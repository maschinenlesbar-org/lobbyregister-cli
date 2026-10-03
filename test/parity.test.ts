// CLI <-> library parity: the same input through run() and through the library,
// on one recording mock transport, must give the same outcome — both reject before
// any request, or both send the identical request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LobbyregisterClient } from "../src/client/client.js";
import { LobbyValidationError } from "../src/client/errors.js";
import { isBlank, nonEmptyProblem } from "../src/client/validate.js";
import type { Transport } from "../src/client/http.js";
import { SEARCH_FILTER_ATTRIBUTES, ignoredSort, knownFilterAttributeProblem } from "../src/client/filters.js";
import { jsonResponse, parity, type CliOutcome, type LibOutcome } from "./helpers.js";

/** Both sides reject the input as a usage/validation error and send nothing. */
function assertBothReject(cli: CliOutcome, lib: LibOutcome, label: string): void {
  assert.equal(cli.code, 2, `${label}: CLI exit (stderr: ${cli.err})`);
  assert.deepEqual(cli.requests, [], `${label}: CLI requests`);
  assert.equal(lib.ok, false, `${label}: library should reject`);
  if (!lib.ok) assert.ok(lib.error instanceof LobbyValidationError, `${label}: ${String(lib.error)}`);
  assert.deepEqual(lib.requests, [], `${label}: library requests`);
}

/** Both sides succeed and send the identical request URLs. */
function assertSameRequests(cli: CliOutcome, lib: LibOutcome, label: string): void {
  assert.equal(cli.code, 0, `${label}: CLI exit (stderr: ${cli.err})`);
  assert.equal(lib.ok, true, `${label}: library should succeed (${lib.ok ? "" : String(lib.error)})`);
  assert.ok(cli.requests.length > 0, `${label}: CLI sent nothing`);
  assert.deepEqual(
    lib.requests.map((r) => r.url),
    cli.requests.map((r) => r.url),
    label,
  );
}

const client = (t: Transport) => new LobbyregisterClient({ transport: t });

// ---- finding 2: blank q / sort (PAT-9) -----------------------------------------

test("isBlank / nonEmptyProblem: empty and whitespace-only strings are blank", () => {
  for (const v of ["", " ", "   ", "\t", "\n "]) {
    assert.equal(isBlank(v), true, JSON.stringify(v));
    assert.equal(nonEmptyProblem(v), "Expected a non-empty value.");
  }
  for (const v of ["x", " Energie "]) {
    assert.equal(isBlank(v), false);
    assert.equal(nonEmptyProblem(v), undefined);
  }
});

test("parity: a blank query is rejected by both the CLI and the library", async () => {
  for (const q of ["", "   "]) {
    const c = await parity(["--compact", "count", "--", q], (t) => client(t).count(q));
    assertBothReject(c.cli, c.lib, `count ${JSON.stringify(q)}`);
    const s = await parity(["--compact", "search", "--", q], (t) => client(t).search({ q }));
    assertBothReject(s.cli, s.lib, `search ${JSON.stringify(q)}`);
  }
});

test("parity: a blank sort is rejected by both the CLI and the library", async () => {
  for (const sort of ["", "  "]) {
    const r = await parity(["--compact", "search", "Energie", "--sort", sort], (t) =>
      client(t).search({ q: "Energie", sort }),
    );
    assertBothReject(r.cli, r.lib, `sort ${JSON.stringify(sort)}`);
  }
});

test("parity: no query and a real query send the same request on both sides", async () => {
  const none = await parity(["--compact", "count"], (t) => client(t).count());
  assertSameRequests(none.cli, none.lib, "count");
  const some = await parity(["--compact", "search", "Energie", "--sort", "REGISTRATION_DESC"], (t) =>
    client(t).search({ q: "Energie", sort: "REGISTRATION_DESC" }),
  );
  assertSameRequests(some.cli, some.lib, "search Energie");
});

// ---- finding 1: the filter attribute allowlist (PAT-13) ------------------------

/** A reply with no `facets` array, so the echo check has nothing to compare. */
const noFacets = () => jsonResponse({ resultCount: 6989, results: [{ id: 1 }], searchParameters: { sortOrder: "RELEVANCE_DESC" } });

test("knownFilterAttributeProblem accepts only SEARCH_FILTER_ATTRIBUTES", () => {
  for (const attribute of SEARCH_FILTER_ATTRIBUTES) assert.equal(knownFilterAttributeProblem(attribute), undefined);
  for (const attribute of ["foo", "revolvingdoor", "RevolvingDoorData", "", "constructor", "toString"]) {
    const reason = knownFilterAttributeProblem(attribute);
    assert.ok(reason?.startsWith(`Unknown filter ${JSON.stringify(attribute)}. The register ignores unknown filters`), attribute);
  }
});

test("parity: an unknown filter attribute is rejected by both sides before any request", async () => {
  const c = await parity(["--compact", "count", "--filter", "foo=true"], (t) =>
    client(t).count(undefined, [{ attribute: "foo", value: "true" }]), noFacets);
  assertBothReject(c.cli, c.lib, "count --filter foo=true");
  const s = await parity(
    ["--compact", "search", "Energie", "--filter", "revolvingdoordata=true", "--filter", "foo=true"],
    (t) => client(t).search({ q: "Energie", filters: [{ attribute: "revolvingdoordata", value: "true" }, { attribute: "foo", value: "true" }] }),
    noFacets,
  );
  assertBothReject(s.cli, s.lib, "search --filter foo=true");
  if (!s.lib.ok) assert.match(String(s.lib.error), /Invalid filter attribute: Unknown filter "foo"\. The register ignores unknown filters/);
});

test("parity: a known filter attribute sends the same request on both sides", async () => {
  const r = await parity(["--compact", "count", "--filter", "revolvingdoordata=true"], (t) =>
    client(t).count(undefined, [{ attribute: "revolvingdoordata", value: "true" }]), noFacets);
  assertSameRequests(r.cli, r.lib, "count --filter revolvingdoordata=true");
});

// ---- finding 4: a sort the register did not apply (PAT-20) ---------------------

test("ignoredSort compares the requested sort with the echoed sortOrder", () => {
  assert.deepEqual(ignoredSort("registration_desc", { sortOrder: "RELEVANCE_DESC" }), {
    requested: "registration_desc",
    applied: "RELEVANCE_DESC",
  });
  assert.equal(ignoredSort("REGISTRATION_DESC", { sortOrder: "REGISTRATION_DESC" }), undefined);
  assert.equal(ignoredSort(undefined, { sortOrder: "RELEVANCE_DESC" }), undefined);
  assert.equal(ignoredSort("x", undefined), undefined);
  assert.equal(ignoredSort("x", {}), undefined);
  assert.equal(ignoredSort("x", { sortOrder: 5 }), undefined);
});

test("parity: a sort the register ignored is reported by both sides, with the same data", async () => {
  const reply = () =>
    jsonResponse({
      resultCount: 5,
      results: [{ n: 1 }, { n: 2 }, { n: 3 }],
      searchParameters: { queryString: "Energie", sortOrder: "RELEVANCE_DESC", facets: [] },
    });
  const r = await parity(
    ["--compact", "search", "Energie", "--sort", "registration_desc", "--page-size", "2", "--page", "2"],
    (t) => client(t).search({ q: "Energie", sort: "registration_desc", pageSize: 2, page: 2 }),
    reply,
  );
  assertSameRequests(r.cli, r.lib, "search --sort registration_desc");
  assert.ok(r.lib.ok);
  const { sortIgnored, ...envelope } = r.lib.value as { sortIgnored?: unknown };
  assert.deepEqual(sortIgnored, { requested: "registration_desc", applied: "RELEVANCE_DESC" });
  assert.deepEqual(JSON.parse(r.cli.out), envelope);
  assert.match(r.cli.err, /^Warning: the API did not apply --sort "registration_desc" and sorted by RELEVANCE_DESC instead\./);

  const applied = await parity(["--compact", "search", "x", "--sort", "RELEVANCE_DESC"], (t) =>
    client(t).search({ q: "x", sort: "RELEVANCE_DESC" }), reply);
  assert.ok(applied.lib.ok);
  assert.equal("sortIgnored" in (applied.lib.value as object), false);
  assert.doesNotMatch(applied.cli.err, /Warning/);
});
