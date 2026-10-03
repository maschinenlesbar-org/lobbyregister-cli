// Public entry point for the API client library.

export { LobbyregisterClient } from "./client.js";
export { RequestEngine, DEFAULT_BASE_URL } from "./engine.js";
export type { EngineOptions, RawResponse } from "./engine.js";
export { MAX_TIMEOUT_MS, nodeHttpTransport } from "./http.js";
export type { Transport, HttpRequest, HttpResponse } from "./http.js";
export { buildQueryString } from "./query.js";
export type { QueryParams, QueryValue } from "./query.js";
export { SEARCH_FILTER_ATTRIBUTES, FILTER_VALUE_PATTERN, filterQuery } from "./filters.js";
export type { SearchFilter } from "./filters.js";
export { assertValid } from "./validate.js";
export type { Problem } from "./validate.js";
export {
  LobbyError,
  LobbyApiError,
  LobbyNetworkError,
  LobbyParseError,
  LobbyValidationError,
} from "./errors.js";

export * from "./types.js";
