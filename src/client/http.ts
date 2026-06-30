// HTTP transport built on Node's built-in `http`/`https` modules — no axios,
// no fetch polyfill, no third-party HTTP client.
//
// The transport is a plain function so it can be trivially swapped out in tests
// (inject a `mock.fn()` returning a canned HttpResponse) without touching the
// network. The default implementation below is exercised against a real local
// `http.createServer` in the test-suite.

import http from "node:http";
import https from "node:https";
import { LobbyNetworkError } from "./errors.js";

export interface HttpRequest {
  method: string;
  /** Fully-qualified absolute URL. */
  url: string;
  headers?: Record<string, string>;
  /** Optional request body (already serialised). */
  body?: string | Buffer;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Hard cap on the response body size in bytes; the request aborts if exceeded. */
  maxResponseBytes?: number;
}

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

/** Largest delay Node's setTimeout accepts without truncating (2^31 - 1 ms). */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Default transport. Resolves with the raw response (including non-2xx) — status
 * interpretation is the client's job. Rejects only on transport-level failures
 * (connection errors, timeouts, malformed URLs).
 */
export const nodeHttpTransport: Transport = (request) =>
  new Promise<HttpResponse>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      reject(new LobbyNetworkError(`Invalid URL: ${request.url}`));
      return;
    }

    // Only http/https are supported. Reject anything else up front with a clear,
    // typed error instead of letting Node throw an opaque ERR_INVALID_PROTOCOL
    // (and so this never reaches the file:/ftp:/etc. drivers).
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new LobbyNetworkError(`Unsupported protocol "${url.protocol}" in URL: ${request.url}`));
      return;
    }

    const isHttps = url.protocol === "https:";
    const driver = isHttps ? https : http;
    const maxBytes = request.maxResponseBytes;

    // Building the request can throw synchronously when a header value is invalid
    // (e.g. a User-Agent with a newline or a non-ASCII character — Node guards
    // against header injection). Wrap it so that surfaces as a typed
    // LobbyNetworkError instead of an opaque "Unexpected error".
    let req: http.ClientRequest;
    try {
      req = driver.request(
        url,
        {
          method: request.method,
          headers: request.headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let received = 0;
          let aborted = false;

          res.on("data", (chunk: Buffer) => {
            if (aborted) return;
            received += chunk.length;
            if (maxBytes !== undefined && received > maxBytes) {
              aborted = true;
              res.destroy();
              reject(new LobbyNetworkError(`Response exceeded maxResponseBytes (${maxBytes})`));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            if (aborted) return;
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
          });
          res.on("error", (err) => {
            if (aborted) return; // we already rejected with the size-cap error
            reject(new LobbyNetworkError(`Response stream error: ${err.message}`, { cause: err }));
          });
        },
      );
    } catch (err) {
      reject(
        err instanceof LobbyNetworkError
          ? err
          : new LobbyNetworkError(
              `Invalid request: ${err instanceof Error ? err.message : String(err)}`,
              { cause: err },
            ),
      );
      return;
    }

    if (request.timeoutMs && request.timeoutMs > 0) {
      // Node's timers are backed by a 32-bit signed integer; a larger delay emits
      // a TimeoutOverflowWarning on stderr and is silently truncated. The option
      // parser accepts values up to Number.MAX_SAFE_INTEGER, so clamp here to keep
      // that internal warning out of the user's terminal. (~24.8 days is already
      // an effectively-unbounded request timeout.)
      const timeoutMs = Math.min(request.timeoutMs, MAX_TIMER_MS);
      req.setTimeout(timeoutMs, () => {
        req.destroy(new LobbyNetworkError(`Request timed out after ${timeoutMs}ms`));
      });
    }

    req.on("error", (err) => {
      // A timeout destroy already passes an LobbyNetworkError; don't double-wrap.
      if (err instanceof LobbyNetworkError) {
        reject(err);
        return;
      }
      // A TLS handshake against a plaintext server fails with EPROTO ("wrong
      // version number"). The raw OpenSSL message is inscrutable, so add a hint
      // pointing at the most likely cause: an https:// base URL for an http host.
      const code = (err as NodeJS.ErrnoException).code;
      const hint =
        code === "EPROTO"
          ? " (the server may not speak TLS — try an http:// base URL)"
          : "";
      reject(new LobbyNetworkError(`${err.message}${hint}`, { cause: err }));
    });

    if (request.body !== undefined) req.write(request.body);
    req.end();
  });
