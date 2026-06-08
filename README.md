# lobbyregister-cli

A TypeScript **API client** and **command-line interface** for the open
[Lobbyregister](https://www.lobbyregister.bundestag.de/) search API
(`lobbyregister.bundestag.de`) — the German federal **register of interest
representatives** (lobbyists) before the Bundestag and the federal government.

- **Zero runtime HTTP dependencies** — built on Node's built-in `http`/`https` (no axios, no fetch polyfill).
- **One small dependency** for the CLI: [`commander`](https://github.com/tj/commander.js).
- **Strongly typed** — typed search envelope and parameters (register entries kept as raw `JsonObject`).
- **Well tested** — unit tests on Node's built-in test runner (`node --test`), every HTTP response mocked.
- **Read-only, no auth** — the `/sucheJson` open-data endpoint needs no key; this client only reads.

New to the Lobbyregister, or terms like *RegisterEntry*, *resultCount* or the
`/sucheJson` envelope? See **[GLOSSARY.md](GLOSSARY.md)** for the domain concepts
and the project's own vocabulary.

## Requirements

- Node.js **>= 20** (uses the stable built-in test runner, ESM and top-level `await`).

## Install

```bash
npm install
npm run build        # compiles TypeScript to dist/
```

Run the CLI without a global install:

```bash
node dist/src/cli/index.js --help
# or, after `npm link` / global install:
lobbyregister --help
```

---

## CLI usage

`search` prints the full envelope (`resultCount` + `results`); `--results-only`
prints just the array. `--compact` for a single line. Each `results` entry
conforms to the JSON-Schema named in the response's `$schema` field.

### Global options

| Option | Description |
| --- | --- |
| `--base-url <url>` | API base URL (default `https://www.lobbyregister.bundestag.de`) |
| `--timeout <ms>` | Per-request timeout (default `30000`) |
| `--user-agent <ua>` | `User-Agent` header value |
| `--max-retries <n>` | Retries for transient `429`/`503` responses (default `2`) |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default 100 MiB) |
| `--compact` | Print JSON on a single line |

Global options are recognised both **before** and **after** the command, e.g.
both `lobbyregister --compact count Energie` and `lobbyregister count Energie --compact`
work the same way (the program resolves globals via `optsWithGlobals()`).

### Commands

```text
search [query] [--page <n>] [--page-size <n>] [--sort <order>] [--results-only]
count  [query]                  number of entries matching a query
```

Common `--sort` values: `RELEVANCE_DESC`, `REGISTRATION_DESC`, `REGISTRATION_ASC`.
`--sort` is passed through verbatim and is not validated client-side. Note that
the live `/sucheJson` endpoint currently does **not** validate `sort` either: an
unrecognised value is silently ignored (HTTP `200`) rather than rejected, so a
typo will not raise an error. The CLI only surfaces an error if the API *does*
return an HTTP `400`: it then exits `1` and prints the API's error detail (plus a
hint to check `--sort` when the API gives no detail).

### Examples

```bash
# How many entries mention "Energie"?
lobbyregister count Energie

# First page of results, newest registrations first
lobbyregister search Energie --sort REGISTRATION_DESC --page-size 10

# Just the entries, no envelope
lobbyregister search Energie --results-only --compact

# Search a term that begins with a dash — end the options with `--`
lobbyregister search -- -Energie
```

Exit codes: `0` success, `2` for a usage error (unknown/missing command, unknown
option, invalid option value, or no command given), `4` on a `404` from the API,
`1` for any other error (network, parse, or other non-404 HTTP status).

---

## Library usage

```ts
import { LobbyregisterClient, LobbyApiError } from "@maschinenlesbar.org/lobbyregister-cli";

const client = new LobbyregisterClient(); // defaults to https://www.lobbyregister.bundestag.de

const page = await client.search({ q: "Energie", pageSize: 10 });
console.log(page.resultCount, page.results.length);

const total = await client.count("Energie");

try {
  await client.search({ q: "x" });
} catch (err) {
  if (err instanceof LobbyApiError) console.error(err.status, err.detail);
}
```

### Client options

```ts
new LobbyregisterClient({
  baseUrl: "https://www.lobbyregister.bundestag.de",
  timeoutMs: 15_000,
  maxRetries: 3,              // 429 / 503 are retried with linear backoff
  maxResponseBytes: 50 << 20, // abort responses larger than 50 MiB (0 = unlimited)
  userAgent: "my-app/1.0",
  headers: { Authorization: "Bearer …" }, // extra headers on every request
  transport: customTransport, // inject your own HTTP transport
});
```

Credential-bearing headers (`Authorization`, `Cookie`, `X-API-Key`) are
automatically stripped when a redirect crosses to a different origin, so they are
never sent to an arbitrary host named in a `Location` header.

### Methods

`client.search({ q?, page?, pageSize?, sort? })` (full envelope) and
`client.count(q?)` (just the match count).

---

## Architecture

```
src/
  client/
    types.ts     # SearchResult envelope + SearchParams (entries kept as JsonObject)
    query.ts     # dependency-free query-string builder
    http.ts      # the Transport interface + default node:http/https transport
    engine.ts    # URL building, retry/backoff, redirects (with cross-origin credential stripping), JSON decoding, error mapping
    errors.ts    # LobbyError / LobbyApiError / LobbyNetworkError / LobbyParseError
    client.ts    # LobbyregisterClient — search + count over the engine
  cli/
    io.ts        # injectable I/O seam (stdout/stderr)
    shared.ts    # option parsers, global-option resolver, JSON renderer
    commands/    # search / count
    program.ts   # assembles the commander program from injectable deps
    run.ts       # parses argv -> exit code (no process.exit; testable)
    index.ts     # #! bin shim
```

**Design notes**

- The HTTP layer is a single `Transport` function (`(req) => Promise<HttpResponse>`). The default
  uses `node:http`/`node:https`; tests inject a mock. This keeps the client free of any HTTP framework.
- The CLI is built around injectable `CliDeps` (client factory + I/O), so the whole program can be
  driven in-process by tests with a mocked client and captured output — no subprocesses.
- Register entries are large, schema-versioned documents, so `results` are returned as faithful
  raw `JsonObject`s rather than partially-guessed types.

---

## Testing

```bash
npm test          # builds, then runs `node --test` over dist/test
```

- **`query.test.ts`** — query-string serialisation.
- **`http.test.ts`** — the default transport against a real loopback `http.createServer`.
- **`engine.test.ts`** — URL building, JSON decoding, error mapping, 429/503 retry (incl. `maxRetries: 0`), same-/cross-origin redirects (cross-origin credential stripping), missing-`Location` handling — mocked transport.
- **`client.test.ts`** — the search URL/param mapping, empty-query semantics and the `count` helper — mocked transport.
- **`cli.test.ts`** — command parsing, `--page`/`--sort`/`--results-only` passthrough, `count`, and exit codes (404, 400-with-hint, network and parse errors) — mocked client.

## Continuous integration

GitHub Actions workflows under `.github/workflows/`:

- **ci.yml** — type-check, build and test on Node 20/22/24 for every push and PR.
- **release.yml** — on a `v*` tag: verify the tag matches `package.json`, test, `npm pack`, generate CycloneDX SBOMs (production and full graph), and create a GitHub Release with the tarball and SBOMs.
- **publish.yml** — manual dispatch: publish to npm via OIDC **Trusted Publishing** (no stored `NPM_TOKEN`) with provenance.
- **docs.yml** — build TypeDoc API docs and deploy to GitHub Pages on each `v*` tag.

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
