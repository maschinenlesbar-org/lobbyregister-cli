# Glossary

A reference for the domain concepts and project-specific terms used throughout
`lobbyregister-cli`. The Lobbyregister domain is German; this glossary gives the
term used in the CLI/API alongside the original German where one exists.

> **Scope.** This tool wraps a single open endpoint — the JSON search of the
> German Lobbyregister (`/sucheJson`). The terms below are the ones actually
> surfaced by the client's types, the search parameters and the two CLI
> commands. The register entries themselves are large, schema-versioned JSON
> documents that the client passes through untyped (see **RegisterEntry**), so
> their internal field names are deliberately *not* enumerated here.

---

## The Lobbyregister

**Lobbyregister.** The public German federal **register of interest
representatives** ("Lobbyisten") who lobby the Bundestag (the federal
parliament) and the federal government. Operated by the German Bundestag and
published at [`lobbyregister.bundestag.de`](https://www.lobbyregister.bundestag.de/).

**Interest representative (Interessenvertreter).** A person or organisation
registered in the Lobbyregister. Each is described by one **register entry**.

**Lobbyregistergesetz (LobbyRG).** The German Lobby Register Act, the legal basis
that mandates the register and its public disclosure. (Background only — not a
field the client reads.)

---

## Resource & endpoint

**`/sucheJson`.** The single open (no-auth) endpoint this client calls: a JSON
search over the register, served from the base URL
`https://www.lobbyregister.bundestag.de`. `getJson` issues a `GET` against it.
The human-facing equivalent is the website's search page; the response echoes
that page's URL in `searchUrl`.

**Open data / read-only.** The `/sucheJson` endpoint requires no API key,
no token and no login. This client implements **only** this read-only `GET`; it
never writes.

---

## Search request

**`q` (query).** The free-text query string. Optional — omit `q` to match the
whole register; a blank `q` (`""` or whitespace) is rejected, by the CLI and the
library alike, before any request. On the CLI it is the positional `[query]` argument to
`search` and `count`. A query beginning with a dash must be passed after a `--`
separator (e.g. `search -- -Energie`). The server also matches text that the response
doesn't contain (such as the activity description on an entry's register page), so an
entry can match without the term appearing anywhere in its JSON.

**`sort`.** The result sort order, passed through verbatim (case-sensitive); a
blank value is rejected before any request. The
values are those of the register's website search: `RELEVANCE_DESC` (the default with a query), `REGISTRATION_DESC` (first published),
`UPDATE_DESC` (last updated), `INACTIVITY_DESC` (went inactive), `NAME_ASC`,
`FINANCIALEXPENSES_DESC` (declared spend), `DONATIONAMOUNT_DESC`, `MEMBERSHIPFEES_DESC`,
`NUMBEROFREGULATORYPROJECTS_DESC`, `NUMBEROFSTATEMENTS_DESC`, `NUMBEROFFTE_DESC`,
`NUMBEROFENTRUSTEDPERSONS_DESC`, `NUMBEROFCONTRACTS_DESC`, `NUMBEROFMEMBERS_DESC`,
`NUMBEROFMEMBERSHIPS_DESC` — each also in the other direction (`_ASC` / `_DESC`). The live endpoint ignores an unrecognised value (HTTP `200`) and falls back
to its default order rather than rejecting it. The library then adds
`sortIgnored: { requested, applied }` to the result, from the order echoed in
`searchParameters.sortOrder`, and the CLI warns on stderr. CLI: `search --sort <order>`.

**Filters (`filter[<attribute>][<value>]`).** The facet filters of the register's
website search, which `/sucheJson` accepts as `filter[<attribute>][<value>]=true`
and echoes back in `searchParameters.facets`. Examples: `revolvingdoordata=true`
(an entry records a recent public office for its lobbyist, a legal representative,
an entrusted person or a contractor — far more entries than carry the
`recentGovernmentFunctionPresent` flag, which covers only the lobbyist),
`revolvingdoorpersontypes`, `revolvingdoorareas`, `activelobbyist`,
`fieldsofinterest` (`FOI_ENERGY`, sub-fields as `FOI_WORK|FOI_WORK_POLICY`),
`activity`, `legalform`, `donationsreceived` (`DONATIONS_RECEIVED`,
`DONATIONS_NOT_RECEIVED`, `DONATIONS_INFORMATION_MISSING_FISCAL_YEAR` — not `true`),
`ftepresent` (`true` = an FTE figure was declared, including the entries that declared
0 FTE; not "has staff"). Values of one attribute are alternatives, different
attributes must all match. The API ignores an unknown attribute (and would return
everything) and matches nothing for an unknown value, so the CLI and the library accept
only the known attributes and value codes (`--allow-unknown-filters`, or
`allowUnknownFilters` in the library, opts out). Both parts are trimmed, the attribute
is compared case-insensitively (sent in lower case), the value is matched
case-insensitively and sent in the register's spelling, and a sub-field code as the
entries carry it (`FOI_EU_LAWS`) is sent with its parent (`FOI_EUROPEAN_UNION|FOI_EU_LAWS`):
the register matches a sub-field only in that form, and the parent can't be read off
the code. CLI: `search`/`count --filter <attribute=value>` (repeatable); library:
`SearchParams.filters`, `SEARCH_FILTER_ATTRIBUTES`, `SEARCH_FILTER_VALUES`.

**`page` / `pageSize`.** A 1-based page number and a page size (both integers
>= 1; `page` needs `pageSize`). A live probe (2026-06) showed `/sucheJson`
**ignores** them: it always returns the full `results` array regardless. So they
are not sent; the client (`SearchParams`, and through it the CLI's `--page` /
`--page-size`) downloads the whole set and slices `results` **client-side**; the
reported `resultCount` is always the true total. Because every run fetches the
set again and the relevance order (`RELEVANCE_DESC`) differs between identical
requests, pages from separate runs are only consistent under a date sort such as
`REGISTRATION_DESC`. CLI: `search --page <n> --page-size <n>`.

---

## Search response

**SearchResult (the envelope).** The typed top-level shape returned by
`/sucheJson`: `resultCount` plus the `results` array, with optional metadata
fields (`$schema`, `source`, `sourceUrl`, `sourceDate`, `jsonDocumentationUrl`,
`searchUrl`, `searchParameters`).

**`resultCount`.** The total number of register entries matching the query — the
*true* total, independent of how many entries are actually returned or sliced.
This is the single number reported by the `count` command.

**`results`.** The array of matching register entries (each a **RegisterEntry**).

**Duplicate versions.** The API can return more than one version of the same register
entry: on 2026-09-26 `R000534` came back twice (`registerEntryDetails.registerEntryId`
84196, valid from 2026-08-20, and 85248, valid from 2026-09-10), and `resultCount`
counted both. The CLI passes the data through unchanged; to count or rank entries,
keep one per `registerNumber` (the newest `registerEntryDetails.validFromDate`), e.g.
`jq 'group_by(.registerNumber) | map(max_by(.registerEntryDetails.validFromDate))'`.

**RegisterEntry.** One register entry — a registered interest representative.
Typed as a raw `JsonObject` (a faithful, untyped JSON document) because entries
are large and schema-versioned; the client does not guess their internal shape.

**`$schema`.** A URL naming the JSON Schema that each `results` entry conforms to
(the register's published, versioned document schema).

**`source` / `sourceUrl` / `sourceDate`.** Provenance metadata for the data set:
its name, a canonical URL, and the date it was produced.

**`searchUrl`.** The human-facing search-page URL that corresponds to the same
query, suitable for opening in a browser.

**`searchParameters`.** The parameters the server interpreted for this search,
echoed back as a JSON object: `queryString`, `sortOrder`, `facets` (the filters it
applied, as `{attribute, value}`) and `numberRanges`.

**`jsonDocumentationUrl`.** A URL to the documentation of the JSON response
format.

---

## CLI commands

**`search [query]`.** Run a search and print the full **SearchResult** envelope.
`--results-only` prints just the `results` array; `--compact` prints single-line
JSON. Supports `--page`, `--page-size`, `--sort` and `--filter` (see above).

**`count [query]`.** Print only the match count: `{ query, resultCount }` (with
`filters` listed when `--filter` was given). A thin wrapper over `search` that reads
back `resultCount`; the API has no count-only mode, so it downloads every matching
record, just like `search`. Takes the optional query, `--filter` and
the global options.

**Log record.** Every diagnostic line the CLI writes to stderr: a timestamp, a level
(`ERROR`, `WARN`, `INFO`) and a topic `lobbyregister.<area>`, as text (log4j style) or with
`--log-format jsonl` as one JSON object per line. The areas: `cli` (usage errors,
commander's messages, unexpected errors), `api` (the API's answers and the notes on them:
an error status, a malformed answer — bad JSON, the wrong shape or content type —, a filter
the reply did not echo, the ignored `--sort`, relevance-order paging), `http` (the
connection, the cleartext warning, and one WARN per retry before it waits) and `output` (a failed write to stdout). A record is
always one line; control characters in it are escaped.

---

## Exit codes

**Exit codes.** The CLI maps outcomes to process exit codes: `0` success;
`2` usage / argument-validation errors (unknown/missing command, unknown option,
invalid option value, or no command given); `4` on `404` from the API; `1` for
any other error (network, parse, or other non-404 HTTP status). A `400` exits `1`
and prints the API's error detail; only when the API sends no detail does the CLI add
a hint to check `--sort`. `--help` / `--version` return `0`.

---

> **Library & internals.** Terms for the TypeScript client and its internals —
> `LobbyregisterClient`, the request engine, transport, retry/backoff, error
> types, query builder, redirect behaviour — now live in **[DEVELOPING.md](DEVELOPING.md)**.
