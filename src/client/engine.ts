// The request engine: turns logical (method, path, query) calls into HTTP
// requests via a Transport, applies retry/backoff for transient statuses
// (429, 503), and decodes responses.

import { TextDecoder } from "node:util";
import {
  MAX_TIMEOUT_MS,
  nodeHttpTransport,
  sizeLimitMessage,
  type HttpRequest,
  type HttpResponse,
  type Transport,
} from "./http.js";
import { buildQueryString, type QueryParams } from "./query.js";
import {
  LobbyApiError,
  LobbyError,
  LobbyNetworkError,
  LobbyParseError,
  LobbyValidationError,
  credentialsIn,
  redactCredentials,
  redactUrl,
} from "./errors.js";
import { assertValid, headerNameProblem, headerValueProblem, intInRangeProblem, type Problem } from "./validate.js";

export const DEFAULT_BASE_URL = "https://www.lobbyregister.bundestag.de";
const DEFAULT_USER_AGENT = "lobbyregister-cli";

export interface RawResponse {
  data: Buffer;
  contentType: string;
  status: number;
}

export interface EngineOptions {
  /** Base URL of the API. Defaults to https://www.lobbyregister.bundestag.de */
  baseUrl?: string;
  /** Swappable transport. Defaults to the built-in node http/https transport. */
  transport?: Transport;
  /**
   * Value of the User-Agent header (default `lobbyregister-cli`). A blank value, a
   * control character other than tab, or a character above U+00FF throws a
   * `LobbyValidationError`.
   */
  userAgent?: string;
  /**
   * Extra headers sent on every request to the configured origin (e.g. an
   * Authorization token for a future authenticated endpoint). When a redirect
   * crosses to a different origin, all of them are dropped (only the engine's own
   * Accept and User-Agent go along), so no credential — Authorization,
   * Proxy-Authorization, Cookie, X-API-Key, X-Auth-Token or any other — leaks to an
   * arbitrary host named in Location. Names must be HTTP tokens and values are
   * checked like `userAgent`.
   */
  headers?: Record<string, string>;
  /**
   * Time limit per request in milliseconds, covering the whole response body, not
   * only idle gaps: an integer 0..`MAX_TIMEOUT_MS` (2^31 - 1, the largest timer
   * Node supports); 0 disables. Defaults to 30000.
   */
  timeoutMs?: number;
  /**
   * Number of automatic retries for transient (429/503) responses and reset
   * connections (ECONNRESET, EPIPE, ECONNABORTED, undici's UND_ERR_SOCKET, anywhere in
   * the error's `cause` chain; GET and HEAD only), a non-negative integer. Defaults
   * to 2. Timeouts are not retried. Each retry waits `retryDelayMs * attempt`, or the
   * response's `Retry-After` when that is longer (capped at 60 s).
   */
  maxRetries?: number;
  /**
   * Base backoff between retries in milliseconds (grows linearly), an integer from 0
   * to 60 000 (the Retry-After cap). Defaults to 200. A `Retry-After` can make a wait
   * longer, never shorter.
   */
  retryDelayMs?: number;
  /**
   * Number of HTTP redirects (301/302/303/307/308) to follow, a non-negative
   * integer (0 = none). Defaults to 5.
   */
  maxRedirects?: number;
  /**
   * Hard cap on response body size in bytes (defends against memory exhaustion
   * from a hostile/buggy endpoint), a non-negative integer. Defaults to 100 MiB;
   * set to 0 for no limit.
   */
  maxResponseBytes?: number;
  /** Injectable sleep, primarily for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

// The headers the engine sets itself, under the exact keys it uses. They are the
// only ones that follow a cross-origin redirect.
const ENGINE_HEADERS = new Set(["Accept", "User-Agent"]);

/**
 * The register's error page. `/sucheJson` answers a query it cannot parse (an
 * unbalanced quote or parenthesis, a very long query) with `302 Location: /fehler`,
 * an HTML page; following it used to end in "Unexpected content type text/html".
 */
const ERROR_PAGE_PATH = /(^|\/)fehler\/?$/;

/** The message for a redirect to the register's error page. */
const ERROR_PAGE_DETAIL =
  "the register rejected the request: it redirected to its error page (/fehler) instead of answering, " +
  "which it does for a query it cannot parse, such as an unbalanced quote or parenthesis (\"Tabak, Tabak ( ) " +
  "or a very long query";

/** True when `a` and `b` parse and share scheme, host and port; false otherwise. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Why a 401/403 after a redirect to another origin may not be the credentials' fault:
 * the engine did not send the caller's headers there. An http->https upgrade on the
 * same host gets its own advice.
 */
function credentialsDroppedHint(from: URL, to: URL): string {
  if (from.protocol === "http:" && to.protocol === "https:" && from.hostname === to.hostname) {
    return "the server redirected http to https, so the credential headers were not sent there; use an https base URL";
  }
  return (
    `the server redirected to another origin (${to.origin}), so the credential headers were not sent there; ` +
    "use that origin as the base URL if it should get them"
  );
}

/**
 * A copy of `headers` without any caller-supplied header (used on cross-origin
 * redirects). A list of known credential headers is never complete
 * (Proxy-Authorization, X-Auth-Token, ...), so only the engine's own
 * non-credential headers are kept.
 */
function engineHeadersOnly(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => ENGINE_HEADERS.has(key)));
}

/**
 * Strip control characters (all C0/C1 except tab and newline, plus DEL) out of a
 * string that originates in an attacker-controlled response — the error `detail`
 * and the echoed Content-Type. `JSON.parse` decodes an escaped ESC in an error
 * body into a real ESC byte, so without this a hostile/MITM'd endpoint could drive
 * ANSI/OSC escape sequences into the user's terminal when the message is printed
 * to stderr. The CLI's JSON output is escaped separately (`escapeControlChars` in
 * cli/shared.ts): `JSON.stringify` alone leaves DEL and the C1 range raw. So this
 * only needs to cover text that flows into an error message. Built with a
 * char-code filter so no raw control byte ever appears in this source file.
 */
function sanitizeServerText(text: string): string {
  let out = "";
  for (const ch of text) {
    const n = ch.codePointAt(0) ?? 0;
    if (n <= 8 || (n >= 0x0b && n <= 0x1f) || (n >= 0x7f && n <= 0x9f)) continue;
    out += ch;
  }
  return out;
}

/**
 * Longest server text (in characters) kept for an error message: an error `detail`, a
 * transport's error text or a redirect target. A longer one is cut and ends in "…", so a
 * hostile or buggy body cannot flood stderr or a CI log with one huge line.
 * `LobbyApiError.body` keeps the full text.
 */
const MAX_DETAIL_LENGTH = 500;

/** sanitizeServerText, then cut at MAX_DETAIL_LENGTH characters. */
function cleanDetail(text: string): string {
  const clean = sanitizeServerText(text);
  return clean.length > MAX_DETAIL_LENGTH ? `${clean.slice(0, MAX_DETAIL_LENGTH)}…` : clean;
}

/**
 * Read a function option: `undefined` gives the default; anything else that is not a
 * function throws a `LobbyValidationError`. A string `transport` used to fail at the
 * first request as a raw TypeError, and a bad `sleep` on the first retry.
 */
function functionOption<F extends (...args: never[]) => unknown>(name: string, value: F | undefined, fallback: F): F {
  if (value === undefined) return fallback;
  if (typeof value !== "function") {
    throw new LobbyValidationError(`Invalid ${name}: Expected a function, got ${value === null ? "null" : typeof value}.`);
  }
  return value;
}

/**
 * A base URL must be an absolute http(s) URL. The default transport already gates
 * the scheme per hop, but the engine is exported as a library and may be handed a
 * custom transport that does no such check, so the configured base URL is checked
 * up front too (a `file:`/`ftp:` base URL fails fast). The reasons match the CLI's
 * `--base-url` parser, which calls this rule.
 */
export const baseUrlProblem: Problem<unknown> = (value) => {
  if (typeof value !== "string") return "Expected an absolute http(s) URL.";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Expected an absolute http(s) URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `Unsupported scheme "${url.protocol}". Expected an http(s) URL.`;
  }
  return undefined;
};

/**
 * Check a base URL (baseUrlProblem) and return it with trailing slashes stripped.
 * A bad one is a configuration error, not a transport failure: it throws
 * `LobbyValidationError` ("Invalid baseUrl: ..."), before any request.
 */
export function validateBaseUrl(raw: string): string {
  return assertValid("baseUrl", raw, baseUrlProblem).replace(/\/+$/, "");
}

/**
 * A numeric engine option: `fallback` when undefined, else an integer in 0..max,
 * or a `LobbyValidationError` (`Invalid <name>: ...`). A negative, NaN or
 * fractional value would otherwise silently disable the timeout, the size cap or
 * the redirect limit, and Infinity would retry without end.
 */
export function intOption(name: string, value: number | undefined, max: number, fallback: number): number {
  return value === undefined ? fallback : assertValid(name, value, intInRangeProblem(0, max));
}

/**
 * Check a value bound for an HTTP header (see `headerValueProblem`) and return it
 * unchanged; anything else throws a `LobbyValidationError` naming `name`
 * ("Invalid userAgent: Value contains control characters.").
 */
export function assertHeaderValue(name: string, value: string): string {
  return assertValid(name, value, headerValueProblem);
}

/** Check every name and value of the `headers` option, returning a copy. */
function headerOption(headers: Record<string, string> | undefined): Record<string, string> {
  if (headers === undefined) return {};
  assertValid("headers", headers, (v) =>
    typeof v === "object" && v !== null && !Array.isArray(v) ? undefined : "Expected an object of header names to values.",
  );
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    assertValid("header name", name, headerNameProblem);
    out[name] = assertHeaderValue(`headers["${name}"]`, value);
  }
  return out;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Upper bound on a server-dictated Retry-After delay, so a hostile or misbehaving
// endpoint cannot park the client for an arbitrarily long time.
const MAX_RETRY_AFTER_MS = 60_000;

/** RFC 9110's preferred HTTP-date format (IMF-fixdate), e.g. `Wed, 21 Oct 2026 07:28:00 GMT`. */
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Parse an HTTP `Retry-After` header into a delay in milliseconds. Supports both
 * forms from RFC 9110: a delta in seconds (`Retry-After: 5`) and an HTTP-date in
 * IMF-fixdate form (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`). Returns
 * `undefined` when the header is absent or invalid (so the caller falls back to
 * linear backoff), and clamps to `[0, MAX_RETRY_AFTER_MS]`. Only the IMF-fixdate
 * shape goes to `Date.parse`: V8 reads "-1" or "1.5" as dates (year -1,
 * 2001-01-05), which would mean "retry immediately".
 */
export function parseRetryAfter(value: string | undefined, now: number = Date.now()): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS);
  }
  const dateMs = IMF_FIXDATE.test(trimmed) ? Date.parse(trimmed) : Number.NaN;
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(dateMs - now, 0), MAX_RETRY_AFTER_MS);
  }
  return undefined;
}

/** Why `value` is not a usable HttpResponse, or undefined when it is. */
function responseProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "not an object";
  const r = value as Partial<Record<"status" | "headers" | "body", unknown>>;
  if (typeof r.status !== "number" || !Number.isInteger(r.status) || r.status < 100 || r.status > 599) {
    return "status is not an HTTP status code";
  }
  if (typeof r.headers !== "object" || r.headers === null || Array.isArray(r.headers)) return "headers is not an object";
  if (bodyBytes(r.body) === undefined) return "body is not a Buffer, Uint8Array, other ArrayBuffer view or ArrayBuffer";
  return undefined;
}

/**
 * The response body as a Buffer (a view, no copy): a Buffer, any ArrayBuffer view (a
 * Uint8Array from fetch, a DataView) or an ArrayBuffer/SharedArrayBuffer — checked by
 * internal slot, not `instanceof`, so a value from another realm (a vm context, a Jest
 * test) counts. Undefined for anything else. (`Uint8Array#toString` ignores an encoding
 * argument and yields "123,34,…", which is how a fetch body used to fail to parse.)
 */
function bodyBytes(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]") return Buffer.from(value as ArrayBuffer);
  return undefined;
}

/**
 * The response headers as a plain record with lower-case names. A transport built on
 * `fetch` naturally returns its `Headers` object, which has no plain properties, and a
 * custom one may write `Retry-After` or `Location` capitalised: the engine then saw no
 * Retry-After (and retried after the short backoff), no Location (and failed the
 * redirect) and no Content-Type (and skipped the JSON check). Such an object (anything
 * with `get` and `forEach`, a `Map` included) is copied; a plain record gets its names
 * lower-cased.
 */
function plainHeaders(headers: object): Record<string, string | string[] | undefined> {
  const h = headers as { get?: unknown; forEach?: unknown };
  if (typeof h.get === "function" && typeof h.forEach === "function") {
    const record: Record<string, string> = {};
    (h.forEach as (cb: (value: unknown, name: unknown) => void) => void).call(headers, (value, name) => {
      // Headers#forEach gives (value, name), and so does Map#forEach.
      record[String(name).toLowerCase()] = String(value);
    });
    return record;
  }
  const record: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    record[name.toLowerCase()] = value;
  }
  return record;
}

/** One header value as a string (the first of a repeated one), or undefined. */
function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Error codes of a connection that broke off mid-request: Node's (`socket hang up` is
 * ECONNRESET) and undici's (`fetch failed` with cause UND_ERR_SOCKET, "other side closed").
 */
const TRANSIENT_NETWORK_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED", "UND_ERR_SOCKET"]);

/** True when `err` or an error in its `cause` chain has a transient connection code. */
function hasTransientCode(err: unknown, depth = 0): boolean {
  if (typeof err !== "object" || err === null || depth > 4) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) return true;
  return hasTransientCode((err as { cause?: unknown }).cause, depth + 1);
}

/**
 * True for a LobbyNetworkError caused by a reset or aborted connection, which the
 * engine retries — whichever transport raised it (a Node error, fetch's TypeError with
 * an undici cause). A refused connection, a DNS failure or a timeout is not transient
 * in that sense and is not retried.
 */
export function isTransientNetworkError(err: unknown): boolean {
  return err instanceof LobbyNetworkError && hasTransientCode(err.cause);
}

export class RequestEngine {
  // Real private fields (not TypeScript's `private`): util.inspect, console.log and
  // JSON.stringify of an engine or client never show them, so a password in the base
  // URL, or an Authorization header a caller added, can't be logged by accident.
  readonly #baseUrl: string;
  /** The base URL's userinfo, raw and percent-decoded, for scrubbing server and transport text. */
  readonly #credentials: string[];
  readonly #extraHeaders: Record<string, string>;
  private readonly transport: Transport;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EngineOptions = {}) {
    // A JavaScript caller may pass null for "no options"; treat it like undefined.
    options = options ?? {};
    // Check the base URL here, not only its scheme in the default transport: a
    // library consumer that injects a custom transport would otherwise get no
    // gating at all, and could be steered to a non-http(s) scheme.
    this.#baseUrl = validateBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.#credentials = credentialsIn(this.#baseUrl).flatMap((raw) => {
      try {
        return [raw, decodeURIComponent(raw)];
      } catch {
        return [raw];
      }
    });
    this.transport = functionOption("transport", options.transport, nodeHttpTransport);
    // Only an omitted userAgent selects the default: a blank one is an error, not
    // a silent replacement, and a malformed one fails here rather than at request
    // time (or, with a custom transport, not at all).
    this.userAgent =
      options.userAgent === undefined ? DEFAULT_USER_AGENT : assertHeaderValue("userAgent", options.userAgent);
    this.#extraHeaders = headerOption(options.headers);
    // Range-check the numeric options before any request (see intOption).
    const anyInt = Number.MAX_SAFE_INTEGER;
    this.timeoutMs = intOption("timeoutMs", options.timeoutMs, MAX_TIMEOUT_MS, 30_000);
    this.maxRetries = intOption("maxRetries", options.maxRetries, anyInt, 2);
    // Bounded like a Retry-After: a larger value (above 2^31 - 1 ms) overflowed Node's
    // timers, which fire after 1 ms instead, so the retries went out back to back.
    this.retryDelayMs = intOption("retryDelayMs", options.retryDelayMs, MAX_RETRY_AFTER_MS, 200);
    this.maxRedirects = intOption("maxRedirects", options.maxRedirects, anyInt, 5);
    this.maxResponseBytes = intOption("maxResponseBytes", options.maxResponseBytes, anyInt, DEFAULT_MAX_RESPONSE_BYTES);
    this.sleep = functionOption("sleep", options.sleep, realSleep);
  }

  /** Build a fully-qualified URL from a path and optional query parameters. */
  buildUrl(path: string, query?: QueryParams): string {
    // Parse the base URL so a query string or fragment carried in it cannot
    // corrupt the request: naive string concatenation would otherwise append
    // `/sucheJson?…` *inside* an existing `?query` value, or — worse — have the
    // whole endpoint path swallowed by a `#fragment` (silently dropping the
    // query). We take only the base's scheme/host/path and attach our own path
    // and query, discarding any stray query/fragment on the base URL.
    let base: URL;
    try {
      base = new URL(this.#baseUrl);
    } catch {
      throw new LobbyNetworkError(`Invalid base URL: ${redactUrl(this.#baseUrl)}`);
    }
    const basePath = base.pathname.replace(/\/+$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const qs = query ? buildQueryString(query) : "";
    return `${base.protocol}//${base.host}${basePath}${normalizedPath}${qs ? `?${qs}` : ""}`;
  }

  /**
   * `text` without the base URL's credentials: server text (an error body that echoes
   * the request URL) and transport text (fetch's "Failed to fetch <url>") can carry them.
   */
  private scrub(text: string): string {
    return this.#credentials.length === 0 ? text : redactCredentials(text, this.#credentials);
  }

  /**
   * A transport failure as the `cause` of the error the engine raises: the original
   * when its text carries no credentials, otherwise a copy with them scrubbed (message,
   * `code` and the cause chain kept), so logging the error with its causes can't reveal
   * the base URL's password.
   */
  private scrubCause(cause: unknown, depth = 0): unknown {
    if (this.#credentials.length === 0 || depth > 5) return cause;
    if (typeof cause === "string") return this.scrub(cause);
    if (!(cause instanceof Error)) return cause;
    const inner = this.scrubCause(cause.cause, depth + 1);
    const message = this.scrub(cause.message);
    if (message === cause.message && inner === cause.cause && !this.scrub(cause.stack ?? "").includes("***@")) return cause;
    const copy = new Error(message, inner === undefined ? undefined : { cause: inner });
    copy.name = cause.name;
    const code = (cause as { code?: unknown }).code;
    if (code !== undefined) Object.assign(copy, { code });
    return copy;
  }

  /**
   * Call the transport under the overall deadline (`timeoutMs`): the request gets an
   * AbortSignal that fires at the deadline, and the call rejects then whether the
   * transport stops or not — a custom transport (fetch, a node:http wrapper) that
   * ignores `timeoutMs` can't hang the caller. A synchronous throw becomes a rejection.
   */
  private async callTransport(request: HttpRequest): Promise<HttpResponse> {
    const call = (signal?: AbortSignal): Promise<HttpResponse> =>
      Promise.resolve().then(() => this.transport(signal === undefined ? request : { ...request, signal }));
    if (this.timeoutMs === 0) return call();
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new LobbyNetworkError(`Request timed out after ${this.timeoutMs}ms`);
        controller.abort(err);
        reject(err);
      }, this.timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([call(controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Perform a request with Accept negotiation and transient-error retries. */
  async request(
    method: string,
    path: string,
    options: { query?: QueryParams; accept: string } = { accept: "application/json" },
  ): Promise<RawResponse> {
    let url = this.buildUrl(path, options.query);
    let headers: Record<string, string> = {
      ...this.#extraHeaders,
      Accept: options.accept,
      "User-Agent": this.userAgent,
    };

    // Only an idempotent request is sent again after a reset: request() is public, and
    // a POST re-sent after a broken connection may be applied twice. The client itself
    // sends GETs only.
    const idempotent = /^(GET|HEAD)$/i.test(method);
    let attempt = 0;
    let redirects = 0;
    /** Where a redirect to another origin dropped the caller's headers, for the 401/403 hint. */
    let droppedCredentialsAt: { from: URL; to: URL } | undefined;
    // attempts = initial try + maxRetries (redirects are counted separately)
    for (;;) {
      let response: HttpResponse;
      try {
        response = await this.callTransport({
          method,
          url,
          headers,
          redirect: "manual",
          timeoutMs: this.timeoutMs,
          ...(this.maxResponseBytes > 0 ? { maxResponseBytes: this.maxResponseBytes } : {}),
        });
      } catch (cause) {
        // A connection the server (or a gateway) reset is the network-level twin of a
        // 503: retry the GET, whichever transport reported it. Timeouts are not retried
        // — a slow upstream should not be asked again at once.
        if (idempotent && hasTransientCode(cause) && attempt < this.maxRetries) {
          attempt += 1;
          await this.sleep(this.retryDelayMs * attempt);
          continue;
        }
        // The default transport rejects with LobbyNetworkError only; an injected one may
        // throw anything (a string, a TypeError, null). Keep the error contract for both:
        // every failure is a LobbyError. The message names the request — Node's text
        // ("socket hang up") says nothing about which request failed — and the original
        // is the `cause`. Any other LobbyError passes through.
        if (cause instanceof LobbyError && !(cause instanceof LobbyNetworkError)) throw cause;
        const reason = cause instanceof Error ? cause.message : String(cause);
        const retried = attempt > 0 ? ` (after ${attempt} ${attempt === 1 ? "retry" : "retries"})` : "";
        throw new LobbyNetworkError(
          `${method} ${redactUrl(url)} failed: ${cleanDetail(this.scrub(reason))}${retried}`,
          { cause: this.scrubCause(cause) },
        );
      }

      // An injected transport may resolve with anything; a malformed HttpResponse would
      // otherwise surface below as a raw TypeError, outside the LobbyError contract.
      const invalid = responseProblem(response);
      if (invalid !== undefined) {
        throw new LobbyNetworkError(
          `${method} ${redactUrl(url)} failed: the transport returned an invalid response (${invalid}).`,
        );
      }
      // Transports must not follow redirects (HttpRequest.redirect is "manual"); fetch does
      // by default. One that reports a final URL on another origin has carried the
      // request — and maybe a credential header fetch doesn't strip — somewhere the
      // engine never vetted, so its answer is not trusted.
      const finalUrl = (response as { url?: unknown }).url;
      if (typeof finalUrl === "string" && finalUrl !== "" && !sameOrigin(finalUrl, url)) {
        throw new LobbyNetworkError(
          `${method} ${redactUrl(url)} failed: the transport followed a redirect to another origin ` +
            `(${cleanDetail(redactUrl(finalUrl))}); a transport must not follow redirects (HttpRequest.redirect is "manual").`,
        );
      }
      const status = response.status;
      const responseHeaders = plainHeaders(response.headers);
      const body = bodyBytes(response.body) as Buffer;
      // The size cap holds whatever the transport did: the default one aborts early, a
      // custom one may have read everything.
      if (this.maxResponseBytes > 0 && body.byteLength > this.maxResponseBytes) {
        throw new LobbyNetworkError(`${method} ${redactUrl(url)} failed: ${sizeLimitMessage(this.maxResponseBytes)}`);
      }

      const retryable = status === 429 || status === 503;
      if (retryable && attempt < this.maxRetries) {
        attempt += 1;
        // Back off linearly from retryDelayMs. A Retry-After header (delta-seconds or an
        // HTTP-date, clamped to MAX_RETRY_AFTER_MS) can ask for longer, never for less:
        // `Retry-After: 0` or a date in the past turned the retries into a zero-delay
        // burst against a server that had just asked for less load.
        const backoff = this.retryDelayMs * attempt;
        const retryAfterMs = parseRetryAfter(headerValue(responseHeaders["retry-after"]));
        await this.sleep(retryAfterMs === undefined ? backoff : Math.min(Math.max(retryAfterMs, backoff), MAX_RETRY_AFTER_MS));
        continue;
      }

      // Follow redirects, resolving the Location relative to the current URL.
      const location = headerValue(responseHeaders["location"]);
      if (status >= 300 && status < 400) {
        const nextUrl = resolveLocation(location, url);
        // The register's error page is no answer: report the rejection instead of
        // fetching an HTML page and failing on its content type.
        if (nextUrl !== undefined && sameOrigin(nextUrl.href, url) && ERROR_PAGE_PATH.test(nextUrl.pathname)) {
          throw new LobbyApiError({
            status,
            url,
            method,
            body: this.scrub(body.toString("utf8")),
            detail: ERROR_PAGE_DETAIL,
            location: cleanDetail(redactUrl(nextUrl.href)),
          });
        }
        if (nextUrl !== undefined) {
          // A redirect we cannot follow because the budget is spent: surface a
          // clear "too many redirects" error rather than a bare 3xx status (which
          // normally implies an *unfollowed* redirect and is confusing here).
          if (redirects >= this.maxRedirects) {
            throw new LobbyNetworkError(
              `Exceeded the maximum of ${this.maxRedirects} redirects (last from ${redactUrl(url)}).`,
            );
          }
          // Credential-strip guard: if the redirect target is a different origin,
          // drop every caller-supplied header so no credential is ever sent to an
          // arbitrary host named in Location. The CLI sets none, but EngineOptions
          // is a public extension surface. Compare full origin (scheme + host +
          // port), not just host, so a same-host https->http *downgrade* also
          // strips — otherwise credentials would cross the wire in cleartext.
          const current = new URL(url);
          if (nextUrl.origin !== current.origin) {
            const kept = engineHeadersOnly(headers);
            if (Object.keys(kept).length < Object.keys(headers).length) {
              droppedCredentialsAt = { from: current, to: nextUrl };
            }
            headers = kept;
          }
          // The engine never sends userinfo — not the base URL's (request URLs are built
          // from its host), and not one a Location names: the default transport would
          // turn `http://mallory:pw@host/` into an Authorization header.
          nextUrl.username = "";
          nextUrl.password = "";
          url = nextUrl.toString();
          redirects += 1;
          continue;
        }
        // A 3xx with no usable Location (missing, or not a valid URL) is
        // malformed; fall through and let the status be surfaced as a
        // LobbyApiError naming the target, rather than looping forever or
        // throwing a raw "Invalid URL" TypeError.
      }

      const contentType = String(headerValue(responseHeaders["content-type"]) ?? "");
      if (status < 200 || status >= 300) {
        const hint =
          (status === 401 || status === 403) && droppedCredentialsAt !== undefined
            ? credentialsDroppedHint(droppedCredentialsAt.from, droppedCredentialsAt.to)
            : undefined;
        throw this.toApiError(method, url, status, body, location, hint);
      }

      return { data: body, contentType, status };
    }
  }

  /** Perform a GET expecting JSON and parse it into `T`. */
  async getJson<T>(path: string, query?: QueryParams): Promise<T> {
    const res = await this.request("GET", path, { query, accept: "application/json" });
    // Guard against a 2xx response that is not actually JSON (e.g. a captive
    // portal or a wildcard-DNS host returning an HTML page). Without this check
    // such a body would surface the misleading "Failed to parse JSON" error.
    // The header may carry a charset/parameters (e.g. "application/json;
    // charset=utf-8"), so match the media type prefix only.
    const mediaType = (res.contentType.split(";", 1)[0] ?? "").trim().toLowerCase();
    if (mediaType && mediaType !== "application/json" && !mediaType.endsWith("+json")) {
      throw new LobbyParseError(
        `Unexpected content type "${cleanDetail(res.contentType)}" from ${path} (expected JSON).`,
      );
    }
    const text = decodeBody(res.data, res.contentType, path);
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new LobbyParseError(`Failed to parse JSON response from ${path}`, { cause });
    }
  }

  private toApiError(
    method: string,
    url: string,
    status: number,
    body: Buffer,
    locationHeader?: string,
    hint?: string,
  ): LobbyApiError {
    const text = this.scrub(body.toString("utf8"));
    let detail: string | undefined;
    try {
      const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown };
      if (parsed && typeof parsed.detail === "string") detail = parsed.detail;
      else if (parsed && typeof parsed.message === "string") detail = parsed.message;
    } catch {
      // Non-JSON error body; leave detail undefined.
    }
    // `detail` came from the response body; strip control characters so a hostile
    // endpoint cannot inject terminal escape sequences via the stderr error message.
    // It is cut at MAX_DETAIL_LENGTH too (the body keeps it all).
    if (detail !== undefined) detail = cleanDetail(detail);
    // Name the target of a redirect that was not followed (server text: sanitised).
    let location: string | undefined;
    if (status >= 300 && status < 400 && locationHeader) {
      const resolved = resolveLocation(locationHeader, url);
      location = cleanDetail(redactUrl(resolved ? resolved.href : locationHeader)).trim() || undefined;
    }
    return new LobbyApiError({ status, url, method, body: text, detail, location, ...(hint !== undefined ? { hint } : {}) });
  }
}

/**
 * Decode a response body by the charset its Content-Type names (UTF-8 when it names
 * none). A proxy or mirror that answers in ISO-8859-1 used to come out as
 * "B\uFFFDndnis" with exit 0. TextDecoder also drops a leading byte order mark, which
 * Buffer#toString keeps and JSON.parse then rejects. An unknown charset label is a
 * LobbyParseError.
 */
function decodeBody(body: Buffer, contentType: string, path: string): string {
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    throw new LobbyParseError(`Unsupported response charset "${cleanDetail(charset)}" from ${path}.`);
  }
  return decoder.decode(body);
}

/**
 * Resolve a Location header against the current URL; undefined if missing, malformed
 * or not http(s). A `file:`, `data:`, `javascript:` or `ftp:` target is refused here,
 * before any transport sees it (the default transport would refuse it too; a custom
 * one may not), and surfaces as a LobbyApiError naming the target.
 */
function resolveLocation(location: string | undefined, base: string): URL | undefined {
  if (location === undefined || location === "") return undefined;
  try {
    const next = new URL(location, base);
    return next.protocol === "http:" || next.protocol === "https:" ? next : undefined;
  } catch {
    return undefined;
  }
}
