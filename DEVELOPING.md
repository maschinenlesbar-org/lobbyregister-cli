# Developing & integrating

This document covers `lobbyregister-cli` as a **TypeScript library**, plus its
architecture, testing and release setup. If you just want to use the
command-line tool, start with the **[README](README.md)** and
**[Usage.md](Usage.md)** instead.

The package ships both a CLI (`lobbyregister`) and a typed API client
(`LobbyregisterClient`) for the open
[Lobbyregister](https://www.lobbyregister.bundestag.de/) search API
(`/sucheJson`).

**Design goals**

- **Zero runtime HTTP dependencies** — built on Node's built-in `http`/`https` (no axios, no fetch polyfill).
- **One small dependency** for the CLI: [`commander`](https://github.com/tj/commander.js).
- **Strongly typed** — typed search envelope and parameters (register entries kept as raw `JsonObject`).
- **Well tested** — unit tests on Node's built-in test runner (`node --test`), every HTTP response mocked.

## Build from source

```bash
npm install
npm run build        # compiles TypeScript to dist/
```

Run the locally built CLI without a global install:

```bash
node dist/src/cli/index.js --help
# or, after `npm link`:
lobbyregister --help
```

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

### Methods

`client.search({ q?, page?, pageSize?, sort? })` returns the full `SearchResult`
envelope. `client.count(q?)` returns just the integer match count.

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

### Library / technical terms

**API client.** [`LobbyregisterClient`](src/client/client.ts) — the typed wrapper
over `/sucheJson`, exposing `search()` and `count()`. Usable as a library
independently of the CLI.

**`search()` / `count()`.** The two client methods. `search()` returns the full
`SearchResult`; `count(q?)` returns just the number of matches.

**Transport.** A single function `(HttpRequest) => Promise<HttpResponse>`
([`http.ts`](src/client/http.ts)). The default uses Node's built-in
`http`/`https`; tests inject a mock. This is the only HTTP seam.

**Request engine.** [`RequestEngine`](src/client/engine.ts) — builds URLs,
serialises the query, follows redirects, applies retry/backoff, decodes JSON and
maps errors. Sits between the client and the transport.

**RawResponse.** The engine's low-level result: `{ data: Buffer, contentType,
status }` — raw bytes before JSON decoding.

**Query-string builder.** [`buildQueryString`](src/client/query.ts) — a
dependency-free serialiser: omits `null`/`undefined`, repeats keys for arrays
(`?id=a&id=b`), renders booleans as `"true"`/`"false"`, `Date`s as ISO-8601, and
encodes spaces as `%20`.

**CliDeps / CliIO.** The dependency-injection seam for the CLI
([`io.ts`](src/cli/io.ts)): a client factory plus an I/O object (`out`/`err`),
letting the whole CLI run in tests with a mocked client and captured output — no
subprocess.

**Error types** ([`errors.ts`](src/client/errors.ts)):

- **`LobbyError`** — the base class all the others extend.
- **`LobbyApiError`** — a non-2xx HTTP status; carries `status`, `detail`
  (extracted from the body's `detail`/`message`), `url`, `method` and `body`.
  `isRetryable` is true for `429`/`503`.
- **`LobbyNetworkError`** — a transport-level failure (DNS, connection reset,
  timeout).
- **`LobbyParseError`** — the body could not be parsed as the expected JSON, or
  had an unexpected content type.

**Retry / backoff.** Transient `429` (rate-limited) and `503` responses are
retried automatically with linear backoff. Count via `--max-retries` /
`maxRetries` (default `2`). `LobbyApiError` exposes `isRetryable`.

**maxResponseBytes.** A hard cap on response body size (default 100 MiB; `0` =
unlimited) guarding against memory exhaustion from a hostile or buggy endpoint.
CLI: `--max-response-bytes`.

**Redirects & cross-origin credential stripping.** The engine follows up to
`maxRedirects` (default `5`) HTTP redirects (`301/302/303/307/308`).
Credential-bearing headers (`Authorization`, `Cookie`, `X-API-Key`) are stripped
before following a redirect to a **different origin**, so they never leak to an
arbitrary host named in a `Location` header. Same-origin redirects keep the
headers.

**Content-type guard.** A `2xx` response whose media type is not
`application/json` (or `*+json`) is rejected as a `LobbyParseError` rather than
mis-reported as malformed JSON — defends against a captive portal or
wildcard-DNS host returning HTML.

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

Dual-licensed under **[AGPL-3.0-or-later](LICENSE)** or a commercial license — see
**[LICENSING.md](LICENSING.md)**. This project does **not** accept external code
contributions; see **[CONTRIBUTING.md](CONTRIBUTING.md)**.
