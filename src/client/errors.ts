// Error types raised by the client. Kept free of any I/O so they are trivial to
// construct in tests and to `instanceof`-check by consumers.

/** Base class for every error originating from this client. */
export class LobbyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Replace the userinfo of a URL (`https://user:secret@host/...`) with `***`, so a
 * credential in a base URL never reaches an error message, a log or CI output.
 * A value that does not parse as a URL (a port typo, an unencoded "#" in the
 * password) or has no scheme (`user:pw@host`) is cut by text instead
 * (`credentialsIn` + `redactCredentials`); one without userinfo is returned unchanged.
 */
export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return redactCredentials(url, credentialsIn(url));
  }
  // `user:pw@host` without a scheme parses as a URL with the scheme "user:": no userinfo.
  if (parsed.username === "" && parsed.password === "") return redactCredentials(url, credentialsIn(url));
  parsed.username = "***";
  parsed.password = "";
  return parsed.href;
}

/**
 * The userinfo a URL-like value carries, exactly as written — `["alice:pa#ss"]` for
 * `https://alice:pa#ss@host` — or `[]` when it carries none. It works on values that
 * don't parse as a URL too, and on values with a prefix (`--base-url=https://u:p@h`):
 * the userinfo is everything between `://` and the last `@` before the host. A value
 * without a scheme counts when it reads `user:password@host`. Used to redact those
 * exact strings from text that echoes the value (usage errors, help), whatever
 * characters the password contains.
 */
export function credentialsIn(value: string): string[] {
  const schemeAt = value.indexOf("://");
  const rest = schemeAt >= 0 ? value.slice(schemeAt + 3) : value;
  // Without a scheme only the unmistakable `user:password@host` form counts.
  if (schemeAt < 0 && !/^[^\s/@:]+:[^@]*@[^@\s/]/.test(rest)) return [];
  // The URL itself starts at its scheme (`--base-url=https://…` has a prefix).
  const scheme = schemeAt >= 0 ? /[a-z][a-z0-9+.-]*$/i.exec(value.slice(0, schemeAt)) : null;
  let parses = false;
  try {
    new URL(schemeAt >= 0 ? value.slice(scheme?.index ?? schemeAt) : `http://${rest}`);
    parses = true;
  } catch {
    // Doesn't parse: the password may hold "/", "?", "#" or spaces.
  }
  // In a URL that parses, the userinfo ends at the last "@" of the authority (before
  // the first "/", "?" or "#"); in one that doesn't, at the last "@" of the value.
  const authority = parses ? rest.slice(0, rest.search(/[/?#]|$/)) : rest;
  const end = authority.lastIndexOf("@");
  return end > 0 ? [rest.slice(0, end)] : [];
}

/**
 * `text` with every occurrence of each credential (as `credentialsIn` returns them)
 * that is followed by `@` replaced by `***`. Matching the exact strings, not a
 * pattern, covers passwords with spaces, quotes, `#`, `?` or `/` that no URL pattern
 * can delimit. The percent-encoded form (`alice%3Apw%40`, as a URL typed as a search
 * term ends up in a request URL) is replaced too.
 */
export function redactCredentials(text: string, credentials: readonly string[]): string {
  let out = text;
  for (const secret of credentials) {
    if (secret === "") continue;
    out = out.split(`${secret}@`).join("***@");
    out = out.split(`${encodeURIComponent(secret)}%40`).join("***%40");
  }
  return out;
}

/** Maximum URL length echoed into a human-readable error message. */
const MAX_URL_IN_MESSAGE = 200;

/** Shorten an overly long URL for display, keeping head and tail context. */
function truncateUrl(url: string): string {
  if (url.length <= MAX_URL_IN_MESSAGE) return url;
  const head = url.slice(0, MAX_URL_IN_MESSAGE - 40);
  const tail = url.slice(-20);
  return `${head}…[${url.length} chars]…${tail}`;
}

/**
 * The API responded with a non-2xx status code. `detail` holds a human-readable
 * message extracted from the response body when one is present. For a 3xx that
 * was not followed (no Location, or one that is not a valid URL), `location` holds
 * the redirect target as sent (control characters stripped) and the message names
 * it.
 */
export class LobbyApiError extends LobbyError {
  readonly status: number;
  readonly detail: string | undefined;
  readonly url: string;
  readonly method: string;
  readonly body: string;
  readonly location: string | undefined;

  constructor(args: {
    status: number;
    url: string;
    method: string;
    body: string;
    detail?: string;
    location?: string;
    /** Advice appended to the message (e.g. that a redirect dropped the credential headers). */
    hint?: string;
  }) {
    const parts: string[] = [];
    if (args.detail) parts.push(args.detail);
    if (args.status >= 300 && args.status < 400) {
      parts.push(
        args.location
          ? `redirect to ${args.location} not followed`
          : "redirect not followed (no Location header)",
      );
    }
    if (args.hint) parts.push(args.hint);
    const detailPart = parts.length > 0 ? `: ${parts.join("; ")}` : "";
    // Cap the URL in the human-readable message so a pathologically long URL
    // (e.g. a huge query that triggers an HTTP 414) doesn't dump multiple KB to
    // stderr. The full URL remains available on `this.url` for programmatic use.
    // The URL is shown without userinfo: a credential in a base URL or a redirect
    // target must not leak.
    const url = redactUrl(args.url);
    super(`HTTP ${args.status} for ${args.method} ${truncateUrl(url)}${detailPart}`);
    this.status = args.status;
    this.url = url;
    this.method = args.method;
    this.body = args.body;
    this.detail = args.detail;
    this.location = args.location;
  }

  /** True for statuses the API documents as transient and retry-able. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status === 503;
  }
}

/** A transport-level failure (DNS, connection reset, timeout, ...). */
export class LobbyNetworkError extends LobbyError {}

/** The response body could not be parsed as the expected JSON shape. */
export class LobbyParseError extends LobbyError {}

/**
 * A rejected input — a client option or a method argument that breaks one of the
 * library's rules (see validate.ts). Thrown before any request is made; the CLI
 * maps it to its usage exit code (2).
 */
export class LobbyValidationError extends LobbyError {}
