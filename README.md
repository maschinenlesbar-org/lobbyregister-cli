# lobbyregister-cli

[![CI](https://github.com/maschinenlesbar-org/lobbyregister-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/maschinenlesbar-org/lobbyregister-cli/actions/workflows/ci.yml)
[![Release](https://github.com/maschinenlesbar-org/lobbyregister-cli/actions/workflows/release.yml/badge.svg)](https://github.com/maschinenlesbar-org/lobbyregister-cli/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@maschinenlesbar.org/lobbyregister-cli)](https://www.npmjs.com/package/@maschinenlesbar.org/lobbyregister-cli)

**Website:** [English](https://maschinenlesbar-org.github.io/lobbyregister-cli/) · [Deutsch](https://maschinenlesbar-org.github.io/lobbyregister-cli/de/) — command reference, guides and API docs

Search Germany's federal **register of interest representatives** (lobbyists)
from your terminal. `lobbyregister` is a command-line tool for the open
[Lobbyregister](https://www.lobbyregister.bundestag.de/) search API — find
registered lobbyists and organisations by keyword, count their presence, and
pipe the results straight into [`jq`](https://jqlang.github.io/jq/).

- **Works out of the box** — no account, no API key, no configuration. Install and search.
- **Clean JSON output** — pretty-printed by default, `--compact` for one-line/scripting.
- **Just two commands** — `search` and `count`.
- **Read-only, open data** — the public `/sucheJson` endpoint needs no credentials; nothing to configure or leak.

> Want to use this as a TypeScript library or understand how it's built?
> See **[DEVELOPING.md](DEVELOPING.md)**.

## Install

```bash
npm i -g @maschinenlesbar.org/lobbyregister-cli
```

This installs the **`lobbyregister`** command. Requires **Node.js 22.12+**.

Check it works:

```bash
lobbyregister --help
```

## Quickstart

No setup needed — the endpoint is fully open. Your first search:

```bash
lobbyregister search Energie
```

The result is a JSON envelope: the matching entries live under `results`, the
total count under `resultCount`. Pull out just the entries with `jq`:

```bash
lobbyregister search Energie | jq '.results'
```

Print just the number of entries that mention a topic:

```bash
lobbyregister count Energie
```

`count` prints one number, but the API has no count-only mode: it still downloads
every matching record (the whole register, about 18 MB, when you give no query or
filter), so it is no faster than `search`.

## Commands

```text
search  [query]   search the register — prints the full envelope
count   [query]   count entries matching a query
```

### `search` options

| Flag | Meaning |
| --- | --- |
| `[query]` | free-text search term (optional — omit to match everything) |
| `--sort <order>` | sort order, e.g. `RELEVANCE_DESC`, `REGISTRATION_DESC`, `FINANCIALEXPENSES_DESC` (all values below) |
| `--filter <attribute=value>` | register facet filter, repeatable (see below) |
| `--allow-unknown-filters` | send a `--filter` attribute or value this release doesn't know |
| `--page <n>` | 1-based page number, 1 or more (client-side paging) |
| `--page-size <n>` | results per page, 1 or more (client-side paging) |
| `--results-only` | print just the `results` array, not the envelope |

`count` takes the optional query, `--filter`, `--allow-unknown-filters` and the global options — no `--page`,
`--sort`, or `--results-only`.

`--filter` passes the facet filters of the register's
[website search](https://www.lobbyregister.bundestag.de/suche) to the API, e.g.
`revolvingdoordata=true` (entries with revolving-door data for any of their people),
`activelobbyist=false`, `fieldsofinterest=FOI_ENERGY` or
`revolvingdoorpersontypes=ENTRUSTED_PERSON`. Values of one attribute are alternatives;
different attributes must all match. `lobbyregister search --help` lists the attributes.
The values are the register's codes: `true`/`false` for yes/no facets, otherwise codes
such as `DONATIONS_RECEIVED` or `ACT_TRADE_ASSOC`, matched case-insensitively. A
field-of-interest code as the entries carry it (`FOI_EU_LAWS`) is sent with its parent
(`FOI_EUROPEAN_UNION|FOI_EU_LAWS`), the only form the register matches. The API ignores
an unknown attribute (and would return everything) and matches nothing for an unknown
value (`resultCount: 0`), so both are a usage error (exit `2`) whose message names the
valid codes — `donationsreceived=true` names `DONATIONS_RECEIVED`.
`--allow-unknown-filters` sends them anyway, for a code the register added after this
release; a reply of 0 then gets a `Note:` on stderr.

The **[Glossary](GLOSSARY.md)** explains every field and term in the response.

## Common tasks

A few recipes to get going — see **[Usage.md](Usage.md)** for the full,
use-case-driven set.

```bash
# How many lobbyists are active in the energy sector?
lobbyregister count Energie

# Full results for a topic, newest registrations first
lobbyregister search Pharma --sort REGISTRATION_DESC

# Entries with revolving-door data (former office-holders among their people)
lobbyregister count --filter revolvingdoordata=true
lobbyregister search Energie --filter revolvingdoordata=true --results-only

# Just the entries — no envelope — for piping into jq
lobbyregister search Wasserstoff --results-only

# Page through a large result set (1-based pages, client-side slicing);
# sort by date: the relevance order changes between requests
lobbyregister search Digitalisierung --sort REGISTRATION_DESC --page-size 10 --page 1
lobbyregister search Digitalisierung --sort REGISTRATION_DESC --page-size 10 --page 2

# Compare topic coverage across several terms
for topic in Energie Verkehr Gesundheit; do
  printf '%s\t' "$topic"
  lobbyregister count "$topic" | jq '.resultCount'
done
```

## Output & scripting

Every command prints **pretty JSON to stdout**. Errors and diagnostics go to
stderr, so piping stdout into `jq` stays clean.

```bash
# Extract organisation names from a result set
lobbyregister search Klimaschutz --results-only \
  | jq -r '.[].lobbyistIdentity.name // empty'

# Skim the newest registrations as a TSV table
lobbyregister search Rüstung --sort REGISTRATION_DESC --page-size 5 --results-only \
  | jq -r '.[] | [.registerNumber, .lobbyistIdentity.name] | @tsv'
```

Use `--compact` for single-line JSON in pipelines and logs:

```bash
lobbyregister search Chemie --results-only --compact \
  | jq -c '.[] | {nr: .registerNumber}'
```

`--compact` (and every global option) works **before or after** the command —
both `lobbyregister --compact search Energie` and `lobbyregister search Energie --compact`
do the same thing.

> **Note on `--sort`** — the register's website offers these orders:
> `RELEVANCE_DESC` (the default with a query), `REGISTRATION_DESC` (first published),
> `UPDATE_DESC` (last updated), `INACTIVITY_DESC` (went inactive), `NAME_ASC`,
> `FINANCIALEXPENSES_DESC` (declared spend), `DONATIONAMOUNT_DESC`, `MEMBERSHIPFEES_DESC`,
> `NUMBEROFREGULATORYPROJECTS_DESC`, `NUMBEROFSTATEMENTS_DESC`, `NUMBEROFFTE_DESC`,
> `NUMBEROFENTRUSTEDPERSONS_DESC`, `NUMBEROFCONTRACTS_DESC`, `NUMBEROFMEMBERS_DESC`,
> `NUMBEROFMEMBERSHIPS_DESC` — each also in the other direction (`_ASC` / `_DESC`).
> The value is passed through verbatim and is case-sensitive. The live API
> ignores an unrecognised value (HTTP `200`) and falls back to its default order;
> the CLI then prints a `Warning:` on stderr naming the order the API used
> (`searchParameters.sortOrder`), and still exits `0`.

> **Note on `--page` / `--page-size`** — the live endpoint ignores paging and
> returns all matches, so these are not sent: the client downloads the full set
> and slices the `results` array itself. `resultCount` always reflects the true total.
> Every run fetches the set again, and the register's **relevance order**
> (`RELEVANCE_DESC`, the default with a query) differs between two identical
> requests, so pages from separate runs can repeat or miss entries. Page with a
> date sort such as `--sort REGISTRATION_DESC` (stable in our checks), or fetch
> once and slice the file. The CLI prints a `Note:` on stderr when it pages a
> relevance-ordered set.

**Exit codes** make the CLI easy to use in scripts:

| Code | Meaning |
| --- | --- |
| `0` | success (also `--help` / `--version`) |
| `2` | bad usage / invalid argument (nothing was sent) |
| `4` | entry not found (`404`) |
| `1` | any other error (network, parse, or non-404 HTTP status) |

A reader that stops early (`lobbyregister search | head -c 100`) ends the run quietly
with exit `0`. A failed run keeps its exit code even when the reader of its stderr has
gone away (`2>&1 | head -1`).

## Troubleshooting

- **`command not found: lobbyregister`** — the global npm bin directory isn't on
  your `PATH`. Run `npm prefix -g` to find it (the commands are in its `bin`
  subdirectory) and add that to your `PATH`, or run via
  `npx @maschinenlesbar.org/lobbyregister-cli …`.
- **Exit `1` / "the register rejected the request"** — the register answers a
  query it cannot parse with a redirect to its error page (`/fehler`) instead of
  data: an unbalanced quote or parenthesis (`"Tabak`, `Tabak (`) or a very long
  query. Fix the query; the CLI doesn't fetch the error page.
- **Exit `4` / "not found"** — a `404` from the API; this is uncommon on the
  search endpoint. Check that `--base-url` points at the right host.
- **Exit `1` / network error** — connectivity, DNS, or a timeout; the message names
  the request that failed (`GET https://… failed: socket hang up`). Try again, or
  raise the limit with `--timeout 60000`. A body larger than `--max-response-bytes`
  fails the same way and says so.
- **Exit `1` with a `400`** — the API rejected the request. The CLI prints the
  API's error detail when it returns one; otherwise it prints a hint to check
  `--sort` and other option values. Verify the parameter values are recognised
  strings.
- **Empty `results`** — the search matched nothing; broaden the keyword or drop
  filters.
- **`Exceeded the maximum of N redirects`** — the host returned a redirect chain
  longer than `--max-redirects` (default `5`). The client follows redirects,
  including across hosts (credential headers are stripped on a cross-origin hop);
  raise the limit or stop following with `--max-redirects 0`.
- **Search a term starting with a dash** — end the options with `--`, e.g.
  `lobbyregister search -- -Energie`.

## Global options

These apply to every command and may be given before *or* after it:

| Option | Description |
| --- | --- |
| `-V, --version` | Print the version number |
| `-h, --help` | Show help for the program or a command |
| `--compact` | Print JSON on a single line instead of pretty-printed |
| `--base-url <url>` | API base URL (default `https://www.lobbyregister.bundestag.de`); http(s) only, given once. A user name or password in it is not sent to the server, and is shown as `***` in messages. A plain `http:` URL to a host other than loopback (`localhost`, `127.0.0.0/8`, `::1`) prints one `warning: requests to <host> are sent unencrypted (http:, not https:)` line on stderr before the first request; stdout and the exit code are unchanged |
| `--timeout <ms>` | Time limit per request, reading the whole response included (default `30000`) |
| `--user-agent <ua>` | `User-Agent` header value (default `lobbyregister-cli`; not blank, no control characters, Latin-1 only) |
| `--max-retries <n>` | Retries for transient `429`/`503` responses and reset connections (default `2`); each waits 200 ms × attempt, or the server's `Retry-After` when that is longer (up to 60 s). A timeout is not retried |
| `--max-redirects <n>` | HTTP redirects to follow (`0` = none; default `5`) |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default 100 MiB) |

## Learn more

- **[SKILLS.md](SKILLS.md)** — Claude Code Agent Skills that drive this CLI for sector briefings, spend rankings and revolving-door checks.
- **[Usage.md](Usage.md)** — full use-case-driven cookbook.
- **[GLOSSARY.md](GLOSSARY.md)** — every field, command and domain term explained.
- **[DEVELOPING.md](DEVELOPING.md)** — TypeScript library usage, architecture, testing, CI.

## Data license

This CLI is a **client** — it accesses data it does not own or redistribute. The
upstream data is © its provider and licensed **separately from this tool's code**.
See **[DATA_LICENSE.md](DATA_LICENSE.md)**.

> **Deutscher Bundestag** — statutory machine-readable open data (§ 4 LobbyRG) but
> **no standard open-data license**; the Bundestag's general terms are restrictive
> on commercial reuse. Entries contain personal data (GDPR applies).

## License

**Dual-licensed** — use it under **either**:

- **[AGPL-3.0-or-later](LICENSE)** (default, free). Note the AGPL's §13 network
  clause: if you run a modified version as a network service, you must offer that
  modified source to the service's users.
- **Commercial license** (paid), for closed-source / proprietary or SaaS use
  without the AGPL's obligations.

See **[LICENSING.md](LICENSING.md)** for details, and **[CONTRIBUTING.md](CONTRIBUTING.md)**
for the contribution policy (this project does not accept external code
contributions). Commercial enquiries: **sebs@2xs.org**.
