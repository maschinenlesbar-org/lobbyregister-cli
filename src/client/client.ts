// LobbyregisterClient — a typed client over the open (no-auth) search endpoint of
// the German Lobbyregister (https://www.lobbyregister.bundestag.de/sucheJson),
// the public register of interest representatives ("Lobbyisten").
//
//   client.search({ q: "Energie", pageSize: 10 })   // first 10 of every match
//   client.count("Energie")

import { RequestEngine, type EngineOptions } from "./engine.js";
import { LobbyError, LobbyParseError } from "./errors.js";
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

/** Throw unless `value` is undefined or an integer from 1 to MAX_SAFE_INTEGER. */
function assertPageNumber(name: string, value: number | undefined): void {
  if (value !== undefined && !(Number.isSafeInteger(value) && value >= 1)) {
    throw new LobbyError(`Invalid ${name}: expected an integer >= 1, got ${String(value)}.`);
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
   * `LobbyError` is thrown before any request.
   *
   * `q` and `sort` may be omitted, but not blank: the register reads a blank `q`
   * as no query (the whole register) and a blank `sort` as the default order, so
   * `""` or whitespace rejects with `LobbyValidationError` before any request.
   *
   * Each filter attribute must be one of `SEARCH_FILTER_ATTRIBUTES` (the register
   * ignores any other and would return the whole unfiltered set), else
   * `LobbyValidationError` before any request; `allowUnknownFilters: true` lifts
   * the allowlist for an attribute the register added after this release.
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
    if (params.q !== undefined) assertValid("q", params.q, nonEmptyProblem);
    if (params.sort !== undefined) assertValid("sort", params.sort, nonEmptyProblem);
    assertPageNumber("page", params.page);
    assertPageNumber("pageSize", params.pageSize);
    if (params.page !== undefined && params.pageSize === undefined) {
      throw new LobbyError("Invalid page: page needs pageSize (the client slices the full result set into pages).");
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
   * A blank `q` rejects with `LobbyValidationError`, as in `search`.
   */
  async count(q?: string, filters?: readonly SearchFilter[]): Promise<number> {
    const res = await this.search({ q, ...(filters !== undefined ? { filters } : {}) });
    return res.resultCount;
  }
}
