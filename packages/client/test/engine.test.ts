import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { TextDecoder } from "node:util";
import assert from "node:assert/strict";
import { RequestEngine, bigIntegerKeysOption, cleartextProblem, firstInexactNumber, parseRetryAfter, sanitizeServerText, scanNumbers } from "../src/engine.js";
import { LobbyApiError, LobbyNetworkError, LobbyParseError, LobbyValidationError, TextBuilder, credentialsIn, cutText, echoedCredentialForms, toWellFormed, typedUrlCredentials } from "../src/errors.js";
import type { HttpResponse } from "../src/http.js";
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

test("buildUrl builds requests from the parsed base URL: lower-cased host, default port dropped", () => {
  // P29's case of it is skipped here (its other base URL carries userinfo, which this client refuses).
  assert.equal(new RequestEngine({ baseUrl: "https://API.Example:443/v1" }).buildUrl("/sucheJson"), "https://api.example/v1/sucheJson");
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
  assert.throws(
    () => new RequestEngine({ baseUrl: "not-a-url" }),
    (err: unknown) =>
      err instanceof LobbyValidationError &&
      (err as Error).message === "Invalid baseUrl: Expected an absolute http(s) URL.",
  );
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

test("a number the JSON cannot carry exactly is a parse error, never a changed value", async () => {
  // JSON.parse rounds 12345678901234567890 (in any form: .0, e0, E-1) and 9007199254740992.5 to the
  // nearest double, turns 1e400 into Infinity (printed as null) and 1e-400 into 0, silently.
  const body = (n: string) => `{"resultCount":1,"n":${n},"text":"12345678901234567890 in a string"}`;
  for (const n of [
    "12345678901234567890", "-9007199254740993", "1e400", "-1E400", "12345678901234567890.0", "9007199254740993e0",
    "90071992547409930E-1", "9007199254740992.5", "-9007199254740992.5", "1e-400", "-0.0001e-399",
    "123456789012345678901234567890",
    // Below the smallest normal double a subnormal has fewer digits: 3e-324 became 5e-324.
    "3e-324", "4e-324", "-4.9e-324", "1.2345678901234567e-310", "2.225073858507201e-309",
  ]) {
    const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(body(n), "application/json")).transport });
    await assert.rejects(e.getJson("/sucheJson"), (err: unknown) => {
      assert.ok(err instanceof LobbyParseError, n);
      assert.equal(err.message, `GET https://www.lobbyregister.bundestag.de/sucheJson: the number ${n} cannot be represented exactly.`);
      return true;
    });
  }
  // What a double carries exactly, or as JSON means it (a decimal fraction below 2^53), passes.
  const exact: Array<[string, number]> = [
    ["9007199254740991", 9007199254740991], ["9007199254740992.0", 2 ** 53], ["9007199254740992e0", 2 ** 53],
    ["90071992547409920E-1", 2 ** 53], ["1e21", 1e21], ["1.2e21", 1.2e21], ["0", 0], ["-0", -0], ["0.0e-500", 0],
    ["1.10", 1.1], ["0.1", 0.1], ["1.00000000000000001", 1], ["5e-324", 5e-324],
    // A subnormal or the smallest normal double that prints as written.
    ["-5e-324", -5e-324], ["1e-310", 1e-310], ["2.2250738585072014e-308", 2.2250738585072014e-308],
    // A double a server printed in its shortest form reads back as that double and prints as the
    // same number: not a changed value, though the decimal is not the double's exact binary value.
    ["1e23", 1e23], ["100000000000000000000000", 1e23], ["1E23", 1e23], ["1.7976931348623157E308", Number.MAX_VALUE], ["-1.7976931348623157e308", -Number.MAX_VALUE],
    ["4.35e30", 4.35e30],
  ];
  for (const [n, value] of exact) {
    const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(body(n), "application/json")).transport });
    assert.equal((await e.getJson<{ n: number }>("/x")).n, value, n);
  }
});

test("the number check skips strings and costs one pass over the text", async () => {
  // Escaped quotes and backslashes must not end a string early and expose its digits.
  const tricky = `{"id":"a","s":"\\\\\\"12345678901234567890\\\\","t":"1e400","n":[1,2.5,-3e2]}`;
  const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(tricky, "application/json")).transport });
  assert.deepEqual(await e.getJson("/x"), JSON.parse(tricky));
  // 1 MB of numbers: the scan is linear.
  const big = `[${Array.from({ length: 200_000 }, (_, i) => i * 7).join(",")}]`;
  const f = new RequestEngine({ transport: makeMockTransport(() => rawResponse(big, "application/json")).transport });
  assert.equal((await f.getJson<number[]>("/x")).length, 200_000);
});

test("a timeout, the size cap, a refused connection and a DNS failure name the request (K3)", async () => {
  const url = "https://www.lobbyregister.bundestag.de/sucheJson?q=Energie";
  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED" });
  const dns = Object.assign(new Error("getaddrinfo ENOTFOUND nosuch.example"), { code: "ENOTFOUND" });
  for (const thrown of [refused, dns]) {
    const e = new RequestEngine({ transport: async () => { throw new LobbyNetworkError(thrown.message, { cause: thrown }); } });
    await assert.rejects(e.getJson("/sucheJson", { q: "Energie" }), (err: unknown) => {
      assert.ok(err instanceof LobbyNetworkError);
      assert.equal(err.message, `GET ${url} failed: ${thrown.message}`);
      assert.equal((err.cause as Error).cause, thrown);
      return true;
    });
  }
  // The engine's own deadline, for a transport that answers too late. (Its timer keeps the event
  // loop alive: the engine's deadline timer is unref'd, and on Node 22 a test whose only pending
  // timer is unref'd is cancelled.)
  const late = () => new Promise<never>((resolve) => setTimeout(() => resolve(rawResponse("{}", "application/json") as never), 50));
  const slow = new RequestEngine({ timeoutMs: 5, transport: late });
  await assert.rejects(slow.getJson("/sucheJson", { q: "Energie" }), (err: unknown) => {
    assert.ok(err instanceof LobbyNetworkError);
    assert.equal(err.message, `GET ${url} failed: Request timed out after 5ms`);
    assert.ok(err.cause instanceof LobbyNetworkError);
    return true;
  });
  // The size cap, whether the transport or the engine finds it.
  const big = new RequestEngine({ maxResponseBytes: 3, transport: async () => rawResponse("[1,2,3]", "application/json") });
  await assert.rejects(big.getJson("/sucheJson", { q: "Energie" }), (err: unknown) => {
    assert.ok(err instanceof LobbyNetworkError);
    assert.match(err.message, new RegExp(`^GET ${url.replace(/[.?]/g, "\\$&")} failed: Response exceeded the size limit of 3 bytes`));
    return true;
  });
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
        err.location === "http://[::1" &&
        err.message === "HTTP 302 for GET https://example.test/x: redirect to http://[::1 not followed",
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
      // Whole escape sequences go (the CSI's parameters with it, never a stray "[31m"); the
      // printable text around them stays.
      assert.equal(err.detail, "boomred");
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
      (err: unknown) =>
        err instanceof LobbyValidationError &&
        !(err instanceof LobbyNetworkError) &&
        /^Invalid baseUrl: Unsupported scheme "(file|ftp):"\. Expected an http\(s\) URL\.$/.test((err as Error).message),
      baseUrl,
    );
  }
  assert.equal(mt.calls.length, 0);
});

test("a redirect to a non-http(s) scheme is refused before the transport is called (04#2)", async () => {
  for (const target of ["file:///etc/passwd", "javascript:alert(1)", "data:text/plain,x", "ftp://x/y"]) {
    const mt = makeMockTransport(() => redirectResponse(target));
    const e = new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport });
    await assert.rejects(
      () => e.getJson("/x"),
      (err: unknown) => err instanceof LobbyApiError && err.status === 302 && /not followed/.test(err.message),
    );
    assert.equal(mt.calls.length, 1, `${target} reached the transport`);
  }
});

test("Location and Content-Type are read from a Headers object and any header case (04#1)", async () => {
  for (const headers of [new Headers({ Location: "/next" }), { Location: "/next" }, { LOCATION: "/next" }]) {
    let n = 0;
    const urls: string[] = [];
    const transport = async (req: { url: string }) => {
      urls.push(req.url);
      return n++ === 0
        ? { status: 302, headers: headers as unknown as Record<string, string>, body: Buffer.alloc(0) }
        : jsonResponse({ ok: true });
    };
    const e = new RequestEngine({ baseUrl: "https://example.test", transport });
    assert.deepEqual(await e.getJson("/x"), { ok: true });
    assert.equal(urls[1], "https://example.test/next");
  }
  const html = async () => ({
    status: 200,
    headers: new Headers({ "Content-Type": "text/html" }) as unknown as Record<string, string>,
    body: Buffer.from("{}"),
  });
  await assert.rejects(() => new RequestEngine({ transport: html }).getJson("/x"), LobbyParseError);
});

test("getJson decodes the body by its declared charset, drops a BOM and rejects an unknown one (03#2)", async () => {
  const latin1 = makeMockTransport(() =>
    rawResponse(Buffer.from(JSON.stringify({ name: "Bündnis für Tabakfreien Genuss" }), "latin1"), "application/json; charset=iso-8859-1"),
  );
  assert.deepEqual(await new RequestEngine({ transport: latin1.transport }).getJson("/x"), {
    name: "Bündnis für Tabakfreien Genuss",
  });
  const bom = makeMockTransport(() => rawResponse(Buffer.from('﻿{"ok":true}', "utf8"), "application/json"));
  assert.deepEqual(await new RequestEngine({ transport: bom.transport }).getJson("/x"), { ok: true });
  const unknown = makeMockTransport(() => rawResponse("{}", "application/json; charset=x-klingon"));
  await assert.rejects(() => new RequestEngine({ transport: unknown.transport }).getJson("/x"), LobbyParseError);
});

test("a long server detail is cut at 500 characters in the message; the body keeps it", async () => {
  const long = "x".repeat(200_000);
  const mt = makeMockTransport(() => jsonResponse({ detail: long }, 500));
  const e = new RequestEngine({ transport: mt.transport, maxRetries: 0 });
  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) =>
      err instanceof LobbyApiError && err.message.length < 1000 && err.detail?.length === 501 && err.body.length > 200_000,
  );
});

test("cutText never cuts inside a surrogate pair; toWellFormed replaces half a character", () => {
  assert.equal(cutText("ab\u{1f600}cd", 3), "ab");
  assert.equal(cutText("ab\u{1f600}cd", 4), "ab\u{1f600}");
  assert.equal(cutText("short", 10), "short");
  assert.equal(toWellFormed("a\ud83d b\ude00 \u{1f600}"), "a\ufffd b\ufffd \u{1f600}");
});

test("a server detail cut at 500 characters keeps the message well-formed", async () => {
  // "a" first, so the 500th unit is the high half of an emoji.
  const mt = makeMockTransport(() => jsonResponse({ detail: "a" + "\u{1f600}".repeat(400) }, 500));
  const e = new RequestEngine({ transport: mt.transport, maxRetries: 0 });
  const err = await e.getJson("/x").catch((caught: unknown) => caught);
  assert.ok(err instanceof LobbyApiError);
  assert.equal(toWellFormed(err.message), err.message);
  assert.match(err.message, /…$/);
});

test("a redirect to the register's error page is reported as a rejected request, not followed (01#1)", async () => {
  for (const maxRedirects of [5, 0]) {
    const mt = makeMockTransport(() => redirectResponse("/fehler"));
    const e = new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport, maxRedirects });
    await assert.rejects(
      () => e.getJson("/sucheJson", { q: '"Tabak' }),
      (err: unknown) =>
        err instanceof LobbyApiError &&
        err.status === 302 &&
        /the register rejected the request: it redirected to its error page \(\/fehler\)/.test(err.message) &&
        /unbalanced quote or parenthesis/.test(err.message),
    );
    assert.equal(mt.calls.length, 1, "the HTML error page is not fetched");
  }
});

test("cleartextProblem: exact wording, host with port, loopback range, never the secret", () => {
  assert.equal(cleartextProblem("http://mirror.example:8080/api"), "requests to mirror.example:8080 are sent unencrypted (http:, not https:)");
  assert.equal(
    cleartextProblem("http://alice:pw@mirror.example"),
    "the base URL's credentials are sent unencrypted to mirror.example (http:, not https:)",
  );
  assert.equal(
    cleartextProblem("http://alice:pw@mirror.example", ["the API key"]),
    "the API key and the base URL's credentials are sent unencrypted to mirror.example (http:, not https:)",
  );
  assert.equal(cleartextProblem("http://mirror.example", ["the login"]), "the login is sent unencrypted to mirror.example (http:, not https:)");
  for (const url of ["https://alice:pw@mirror.example", "http://127.8.9.10", "http://localhost:1", "http://[::1]/", "not a url"]) {
    assert.equal(cleartextProblem(url), undefined, url);
  }
  assert.notEqual(cleartextProblem("http://128.0.0.1"), undefined);
});

test("a redirect target is quoted at most 200 characters long (L3)", async () => {
  const long = "x".repeat(5000);
  // A Location that is no valid URL is not followed; the error names it.
  const e = new RequestEngine({ transport: async () => ({ status: 302, headers: { location: `http://[${long}` }, body: Buffer.alloc(0) }) });
  await assert.rejects(e.getJson("/sucheJson"), (err: Error) => err.message.length < 400 && /redirect to http:\/\/\[x+… not followed/.test(err.message));
});

test("a header named __proto__ is an ordinary header, never the prototype of the headers read (T12)", async () => {
  // A JavaScript transport may return any object; JSON.parse makes "__proto__" an own key.
  const headers = JSON.parse('{"__proto__":{"content-type":"text/html"}}') as Record<string, string>;
  const e = new RequestEngine({ transport: async () => ({ status: 200, headers, body: Buffer.from('{"a":1}') }) });
  // With the prototype set, "text/html" was read as the Content-Type and the answer refused.
  assert.deepEqual(await e.getJson("/x"), { a: 1 });
  const fetchLike = new Headers([["__proto__", "x"], ["content-type", "application/json"]]);
  const f = new RequestEngine({ transport: async () => ({ status: 200, headers: fetchLike as unknown as Record<string, string>, body: Buffer.from('{"a":1}') }) });
  assert.deepEqual(await f.getJson("/x"), { a: 1 });
});

test("an answer error names the request: method and URL, cut and with the query (D9)", async () => {
  const answers: Array<[string, () => HttpResponse]> = [
    ["unexpected content type", () => rawResponse("<html>", "text/html")],
    ["the answer is not valid JSON", () => rawResponse("{", "application/json")],
    ["empty response body", () => rawResponse(" ", "application/json")],
    ["cannot be represented exactly", () => rawResponse('{"n":1e400}', "application/json")],
    ["unsupported response charset", () => rawResponse("{}", "application/json; charset=x-bogus")],
  ];
  for (const [what, respond] of answers) {
    const e = new RequestEngine({ baseUrl: "http://127.0.0.1:9", transport: makeMockTransport(respond).transport });
    await assert.rejects(e.getJson("/sucheJson", { q: "x y" }), (err: unknown) => {
      assert.ok(err instanceof LobbyParseError, what);
      assert.ok(err.message.startsWith("GET http://127.0.0.1:9/sucheJson?q=x%20y: "), err.message);
      assert.ok(err.message.includes(what), err.message);
      return true;
    });
  }
  // A long query is cut in the message, not printed whole.
  const long = new RequestEngine({ transport: makeMockTransport(() => rawResponse("{", "application/json")).transport });
  await assert.rejects(long.getJson("/sucheJson", { q: "x".repeat(5000) }), (err: Error) => err.message.length < 400 && /…: the answer is not valid JSON\.$/.test(err.message));
});

test("bigIntegerKeys: a declared member's number is its exact literal as a string; others keep the rule (D3)", async () => {
  const body = '{"_version_":1858054135406919680,"small":{"_version_":5},"neg":{"\\u005fversion_":-12345678901234567890},' +
    '"s":{"_version_":"text"},"n":{"_version_":null},"arr":{"_version_":[1]},"t":"\\"_version_\\":1","n2":42}';
  const e = new RequestEngine({
    bigIntegerKeys: new Set(["_version_"]),
    transport: makeMockTransport(() => rawResponse(body, "application/json")).transport,
  });
  assert.deepEqual(await e.getJson("/x"), {
    _version_: "1858054135406919680", small: { _version_: "5" }, neg: { _version_: "-12345678901234567890" },
    s: { _version_: "text" }, n: { _version_: null }, arr: { _version_: [1] }, t: '"_version_":1', n2: 42,
  });
  assert.deepEqual([...e.bigIntegerKeys], ["_version_"]);
  // An undeclared big number is still refused; a declared member doesn't make others exact.
  const other = new RequestEngine({
    bigIntegerKeys: ["_version_"] as unknown as ReadonlySet<string>,
    transport: makeMockTransport(() => rawResponse('{"_version_":1858054135406919680,"id":12345678901234567890}', "application/json")).transport,
  });
  await assert.rejects(other.getJson("/x"), /the number 12345678901234567890 cannot be represented exactly/);
  // Malformed stays malformed: a declared member with a leading zero still fails JSON.parse.
  const malformed = new RequestEngine({ bigIntegerKeys: new Set(["_version_"]), transport: makeMockTransport(() => rawResponse('{"_version_":01}', "application/json")).transport });
  await assert.rejects(malformed.getJson("/x"), /not valid JSON/);
  for (const bad of [new Set([""]), new Set([1]), "x", 5, null]) {
    assert.throws(() => new RequestEngine({ bigIntegerKeys: bad as unknown as ReadonlySet<string> }),
      (err: unknown) => err instanceof LobbyValidationError && err.message === "Invalid bigIntegerKeys: expected a set of non-empty member names.");
  }
  // The option reader copies a set or a list; undefined is none.
  const names = new Set(["a"]);
  const copy = bigIntegerKeysOption(names);
  names.add("b");
  assert.deepEqual([...copy], ["a"]);
  assert.deepEqual([...bigIntegerKeysOption(["x", "y"] as unknown as ReadonlySet<string>)], ["x", "y"]);
  assert.equal(bigIntegerKeysOption(undefined).size, 0);
  // Without declarations the scan is the plain number check.
  assert.equal(firstInexactNumber('{"a":"1e400","b":3e-324}'), "3e-324");
  assert.deepEqual(scanNumbers('{"a":1}'), { json: '{"a":1}', inexact: undefined });
});

test("text that is not valid is replaced with U+FFFD and reported through onWarning, never silently (D2)", async () => {
  const cases: Array<[string, Buffer, string, unknown, number]> = [
    // A lone surrogate written as an escape (high alone, low alone); a real pair and an escaped backslash stay.
    ["lone escapes", Buffer.from('{"a":"x\\ud800y","b":"\\udc00","c":"\\ud83d\\ude00","d":"\\\\ud800"}'), "application/json", { a: "x\ufffdy", b: "\ufffd", c: "\u{1f600}", d: "\\ud800" }, 2],
    // A lone surrogate in a member name.
    ["lone in a key", Buffer.from('{"\\udbff":1}'), "application/json", { "\ufffd": 1 }, 1],
    // Invalid UTF-8 bytes; a U+FFFD the server sent is not counted.
    ["invalid bytes", Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xff, 0xc3]), Buffer.from('","b":"\ufffd"}')]), "application/json", { a: "\ufffd\ufffd", b: "\ufffd" }, 2],
    // A byte undefined in a single-byte charset.
    ["iso-8859-3", Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xa5]), Buffer.from('"}')]), "application/json; charset=iso-8859-3", { a: "\ufffd" }, 1],
  ];
  for (const [label, body, type, expected, count] of cases) {
    const warnings: string[] = [];
    const e = new RequestEngine({ onWarning: (m) => warnings.push(m), transport: makeMockTransport(() => rawResponse(body, type)).transport });
    const value = await e.getJson("/sucheJson", { q: "x" });
    assert.deepEqual(value, expected, label);
    assert.ok(!/[\ud800-\udfff]/u.test(JSON.stringify(value)), `${label}: well-formed`);
    assert.deepEqual(warnings, [
      `GET https://www.lobbyregister.bundestag.de/sucheJson?q=x: ${count} ${count === 1 ? "character" : "characters"} of the answer ${count === 1 ? "was" : "were"} not valid text (invalid bytes or a lone surrogate) and replaced with U+FFFD.`,
    ], label);
  }
  // Valid text: no warning; a throwing hook never fails the request.
  const quiet: string[] = [];
  const ok = new RequestEngine({ onWarning: (m) => quiet.push(m), transport: makeMockTransport(() => rawResponse('{"a":"\\u00fc\ufffd"}', "application/json")).transport });
  assert.deepEqual(await ok.getJson("/x"), { a: "ü\ufffd" });
  assert.deepEqual(quiet, []);
  const throwing = new RequestEngine({ onWarning: () => { throw new Error("hook"); }, transport: makeMockTransport(() => rawResponse('"\\ud800"', "application/json")).transport });
  assert.equal(await throwing.getJson("/x"), "\ufffd");
  assert.throws(() => new RequestEngine({ onWarning: "log" as unknown as () => void }), LobbyValidationError);
});

test("an answer longer than V8's longest string is a LobbyParseError naming the request, not a plain Error (T14)", async (t) => {
  // A real one needs a body of 512 MB and more (possible with maxResponseBytes 0): V8's own
  // error is stood in for, for the body marked by its length.
  const huge = Buffer.from('{"resultCount":0}   ');
  const tooLong = Object.assign(new Error("Cannot create a string longer than 0x1fffffe8 characters"), { code: "ERR_STRING_TOO_LONG" });
  const decode = TextDecoder.prototype.decode;
  t.mock.method(TextDecoder.prototype, "decode", function (this: InstanceType<typeof TextDecoder>, input?: Uint8Array, options?: { stream?: boolean }) {
    if (input !== undefined && input.byteLength === huge.length) throw tooLong;
    return decode.call(this, input, options);
  });
  const toString = Buffer.prototype.toString;
  t.mock.method(Buffer.prototype, "toString", function (this: Buffer, ...args: Parameters<Buffer["toString"]>) {
    if (this.length === huge.length && args[0] === "utf8") throw tooLong;
    return toString.apply(this, args);
  });
  const e = new RequestEngine({ maxResponseBytes: 0, transport: makeMockTransport(() => rawResponse(huge, "application/json")).transport });
  await assert.rejects(e.getJson("/sucheJson", { q: "Energie" }), (err: unknown) => {
    assert.ok(err instanceof LobbyParseError, String(err));
    assert.equal(
      err.message,
      `GET https://www.lobbyregister.bundestag.de/sucheJson?q=Energie: the answer is too large to read as text (${huge.length} bytes; the longest string is 536870888 characters).`,
    );
    return true;
  });
  // An error status with such a body is still the API error, without the unreadable body; so is
  // the redirect to the register's error page.
  const failing = new RequestEngine({ maxResponseBytes: 0, maxRetries: 0, transport: makeMockTransport(() => rawResponse(huge, "text/plain", 500)).transport });
  await assert.rejects(failing.getJson("/sucheJson"), (err: unknown) => err instanceof LobbyApiError && err.status === 500 && err.body === "");
  const fehler = new RequestEngine({ maxResponseBytes: 0, transport: makeMockTransport(() => ({ status: 302, headers: { location: "/fehler" }, body: huge })).transport });
  await assert.rejects(fehler.getJson("/sucheJson"), (err: unknown) => err instanceof LobbyApiError && err.status === 302 && err.body === "");
});

test("a number with a long run of zeros is checked in linear time (security audit class A)", async () => {
  // `/0+$/` tried a match at every zero of a run that doesn't end the literal: quadratic, and
  // 1.<100 000 zeros>1e300 held the scan for seconds after the answer was in.
  const literal = `1.${"0".repeat(100_000)}1e300`;
  const start = performance.now();
  assert.equal(firstInexactNumber(`{"a":${literal}}`), literal);
  const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(`{"resultCount":${literal}}`, "application/json")).transport });
  await assert.rejects(e.getJson("/sucheJson"), (err: unknown) => err instanceof LobbyParseError && /cannot be represented exactly/.test(err.message) && err.message.length < 1000);
  const ms = performance.now() - start;
  assert.ok(ms < 1000, `${Math.round(ms)} ms`);
  // Leading and trailing zeros still count as before: exact at the edges, inexact past them.
  assert.equal(firstInexactNumber('{"a":0.000,"b":-0e5,"c":9007199254740992000e-3,"d":1000000000000000000000}'), undefined);
  assert.equal(firstInexactNumber('{"a":00012345678901234567890}'), "00012345678901234567890");
});

test("sanitizeServerText drops whole escape sequences, not just their control bytes (security audit class C)", () => {
  const CSI8 = String.fromCharCode(0x9b);
  const OSC8 = String.fromCharCode(0x9d);
  const ST8 = String.fromCharCode(0x9c);
  for (const [input, expected] of [
    [`line1 ${ESC}]0;title${BEL}rest`, "line1 rest"],
    [`${ESC}]8;;https://evil.example${ESC}\\click${ESC}]8;;${ESC}\\`, "click"],
    [`${ESC}[31mred${ESC}[0m plain`, "red plain"],
    [`${ESC}[1;31;4mbold`, "bold"],
    [`${CSI8}2Jcleared`, "cleared"],
    [`${OSC8}0;t${ST8}ok`, "ok"],
    [`a${ESC}7b${ESC}(Bc`, "abc"],
    // Unterminated: only ESC and its introducer go, the text stays.
    [`keep ${ESC}]0;no terminator here`, "keep 0;no terminator here"],
  ] as const) {
    assert.equal(sanitizeServerText(input), expected, JSON.stringify(input));
  }
  // Invisible format characters go, whitespace runs become one space, ordinary text stays.
  assert.equal(sanitizeServerText("real​ error Error: forged⁦x⁩ ﻿end­‍⁠!"), "real error Error: forgedx end!");
  assert.equal(sanitizeServerText("  Cannot GET  /sucheJson  Größe  "), "Cannot GET /sucheJson Größe");
});

test("sanitizeServerText reads a bounded prefix and drops what the per-character filter dropped (security audit class C)", () => {
  // The filter it replaces, one character at a time: C0 but TAB to CR, DEL, C1 and Cf go.
  const perCharacter = (text: string): string =>
    [...text]
      .filter((ch) => {
        const n = ch.codePointAt(0) ?? 0;
        return (n >= 0x09 && n <= 0x0d) || !(n <= 0x1f || (n >= 0x7f && n <= 0x9f) || /\p{Cf}/u.test(ch));
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  const every = Array.from({ length: 0x3000 }, (_, i) => String.fromCharCode(i)).join("") + "\u{1f600}\u{e0001}\ud800x";
  for (let at = 0; at < every.length; at += 512) {
    const piece = every.slice(at, at + 512).replace(/[\u001b\u0090\u0098\u009b-\u009f]/g, "");
    assert.equal(sanitizeServerText(piece), perCharacter(piece), `from U+${at.toString(16)}`);
  }
  // At most 16 384 units of the text are read, never half a surrogate pair.
  assert.equal(sanitizeServerText("x".repeat(100_000)).length, 16_384);
  assert.equal(sanitizeServerText(`${"x".repeat(16_383)}\u{1f600}`), "x".repeat(16_383));
  // A control string ends at another introducer: the first is dropped by the filter, the second
  // string as a whole. With introducers allowed inside, an unterminated run of them was matched
  // from each one to the end: quadratic (100 000 × U+009D took 16 s).
  const OSC8 = String.fromCharCode(0x9d);
  const ST8 = String.fromCharCode(0x9c);
  assert.equal(sanitizeServerText(`a${OSC8}0;x${OSC8}0;t${ST8}b`), "a0;xb");
  assert.equal(sanitizeServerText(`a${ESC}]0;x${ESC}]0;t${BEL}b`), "a0;xb");
});

test("a TextBuilder joins its pieces in order across batches (security audit class C)", () => {
  const b = new TextBuilder();
  const expected: string[] = [];
  for (let i = 0; i < 40_000; i++) {
    b.push(String(i), ",");
    expected.push(String(i), ",");
  }
  assert.equal(b.toString(), expected.join(""));
  assert.equal(new TextBuilder().toString(), "");
});

// These tests start a process with a small heap: 30 s instead of the suite's 5 s.
const STARTS_A_PROCESS = { timeout: 30_000 };

test("scanNumbers quotes millions of declared members within a small heap (security audit class C)", STARTS_A_PROCESS, () => {
  // One `+` per quoted member made a rope node each: 3 million of them exhausted a 128 MB heap.
  const engine = new URL("../src/engine.js", import.meta.url).href;
  const n = 3_000_000;
  const script =
    `const { scanNumbers } = await import(${JSON.stringify(engine)});` +
    `const json = "[" + '{"k":1},'.repeat(${n - 1}) + '{"k":1}]';` +
    `process.stdout.write(String(scanNumbers(json, new Set(["k"])).json.length));`;
  const out = execFileSync(process.execPath, ["--max-old-space-size=128", "--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(out, String(n * 10 + 1));
});

test("echoedCredentialForms treats a userinfo without a password as a token (Basic `TOKEN:`) (security audit class E)", () => {
  const basic = (pair: string): string => Buffer.from(pair, "utf8").toString("base64");
  assert.deepEqual(echoedCredentialForms("alice:s3cret"), [basic("alice:s3cret"), "alice:s3cret", "s3cret"]);
  assert.deepEqual(echoedCredentialForms("T0ken"), [basic("T0ken:"), "T0ken:", "T0ken"]);
  assert.deepEqual(echoedCredentialForms("T0ken:"), [basic("T0ken:"), "T0ken:", "T0ken"]);
  assert.deepEqual(echoedCredentialForms("T%C3%B6k"), [basic("Tök:"), "Tök:"]); // short: not alone
  assert.deepEqual(echoedCredentialForms(":pw12"), [basic(":pw12"), ":pw12", "pw12"]);
  assert.deepEqual(echoedCredentialForms(""), []);
  assert.deepEqual(echoedCredentialForms(":"), []);
});

test("credentialsIn ends the authority of a special scheme at a backslash, as WHATWG does (security audit class F)", () => {
  for (const scheme of ["http", "https", "HTTPS", "ws", "wss", "ftp"]) {
    assert.deepEqual(credentialsIn(`${scheme}://u:p@a.example\\@b.example/x`), ["u:p"], scheme);
    assert.equal(new URL(`${scheme}://u:p@a.example\\@b.example/x`).password, "p", scheme);
  }
  // Another scheme's authority runs on to "/", "?" or "#".
  assert.deepEqual(credentialsIn("foo://u:p@a.example\\@b.example/x"), ["u:p@a.example\\"]);
  assert.deepEqual(credentialsIn("https://u:p@a.example/x\\@y"), ["u:p"]);
});

test("credentialsIn skips the slashes and backslashes WHATWG skips after a special scheme (security audit class F3)", () => {
  // `http:///u:pw@h`, `https:\\u:pw@h` and `http:u:pw@h` all carry `u:pw` for WHATWG; read
  // after "://", the userinfo was missed, so a refused --base-url echoed the password in clear.
  for (const value of [
    "http:alice:pw@h.example",
    "http:/alice:pw@h.example",
    "http:///alice:pw@h.example/x",
    "https:////alice:pw@h.example",
    "HTTPS:\\\\alice:pw@h.example",
    "wss:\\/alice:pw@h.example",
    "ftp:alice:pw@h.example",
  ]) {
    assert.deepEqual(credentialsIn(value), ["alice:pw"], value);
    assert.equal(new URL(value).password, "pw", value);
  }
  // Another scheme needs "//" before an authority: `foo:u:p@h` and `foo:///u:p@h` carry none.
  assert.deepEqual(credentialsIn("foo:u:p@h.example"), []);
  assert.deepEqual(credentialsIn("foo:///u:p@h.example"), []);
  assert.equal(new URL("foo:///u:p@h.example").password, "");
});

test("a base URL with a backslash, or whose scheme is not followed by // and the host, is rejected at construction, never echoing the password (security audit class F, F4)", () => {
  // WHATWG ends an http(s) host at "\" and repairs `http:host`, `http:/host` and `http:///host`
  // silently into `http://host`: the host requested would not be the one typed.
  for (const [baseUrl, reason] of [
    ["https://alice:s3cret@a.example\\@b.example", 'A base URL cannot contain a backslash (\\); write "/" instead.'],
    ["https://h.example/a\\b", 'A base URL cannot contain a backslash (\\); write "/" instead.'],
    ["https:\\\\alice:s3cret@h.example", 'A base URL cannot contain a backslash (\\); write "/" instead.'],
    ["http:alice:s3cret@h.example", 'Expected an absolute http(s) URL ("https://" and the host).'],
    ["https:/alice:s3cret@h.example", 'Expected an absolute http(s) URL ("https://" and the host).'],
    ["http:///alice:s3cret@h.example", 'Expected an absolute http(s) URL ("https://" and the host).'],
    ["HTTPS:h.example/v1", 'Expected an absolute http(s) URL ("https://" and the host).'],
    ["http:///h.example", 'Expected an absolute http(s) URL ("https://" and the host).'],
  ] as const) {
    const mt = makeMockTransport(() => jsonResponse({}));
    assert.throws(
      () => new RequestEngine({ transport: mt.transport, baseUrl }),
      (err: unknown) => err instanceof LobbyValidationError && err.message === `Invalid baseUrl: ${reason}` && !err.message.includes("s3cret"),
      baseUrl,
    );
    assert.equal(mt.calls.length, 0, baseUrl);
  }
  // A spelling the parser keeps as typed stays accepted: an upper-case scheme, an explicit port,
  // surrounding spaces (trimmed, as before).
  for (const baseUrl of ["HTTPS://h.example/v1", "http://h.example:8080", " https://h.example "]) {
    assert.doesNotThrow(() => new RequestEngine({ transport: makeMockTransport(() => jsonResponse({})).transport, baseUrl }), baseUrl);
  }
});

test("typedUrlCredentials reads a value meant as a URL whatever its scheme: missing, special without //, mistyped (F7)", () => {
  for (const [value, userinfo] of [
    ["https://alice:pw@h.example/x", "alice:pw"],
    ["http:///alice:pw@h.example", "alice:pw"],
    ["alice:pw@h.example/x", "alice:pw"],
    ["my_user:pw@h.example", "my_user:pw"],
    ["T0ken:@h.example", "T0ken:"],
    ["http//alice:pw@h.example", "alice:pw"],
    ["https//alice:pw@h.example/v1", "alice:pw"],
    ["http/alice:pw@h.example", "alice:pw"],
    ["htp:/alice:pw@h.example", "alice:pw"],
    ["http\\\\alice:pw@h.example", "alice:pw"],
    ["http//alice:p/w@h.example", "alice:p/w"],
  ] as const) {
    assert.deepEqual(typedUrlCredentials(value), [userinfo], value);
  }
  // No "@" after the slashes, or a scheme spelled with "//" and no userinfo: none.
  for (const value of ["", "h.example/x", "http//h.example/x", "@h.example/x", "http//@h.example", "https://h.example/a@b"]) {
    assert.deepEqual(typedUrlCredentials(value), [], value);
  }
});
