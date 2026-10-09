// Facet filters of `/sucheJson`.
//
// The endpoint accepts the facet filters of the register's website search form
// (https://www.lobbyregister.bundestag.de/suche, read 2026-09-26 and 2026-10-06) as
// `filter[<attribute>][<value>]=true`, and echoes the ones it applied in
// `searchParameters.facets`. Checked live on 2026-09-26 and 2026-10-05:
//   - an unknown attribute is dropped from the echo and ignored, so the reply is the
//     whole unfiltered set — hence the attribute allowlist below;
//   - an unknown value is echoed but matches nothing (`resultCount: 0`), so a plausible
//     value such as `donationsreceived=true` (the code is `DONATIONS_RECEIVED`) or a
//     sub-code copied from the data (`FOI_EU_LAWS`; the register wants
//     `FOI_EUROPEAN_UNION|FOI_EU_LAWS`) answered "nobody" — hence the value catalogue;
//   - two values of one attribute are alternatives (OR); different attributes must
//     all match (AND).
// The website's number ranges (`filter[financialexpenses][100-2000]`, reported in
// `searchParameters.numberRanges`) are not covered here.

import { LobbyValidationError, cutForMessage } from "./errors.js";
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
export const SEARCH_FILTER_ATTRIBUTES: readonly string[] = Object.freeze([
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
]);

/** The values of a yes/no facet. */
const BOOLEAN = ["false", "true"];

/**
 * The values of a facet with sub-codes: each parent code alone, and each sub-code
 * written `parent|sub`, which is the only form the register matches for a sub-code.
 */
function withSubCodes(tree: Record<string, readonly string[]>): string[] {
  return Object.entries(tree).flatMap(([parent, subs]) => [parent, ...subs.map((sub) => `${parent}|${sub}`)]);
}

/**
 * The value codes of each facet, read from the website's search form
 * (https://www.lobbyregister.bundestag.de/suche, 2026-10-06). The register matches
 * nothing for any other value (HTTP 200, `resultCount: 0`), so the client accepts
 * only these unless `allowUnknownFilters` is set; when the register adds a value, add
 * it here. Sub-codes (fields of interest, revolving-door areas) are listed in the
 * `parent|sub` form the register needs; `canonicalFilterValue` turns a bare sub-code
 * as the entries carry it (`FOI_EU_LAWS`) into that form.
 */
export const SEARCH_FILTER_VALUES: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    Object.entries({
  activelobbyist: BOOLEAN,
  activity: [
    "ACT_BILATERAL_CHAMBER", "ACT_CONSULTING", "ACT_EMPLOYEE_ASSOC", "ACT_EMPLOYER_ASSOC",
    "ACT_LAWYER", "ACT_LEGAL_ENTITY", "ACT_LEGAL_ENTITY_WITH_MANDATE",
    "ACT_NETWORK_WITHOUT_LEGAL_FORM", "ACT_NONPROFIT_ORGA_V2", "ACT_ORGANIZATION", "ACT_PRIVATE",
    "ACT_PRIVATE_CHAMBER", "ACT_PRIVATE_LAW_ORGA", "ACT_PRIVATE_ORGA_V2", "ACT_PROFESSION_ASSOC",
    "ACT_RELIGIOUS_GROUP", "ACT_RESEARCH_FACILITY_V2", "ACT_TRADE_ASSOC",
  ],
  annotations: ["CODEX_VIOLATION", "UPDATE_MISSING"],
  capitalrepresentativeoffice: BOOLEAN,
  contractwithentrustedperson: BOOLEAN,
  contractwithreceivedfunds: BOOLEAN,
  contractwithregulatoryproject: BOOLEAN,
  contractwithsubcontractor: BOOLEAN,
  donationsreceived: [
    "DONATIONS_INFORMATION_MISSING_FISCAL_YEAR", "DONATIONS_NOT_RECEIVED", "DONATIONS_RECEIVED",
  ],
  donationtypes: [
    "EUROPEAN_UNION", "EU_MEMBER_STATE", "GERMAN_PUBLIC_SECTOR_FEDERAL",
    "GERMAN_PUBLIC_SECTOR_LAND", "GERMAN_PUBLIC_SECTOR_MUNICIPALITY", "THIRD_COUNTRY",
  ],
  fieldsofinterest: withSubCodes({
    FOI_AGRICULTURE_FOOD: [
      "FOI_AF_AQUACULTURE", "FOI_AF_FOOD_INDUSTRY", "FOI_AF_FOOD_SAFETY", "FOI_AF_FORESTRY",
      "FOI_AF_OTHER",
    ],
    FOI_BUNDESTAG: [
      "FOI_BUNDESTAG_LEGAL", "FOI_BUNDESTAG_OTHER", "FOI_BUNDESTAG_PARLIAMENTARY",
      "FOI_BUNDESTAG_VOTE",
    ],
    FOI_CULTURE: [],
    FOI_DEFENSE: [
      "FOI_DEFENSE_AFFAIRS", "FOI_DEFENSE_ARMAMENTS", "FOI_DEFENSE_OTHER", "FOI_DEFENSE_POLICY",
    ],
    FOI_DEVELOPMENT_POLICY: [],
    FOI_ECONOMY: [
      "FOI_ECONOMY_AUTOMOBILE", "FOI_ECONOMY_COMPETITION_LAW", "FOI_ECONOMY_CONSUMER_PROTECTION",
      "FOI_ECONOMY_ECOMMERCE", "FOI_ECONOMY_FINANCE", "FOI_ECONOMY_HANDCRAFT",
      "FOI_ECONOMY_INDUSTRIAL", "FOI_ECONOMY_INSURANCE", "FOI_ECONOMY_OTHER",
      "FOI_ECONOMY_SAM_BUSINESS", "FOI_ECONOMY_SERVICES",
    ],
    FOI_EDUCATION_PARENTING: [
      "FOI_EP_ACADEMIC", "FOI_EP_CHILDHOOD", "FOI_EP_OTHER", "FOI_EP_SCHOOL", "FOI_EP_WORK",
    ],
    FOI_ENERGY: [
      "FOI_ENERGY_FOSSILE", "FOI_ENERGY_NET", "FOI_ENERGY_NUCLEAR", "FOI_ENERGY_OTHER",
      "FOI_ENERGY_OVERALL", "FOI_ENERGY_RENEWABLE",
    ],
    FOI_ENVIRONMENT: [
      "FOI_ENVIRONMENT_ANIMAL", "FOI_ENVIRONMENT_CLIMATE", "FOI_ENVIRONMENT_OTHER",
      "FOI_ENVIRONMENT_POLLUTION", "FOI_ENVIRONMENT_SPECIES", "FOI_ENVIRONMENT_SUSTAINABILITY",
    ],
    FOI_EUROPEAN_UNION: [
      "FOI_EU_COOPERATION", "FOI_EU_DOMESTIC_MARKET", "FOI_EU_LAWS", "FOI_EU_OTHER",
      "FOI_EU_POLITICS", "FOI_EU_SAFETY_POLICY",
    ],
    FOI_FOREIGN_AFFAIRS: [
      "FOI_FA_BRD", "FOI_FA_CULTURE", "FOI_FA_HUMAN_RIGHTS", "FOI_FA_INTERNATIONAL",
      "FOI_FA_OTHER",
    ],
    FOI_FOREIGN_TRADE: [],
    FOI_GERMAN_UNITY: [
      "FOI_GU_LIVING_CONDITIONS", "FOI_GU_OTHER", "FOI_GU_SED_JUSTICE",
    ],
    FOI_HEALTH: [
      "FOI_HEALTH_CARE", "FOI_HEALTH_MEDICINE", "FOI_HEALTH_OTHER", "FOI_HEALTH_PROMOTION",
      "FOI_HEALTH_SUPPLY",
    ],
    FOI_INTERNAL_SECURITY: [
      "FOI_IS_ANTI_EXTREMISM", "FOI_IS_ANTI_TERRORISM", "FOI_IS_CRIME", "FOI_IS_CYBER",
      "FOI_IS_DISASTER_CONTROL", "FOI_IS_OTHER", "FOI_IS_VICTIM_PROTECTION",
    ],
    FOI_LAW: [
      "FOI_LAW_CIVIL_RIGHT", "FOI_LAW_CRIMINAL", "FOI_LAW_LEGAL", "FOI_LAW_OTHER",
      "FOI_LAW_PUBLIC",
    ],
    FOI_LEISURE_AND_SPORT: [
      "FOI_LAS_OTHER", "FOI_LAS_POPULAR_SPORT", "FOI_LAS_PROFESSIONAL_SPORT", "FOI_LAS_TOURISM",
    ],
    FOI_MEDIA: [
      "FOI_MEDIA_ADVERTISEMENT", "FOI_MEDIA_COMMUNICATION", "FOI_MEDIA_COPYRIGHT",
      "FOI_MEDIA_DIGITALIZATION", "FOI_MEDIA_FREEDOM_OF_SPEECH", "FOI_MEDIA_INTERNET_POLICY",
      "FOI_MEDIA_MASS", "FOI_MEDIA_OTHER", "FOI_MEDIA_PRIVACY",
    ],
    FOI_OTHER: [],
    FOI_POLITICAL_PARTIES: [],
    FOI_PUBLIC_FINANCE: [],
    FOI_REFUGEE_INTEGRATION_POLICY: [
      "FOI_RPI_INTEGRATION", "FOI_RPI_LAWS", "FOI_RPI_MIGRATION", "FOI_RPI_OTHER",
      "FOI_RPI_REFUGEE",
    ],
    FOI_REGINAL_PLANNING: [
      "FOI_RP_CITY", "FOI_RP_COUNTRYSIDE", "FOI_RP_DEVELOPMENT", "FOI_RP_OTHER", "FOI_RP_RESIDE",
    ],
    FOI_SCIENCE_RESEARCH_TECHNOLOGY: [],
    FOI_SOCIAL_POLICY: [
      "FOI_SP_CHILDREN", "FOI_SP_DISABILITY", "FOI_SP_DIVERSITY", "FOI_SP_ELDERLY",
      "FOI_SP_FAMILY", "FOI_SP_GENDER", "FOI_SP_OTHER", "FOI_SP_RELIGION",
    ],
    FOI_SOCIAL_SECURITY: [
      "FOI_SS_ACCIDENT", "FOI_SS_BASIC", "FOI_SS_HEALTH", "FOI_SS_LONGTERM", "FOI_SS_OLD_AGE",
      "FOI_SS_OTHER", "FOI_SS_UNEMPLOYMENT",
    ],
    FOI_STATE_ADMIN: [
      "FOI_SA_ORGANIZATION", "FOI_SA_OTHER", "FOI_SA_PUBLIC_ADMINISTRATION",
      "FOI_SA_PUBLIC_SERVICE",
    ],
    FOI_TRANSPORTATION: [
      "FOI_TRANSPORTATION_AEROSPACE", "FOI_TRANSPORTATION_AUTOMOBILE",
      "FOI_TRANSPORTATION_FREIGHT_TRANSPORT", "FOI_TRANSPORTATION_INDRASTRUCTURE",
      "FOI_TRANSPORTATION_OTHER", "FOI_TRANSPORTATION_POLICY",
      "FOI_TRANSPORTATION_PUBLIC_TRANSPORT", "FOI_TRANSPORTATION_RAIL",
      "FOI_TRANSPORTATION_SHIPPING",
    ],
    FOI_WORK: [
      "FOI_WORK_OTHER", "FOI_WORK_POLICY", "FOI_WORK_RIGHT",
    ],
  }),
  ftepresent: BOOLEAN,
  hasmemberships: BOOLEAN,
  legalform: [
    "LF_ADOER", "LF_AG", "LF_EG", "LF_EV", "LF_GBR", "LF_GMBH", "LF_KDOER", "LF_KG", "LF_KGAA",
    "LF_NIA", "LF_OHG", "LF_OTHER_INTERNATIONAL", "LF_OTHER_JP_INTERNATIONAL", "LF_OTHER_LA",
    "LF_OTHER_NATIONAL", "LF_PG", "LF_RSBR", "LF_SE", "LF_SOER", "LF_UG_LIMITED",
  ],
  legalformtype: [
    "JURISTIC_PERSON", "LEGAL_ASSOCIATION", "NATURAL_PERSON", "NETWORK_PLATFORM_OR_OTHER",
    "OTHER_ASSOCIATION_OF_PERSONS",
  ],
  mainfundingsource: [
    "MFS_ECONOMIC_ACTIVITY", "MFS_GIFTS_AND_DONATIONS", "MFS_MEMBERSHIP_FEES",
    "MFS_NO_FUNDING_SOURCES", "MFS_OTHERS", "MFS_PUBLIC_GRANTS",
  ],
  memberscombination: ["BOTH", "NONE", "ONLY_NATURAL", "ONLY_ORGANIZATIONS"],
  membershipfeesandcontributerspresent: [
    "MEMBERSHIP_FEES_NOT_RECEIVED", "MEMBERSHIP_FEES_RECEIVED",
    "MEMBERSHIP_FEES_WITH_INDIVIDUAL_CONTRIBUTERS",
  ],
  owncodeofconduct: BOOLEAN,
  regulatoryprojecttypes: [
    "BR_PRINTING_NUMBER", "BT_PRINTING_NUMBER", "DRAFT_BILL", "NONE", "PLAIN",
  ],
  revolvingdooractive: BOOLEAN,
  revolvingdoorareas: withSubCodes({
    FEDERAL_ADMINISTRATION: [],
    FEDERAL_GOVERNMENT: [
      "FEDERAL_CHANCELLOR", "MINISTER", "PARLIAMENTARY_STATE_SECRETARY",
    ],
    HOUSE_OF_REPRESENTATIVES: [
      "FUNCTION_FOR_MEMBER", "FUNCTION_FOR_PARLIAMENTARY_GROUP", "MEMBER",
    ],
  }),
  revolvingdoordata: BOOLEAN,
  revolvingdoorpersontypes: ["CONTRACTOR", "ENTRUSTED_PERSON", "LEGAL_REPRESENTATIVE", "LOBBYIST"],
  statements: BOOLEAN,
  typesofexercisinglobbywork: [
    "CONTRACTS_OPERATED_BY_THIRD_PARTY", "CONTRACTS_OPERATED_ON_BEHALF_OF_THIRD_PARTY_BY_SUBPARTY",
    "ON_BEHALF_OF_THIRD_PARTY", "SELF_OPERATED_OWN_INTEREST",
  ],
  workascontractor: BOOLEAN,
    }).map(([attribute, codes]) => [attribute, Object.freeze([...codes])]),
  ),
);

/** The known values of an attribute, or undefined for an attribute outside the catalogue. */
function knownValues(attribute: string): readonly string[] | undefined {
  return Object.hasOwn(SEARCH_FILTER_VALUES, attribute) ? SEARCH_FILTER_VALUES[attribute] : undefined;
}

/**
 * The register's spelling of a facet value: matched case-insensitively against
 * `SEARCH_FILTER_VALUES` (`TRUE` → `true`, `foi_energy` → `FOI_ENERGY`), and a bare
 * sub-code as the entries carry it in `fieldsOfInterest[].code` given its parent
 * (`FOI_EU_LAWS` → `FOI_EUROPEAN_UNION|FOI_EU_LAWS`, `FOI_ENERGY_NET` →
 * `FOI_ENERGY|FOI_ENERGY_NET`). A value the catalogue doesn't know is returned
 * unchanged.
 */
export function canonicalFilterValue(attribute: string, value: string): string {
  const known = knownValues(attribute);
  if (known === undefined) return value;
  const upper = value.toUpperCase();
  return (
    known.find((code) => code.toUpperCase() === upper) ??
    known.find((code) => code.toUpperCase().endsWith(`|${upper}`)) ??
    value
  );
}

/**
 * A value the register knows for `attribute` (after `canonicalFilterValue`), or the
 * reason it would match nothing, naming the values to use instead.
 */
export function knownFilterValueProblem(attribute: string): Problem<string> {
  return (value) => {
    const known = knownValues(attribute);
    if (known === undefined || known.includes(value)) return undefined;
    const parents = known.filter((code) => !code.includes("|"));
    const example = known.find((code) => code.includes("|"))?.split("|")[1];
    const list =
      example !== undefined
        ? `${parents.join(", ")}, or a sub-code such as ${example} (sent with its parent); ` +
          "SEARCH_FILTER_VALUES in the library lists them all"
        : known.join(", ");
    return `Unknown value ${JSON.stringify(cutForMessage(value))} for ${attribute}: the register matches nothing for it. Values: ${list}.`;
  };
}

/**
 * An attribute the register knows: one of `SEARCH_FILTER_ATTRIBUTES`. The register
 * ignores an unknown attribute and answers with the whole unfiltered set.
 */
export const knownFilterAttributeProblem: Problem<string> = (attribute) =>
  SEARCH_FILTER_ATTRIBUTES.includes(attribute)
    ? undefined
    : `Unknown filter ${JSON.stringify(cutForMessage(attribute))}. The register ignores unknown filters and would ` +
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
 * (the register's attributes are lower case), and the value in the register's
 * spelling (`canonicalFilterValue`: `TRUE` → `true`, `FOI_EU_LAWS` →
 * `FOI_EUROPEAN_UNION|FOI_EU_LAWS`). Idempotent. Parts that are not strings are left
 * for the checks in `filterQuery` / `parseFilter` to reject.
 */
export function normaliseFilter(filter: SearchFilter): SearchFilter {
  if (typeof filter !== "object" || filter === null) return filter;
  const { attribute, value } = filter;
  const name = typeof attribute === "string" ? attribute.trim().toLowerCase() : attribute;
  return {
    attribute: name,
    value: typeof value === "string" ? canonicalFilterValue(String(name), value.trim()) : value,
  };
}

/**
 * Check one normalised filter; throws `LobbyValidationError` for a malformed
 * attribute or value, and, unless `allowUnknown`, for an attribute outside
 * `SEARCH_FILTER_ATTRIBUTES` or a value outside `SEARCH_FILTER_VALUES`.
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
      `Invalid filter attribute: expected lower-case letters, got ${JSON.stringify(cutForMessage(filter.attribute))}.`,
    );
  }
  if (typeof filter.value !== "string" || !FILTER_VALUE_PATTERN.test(filter.value)) {
    throw new LobbyValidationError(
      `Invalid filter value for "${cutForMessage(filter.attribute)}": expected a code such as true, FOI_ENERGY or ` +
        `FOI_WORK|FOI_WORK_POLICY, got ${typeof filter.value === "string" ? JSON.stringify(cutForMessage(filter.value)) : JSON.stringify(filter.value)}.`,
    );
  }
  if (!allowUnknown) assertValid("filter value", filter.value, knownFilterValueProblem(filter.attribute));
}

/**
 * True when the catalogue knows the filter's attribute and value
 * (`SEARCH_FILTER_ATTRIBUTES`, `SEARCH_FILTER_VALUES`), compared in normalised form.
 * One it doesn't know can only have been sent with `allowUnknownFilters`; a reply
 * of 0 entries may then mean that the register doesn't know the value either.
 */
export function isKnownFilter(filter: SearchFilter): boolean {
  const f = normaliseFilter(filter);
  return SEARCH_FILTER_ATTRIBUTES.includes(f.attribute) && knownValues(f.attribute)?.includes(f.value) === true;
}

/**
 * Parse the text form `attribute=value` (split at the first `=`), normalise it
 * (normaliseFilter) and check it like `filterQuery` does. Throws
 * `LobbyValidationError` for a missing `=` or a blank part, a malformed value, and
 * (unless `allowUnknown`) an unknown attribute or value. The CLI's `--filter` parser
 * calls it with `allowUnknown` and leaves those two checks to the client, so that
 * `--allow-unknown-filters` can lift them wherever it stands on the command line.
 */
export function parseFilter(text: string, options: { allowUnknown?: boolean } = {}): SearchFilter {
  const eq = text.indexOf("=");
  const filter = normaliseFilter({
    attribute: eq === -1 ? "" : text.slice(0, eq),
    value: eq === -1 ? "" : text.slice(eq + 1),
  });
  if (filter.attribute === "" || filter.value === "") {
    throw new LobbyValidationError(
      `Invalid filter ${JSON.stringify(cutForMessage(text))}: expected attribute=value, e.g. revolvingdoordata=true.`,
    );
  }
  checkFilter(filter, options.allowUnknown === true);
  return filter;
}

/**
 * Normalise and check the filters (normaliseFilter: trimmed, attribute in lower
 * case) and turn them into query parameters
 * (`filter[revolvingdoordata][true]=true`). Throws `LobbyValidationError` for a
 * malformed attribute or value, for an attribute outside
 * `SEARCH_FILTER_ATTRIBUTES` (knownFilterAttributeProblem) — the register would
 * ignore it and return the whole unfiltered set — and for a value outside
 * `SEARCH_FILTER_VALUES` (knownFilterValueProblem) — the register would match
 * nothing. `allowUnknown` skips both catalogues, for an attribute or value the
 * register added after this release;
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
