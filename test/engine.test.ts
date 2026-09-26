import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestEngine, parseRetryAfter } from "../src/client/engine.js";
import { LobbyApiError, LobbyNetworkError, LobbyParseError } from "../src/client/errors.js";
import {
  makeMockTransport,
  jsonResponse,
  rawResponse,
  redirectResponse,
  redirectWithoutLocation,
} from "./helpers.js";

test("buildUrl normalises the path and appends the query", () => {
  const e = new RequestEngine({ baseUrl: "https://example.test/" });
  assert.equal(e.buildUrl("sucheJson"), "https://example.test/sucheJson");
  assert.equal(
    e.buildUrl("/x", { a: "1", b: ["2", "3"] }),
    "https://example.test/x?a=1&b=2&b=3",
  );
});

test("buildUrl keeps a path component in the base URL", () => {
  const e = new RequestEngine({ baseUrl: "https://example.test/api" });
  assert.equal(e.buildUrl("/sucheJson", { q: "x" }), "https://example.test/api/sucheJson?q=x");
});

test("buildUrl ignores a fragment in the base URL (no path/query loss)", () => {
  const e = new RequestEngine({ baseUrl: "https://example.test/api#frag" });
  // Without the fix, the #frag would swallow /sucheJson?q=x entirely.
  assert.equal(e.buildUrl("/sucheJson", { q: "x" }), "https://example.test/api/sucheJson?q=x");
});

test("buildUrl ignores a query string in the base URL (no malformed URL)", () => {
  const e = new RequestEngine({ baseUrl: "https://example.test/api?foo=bar" });
  assert.equal(e.buildUrl("/sucheJson", { q: "x" }), "https://example.test/api/sucheJson?q=x");
});

test("a syntactically invalid base URL is rejected at construction", () => {
  assert.throws(() => new RequestEngine({ baseUrl: "not-a-url" }), LobbyNetworkError);
});

test("getJson parses a JSON body", async () => {
  const mt = makeMockTransport(() => jsonResponse({ ok: true }));
  const e = new RequestEngine({ transport: mt.transport });
  assert.deepEqual(await e.getJson("/x"), { ok: true });
});

test("getJson throws LobbyParseError on invalid JSON", async () => {
  const mt = makeMockTransport(() => rawResponse("not json", "application/json"));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(() => e.getJson("/x"), LobbyParseError);
});

test("a 503 is retried up to maxRetries then surfaces as LobbyApiError", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return jsonResponse({ detail: "busy" }, 503);
  });
  const e = new RequestEngine({
    transport: mt.transport,
    maxRetries: 2,
    sleep: async () => {},
  });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) => err instanceof LobbyApiError && err.status === 503,
  );
  assert.equal(calls, 3); // initial + 2 retries
});

test("parseRetryAfter understands delta-seconds, HTTP-date and junk", () => {
  assert.equal(parseRetryAfter("5"), 5000);
  assert.equal(parseRetryAfter("0"), 0);
  assert.equal(parseRetryAfter(undefined), undefined);
  assert.equal(parseRetryAfter("   "), undefined);
  assert.equal(parseRetryAfter("soon"), undefined);
  // clamps to the 60s ceiling
  assert.equal(parseRetryAfter("100000"), 60_000);
  // HTTP-date relative to an injected "now"
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(parseRetryAfter("Thu, 01 Jan 2026 00:00:03 GMT", now), 3000);
  // a past date floors at 0
  assert.equal(parseRetryAfter("Thu, 01 Jan 2026 00:00:00 GMT", now + 10_000), 0);
  // invalid values fall back to linear backoff, never "retry at once"
  for (const bad of ["-1", "1.5", "+5", "1e3", "0x10", "2026-01-01T00:00:03Z", "Thursday, 01-Jan-26 00:00:03 GMT", "Thu Jan  1 00:00:03 2026"]) {
    assert.equal(parseRetryAfter(bad, now), undefined, bad);
  }
});

test("a 503 with an invalid Retry-After uses linear backoff", async () => {
  const delays: number[] = [];
  const mt = makeMockTransport(() => ({
    status: 503,
    headers: { "content-type": "application/json", "retry-after": "1.5" },
    body: Buffer.from("{}"),
  }));
  const e = new RequestEngine({ transport: mt.transport, maxRetries: 2, retryDelayMs: 200, sleep: async (ms) => { delays.push(ms); } });
  await assert.rejects(() => e.getJson("/x"), LobbyApiError);
  assert.deepEqual(delays, [200, 400]);
});

test("a 503 with Retry-After honours it over linear backoff", async () => {
  const delays: number[] = [];
  const mt = makeMockTransport(() => ({
    status: 503,
    headers: { "retry-after": "2" },
    body: Buffer.from("{}"),
  }));
  const e = new RequestEngine({
    transport: mt.transport,
    maxRetries: 1,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  await assert.rejects(() => e.getJson("/x"), LobbyApiError);
  assert.deepEqual(delays, [2000]); // honoured Retry-After (2s), not linear 200ms
});

test("without Retry-After, retries use linear backoff", async () => {
  const delays: number[] = [];
  const mt = makeMockTransport(() => jsonResponse({ detail: "busy" }, 503));
  const e = new RequestEngine({
    transport: mt.transport,
    maxRetries: 3,
    retryDelayMs: 100,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  await assert.rejects(() => e.getJson("/x"), LobbyApiError);
  assert.deepEqual(delays, [100, 200, 300]); // linear: retryDelayMs * attempt
});

test("a retried request that then succeeds resolves", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return calls === 1 ? jsonResponse({}, 503) : jsonResponse({ ok: 1 });
  });
  const e = new RequestEngine({ transport: mt.transport, sleep: async () => {} });
  assert.deepEqual(await e.getJson("/x"), { ok: 1 });
  assert.equal(calls, 2);
});

test("the User-Agent and Accept headers are sent", async () => {
  const mt = makeMockTransport(() => jsonResponse({}));
  const e = new RequestEngine({ transport: mt.transport, userAgent: "ua/1" });
  await e.getJson("/x");
  assert.equal(mt.last().headers?.["User-Agent"], "ua/1");
  assert.equal(mt.last().headers?.["Accept"], "application/json");
});

test("maxRetries: 0 disables retries (a single 503 surfaces immediately)", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return jsonResponse({}, 503);
  });
  const e = new RequestEngine({ transport: mt.transport, maxRetries: 0, sleep: async () => {} });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) => err instanceof LobbyApiError && err.status === 503,
  );
  assert.equal(calls, 1); // no retry
});

test("a same-origin redirect is followed", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return calls === 1
      ? redirectResponse("/moved")
      : jsonResponse({ ok: true });
  });
  const e = new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport });
  assert.deepEqual(await e.getJson("/x"), { ok: true });
  assert.equal(calls, 2);
  assert.equal(new URL(mt.last().url).pathname, "/moved");
});

test("a same-origin redirect preserves credential headers", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return calls === 1 ? redirectResponse("/moved") : jsonResponse({ ok: true });
  });
  const e = new RequestEngine({
    baseUrl: "https://example.test",
    transport: mt.transport,
    headers: { Authorization: "Bearer secret", "X-API-Key": "k", Cookie: "s=1" },
  });
  await e.getJson("/x");
  const headers = mt.last().headers ?? {};
  assert.equal(headers["Authorization"], "Bearer secret");
  assert.equal(headers["X-API-Key"], "k");
  assert.equal(headers["Cookie"], "s=1");
});

test("a cross-origin redirect strips credential headers", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return calls === 1
      ? redirectResponse("https://evil.test/steal")
      : jsonResponse({ ok: true });
  });
  const e = new RequestEngine({
    baseUrl: "https://example.test",
    transport: mt.transport,
    headers: { Authorization: "Bearer secret", "X-API-Key": "k", Cookie: "s=1" },
  });
  await e.getJson("/x");
  const second = mt.calls[1]?.headers ?? {};
  // The redirected request went to evil.test with no credentials.
  assert.equal(new URL(mt.last().url).host, "evil.test");
  assert.equal(second["Authorization"], undefined);
  assert.equal(second["X-API-Key"], undefined);
  assert.equal(second["Cookie"], undefined);
  // Non-sensitive headers still travel.
  assert.equal(second["Accept"], "application/json");
});

test("a cross-origin redirect keeps only Accept and User-Agent (Proxy-Authorization, X-Auth-Token dropped)", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return calls === 1 ? redirectResponse("https://evil.test/steal") : jsonResponse({ ok: true });
  });
  const e = new RequestEngine({
    baseUrl: "https://example.test",
    transport: mt.transport,
    headers: { AUTHORIZATION: "a", "Proxy-Authorization": "p", "X-Auth-Token": "t", "X-Custom": "c" },
  });
  await e.getJson("/x");
  const first = mt.calls[0]?.headers ?? {};
  const second = mt.calls[1]?.headers ?? {};
  assert.deepEqual(Object.keys(second).sort(), ["Accept", "User-Agent"]);
  // The first request (to the configured origin) keeps them, and is not mutated.
  assert.equal(first["Proxy-Authorization"], "p");
  assert.equal(first["X-Auth-Token"], "t");
});

test("a same-host https->http downgrade strips credential headers (LR-01)", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    // Same host and path, but downgraded to cleartext http:.
    return calls === 1
      ? redirectResponse("http://example.test/moved")
      : jsonResponse({ ok: true });
  });
  const e = new RequestEngine({
    baseUrl: "https://example.test",
    transport: mt.transport,
    headers: { Authorization: "Bearer secret", "X-API-Key": "k", Cookie: "s=1" },
  });
  await e.getJson("/x");
  const second = mt.calls[1]?.headers ?? {};
  // The origin differs only by scheme, but credentials must not ride cleartext.
  assert.equal(new URL(mt.last().url).protocol, "http:");
  assert.equal(second["Authorization"], undefined);
  assert.equal(second["X-API-Key"], undefined);
  assert.equal(second["Cookie"], undefined);
});

test("a 3xx with no Location header surfaces as a LobbyApiError", async () => {
  const mt = makeMockTransport(() => redirectWithoutLocation(302));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) =>
      err instanceof LobbyApiError &&
      err.status === 302 &&
      /: redirect not followed \(no Location header\)$/.test(err.message),
  );
});

test("a malformed Location surfaces as a LobbyApiError naming it, not a raw TypeError", async () => {
  for (const maxRedirects of [5, 0]) {
    const mt = makeMockTransport(() => redirectResponse("http://[::1" + ESC + "[2J"));
    const e = new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport, maxRedirects });
    await assert.rejects(
      () => e.getJson("/x"),
      (err) =>
        err instanceof LobbyApiError &&
        err.location === "http://[::1[2J" &&
        err.message === "HTTP 302 for GET https://example.test/x: redirect to http://[::1[2J not followed",
      String(maxRedirects),
    );
    assert.equal(mt.calls.length, 1);
  }
});

test("exceeding maxRedirects raises a clear LobbyNetworkError, not a bare 3xx", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return redirectResponse("/loop");
  });
  const e = new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport, maxRedirects: 2 });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) => err instanceof LobbyNetworkError && /maximum of 2 redirects/.test((err as Error).message),
  );
  assert.equal(calls, 3); // initial + 2 follows, then the limit is hit
});

test("maxRedirects: 0 refuses to follow even the first redirect", async () => {
  const mt = makeMockTransport(() => redirectResponse("/moved"));
  const e = new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport, maxRedirects: 0 });
  await assert.rejects(() => e.getJson("/x"), LobbyNetworkError);
});

// Control chars built via char codes so no raw control byte ever appears here.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const C1 = String.fromCharCode(0x9b); // a C1 control (CSI)

/** True if the string contains any C0/C1 control char except tab/newline. */
function hasControlChars(s: string): boolean {
  return [...s].some((c) => {
    const n = c.charCodeAt(0);
    return n <= 8 || (n >= 0x0b && n <= 0x1f) || (n >= 0x7f && n <= 0x9f);
  });
}

test("error detail is stripped of terminal control characters", async () => {
  // ESC + CSI + BEL interleaved with printable text in a JSON error body. The
  // escaped ESC decodes into a real ESC byte, which must not reach the terminal.
  const evil = `boom${ESC}[31mred${BEL}${C1}2J`;
  const mt = makeMockTransport(() =>
    jsonResponse({ detail: evil }, 500),
  );
  const e = new RequestEngine({ transport: mt.transport, maxRetries: 0 });

  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) => {
      assert.ok(err instanceof LobbyApiError);
      // Control bytes are gone from the structured detail and the printed message.
      assert.ok(!hasControlChars(err.detail ?? ""));
      assert.ok(!hasControlChars(err.message));
      // Printable characters are preserved.
      assert.equal(err.detail, "boom[31mred2J");
      return true;
    },
  );
});

test("an unexpected content type is echoed with control characters stripped", async () => {
  const evilType = `text/html${ESC}[2J`;
  const mt = makeMockTransport(() => rawResponse("<html>", evilType));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) => {
      assert.ok(err instanceof LobbyParseError);
      assert.ok(!hasControlChars((err as Error).message));
      return true;
    },
  );
});

test("a non-http(s) base URL is rejected at construction, before any request", () => {
  const mt = makeMockTransport(() => jsonResponse({ ok: true }));
  for (const baseUrl of ["file:///etc/passwd", "ftp://example.org"]) {
    assert.throws(
      () => new RequestEngine({ baseUrl, transport: mt.transport }),
      (err: unknown) => err instanceof LobbyNetworkError && /Unsupported protocol/.test((err as Error).message),
      baseUrl,
    );
  }
  assert.equal(mt.calls.length, 0);
});
