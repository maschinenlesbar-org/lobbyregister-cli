// Facet filters of `/sucheJson`.
//
// The endpoint accepts the facet filters of the register's website search form
// (https://www.lobbyregister.bundestag.de/suche, read 2026-09-26) as
// `filter[<attribute>][<value>]=true`, and echoes the ones it applied in
// `searchParameters.facets`. Checked live on 2026-09-26:
//   - an unknown attribute is dropped from the echo and ignored, so the reply is the
//     whole unfiltered set — hence the attribute allowlist below;
//   - an unknown value is echoed but matches nothing (`resultCount: 0`);
//   - two values of one attribute are alternatives (OR); different attributes must
//     all match (AND).
// The website's number ranges (`filter[financialexpenses][100-2000]`, reported in
// `searchParameters.numberRanges`) are not covered here.

import { LobbyValidationError } from "./errors.js";
import type { QueryParams } from "./query.js";
import { assertValid, type Problem } from "./validate.js";

/** One facet filter: `{ attribute: "revolvingdoordata", value: "true" }`. */
export interface SearchFilter {
  attribute: string;
  value: string;
}

/**
 * The facet attributes of the website's search form (2026-09-26). The client
 * (and so the CLI) accepts only these; when the register adds one, add it here.
 */
export const SEARCH_FILTER_ATTRIBUTES: readonly string[] = [
  "activelobbyist",
  "activity",
  "annotations",
  "capitalrepresentativeoffice",
  "contractwithentrustedperson",
  "contractwithreceivedfunds",
  "contractwithregulatoryproject",
  "contractwithsubcontractor",
  "donationsreceived",
  "donationtypes",
  "fieldsofinterest",
  "ftepresent",
  "hasmemberships",
  "legalform",
  "legalformtype",
  "mainfundingsource",
  "memberscombination",
  "membershipfeesandcontributerspresent",
  "owncodeofconduct",
  "regulatoryprojecttypes",
  "revolvingdooractive",
  "revolvingdoorareas",
  "revolvingdoordata",
  "revolvingdoorpersontypes",
  "statements",
  "typesofexercisinglobbywork",
  "workascontractor",
];

/**
 * An attribute the register knows: one of `SEARCH_FILTER_ATTRIBUTES`. The register
 * ignores an unknown attribute and answers with the whole unfiltered set.
 */
export const knownFilterAttributeProblem: Problem<string> = (attribute) =>
  SEARCH_FILTER_ATTRIBUTES.includes(attribute)
    ? undefined
    : `Unknown filter ${JSON.stringify(attribute)}. The register ignores unknown filters and would ` +
      `return the whole unfiltered set. Filters: ${SEARCH_FILTER_ATTRIBUTES.join(", ")}.`;

/** An attribute name: lower-case letters only, as in the search form. */
const ATTRIBUTE_PATTERN = /^[a-z]+$/;

/**
 * A facet value: a code such as `true`, `FOI_ENERGY` or, for a sub-field,
 * `FOI_WORK|FOI_WORK_POLICY`. Nothing that could break out of the bracketed key.
 */
export const FILTER_VALUE_PATTERN = /^[A-Za-z0-9_|]+$/;

/**
 * The canonical form of a filter: both parts trimmed, the attribute lower-cased
 * (the register's attributes are lower case; values such as `FOI_ENERGY` keep
 * their case). Idempotent. Parts that are not strings are left for the checks in
 * `filterQuery` / `parseFilter` to reject.
 */
export function normaliseFilter(filter: SearchFilter): SearchFilter {
  if (typeof filter !== "object" || filter === null) return filter;
  const { attribute, value } = filter;
  return {
    attribute: typeof attribute === "string" ? attribute.trim().toLowerCase() : attribute,
    value: typeof value === "string" ? value.trim() : value,
  };
}

/**
 * Check one normalised filter; throws `LobbyValidationError` for a malformed
 * attribute or value, and for an attribute outside `SEARCH_FILTER_ATTRIBUTES`
 * unless `allowUnknown`.
 */
function checkFilter(filter: SearchFilter, allowUnknown: boolean): void {
  if (typeof filter?.attribute !== "string") {
    throw new LobbyValidationError(
      `Invalid filter attribute: expected lower-case letters, got ${JSON.stringify(filter?.attribute)}.`,
    );
  }
  if (!allowUnknown) assertValid("filter attribute", filter.attribute, knownFilterAttributeProblem);
  if (!ATTRIBUTE_PATTERN.test(filter.attribute)) {
    throw new LobbyValidationError(
      `Invalid filter attribute: expected lower-case letters, got ${JSON.stringify(filter.attribute)}.`,
    );
  }
  if (typeof filter.value !== "string" || !FILTER_VALUE_PATTERN.test(filter.value)) {
    throw new LobbyValidationError(
      `Invalid filter value for "${filter.attribute}": expected a code such as true, FOI_ENERGY or ` +
        `FOI_WORK|FOI_WORK_POLICY, got ${JSON.stringify(filter.value)}.`,
    );
  }
}

/**
 * Parse the text form `attribute=value` (split at the first `=`), normalise it
 * (normaliseFilter) and check it like `filterQuery` does. Throws
 * `LobbyValidationError` for a missing `=` or a blank part, an unknown attribute
 * or a malformed value. The CLI's `--filter` parser is this function.
 */
export function parseFilter(text: string): SearchFilter {
  const eq = text.indexOf("=");
  const filter = normaliseFilter({
    attribute: eq === -1 ? "" : text.slice(0, eq),
    value: eq === -1 ? "" : text.slice(eq + 1),
  });
  if (filter.attribute === "" || filter.value === "") {
    throw new LobbyValidationError(
      `Invalid filter ${JSON.stringify(text)}: expected attribute=value, e.g. revolvingdoordata=true.`,
    );
  }
  checkFilter(filter, false);
  return filter;
}

/**
 * Normalise and check the filters (normaliseFilter: trimmed, attribute in lower
 * case) and turn them into query parameters
 * (`filter[revolvingdoordata][true]=true`). Throws `LobbyValidationError` for a
 * malformed attribute or value, and for an attribute outside
 * `SEARCH_FILTER_ATTRIBUTES` (knownFilterAttributeProblem) — the register would
 * ignore it and return the whole unfiltered set. `allowUnknown` skips only the
 * allowlist, for an attribute the register added after this release;
 * `LobbyregisterClient.search` still verifies that the reply echoes every filter,
 * which also catches an attribute the register has dropped.
 */
export function filterQuery(
  filters: readonly SearchFilter[],
  options: { allowUnknown?: boolean } = {},
): QueryParams {
  const query: QueryParams = {};
  for (const filter of filters.map(normaliseFilter)) {
    checkFilter(filter, options.allowUnknown === true);
    query[`filter[${filter.attribute}][${filter.value}]`] = "true";
  }
  return query;
}

/** `attribute=value`, the form the CLI takes and messages print. */
export function describeFilter(filter: SearchFilter): string {
  return `${filter.attribute}=${filter.value}`;
}

/**
 * The requested filters the reply does not echo in `searchParameters.facets`,
 * i.e. the ones the register ignored, compared (and returned) in their
 * normalised form (normaliseFilter), as `filterQuery` sent them. `undefined`
 * when the reply carries no `facets` array to check against.
 */
export function ignoredFilters(
  filters: readonly SearchFilter[],
  searchParameters: unknown,
): SearchFilter[] | undefined {
  const facets =
    typeof searchParameters === "object" && searchParameters !== null
      ? (searchParameters as { facets?: unknown }).facets
      : undefined;
  if (!Array.isArray(facets)) return undefined;
  return filters.map(normaliseFilter).filter(
    (f) =>
      !facets.some(
        (echo: unknown) =>
          typeof echo === "object" &&
          echo !== null &&
          (echo as { attribute?: unknown }).attribute === f.attribute &&
          (echo as { value?: unknown }).value === f.value,
      ),
  );
}

/** A sort the register did not apply: the order asked for and the one it used. */
export interface SortIgnored {
  requested: string;
  applied: string;
}

/**
 * The requested sort, when the reply's `searchParameters.sortOrder` names a
 * different one: the register ignores an unknown or wrong-case sort (HTTP 200)
 * and falls back to its default order (`RELEVANCE_DESC`, which is not stable
 * between requests). `undefined` when no sort was requested, when it was
 * applied, or when the reply echoes no `sortOrder` string to compare against.
 */
export function ignoredSort(requested: string | undefined, searchParameters: unknown): SortIgnored | undefined {
  if (requested === undefined) return undefined;
  const applied =
    typeof searchParameters === "object" && searchParameters !== null
      ? (searchParameters as { sortOrder?: unknown }).sortOrder
      : undefined;
  if (typeof applied !== "string" || applied === requested) return undefined;
  return { requested, applied };
}
