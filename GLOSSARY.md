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

**`q` (query).** The free-text query string. Optional — an absent or empty `q`
returns the whole register. On the CLI it is the positional `[query]` argument to
`search` and `count`. A query beginning with a dash must be passed after a `--`
separator (e.g. `search -- -Energie`).

**`sort`.** The result sort order, passed through verbatim and **not** validated
client-side. Observed values: `RELEVANCE_DESC` (default relevance ranking),
`REGISTRATION_DESC` (newest registrations first) and `REGISTRATION_ASC` (oldest
first). The live endpoint silently ignores an unrecognised value (HTTP `200`)
rather than rejecting it. CLI: `search --sort <order>`.

**`page` / `pageSize`.** A 1-based page number and a page size. These exist in
`SearchParams`, but a live probe (2026-06) showed `/sucheJson` **ignores** them:
it always returns the full `results` array regardless. The CLI therefore applies
`--page` / `--page-size` **client-side**, slicing the returned array; the
reported `resultCount` is always the true total. CLI: `search --page <n>
--page-size <n>`.

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
echoed back as a JSON object.

**`jsonDocumentationUrl`.** A URL to the documentation of the JSON response
format.

---

## CLI commands

**`search [query]`.** Run a search and print the full **SearchResult** envelope.
`--results-only` prints just the `results` array; `--compact` prints single-line
JSON. Supports `--page`, `--page-size`, `--sort` (see above).

**`count [query]`.** Print only the match count: `{ query, resultCount }`. A thin
wrapper over `search` with `pageSize: 1` that reads back `resultCount`. Takes only
the optional query plus the global options.

---

## Exit codes

**Exit codes.** The CLI maps outcomes to process exit codes: `0` success;
`2` usage / argument-validation errors (unknown/missing command, unknown option,
invalid option value, or no command given); `4` on `404` from the API; `1` for
any other error (network, parse, or other non-404 HTTP status). A `400` exits `1`
and prints the API's error detail plus a hint to check `--sort`. `--help` /
`--version` return `0`.

---

> **Library & internals.** Terms for the TypeScript client and its internals —
> `LobbyregisterClient`, the request engine, transport, retry/backoff, error
> types, query builder, redirect behaviour — now live in **[DEVELOPING.md](DEVELOPING.md)**.
