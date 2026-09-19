// The request engine: turns logical (method, path, query) calls into HTTP
// requests via a Transport, applies retry/backoff for transient statuses
// (429, 503), and decodes responses.

import { nodeHttpTransport, type Transport } from "./http.js";
import { buildQueryString, type QueryParams } from "./query.js";
import { LobbyApiError, LobbyNetworkError, LobbyParseError } from "./errors.js";

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
  /** Value of the User-Agent header. */
  userAgent?: string;
  /**
   * Extra headers sent on every request (e.g. an Authorization token for a
   * future authenticated endpoint). Credential-bearing headers (Authorization,
   * Cookie, X-API-Key) are automatically stripped when a redirect crosses to a
   * different origin, so they never leak to an arbitrary host named in Location.
   */
  headers?: Record<string, string>;
  /**
   * Time limit per request in milliseconds, covering the whole response body, not
   * only idle gaps (0 disables).
   */
  timeoutMs?: number;
  /** Number of automatic retries for transient (429/503) responses. */
  maxRetries?: number;
  /** Base backoff between retries in milliseconds (grows linearly). */
  retryDelayMs?: number;
  /** Number of HTTP redirects (301/302/303/307/308) to follow. Defaults to 5. */
  maxRedirects?: number;
  /**
   * Hard cap on response body size in bytes (defends against memory exhaustion
   * from a hostile/buggy endpoint). Defaults to 100 MiB; set to 0 for no limit.
   */
  maxResponseBytes?: number;
  /** Injectable sleep, primarily for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

// Headers that carry credentials and must never follow a cross-origin redirect.
// Matched case-insensitively against the live header keys.
const SENSITIVE_HEADERS = ["authorization", "cookie", "x-api-key"];

/** Remove credential-bearing headers in place (used on cross-origin redirects). */
function stripSensitiveHeaders(headers: Record<string, string>): void {
  for (const key of Object.keys(headers)) {
    if (SENSITIVE_HEADERS.includes(key.toLowerCase())) delete headers[key];
  }
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
 * Reject a base URL whose scheme is not http(s). The default transport already
 * gates this per hop, but the engine is exported as a library and may be handed a
 * custom transport that does no such check, so gate the configured base URL here
 * too (a `file:`/`ftp:` base URL fails fast with a typed error).
 */
function assertHttpScheme(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new LobbyNetworkError(`Invalid base URL: ${baseUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LobbyNetworkError(
      `Unsupported protocol "${url.protocol}" in base URL: ${baseUrl}`,
    );
  }
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Upper bound on a server-dictated Retry-After delay, so a hostile or misbehaving
// endpoint cannot park the client for an arbitrarily long time.
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Parse an HTTP `Retry-After` header into a delay in milliseconds. Supports both
 * forms from RFC 9110: a delta in seconds (`Retry-After: 5`) and an HTTP-date
 * (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`). Returns `undefined` when the
 * header is absent or unparseable (so the caller falls back to linear backoff),
 * and clamps to `[0, MAX_RETRY_AFTER_MS]`.
 */
export function parseRetryAfter(value: string | undefined, now: number = Date.now()): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(dateMs - now, 0), MAX_RETRY_AFTER_MS);
  }
  return undefined;
}

export class RequestEngine {
  private readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly userAgent: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EngineOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    // Re-check the base-URL scheme here, not only in the default transport: a
    // library consumer that injects a custom transport would otherwise get no
    // gating at all, and could be steered to a non-http(s) scheme.
    assertHttpScheme(this.baseUrl);
    this.transport = options.transport ?? nodeHttpTransport;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.extraHeaders = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 200;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.sleep = options.sleep ?? realSleep;
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
      base = new URL(this.baseUrl);
    } catch {
      throw new LobbyNetworkError(`Invalid base URL: ${this.baseUrl}`);
    }
    const basePath = base.pathname.replace(/\/+$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const qs = query ? buildQueryString(query) : "";
    return `${base.protocol}//${base.host}${basePath}${normalizedPath}${qs ? `?${qs}` : ""}`;
  }

  /** Perform a request with Accept negotiation and transient-error retries. */
  async request(
    method: string,
    path: string,
    options: { query?: QueryParams; accept: string } = { accept: "application/json" },
  ): Promise<RawResponse> {
    let url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      ...this.extraHeaders,
      Accept: options.accept,
      "User-Agent": this.userAgent,
    };

    let attempt = 0;
    let redirects = 0;
    // attempts = initial try + maxRetries (redirects are counted separately)
    for (;;) {
      const response = await this.transport({
        method,
        url,
        headers,
        timeoutMs: this.timeoutMs,
        ...(this.maxResponseBytes > 0 ? { maxResponseBytes: this.maxResponseBytes } : {}),
      });

      const status = response.status;
      const retryable = status === 429 || status === 503;
      if (retryable && attempt < this.maxRetries) {
        attempt += 1;
        // Honour a server-provided Retry-After if present (delta-seconds or an
        // HTTP-date), otherwise fall back to linear backoff. A `Retry-After: 0`
        // is respected as an immediate retry (?? only falls through on absent).
        const retryAfterHeader = response.headers["retry-after"];
        const retryAfterMs = parseRetryAfter(
          typeof retryAfterHeader === "string" ? retryAfterHeader : undefined,
        );
        await this.sleep(retryAfterMs ?? this.retryDelayMs * attempt);
        continue;
      }

      // Follow redirects, resolving the Location relative to the current URL.
      if (status >= 300 && status < 400) {
        const location = response.headers["location"];
        if (typeof location === "string" && location.length > 0) {
          // A redirect we cannot follow because the budget is spent: surface a
          // clear "too many redirects" error rather than a bare 3xx status (which
          // normally implies an *unfollowed* redirect and is confusing here).
          if (redirects >= this.maxRedirects) {
            throw new LobbyNetworkError(
              `Exceeded the maximum of ${this.maxRedirects} redirects (last from ${url}).`,
            );
          }
          const nextUrl = new URL(location, url);
          // Credential-strip guard: if the redirect target is a different origin,
          // drop any sensitive headers so Authorization/cookie-style credentials
          // are never sent to an arbitrary host named in Location. (This is what
          // fetch/curl do on cross-origin redirects.) The default transport sends
          // none of these today, but EngineOptions is a public extension surface
          // and a future consumer could add them. Compare full origin (scheme +
          // host + port), not just host, so a same-host https->http *downgrade*
          // also strips — otherwise credentials would cross the wire in cleartext.
          if (nextUrl.origin !== new URL(url).origin) {
            stripSensitiveHeaders(headers);
          }
          url = nextUrl.toString();
          redirects += 1;
          continue;
        }
        // A 3xx with no usable Location is malformed; fall through and let the
        // status be surfaced as a LobbyApiError rather than looping forever.
      }

      const contentType = String(response.headers["content-type"] ?? "");
      if (status < 200 || status >= 300) {
        throw this.toApiError(method, url, status, response.body);
      }

      return { data: response.body, contentType, status };
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
        `Unexpected content type "${sanitizeServerText(res.contentType)}" from ${path} (expected JSON).`,
      );
    }
    const text = res.data.toString("utf8");
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new LobbyParseError(`Failed to parse JSON response from ${path}`, { cause });
    }
  }

  private toApiError(method: string, url: string, status: number, body: Buffer): LobbyApiError {
    const text = body.toString("utf8");
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
    if (detail !== undefined) detail = sanitizeServerText(detail);
    return new LobbyApiError({ status, url, method, body: text, detail });
  }
}
