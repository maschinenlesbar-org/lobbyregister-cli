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

import { LobbyError } from "./errors.js";
import type { QueryParams } from "./query.js";

/** One facet filter: `{ attribute: "revolvingdoordata", value: "true" }`. */
export interface SearchFilter {
  attribute: string;
  value: string;
}

/**
 * The facet attributes of the website's search form (2026-09-26). The CLI accepts
 * only these; when the register adds one, add it here.
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

/** An attribute name: lower-case letters only, as in the search form. */
const ATTRIBUTE_PATTERN = /^[a-z]+$/;

/**
 * A facet value: a code such as `true`, `FOI_ENERGY` or, for a sub-field,
 * `FOI_WORK|FOI_WORK_POLICY`. Nothing that could break out of the bracketed key.
 */
export const FILTER_VALUE_PATTERN = /^[A-Za-z0-9_|]+$/;

/**
 * Check the filters' shape and turn them into query parameters
 * (`filter[revolvingdoordata][true]=true`). Throws `LobbyError` for a malformed
 * attribute or value. The attribute is not checked against
 * `SEARCH_FILTER_ATTRIBUTES` here: `LobbyregisterClient.search` instead verifies
 * that the reply echoes every filter, which also catches an attribute the
 * register has dropped.
 */
export function filterQuery(filters: readonly SearchFilter[]): QueryParams {
  const query: QueryParams = {};
  for (const filter of filters) {
    if (typeof filter?.attribute !== "string" || !ATTRIBUTE_PATTERN.test(filter.attribute)) {
      throw new LobbyError(
        `Invalid filter attribute: expected lower-case letters, got ${JSON.stringify(filter?.attribute)}.`,
      );
    }
    if (typeof filter.value !== "string" || !FILTER_VALUE_PATTERN.test(filter.value)) {
      throw new LobbyError(
        `Invalid filter value for "${filter.attribute}": expected a code such as true or FOI_ENERGY, got ${JSON.stringify(filter.value)}.`,
      );
    }
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
 * i.e. the ones the register ignored. `undefined` when the reply carries no
 * `facets` array to check against.
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
  return filters.filter(
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
