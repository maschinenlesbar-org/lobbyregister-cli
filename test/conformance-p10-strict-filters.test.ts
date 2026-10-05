// Conformance test P10 (fix plan 2026-10-06): a filter the API would ignore never goes out.
// An unknown, misspelled or `__proto__` key, an unknown filter name, an array or NaN where
// the API takes one value are the library's validation error before any data request; a
// filter name that is only spelled differently (NFD, padding, case) is normalised or
// rejected, never sent as typed; a repeated filter flag is combined or rejected, never
// "last one wins". The API answers all of these with the whole unfiltered set or a wrong
// count and HTTP 200. Shared across the *-cli repos with filters; only the adapter differs.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CliDeps } from "../src/cli/io.js";
import type { HttpRequest, HttpResponse } from "../src/client/http.js";

// ---- adapter (per repo) -------------------------------------------------------------
import { run } from "../src/cli/run.js";
import { LobbyregisterClient as Client } from "../src/client/client.js";
import { LobbyValidationError as ValidationError } from "../src/client/errors.js";
/** The library's filtered call, with its query/parameter object passed through as is. */
const call = (client: Client, query: Record<string, unknown>): Promise<unknown> => client.search(query as never);
/** A valid query, and the filter it sends (read back from the request by `sentFilter`). */
const GOOD = {
  query: {
    filters: [
      { attribute: "revolvingdoordata", value: "true" },
      { attribute: "fieldsofinterest", value: "FOI_EUROPEAN_UNION|FOI_EU_LAWS" },
    ],
  },
};
const GOOD_SENT = "filter[fieldsofinterest][FOI_EUROPEAN_UNION|FOI_EU_LAWS]&filter[revolvingdoordata][true]";
/** What a data request carries as its filter (to compare with GOOD_SENT): the sorted facet keys. */
const sentFilter = (req: HttpRequest): string | null =>
  [...new URL(req.url).searchParams.keys()].filter((k) => k.startsWith("filter[")).sort().join("&") || null;
/** Queries with a key the call doesn't take: unknown, misspelled, `__proto__` (from JSON). */
const BAD_KEYS: Array<[string, Record<string, unknown>]> = [
  ["unknown key", { revolvingdoordata: "true" }],
  ["misspelled key", { filter: [{ attribute: "revolvingdoordata", value: "true" }] }],
  ["wrong-case key", { Filters: [{ attribute: "revolvingdoordata", value: "true" }] }],
  ["__proto__ key", JSON.parse('{"__proto__": {"filters": [{"attribute": "revolvingdoordata", "value": "true"}]}}') as Record<string, unknown>],
];
/** Queries whose filter names the API doesn't have. */
const BAD_FILTER_NAMES: Array<[string, Record<string, unknown>]> = [
  ["unknown name", { filters: [{ attribute: "lobbyistname", value: "true" }] }],
  ["misspelled name", { filters: [{ attribute: "revolvingdoordta", value: "true" }] }],
  ["__proto__ name", { filters: [{ attribute: "__proto__", value: "true" }] }],
  ["constructor name", { filters: [{ attribute: "constructor", value: "true" }] }],
  ["a number-range facet the client doesn't take", { filters: [{ attribute: "financialexpenses", value: "100" }] }],
  // lobbyregister: a value the register doesn't know matches nothing (resultCount 0).
  ["a plausible value that isn't the code", { filters: [{ attribute: "donationsreceived", value: "true" }] }],
  ["an unknown code", { filters: [{ attribute: "fieldsofinterest", value: "FOI_NOTHING" }] }],
  ["a sub-code under the wrong parent", { filters: [{ attribute: "fieldsofinterest", value: "FOI_ENERGY|FOI_EU_LAWS" }] }],
];
/** Values of the wrong type: arrays where the API takes one value, NaN, objects. */
const BAD_VALUES: Array<[string, Record<string, unknown>]> = [
  ["array value", { filters: [{ attribute: "revolvingdoordata", value: ["true", "false"] }] }],
  ["object filters", { filters: { attribute: "revolvingdoordata", value: "true" } }],
  ["NaN page", { page: Number.NaN, pageSize: 2 }],
  ["NaN pageSize", { pageSize: Number.NaN }],
  ["array page", { page: [1, 2], pageSize: 2 }],
];
/**
 * Queries that differ from GOOD only in how a filter is spelled (padding, case, a bare
 * sub-code as the entries carry it): the API matches nothing for such a value.
 * "normalise" = sent as GOOD_SENT; "reject" = the validation error.
 */
const UNNORMALISED: Array<[string, Record<string, unknown>]> = [
  ["padded", { filters: [{ attribute: " revolvingdoordata ", value: " true " }, { attribute: "fieldsofinterest", value: " FOI_EUROPEAN_UNION|FOI_EU_LAWS" }] }],
  ["upper-case attribute and value", { filters: [{ attribute: "RevolvingDoorData", value: "TRUE" }, { attribute: "FieldsOfInterest", value: "FOI_EUROPEAN_UNION|FOI_EU_LAWS" }] }],
  ["lower-case code", { filters: [{ attribute: "revolvingdoordata", value: "true" }, { attribute: "fieldsofinterest", value: "foi_european_union|foi_eu_laws" }] }],
  ["bare sub-code from the data", { filters: [{ attribute: "revolvingdoordata", value: "true" }, { attribute: "fieldsofinterest", value: "FOI_EU_LAWS" }] }],
];
const UNNORMALISED_POLICY = "normalise" as "normalise" | "reject";
/** The CLI's filter flag given twice (the two halves of GOOD), and what the repo does with it. */
const REPEATED_FLAG_ARGV = ["count", "--filter", "revolvingdoordata=true", "--filter", "fieldsofinterest=FOI_EU_LAWS"];
const REPEATED_POLICY = "combine" as "combine" | "reject";
/** A single-value option given twice, which must be a usage error. */
const REPEATED_SINGLE_ARGV = ["search", "--sort", "NAME_ASC", "--sort", "NAME_DESC"];
const USAGE_EXIT = 2;
/** True for a request that fetches data (every lobbyregister request does). */
const isDataRequest = (_req: HttpRequest): boolean => true;
/** The answer to any request: an envelope that echoes the facets, as the register does. */
const respond = (req: HttpRequest): HttpResponse => {
  const facets = [...new URL(req.url).searchParams.keys()]
    .map((k) => /^filter\[([^\]]+)\]\[([^\]]+)\]$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ attribute: m[1], value: m[2] }));
  return {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: Buffer.from(JSON.stringify({ resultCount: 0, results: [], searchParameters: { facets } })),
  };
};
/** CliDeps for this repo. */
const makeDeps = (io: CliDeps["io"], transport: (req: HttpRequest) => Promise<HttpResponse>): CliDeps => ({
  io,
  createClient: (opts) => new Client({ ...opts, transport }),
});
// --------------------------------------------------------------------------------------

function recorder() {
  const requests: HttpRequest[] = [];
  const transport = async (req: HttpRequest): Promise<HttpResponse> => {
    requests.push(req);
    return respond(req);
  };
  return { transport, data: () => requests.filter(isDataRequest) };
}

async function rejectsBeforeData(label: string, query: Record<string, unknown>): Promise<void> {
  const r = recorder();
  await assert.rejects(call(new Client({ transport: r.transport }), query), ValidationError, label);
  assert.equal(r.data().length, 0, `${label}: a data request went out`);
}

test("P10: the valid query goes out as given", async () => {
  const r = recorder();
  await call(new Client({ transport: r.transport }), GOOD.query);
  assert.deepEqual(r.data().map(sentFilter), [GOOD_SENT]);
});

test("P10: an unknown, misspelled or __proto__ key is a validation error before any data request", async () => {
  for (const [label, query] of BAD_KEYS) await rejectsBeforeData(label, query);
});

test("P10: a filter name the API doesn't have is a validation error before any data request", async () => {
  for (const [label, query] of BAD_FILTER_NAMES) await rejectsBeforeData(label, query);
});

test("P10: an array, object or NaN where the API takes one value is a validation error", async () => {
  for (const [label, query] of BAD_VALUES) await rejectsBeforeData(label, query);
});

test("P10: a filter name spelled differently is normalised or rejected, never sent as typed", async () => {
  for (const [label, query] of UNNORMALISED) {
    if (UNNORMALISED_POLICY === "reject") {
      await rejectsBeforeData(label, query);
      continue;
    }
    const r = recorder();
    await call(new Client({ transport: r.transport }), query);
    assert.deepEqual(r.data().map(sentFilter), [GOOD_SENT], label);
  }
});

test("P10: a repeated filter flag is combined or rejected, never last-one-wins", async () => {
  const r = recorder();
  const err: string[] = [];
  const code = await run(REPEATED_FLAG_ARGV, makeDeps({ out: () => {}, err: (s) => err.push(s) }, r.transport));
  if (REPEATED_POLICY === "combine") {
    assert.equal(code, 0, err.join("\n"));
    assert.deepEqual(r.data().map(sentFilter), [GOOD_SENT]);
  } else {
    assert.equal(code, USAGE_EXIT);
    assert.equal(r.data().length, 0);
  }
});

test("P10: a repeated single-value option is a usage error", async () => {
  const r = recorder();
  const err: string[] = [];
  const code = await run(REPEATED_SINGLE_ARGV, makeDeps({ out: () => {}, err: (s) => err.push(s) }, r.transport));
  assert.equal(code, USAGE_EXIT, err.join("\n"));
  assert.equal(r.data().length, 0);
});
