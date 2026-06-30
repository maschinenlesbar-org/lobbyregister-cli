# lobbyregister-cli

[![CI](https://github.com/maschinenlesbar-org/lobbyregister-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/maschinenlesbar-org/lobbyregister-cli/actions/workflows/ci.yml)
[![Release](https://github.com/maschinenlesbar-org/lobbyregister-cli/actions/workflows/release.yml/badge.svg)](https://github.com/maschinenlesbar-org/lobbyregister-cli/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@maschinenlesbar.org/lobbyregister-cli)](https://www.npmjs.com/package/@maschinenlesbar.org/lobbyregister-cli)

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

This installs the **`lobbyregister`** command. Requires **Node.js 20+**.

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

Count how many entries mention a topic without fetching the full records:

```bash
lobbyregister count Energie
```

## Commands

```text
search  [query]   search the register — prints the full envelope
count   [query]   count entries matching a query
```

### `search` options

| Flag | Meaning |
| --- | --- |
| `[query]` | free-text search term (optional — omit to match everything) |
| `--sort <order>` | sort order: `RELEVANCE_DESC`, `REGISTRATION_DESC`, `REGISTRATION_ASC` |
| `--page <n>` | 1-based page number (client-side paging) |
| `--page-size <n>` | results per page (client-side paging) |
| `--results-only` | print just the `results` array, not the envelope |

`count` takes only the optional query and the global options — no `--page`,
`--sort`, or `--results-only`.

The **[Glossary](GLOSSARY.md)** explains every field and term in the response.

## Common tasks

A few recipes to get going — see **[Usage.md](Usage.md)** for the full,
use-case-driven set.

```bash
# How many lobbyists are active in the energy sector?
lobbyregister count Energie

# Full results for a topic, newest registrations first
lobbyregister search Pharma --sort REGISTRATION_DESC

# Just the entries — no envelope — for piping into jq
lobbyregister search Wasserstoff --results-only

# Page through a large result set (1-based pages, client-side slicing)
lobbyregister search Digitalisierung --page-size 10 --page 1
lobbyregister search Digitalisierung --page-size 10 --page 2

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

> **Note on `--sort`** — the value is passed through verbatim and not validated
> client-side. An unrecognised value is silently ignored by the live API (HTTP
> `200`), so a typo won't raise an error.

> **Note on `--page` / `--page-size`** — the live endpoint returns all matches
> regardless of these parameters; the CLI slices the `results` array client-side.
> `resultCount` always reflects the true total.

**Exit codes** make the CLI easy to use in scripts:

| Code | Meaning |
| --- | --- |
| `0` | success (also `--help` / `--version`) |
| `2` | bad usage / invalid argument (nothing was sent) |
| `4` | entry not found (`404`) |
| `1` | any other error (network, parse, or non-404 HTTP status) |

## Troubleshooting

- **`command not found: lobbyregister`** — the global npm bin directory isn't on
  your `PATH`. Run `npm bin -g` to find it and add it, or run via
  `npx @maschinenlesbar.org/lobbyregister-cli …`.
- **Exit `4` / "not found"** — a `404` from the API; this is uncommon on the
  search endpoint. Check that `--base-url` points at the right host.
- **Exit `1` / network error** — connectivity, DNS, or a timeout. Try again, or
  raise the limit with `--timeout 60000`.
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
| `--base-url <url>` | API base URL (default `https://www.lobbyregister.bundestag.de`) |
| `--timeout <ms>` | Per-request timeout (default `30000`) |
| `--user-agent <ua>` | `User-Agent` header value |
| `--max-retries <n>` | Retries for transient `429`/`503` responses (default `2`) |
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
