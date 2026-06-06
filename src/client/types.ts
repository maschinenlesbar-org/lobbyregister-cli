// Domain types for the Lobbyregister search API (lobbyregister.bundestag.de).
//
// The register entries are large, schema-versioned documents, so individual
// `results` are exposed as faithful raw `JsonObject`s while the search envelope
// is typed at the top level.

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
  /** Free-text query string. */
  q?: string;
  /** 1-based page number. */
  page?: number;
  pageSize?: number;
  /** Sort order, e.g. "RELEVANCE_DESC", "REGISTRATION_DESC". */
  sort?: string;
}
