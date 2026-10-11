// Public entry point for the API client library.

export { LobbyregisterClient, resultCountMismatch, searchQuery } from "./client.js";
export {
  RequestEngine,
  DEFAULT_BASE_URL,
  assertHeaderValue,
  baseUrlProblem,
  cleartextProblem,
  intOption,
  isTransientNetworkError,
  validateBaseUrl,
} from "./engine.js";
export type { EngineOptions, RawResponse, RetryEvent } from "./engine.js";
export { MAX_TIMEOUT_MS, nodeHttpTransport } from "./http.js";
export type { Transport, HttpRequest, HttpResponse } from "./http.js";
export { buildQueryString } from "./query.js";
export type { QueryParams, QueryValue } from "./query.js";
export {
  SEARCH_FILTER_ATTRIBUTES,
  SEARCH_FILTER_VALUES,
  FILTER_VALUE_PATTERN,
  canonicalFilterValue,
  filterQuery,
  isKnownFilter,
  knownFilterAttributeProblem,
  knownFilterValueProblem,
  ignoredSort,
  sortOrderForMessage,
  normaliseFilter,
  parseFilter,
} from "./filters.js";
export type { SearchFilter, SortIgnored } from "./filters.js";
export {
  assertValid,
  headerNameProblem,
  headerValueProblem,
  intInRangeProblem,
  isBlank,
  nonEmptyProblem,
} from "./validate.js";
export type { Problem } from "./validate.js";
export {
  LobbyError,
  LobbyApiError,
  LobbyNetworkError,
  LobbyParseError,
  LobbyValidationError,
  credentialsIn,
  redactCredentials,
  redactUrl,
} from "./errors.js";

export * from "./types.js";
