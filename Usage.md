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

Quick way to gauge how strongly a sector is represented before pulling full records.

```bash
lobbyregister count Energie
```

Prints an envelope with the query and the API-reported total:

```json
{ "query": "Energie", "resultCount": 1234 }
```

`count` takes only an optional query plus the global options — no paging or
sorting flags.

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

Common `--sort` values: `RELEVANCE_DESC`, `REGISTRATION_DESC`,
`REGISTRATION_ASC`. The value is passed through verbatim and is not validated
client-side; an unrecognised value is silently ignored by the API.

### 5. Page through a large result set

Browse results in fixed-size chunks instead of dumping everything at once. Paging
is applied client-side (the live endpoint returns all matches; the CLI slices the
`results` array). `--page` is 1-based.

```bash
# First 10 entries
lobbyregister search Digitalisierung --page-size 10 --page 1

# Next 10 entries
lobbyregister search Digitalisierung --page-size 10 --page 2
```

`resultCount` still reflects the true total; only the visible slice is trimmed.

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

### 10. Search a term that begins with a dash

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
| `--user-agent <ua>` | `User-Agent` header value |
| `--max-retries <n>` | Retries for transient `429`/`503` responses (default `2`) |
| `--max-redirects <n>` | HTTP redirects to follow (`0` = none; default `5`) |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default ~100 MiB) |
| `--compact` | Print JSON on a single line instead of pretty-printed |
| `-h, --help` | Show help for the program or a command |

Exit codes: `0` success, `2` usage error, `4` on a `404` from the API, `1` for
any other error (network, parse, or other non-404 HTTP status).
