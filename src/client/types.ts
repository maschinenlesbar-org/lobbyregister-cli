// Domain types for the Lobbyregister search API (lobbyregister.bundestag.de).
//
// The register entries are large, schema-versioned documents, so individual
// `results` are exposed as faithful raw `JsonObject`s while the search envelope
// is typed at the top level.

import type { SearchFilter } from "./filters.js";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** One register entry (a registered interest representative). */
export type RegisterEntry = JsonObject;

/** Response of `/sucheJson`. */
export interface SearchResult {
  /** JSON-Schema URL the results conform to. */
  $schema?: string;
  source?: string;
  sourceUrl?: string;
  sourceDate?: string;
  jsonDocumentationUrl?: string;
  /** The human-facing search URL for the same query. */
  searchUrl?: string;
  searchParameters?: JsonObject;
  resultCount: number;
  results: RegisterEntry[];
}

/** Parameters for `/sucheJson`. */
export interface SearchParams {
  /**
   * Free-text query string. Omit it to match the whole register; a blank value
   * (`""` or whitespace) rejects with `LobbyValidationError`.
   */
  q?: string;
  /**
   * 1-based page number (default 1). Needs `pageSize`. Applied by the client, not
   * sent: the API ignores paging and returns every match.
   */
  page?: number;
  /** Results per page, sliced client-side out of the full result set. */
  pageSize?: number;
  /** Sort order, e.g. "RELEVANCE_DESC", "REGISTRATION_DESC". Must not be blank. */
  sort?: string;
  /**
   * Facet filters, sent as `filter[<attribute>][<value>]=true` — e.g.
   * `[{ attribute: "revolvingdoordata", value: "true" }]`. Values of one attribute
   * are alternatives; different attributes must all match. Each attribute must be
   * one of `SEARCH_FILTER_ATTRIBUTES`, else `LobbyValidationError` before any
   * request.
   */
  filters?: readonly SearchFilter[];
  /**
   * Accept a filter attribute outside `SEARCH_FILTER_ATTRIBUTES`, e.g. one the
   * register added after this release. Off by default. The reply must still echo
   * the filter in `searchParameters.facets`.
   */
  allowUnknownFilters?: boolean;
}
