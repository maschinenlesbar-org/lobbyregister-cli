import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestEngine } from "../src/client/engine.js";
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

test("buildUrl rejects a syntactically invalid base URL", () => {
  const e = new RequestEngine({ baseUrl: "not-a-url" });
  assert.throws(() => e.buildUrl("/sucheJson"), LobbyNetworkError);
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

test("a 3xx with no Location header surfaces as a LobbyApiError", async () => {
  const mt = makeMockTransport(() => redirectWithoutLocation(302));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) => err instanceof LobbyApiError && err.status === 302,
  );
});
