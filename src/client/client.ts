// LobbyregisterClient — a typed client over the open (no-auth) search endpoint of
// the German Lobbyregister (https://www.lobbyregister.bundestag.de/sucheJson),
// the public register of interest representatives ("Lobbyisten").
//
//   client.search({ q: "Energie", pageSize: 10 })   // first 10 of every match
//   client.count("Energie")

import { RequestEngine, type EngineOptions } from "./engine.js";
import { LobbyError, LobbyParseError, LobbyValidationError } from "./errors.js";
import { describeFilter, filterQuery, ignoredFilters, ignoredSort, type SearchFilter } from "./filters.js";
import type { QueryParams } from "./query.js";
import type { SearchResult, SearchParams } from "./types.js";
import { assertValid, nonEmptyProblem } from "./validate.js";

const PATH = "/sucheJson";

/**
 * Narrow an arbitrary parsed JSON value to the `SearchResult` envelope. The
 * endpoint is trusted but not infallible (a proxy, an error page served with a
 * `200`, or a future schema change could all yield valid JSON of the wrong
 * shape), so reject anything missing a numeric `resultCount` or an array
 * `results` rather than silently reporting a bogus count or crashing later.
 * The count must be a non-negative safe integer: `-5` or `1e400` (Infinity,
 * which JSON output prints as `null`) is no count. Every entry in `results` must be
 * a JSON object: a `null` or a string there would be printed as a register entry.
 */
function assertSearchResult(value: unknown): asserts value is SearchResult {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as { resultCount?: unknown }).resultCount !== "number" ||
    !Array.isArray((value as { results?: unknown }).results)
  ) {
    throw new LobbyParseError(
      `Unexpected response shape from ${PATH}: expected a JSON object with a numeric resultCount and a results array.`,
    );
  }
  const count = (value as { resultCount: number }).resultCount;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new LobbyParseError(
      `Unexpected response shape from ${PATH}: expected a non-negative integer resultCount.`,
    );
  }
  const results = (value as { results: unknown[] }).results;
  if (results.some((entry) => typeof entry !== "object" || entry === null || Array.isArray(entry))) {
    throw new LobbyParseError(
      `Unexpected response shape from ${PATH}: expected every entry in results to be a JSON object.`,
    );
  }
}

/**
 * Why a search envelope's `resultCount` and its `results` disagree, as one sentence, or
 * `undefined` when they agree. `/sucheJson` returns every match
 * (it ignores paging), so the two should always be equal; `count()` trusts
 * `resultCount` either way, and the CLI's `count` logs this as a `WARN` record of
 * `lobbyregister.api` on stderr. Pass the envelope
 * as the register sent it — a page `search()` sliced with `pageSize` has fewer results by
 * design.
 */
export function resultCountMismatch(result: Pick<SearchResult, "resultCount" | "results">): string | undefined {
  const returned = result.results.length;
  if (returned === result.resultCount) return undefined;
  return (
    `the register reports resultCount ${result.resultCount} but returned ${returned} ` +
    `result${returned === 1 ? "" : "s"}; the count shown is resultCount`
  );
}

/** Throw `LobbyValidationError` unless `value` is undefined or an integer from 1 to MAX_SAFE_INTEGER. */
function assertPageNumber(name: string, value: unknown): void {
  if (value !== undefined && !(typeof value === "number" && Number.isSafeInteger(value) && value >= 1)) {
    const got = typeof value === "number" ? String(value) : value === null ? "null" : typeof value;
    throw new LobbyValidationError(`Invalid ${name}: expected an integer >= 1, got ${got}.`);
  }
}

/** The keys `search()` takes. */
const SEARCH_PARAM_KEYS: readonly string[] = ["q", "page", "pageSize", "sort", "filters", "allowUnknownFilters"];

/**
 * Check the shape of `search()`'s parameters before anything else: an object (or
 * undefined) with only the keys `search()` takes, `filters` an array,
 * `allowUnknownFilters` a boolean. An unknown key — a misspelled `filter`, a facet
 * given as a key (`{ revolvingdoordata: "true" }`), `__proto__` from parsed JSON — used
 * to be ignored, so the call downloaded the whole unfiltered register. A wrong type used to
 * fail as a raw TypeError (`filters.map is not a function`), or, for a truthy string
 * `allowUnknownFilters`, to be read as false without a word.
 */
function assertSearchParams(params: unknown): asserts params is SearchParams {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    const got = params === null ? "null" : Array.isArray(params) ? "an array" : typeof params;
    throw new LobbyValidationError(
      `Invalid search parameters: expected an object such as { q: "Energie" }, got ${got}.` +
        (typeof params === "string" ? " (count() takes the query string itself: count(\"Energie\").)" : ""),
    );
  }
  const p = params as Record<string, unknown>;
  const unknown = Object.keys(p).filter((key) => !SEARCH_PARAM_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new LobbyValidationError(
      `Invalid search parameters: unknown ${unknown.length === 1 ? "key" : "keys"} ` +
        `${unknown.map((key) => JSON.stringify(key)).join(", ")}; search() takes ${SEARCH_PARAM_KEYS.join(", ")}. ` +
        "An unknown key would be ignored and the result left unfiltered.",
    );
  }
  if (p["filters"] !== undefined && !Array.isArray(p["filters"])) {
    throw new LobbyValidationError(
      `Invalid filters: expected an array of { attribute, value } objects, got ${p["filters"] === null ? "null" : typeof p["filters"]}.`,
    );
  }
  if (p["allowUnknownFilters"] !== undefined && typeof p["allowUnknownFilters"] !== "boolean") {
    throw new LobbyValidationError(
      `Invalid allowUnknownFilters: expected true or false, got ${typeof p["allowUnknownFilters"]}.`,
    );
  }
}

/**
 * Slice one page out of the envelope. `resultCount` stays the API's total; only
 * `results` is cut. Without `pageSize` the envelope is returned unchanged.
 */
function slicePage(result: SearchResult, page: number | undefined, pageSize: number | undefined): SearchResult {
  if (pageSize === undefined) return result;
  const start = ((page ?? 1) - 1) * pageSize;
  return { ...result, results: result.results.slice(start, start + pageSize) };
}

export class LobbyregisterClient {
  // A real private field: util.inspect, console.log and JSON.stringify of a client
  // never show the engine, and so never the base URL or a header a caller added.
  readonly #engine: RequestEngine;

  constructor(options: EngineOptions = {}) {
    this.#engine = new RequestEngine(options);
  }

  /**
   * Search the register; returns the full envelope (resultCount + results).
   *
   * `/sucheJson` ignores `page`/`pageSize` and always returns every match, so they
   * are not sent: the client downloads the whole set and slices `results` itself
   * (`pageSize` entries, 1-based `page`, default 1). `resultCount` stays the true
   * total. Both must be integers >= 1, and `page` needs `pageSize`; otherwise
   * `LobbyValidationError` is thrown before any request.
   *
   * `q` and `sort` may be omitted, but not blank: the register reads a blank `q`
   * as no query (the whole register) and a blank `sort` as the default order, so
   * `""` or whitespace rejects with `LobbyValidationError` before any request.
   *
   * An unknown key in `params` is a `LobbyValidationError`. Each filter attribute
   * must be one of `SEARCH_FILTER_ATTRIBUTES` (the register ignores any other and
   * would return the whole unfiltered set), and each value one of
   * `SEARCH_FILTER_VALUES` (the register matches nothing for any other: a reply of 0),
   * else `LobbyValidationError` before any request. Values are matched
   * case-insensitively and a bare sub-code from the data is sent with its parent
   * (`FOI_EU_LAWS` → `FOI_EUROPEAN_UNION|FOI_EU_LAWS`; see `normaliseFilter`).
   * `allowUnknownFilters: true` lifts both catalogues for an attribute or value the
   * register added after this release.
   * With `filters`, the reply must also echo every filter in
   * `searchParameters.facets`; one the register ignored (it would return the
   * unfiltered set) throws `LobbyError`. A reply without a `facets` array cannot
   * be checked and is passed through.
   *
   * The register ignores an unknown or wrong-case `sort` and falls back to its
   * default order. When `searchParameters.sortOrder` differs from the requested
   * `sort`, the result carries `sortIgnored: { requested, applied }` (see
   * `ignoredSort`); the data is still returned.
   */
  async search(params: SearchParams = {}): Promise<SearchResult> {
    assertSearchParams(params);
    if (params.q !== undefined) assertValid("q", params.q, nonEmptyProblem);
    if (params.sort !== undefined) assertValid("sort", params.sort, nonEmptyProblem);
    assertPageNumber("page", params.page);
    assertPageNumber("pageSize", params.pageSize);
    if (params.page !== undefined && params.pageSize === undefined) {
      throw new LobbyValidationError(
        "Invalid page: page needs pageSize (the client slices the full result set into pages).",
      );
    }
    const filters = params.filters ?? [];
    const query: QueryParams = filterQuery(filters, { allowUnknown: params.allowUnknownFilters });
    if (params.q !== undefined) query["q"] = params.q;
    if (params.sort !== undefined) query["sort"] = params.sort;
    const result = await this.#engine.getJson<unknown>(PATH, query);
    assertSearchResult(result);
    const ignored = ignoredFilters(filters, result.searchParameters);
    if (ignored !== undefined && ignored.length > 0) {
      throw new LobbyError(
        `The register ignored the filter ${ignored.map((f) => `"${describeFilter(f)}"`).join(", ")} ` +
          "(missing from searchParameters.facets in the reply), so the result would not be filtered.",
      );
    }
    const sortIgnored = ignoredSort(params.sort, result.searchParameters);
    const page = slicePage(result, params.page, params.pageSize);
    return sortIgnored === undefined ? page : { ...page, sortIgnored };
  }

  /**
   * How many entries match a query (and filters).
   *
   * The API has no count-only mode: a live probe of `/sucheJson` (2026-06) showed
   * it ignores `pageSize` (both `0` and `1` return the full result set, e.g. all
   * 2351 entries for `q=Energie`, with the correct `resultCount`). So this
   * downloads every matching record, like `search`, and reads `resultCount`.
   * A blank `q` rejects with `LobbyValidationError`, as in `search`, and so do
   * filters `search` would reject; `options.allowUnknownFilters` is `search`'s.
   * When `resultCount` and the number of downloaded results disagree, `resultCount`
   * is returned all the same (see {@link resultCountMismatch}).
   */
  async count(
    q?: string,
    filters?: readonly SearchFilter[],
    options: { allowUnknownFilters?: boolean } = {},
  ): Promise<number> {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw new LobbyValidationError("Invalid count options: expected an object such as { allowUnknownFilters: true }.");
    }
    const res = await this.search({
      q,
      ...(filters !== undefined ? { filters } : {}),
      ...(options.allowUnknownFilters !== undefined ? { allowUnknownFilters: options.allowUnknownFilters } : {}),
    });
    return res.resultCount;
  }
}
