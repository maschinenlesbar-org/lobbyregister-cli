import { test } from "node:test";
import assert from "node:assert/strict";
import { LobbyregisterClient } from "../src/client/client.js";
import { LobbyApiError } from "../src/client/errors.js";
import { makeMockTransport, jsonResponse, constantJson } from "./helpers.js";

function clientWith(mt: ReturnType<typeof makeMockTransport>): LobbyregisterClient {
  return new LobbyregisterClient({ transport: mt.transport });
}

test("search passes q, page, pageSize and sort", async () => {
  const mt = constantJson({ resultCount: 0, results: [] });
  await clientWith(mt).search({ q: "Energie", page: 2, pageSize: 10, sort: "REGISTRATION_DESC" });
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, "/sucheJson");
  assert.equal(url.searchParams.get("q"), "Energie");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("pageSize"), "10");
  assert.equal(url.searchParams.get("sort"), "REGISTRATION_DESC");
});

test("search with no params sends no query", async () => {
  const mt = constantJson({ resultCount: 0, results: [] });
  await clientWith(mt).search();
  assert.equal(new URL(mt.last().url).search, "");
});

test("count returns resultCount and asks for a single result", async () => {
  const mt = constantJson({ resultCount: 42, results: [{}] });
  const n = await clientWith(mt).count("Energie");
  assert.equal(n, 42);
  assert.equal(new URL(mt.last().url).searchParams.get("pageSize"), "1");
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

test("a 404 raises LobbyApiError with status 404", async () => {
  const mt = makeMockTransport(() => jsonResponse({}, 404));
  await assert.rejects(
    () => clientWith(mt).search({ q: "x" }),
    (err) => err instanceof LobbyApiError && err.status === 404,
  );
});
