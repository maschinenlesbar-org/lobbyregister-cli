// CLI <-> library parity: the same input through run() and through the library,
// on one recording mock transport, must give the same outcome — both reject before
// any request, or both send the identical request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LobbyregisterClient } from "../src/client/client.js";
import { LobbyNetworkError, LobbyValidationError } from "../src/client/errors.js";
import { baseUrlProblem } from "../src/client/engine.js";
import { headerNameProblem, headerValueProblem, intInRangeProblem, isBlank, nonEmptyProblem } from "../src/client/validate.js";
import { MAX_TIMEOUT_MS } from "../src/client/http.js";
import type { HttpRequest, HttpResponse, Transport } from "../src/client/http.js";
import {
  SEARCH_FILTER_ATTRIBUTES,
  ignoredSort,
  knownFilterAttributeProblem,
  normaliseFilter,
  parseFilter,
  type SearchFilter,
} from "../src/client/filters.js";
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
  assert.match(r.cli.err, /^WARN  \[lobbyregister\.api\] the API did not apply --sort "registration_desc" and sorted by RELEVANCE_DESC instead\./);

  const applied = await parity(["--compact", "search", "x", "--sort", "RELEVANCE_DESC"], (t) =>
    client(t).search({ q: "x", sort: "RELEVANCE_DESC" }), reply);
  assert.ok(applied.lib.ok);
  assert.equal("sortIgnored" in (applied.lib.value as object), false);
  assert.doesNotMatch(applied.cli.err, /Warning/);
});

// ---- finding 3: the engine's numeric limits (PAT-8) ----------------------------

test("intInRangeProblem accepts only safe integers in min..max", () => {
  const p = intInRangeProblem(0, 10);
  assert.equal(p(0), undefined);
  assert.equal(p(10), undefined);
  assert.equal(p(-1), "Must be >= 0.");
  assert.equal(p(11), "Must be <= 10.");
  for (const v of [NaN, Infinity, -Infinity, 1.5, "5", undefined]) assert.equal(p(v), "Expected an integer.", String(v));
  assert.equal(intInRangeProblem(0)(Number.MAX_SAFE_INTEGER), undefined);
});

const engineLimitCases: Array<[string, Record<string, number>]> = [
  ["--timeout=-1", { timeoutMs: -1 }],
  ["--timeout=NaN", { timeoutMs: NaN }],
  ["--timeout=1.5", { timeoutMs: 1.5 }],
  ["--timeout=2147483648", { timeoutMs: 2_147_483_648 }],
  ["--max-retries=-1", { maxRetries: -1 }],
  ["--max-retries=Infinity", { maxRetries: Infinity }],
  ["--max-retries=1.5", { maxRetries: 1.5 }],
  ["--max-redirects=-1", { maxRedirects: -1 }],
  ["--max-redirects=NaN", { maxRedirects: NaN }],
  ["--max-redirects=1.5", { maxRedirects: 1.5 }],
  ["--max-response-bytes=-1", { maxResponseBytes: -1 }],
  ["--max-response-bytes=NaN", { maxResponseBytes: NaN }],
  ["--max-response-bytes=1.5", { maxResponseBytes: 1.5 }],
];

test("parity: an out-of-range engine limit is rejected by both sides before any request", async () => {
  for (const [flag, options] of engineLimitCases) {
    const r = await parity([flag, "count"], (t) => new LobbyregisterClient({ ...options, transport: t }).count());
    assertBothReject(r.cli, r.lib, flag);
  }
});

test("the library also range-checks retryDelayMs, which has no CLI flag", () => {
  for (const retryDelayMs of [-1, NaN, Infinity, 0.5]) {
    assert.throws(() => new LobbyregisterClient({ retryDelayMs }), LobbyValidationError, String(retryDelayMs));
  }
});

test("parity: in-range engine limits (0 and the maximum) send the same request", async () => {
  const argv = ["--timeout=0", "--max-retries=0", "--max-redirects=0", "--max-response-bytes=0", "count"];
  const r = await parity(argv, (t) =>
    new LobbyregisterClient({ timeoutMs: 0, maxRetries: 0, maxRedirects: 0, maxResponseBytes: 0, transport: t }).count());
  assertSameRequests(r.cli, r.lib, argv.join(" "));
  const max = await parity([`--timeout=${MAX_TIMEOUT_MS}`, "count"], (t) =>
    new LobbyregisterClient({ timeoutMs: MAX_TIMEOUT_MS, transport: t }).count());
  assertSameRequests(max.cli, max.lib, "--timeout=MAX_TIMEOUT_MS");
});

// ---- finding 5: User-Agent and header values (PAT-5) ---------------------------

test("headerValueProblem / headerNameProblem", () => {
  for (const ok of ["my-app/1.0", "café", "a\tb"]) assert.equal(headerValueProblem(ok), undefined, JSON.stringify(ok));
  assert.equal(headerValueProblem(""), "Expected a non-empty value.");
  assert.equal(headerValueProblem("   "), "Expected a non-empty value.");
  assert.equal(headerValueProblem(5), "Expected a non-empty value.");
  for (const bad of ["a\r\nX-Injected: 1", "a\u0000b", "a\u007fb"]) {
    assert.equal(headerValueProblem(bad), "Value contains control characters.", JSON.stringify(bad));
  }
  for (const bad of ["agent☃", "€"]) {
    assert.equal(headerValueProblem(bad), "Value contains characters outside Latin-1 (above U+00FF).");
  }
  assert.equal(headerNameProblem("X-Request-Id"), undefined);
  for (const bad of ["", "X Bad", "X:a", "X\r\nY"]) assert.ok(headerNameProblem(bad), JSON.stringify(bad));
});

test("parity: a blank or unsendable User-Agent is rejected by both sides before any request", async () => {
  for (const ua of ["", "   ", "a\r\nX-Injected: 1", "\u0000", "agent☃", "€"]) {
    const r = await parity(["--user-agent", ua, "count"], (t) => new LobbyregisterClient({ userAgent: ua, transport: t }).count());
    assertBothReject(r.cli, r.lib, `--user-agent ${JSON.stringify(ua)}`);
  }
});

test("parity: an accepted User-Agent is sent identically by both sides", async () => {
  for (const ua of ["café", "a\tb"]) {
    const r = await parity(["--user-agent", ua, "count"], (t) => new LobbyregisterClient({ userAgent: ua, transport: t }).count());
    assertSameRequests(r.cli, r.lib, JSON.stringify(ua));
    assert.equal(r.cli.requests[0]?.headers?.["User-Agent"], ua);
    assert.equal(r.lib.requests[0]?.headers?.["User-Agent"], ua);
  }
});

test("the library checks the names and values of the headers option too", () => {
  const cases: Record<string, string>[] = [{ "X-A": "a\r\nb" }, { "X-A": "" }, { "X A": "x" }];
  for (const headers of cases) {
    assert.throws(() => new LobbyregisterClient({ headers }), LobbyValidationError, JSON.stringify(headers));
  }
  new LobbyregisterClient({ headers: { Authorization: "Bearer x" } });
});

// ---- finding 6: filter trimming and attribute lower-casing (PAT-16) ------------

/** A /sucheJson stand-in that echoes the facet filters it received, as the live API does. */
function echoFacets(req: HttpRequest): HttpResponse {
  const facets: { attribute: string; value: string }[] = [];
  for (const key of new URL(req.url).searchParams.keys()) {
    const m = /^filter\[([^\]]+)\]\[([^\]]+)\]$/.exec(key);
    if (m) facets.push({ attribute: m[1]!, value: m[2]! });
  }
  return jsonResponse({ resultCount: 2, results: [{ id: "R001" }, { id: "R002" }], searchParameters: { facets } });
}

test("normaliseFilter trims both parts and lower-cases the attribute, idempotently", () => {
  const once = normaliseFilter({ attribute: " RevolvingDoorData ", value: "\ttrue " });
  assert.deepEqual(once, { attribute: "revolvingdoordata", value: "true" });
  assert.deepEqual(normaliseFilter(once), once);
  // The value keeps its case: codes such as FOI_ENERGY are upper case.
  assert.deepEqual(normaliseFilter({ attribute: "FieldsOfInterest", value: " FOI_ENERGY" }), {
    attribute: "fieldsofinterest",
    value: "FOI_ENERGY",
  });
});

test("parseFilter splits at the first '=' and checks the filter", () => {
  assert.deepEqual(parseFilter(" RevolvingDoorData = true "), { attribute: "revolvingdoordata", value: "true" });
  assert.deepEqual(parseFilter("fieldsofinterest=FOI_WORK|FOI_WORK_POLICY"), {
    attribute: "fieldsofinterest",
    value: "FOI_WORK|FOI_WORK_POLICY",
  });
  for (const [text, message] of [
    ["revolvingdoordata", /expected attribute=value/],
    ["=true", /expected attribute=value/],
    ["revolvingdoordata= ", /expected attribute=value/],
    ["foo=true", /Unknown filter "foo"/],
    ["revolvingdoordata=a=b", /Invalid filter value for "revolvingdoordata"/],
  ] as const) {
    assert.throws(() => parseFilter(text), (e: unknown) => e instanceof LobbyValidationError && message.test((e as Error).message), text);
  }
});

test("parity: untrimmed or mixed-case filters send the same request on both sides", async () => {
  const cases: Array<[string, SearchFilter]> = [
    [" RevolvingDoorData = true ", { attribute: " RevolvingDoorData ", value: " true " }],
    ["RevolvingDoorData=true", { attribute: "RevolvingDoorData", value: "true" }],
    ["revolvingdoordata=true ", { attribute: "revolvingdoordata", value: "true " }],
    ["revolvingdoordata=\ttrue", { attribute: "revolvingdoordata", value: "\ttrue" }],
  ];
  for (const [text, filter] of cases) {
    const s = await parity(["--compact", "search", "--filter", text], (t) => client(t).search({ filters: [filter] }), echoFacets);
    assertSameRequests(s.cli, s.lib, `search --filter ${JSON.stringify(text)}`);
    const c = await parity(["--compact", "count", "--filter", text], (t) => client(t).count(undefined, [filter]), echoFacets);
    assertSameRequests(c.cli, c.lib, `count --filter ${JSON.stringify(text)}`);
    assert.equal(c.lib.ok && c.lib.value, 2);
  }
});

// ---- finding 7: an invalid base URL is a validation error (PAT-2) --------------

test("baseUrlProblem accepts only absolute http(s) URLs", () => {
  for (const ok of ["https://www.lobbyregister.bundestag.de", "http://localhost:8080/api/", " https://example.test "]) {
    assert.equal(baseUrlProblem(ok), undefined, ok);
  }
  for (const bad of ["", "   ", "not-a-url", "http://", "https:"]) {
    assert.equal(baseUrlProblem(bad), "Expected an absolute http(s) URL.", JSON.stringify(bad));
  }
  assert.equal(baseUrlProblem("ftp://x"), 'Unsupported scheme "ftp:". Expected an http(s) URL.');
  assert.equal(baseUrlProblem("file:///etc/passwd"), 'Unsupported scheme "file:". Expected an http(s) URL.');
});

test("parity: an invalid base URL is a usage error in the CLI and a LobbyValidationError in the library", async () => {
  for (const baseUrl of ["ftp://x", "", "http://", "   ", "not-a-url", "file:///etc/passwd", "https:", "javascript:alert(1)"]) {
    const r = await parity(["--base-url", baseUrl, "count", "x"], (t) => new LobbyregisterClient({ baseUrl, transport: t }).count("x"));
    assertBothReject(r.cli, r.lib, `--base-url ${JSON.stringify(baseUrl)}`);
    if (!r.lib.ok) assert.equal(r.lib.error instanceof LobbyNetworkError, false, baseUrl);
  }
});

test("parity: an accepted base URL sends the same request on both sides", async () => {
  for (const baseUrl of [" https://example.test ", "https://example.test/api?foo=bar#frag", "http://localhost:8080/"]) {
    const r = await parity(["--base-url", baseUrl, "count", "x"], (t) => new LobbyregisterClient({ baseUrl, transport: t }).count("x"));
    assertSameRequests(r.cli, r.lib, baseUrl);
  }
});
