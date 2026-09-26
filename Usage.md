# Usage

Practical, use-case-driven examples for the `lobbyregister` CLI — a command-line
client for the open German [Lobbyregister](https://www.lobbyregister.bundestag.de/)
search API (`/sucheJson`), the federal register of interest representatives
(lobbyists) before the Bundestag and the federal government.

The CLI is read-only and needs no API key. It exposes two commands — `search`
and `count` — and prints JSON to stdout, so it composes cleanly with `jq`.

## Install

```bash
npm i -g @maschinenlesbar.org/lobbyregister-cli
```

This installs a single bin named **`lobbyregister`**. Confirm it works:

```bash
lobbyregister --version
lobbyregister --help
```

Without a global install you can also run it from a checkout with
`node dist/src/cli/index.js …` (after `npm run build`).

## Use cases

### 1. Count how many entries mention a topic

Gauge how strongly a sector is represented, as a single number.

```bash
lobbyregister count Energie
```

Prints an envelope with the query and the API-reported total:

```json
{ "query": "Energie", "resultCount": 1234 }
```

`count` takes an optional query, `--filter` and the global options — no paging or
sorting flags. It is not a cheaper request: the API has no count-only mode, so
`count` downloads the same records as `search` (the whole register, about 18 MB,
without a query or filter) and prints only `resultCount`. A loop over several topics
(§7) downloads each topic's full set.

### 2. Search lobbyists by keyword

Retrieve the full result set for a search term as the API returns it.

```bash
lobbyregister search Wasserstoff
```

Prints the full envelope: `resultCount` plus the `results` array of register
entries (each a raw, schema-versioned `RegisterEntry` JSON object).

### 3. Get only the entries, not the envelope

When you want to pipe the records straight into another tool and don't care about
the surrounding `resultCount` wrapper.

```bash
lobbyregister search Wasserstoff --results-only
```

`--results-only` prints just the `results` array instead of the full envelope.

### 4. Sort results by newest registration first

See which interest representatives most recently registered for a topic.

```bash
lobbyregister search Pharma --sort REGISTRATION_DESC
```

`--sort` values (the orders of the register's website search):
`RELEVANCE_DESC` (the default with a query), `REGISTRATION_DESC` (first published),
`UPDATE_DESC` (last updated), `INACTIVITY_DESC` (went inactive), `NAME_ASC`,
`FINANCIALEXPENSES_DESC` (declared spend), `DONATIONAMOUNT_DESC`, `MEMBERSHIPFEES_DESC`,
`NUMBEROFREGULATORYPROJECTS_DESC`, `NUMBEROFSTATEMENTS_DESC`, `NUMBEROFFTE_DESC`,
`NUMBEROFENTRUSTEDPERSONS_DESC`, `NUMBEROFCONTRACTS_DESC`, `NUMBEROFMEMBERS_DESC`,
`NUMBEROFMEMBERSHIPS_DESC` — each also in the other direction (`_ASC` / `_DESC`).
The value is passed through verbatim and is case-sensitive. The API ignores an
unrecognised value (HTTP `200`, default ordering), so a bad sort never raises a
`400`; the CLI compares the order the API reports (`searchParameters.sortOrder`)
with the one you asked for and prints a `Warning:` on stderr when they differ
(exit `0`).

```bash
# Biggest declared lobbying budgets first
lobbyregister search Energie --sort FINANCIALEXPENSES_DESC --page-size 10 --results-only
```

### 5. Page through a large result set

Browse results in fixed-size chunks instead of dumping everything at once. The
parameters are sent to the API, but the live endpoint ignores them and returns
all matches, so paging is applied client-side (the CLI slices the `results`
array). `--page` is 1-based and requires `--page-size`; both must be 1 or more
(`0` is a usage error, exit `2`).

```bash
# First 10 entries
lobbyregister search Digitalisierung --sort REGISTRATION_DESC --page-size 10 --page 1

# Next 10 entries
lobbyregister search Digitalisierung --sort REGISTRATION_DESC --page-size 10 --page 2
```

`resultCount` still reflects the true total; only the visible slice is trimmed.

Each run downloads the set again, and the register's relevance order
(`RELEVANCE_DESC`, the default with a query) is **not stable between requests**:
two identical searches return the entries in a different order, so page 1 and
page 2 from separate runs can overlap or skip entries. Page with a date sort
(`REGISTRATION_DESC`, stable in our checks), or fetch the whole set once and
slice it yourself. When it pages a relevance-ordered set, the CLI prints a
`Note:` on stderr (exit `0`).

### 6. Extract just the names of matching organisations with jq

Turn raw register entries into a flat list for a report or spreadsheet.

```bash
lobbyregister search Klimaschutz --results-only \
  | jq -r '.[].lobbyistIdentity.name // empty'
```

`--results-only` gives `jq` a plain array to iterate. (Adjust the field path to
the entry shape in your results; `jq '.[0] | keys'` reveals the available keys.)

### 7. Compare topic coverage with a one-liner

Pull just the count for several topics to compare their footprint in the register.

```bash
for topic in Energie Verkehr Gesundheit Landwirtschaft; do
  printf '%s\t' "$topic"
  lobbyregister count "$topic" | jq '.resultCount'
done
```

### 8. List the newest registrations in a topic as a compact table

Combine sorting, paging and `jq` to skim recent entrants.

```bash
lobbyregister search Rüstung --sort REGISTRATION_DESC --page-size 5 --results-only \
  | jq -r '.[] | [.registerNumber, .lobbyistIdentity.name] | @tsv'
```

### 9. Stream single-line JSON into a logging or ETL pipeline

`--compact` prints JSON on one line, which is friendlier for line-oriented tools.

```bash
lobbyregister search Chemie --results-only --compact \
  | jq -c '.[] | {nr: .registerNumber}'
```

### 10. Narrow a search with the register's own filters

`--filter <attribute=value>` passes the facet filters of the register's
[website search](https://www.lobbyregister.bundestag.de/suche) to the API, on `search`
and `count`. It can be repeated: values of one attribute are alternatives (OR),
different attributes must all match (AND).

```bash
# Entries with revolving-door data: a lobbyist, legal representative, entrusted
# person or contractor who recently held public office
lobbyregister count --filter revolvingdoordata=true

# ... among the energy entries, only where it concerns an entrusted person
lobbyregister search Energie --filter revolvingdoordata=true \
  --filter revolvingdoorpersontypes=ENTRUSTED_PERSON --results-only

# Inactive entries with the field of interest "Energie"
lobbyregister search --filter activelobbyist=false --filter fieldsofinterest=FOI_ENERGY
```

`lobbyregister search --help` lists the attributes. An unknown attribute is a usage
error (exit `2`) because the API would silently ignore it and return the whole set; an
unknown **value** matches nothing (`resultCount: 0`). The value codes are the ones that
appear in the website's search URL when you tick a box there (`FOI_ENERGY`, a sub-field
as `FOI_WORK|FOI_WORK_POLICY`, `true`/`false` for yes/no facets). If a reply does not
confirm a filter in `searchParameters.facets`, the CLI exits `1` rather than print an
unfiltered set. The website's number ranges (spend, staff, members from/to) are not
supported.

### 11. Search a term that begins with a dash

A leading `-` would otherwise be parsed as an option. End the options with `--`.

```bash
lobbyregister search -- -Energie
```

This searches for the literal term `-Energie`.

## Global options

These apply to every command and may be given **before or after** the command
name (e.g. both `lobbyregister --compact count Energie` and
`lobbyregister count Energie --compact` work):

| Option | Description |
| --- | --- |
| `-V, --version` | Print the version and exit |
| `--base-url <url>` | API base URL (default `https://www.lobbyregister.bundestag.de`) |
| `--timeout <ms>` | Per-request timeout in milliseconds (default `30000`) |
| `--user-agent <ua>` | `User-Agent` header value (default `lobbyregister-cli`) |
| `--max-retries <n>` | Retries for transient `429`/`503` responses (default `2`) |
| `--max-redirects <n>` | HTTP redirects to follow (`0` = none; default `5`) |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default ~100 MiB) |
| `--compact` | Print JSON on a single line instead of pretty-printed |
| `-h, --help` | Show help for the program or a command |

Exit codes: `0` success, `2` usage error, `4` on a `404` from the API, `1` for
any other error (network, parse, or other non-404 HTTP status).
