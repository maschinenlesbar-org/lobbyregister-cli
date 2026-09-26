import { test } from "node:test";
import assert from "node:assert/strict";
import { LobbyregisterClient } from "../src/client/client.js";
import { LobbyApiError, LobbyError, LobbyNetworkError, LobbyParseError } from "../src/client/errors.js";
import { makeMockTransport, jsonResponse, constantJson } from "./helpers.js";

function clientWith(mt: ReturnType<typeof makeMockTransport>): LobbyregisterClient {
  return new LobbyregisterClient({ transport: mt.transport });
}

test("search passes q and sort, and slices page/pageSize itself", async () => {
  const results = Array.from({ length: 25 }, (_, i) => ({ n: i }));
  const mt = constantJson({ resultCount: 25, results });
  const res = await clientWith(mt).search({ q: "Energie", page: 2, pageSize: 10, sort: "REGISTRATION_DESC" });
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, "/sucheJson");
  assert.equal(url.searchParams.get("q"), "Energie");
  assert.equal(url.searchParams.get("page"), null);
  assert.equal(url.searchParams.get("pageSize"), null);
  assert.equal(url.searchParams.get("sort"), "REGISTRATION_DESC");
  assert.equal(res.resultCount, 25);
  assert.deepEqual(res.results.map((r) => r["n"]), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  const first = await clientWith(mt).search({ q: "Energie", pageSize: 10 });
  assert.equal(first.results.length, 10);
  assert.deepEqual(first.results[0], { n: 0 });
  assert.equal((await clientWith(mt).search({ q: "Energie" })).results.length, 25);
});

test("search rejects invalid paging before any request", async () => {
  for (const params of [
    { page: -3, pageSize: 10 },
    { page: 1, pageSize: Number.NaN },
    { pageSize: 0 },
    { pageSize: 1.5 },
    { page: 2 },
  ]) {
    const mt = constantJson({ resultCount: 0, results: [] });
    await assert.rejects(() => clientWith(mt).search(params), LobbyError, JSON.stringify(params));
    assert.equal(mt.calls.length, 0);
  }
  await assert.rejects(
    () => clientWith(constantJson({ resultCount: 0, results: [] })).search({ page: -3, pageSize: 10 }),
    /Invalid page: expected an integer >= 1, got -3\./,
  );
});

test("search with no params sends no query", async () => {
  const mt = constantJson({ resultCount: 0, results: [] });
  await clientWith(mt).search();
  assert.equal(new URL(mt.last().url).search, "");
});

test("count returns resultCount", async () => {
  const mt = constantJson({ resultCount: 42, results: [{}] });
  const n = await clientWith(mt).count("Energie");
  assert.equal(n, 42);
  assert.equal(new URL(mt.last().url).searchParams.get("q"), "Energie");
});

test("count parses resultCount even from an empty-results envelope", async () => {
  const mt = constantJson({ resultCount: 7, results: [] });
  const n = await clientWith(mt).count("Energie");
  assert.equal(n, 7);
});

test("search with an empty-string query sends q= (distinct from omitting q)", async () => {
  const mt = constantJson({ resultCount: 0, results: [] });
  await clientWith(mt).search({ q: "" });
  const url = new URL(mt.last().url);
  assert.equal(url.searchParams.get("q"), "");
  assert.ok(url.search.includes("q="));
});

test("search rejects a valid-JSON body of the wrong shape", async () => {
  const mt = constantJson({ foo: "bar" }); // 200, but not a SearchResult envelope
  await assert.rejects(() => clientWith(mt).search({ q: "x" }), LobbyParseError);
});

test("count rejects a body whose resultCount is not a number", async () => {
  const mt = constantJson({ resultCount: "lots", results: [] });
  await assert.rejects(() => clientWith(mt).count("x"), LobbyParseError);
});

test("a 404 raises LobbyApiError with status 404", async () => {
  const mt = makeMockTransport(() => jsonResponse({}, 404));
  await assert.rejects(
    () => clientWith(mt).search({ q: "x" }),
    (err) => err instanceof LobbyApiError && err.status === 404,
  );
});

test("the client rejects a file: base URL before any request reaches a custom transport", () => {
  const mt = makeMockTransport(() => jsonResponse({ resultCount: 0, results: [] }));
  assert.throws(
    () => new LobbyregisterClient({ baseUrl: "file:///etc/passwd", transport: mt.transport }),
    LobbyNetworkError,
  );
  assert.equal(mt.calls.length, 0);
});

test("search sends filters as filter[attribute][value]=true and checks the echo", async () => {
  const echoed = { resultCount: 1, results: [], searchParameters: { facets: [{ attribute: "revolvingdoordata", value: "true" }] } };
  const mt = constantJson(echoed);
  const res = await clientWith(mt).search({ q: "R002822", filters: [{ attribute: "revolvingdoordata", value: "true" }] });
  assert.equal(res.resultCount, 1);
  assert.equal(new URL(mt.last().url).searchParams.get("filter[revolvingdoordata][true]"), "true");
  assert.equal(await clientWith(mt).count("R002822", [{ attribute: "revolvingdoordata", value: "true" }]), 1);
});

test("search rejects a filter the reply leaves out of searchParameters.facets", async () => {
  const mt = constantJson({ resultCount: 6989, results: [], searchParameters: { facets: [] } });
  await assert.rejects(
    () => clientWith(mt).search({ filters: [{ attribute: "bogusattr", value: "true" }] }),
    (err) => err instanceof LobbyError && /ignored the filter "bogusattr=true"/.test((err as Error).message),
  );
  // No facets array in the reply: nothing to check against, passed through.
  const bare = constantJson({ resultCount: 3, results: [] });
  assert.equal((await clientWith(bare).search({ filters: [{ attribute: "activelobbyist", value: "true" }] })).resultCount, 3);
});

test("a malformed filter is rejected before any request", async () => {
  for (const filter of [
    { attribute: "revolving door", value: "true" },
    { attribute: "revolvingdoordata", value: "" },
    { attribute: "revolvingdoordata", value: "true][x" },
  ]) {
    const mt = constantJson({ resultCount: 0, results: [] });
    await assert.rejects(() => clientWith(mt).search({ filters: [filter] }), LobbyError, JSON.stringify(filter));
    assert.equal(mt.calls.length, 0);
  }
});

test("a negative, fractional or non-finite resultCount is a LobbyParseError", async () => {
  for (const body of ['{"resultCount":-5,"results":[]}', '{"resultCount":1e400,"results":[]}', '{"resultCount":2.5,"results":[]}']) {
    const mt = makeMockTransport(() => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(body) }));
    await assert.rejects(
      () => clientWith(mt).count(),
      (err) => err instanceof LobbyParseError && /expected a non-negative integer resultCount\./.test((err as Error).message),
      body,
    );
  }
});
