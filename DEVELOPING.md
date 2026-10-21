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
npm run build        # compiles every workspace (tsc -b) to its dist/
```

Run the locally built CLI without a global install:

```bash
node apps/cli/dist/src/cli/index.js --help    # or: npm start -- --help
# or, after `npm link --workspace apps/cli`:
lobbyregister --help
```

## Library usage

```ts
import { LobbyregisterClient, LobbyApiError } from "@maschinenlesbar.org/lobbyregister-cli";

const client = new LobbyregisterClient(); // defaults to https://www.lobbyregister.bundestag.de

const page = await client.search({ q: "Energie", pageSize: 10 }); // first 10 of all matches
console.log(page.resultCount, page.results.length);             // e.g. 2409 10

const total = await client.count("Energie");

// Facet filters of the register's website search (values of one attribute: OR; attributes: AND)
const revolvingDoor = await client.count(undefined, [{ attribute: "revolvingdoordata", value: "true" }]);

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
  maxRetries: 3,              // 429 / 503 retried (Retry-After honoured, else linear backoff)
  maxResponseBytes: 50 << 20, // cap at 50 MiB — overrides the 100 MiB default (0 = unlimited)
  userAgent: "my-app/1.0",
  headers: { Authorization: "Bearer …" }, // extra headers on every request
  transport: customTransport, // inject your own HTTP transport
});
```

Every option — here, in `search()`'s parameters, `count()`'s options and the `allowUnknown`
option of `parseFilter`/`filterQuery` — may also be given as `undefined`, which means its
default, as an omitted one does; the types say so (`?: T | undefined`), so a consumer compiled
with `exactOptionalPropertyTypes` can pass `process.env.X` as it is.

`baseUrl` must be an absolute `http:`/`https:` URL (`baseUrlProblem`,
`validateBaseUrl`); a malformed one or another scheme throws `LobbyValidationError`
when the client is built, as the CLI's `--base-url` parser does. The numeric options
are checked then too: `timeoutMs` must be an integer `0..MAX_TIMEOUT_MS` (2^31 - 1
ms, the largest timer Node supports), and
`maxRetries`, `retryDelayMs`, `maxRedirects` and `maxResponseBytes` non-negative
integers. Anything else — `-1`, `NaN` (e.g. `Number()` of an unset variable),
`1.5`, `Infinity` — throws `LobbyValidationError` instead of silently switching the
limit off. `0` keeps its meaning (no timeout, no retries, no redirects, no cap). The
CLI's `--timeout`, `--max-retries`, `--max-redirects` and `--max-response-bytes`
parsers apply the same rule (`intInRangeProblem`).

A base URL with a user name or password is rejected (`baseUrlProblem`, so the library's
`LobbyValidationError` and the CLI's usage error, exit 2): the register needs no
credentials, the engine never sent them, and accepting them only looked as if they were
used. The validation reasons never repeat a base URL. The CLI also redacts on output:
`run.ts` (`redactionFor`, `withRedactedOutput`) takes the exact userinfo of every URL
argument (`credentialsIn`, exported; only a value that starts with a scheme counts, since a
bare `a:b@c` is a search text or a User-Agent as often as a credential, except as the
`--base-url` value, which is read as if it had one) and replaces it with `***` in
everything it prints —
commander's usage errors, which echo rejected values, and its own messages — so a
password with spaces, quotes, `#`, `?` or `/` is caught as well as an ordinary one. The
log replaces them in each record's *message*, before the record is cut and escaped, and
writes it to the raw stderr: the frame (time, level, topic) is never touched, and a
password with DEL, C1 or bidi characters is matched in its raw form. The forms a server
echoes a userinfo back in are replaced too (`echoedCredentialForms`): the `Basic` value and
the decoded `user:password` on stdout and stderr, the password alone (4 characters or more)
on stderr only, since it may well occur in the data.
`redactUrl` (exported) masks the userinfo of a URL and falls back to the same
text-based cut (`redactCredentials`, exported) for a value that doesn't parse.

The library keeps them out of what a caller logs, too. The client's engine, the base
URL and the `headers` option live in real `#private` fields, so `console.log(client)`,
`util.inspect` and `JSON.stringify` show none of them. The engine never sends the base
URL's userinfo (request URLs are built from its scheme, host and path), and it scrubs
that userinfo, raw and percent-decoded, from error bodies and details, transport error
text and the `cause` chain it attaches; `LobbyApiError.url`, its `location` and every
message show URLs through `redactUrl`.

`userAgent` and every value in `headers` must be a non-blank string of Latin-1
characters without control characters (tab is allowed), and every header name an HTTP
token; otherwise the constructor throws `LobbyValidationError` (`headerValueProblem`,
`headerNameProblem`, `assertHeaderValue`). Only an omitted `userAgent` selects the
default `lobbyregister-cli`. The CLI's `--user-agent` parser applies the same rule.

### Methods

`client.search({ q?, page?, pageSize?, sort?, filters? })` returns the `SearchResult`
envelope. `client.count(q?, filters?)` returns just the integer match count.

`/sucheJson` ignores paging and always returns every match, so `page`/`pageSize` are not
sent: the client downloads the whole set and slices `results` (1-based `page`, default 1;
`resultCount` stays the total). Both must be integers >= 1 and `page` needs `pageSize`,
else `LobbyValidationError` before any request. `q` and `sort` may be omitted but not blank: the
register reads a blank `q` as no query (the whole register) and a blank `sort` as the
default order, so `""` or whitespace rejects with `LobbyValidationError` before any
request (`count` too). Omit `q` to match everything. `q` is free text and goes out trimmed and
in composed Unicode, NFC (`normalizeText`, exported), so a pasted trailing space or a decomposed
"Müller" (u plus U+0308) matches what the typed text matches; the CLI's `count` prints that
form as its `query`. `sort` and the filter values are codes and are not touched by it. `count` downloads the whole set
too — there is no count-only request.

`filters` are the facet filters of the register's website search, sent as
`filter[<attribute>][<value>]=true` (`packages/client/src/filters.ts`). Each filter is first
normalised (`normaliseFilter`: both parts trimmed, the attribute lower-cased), so
`{ attribute: " RevolvingDoorData ", value: " true " }` sends the same request as the
CLI's `--filter " RevolvingDoorData = true "`; `parseFilter("attribute=value")` is the
text form the CLI's `--filter` parser uses. The API ignores an
unknown attribute and would return the whole unfiltered set, so the client accepts
only the attributes in `SEARCH_FILTER_ATTRIBUTES`, taken from the website's search
form (2026-09-26). It matches nothing for an unknown value (HTTP 200,
`resultCount: 0`), so the client also accepts only the value codes in
`SEARCH_FILTER_VALUES` (read from the form on 2026-10-06): normalisation matches them
case-insensitively and gives a bare sub-code from the data its parent
(`canonicalFilterValue`: `FOI_EU_LAWS` → `FOI_EUROPEAN_UNION|FOI_EU_LAWS`, the only
form the register matches); anything else — `donationsreceived=true`, an unknown code,
a sub-code under the wrong parent — rejects with `LobbyValidationError` naming the
valid codes, before any request (`knownFilterAttributeProblem`,
`knownFilterValueProblem`). Both lists are frozen. When the register adds a filter or
a value, add it; until a release has it, `search({ ..., allowUnknownFilters: true })`
(CLI: `--allow-unknown-filters`) lifts both checks, and the CLI then notes on stderr
when a reply of 0 follows a code it didn't know (`isKnownFilter`). The CLI's `--filter`
parser checks only the syntax and leaves the catalogue check to the client, so the
flag works wherever it stands. `searchQuery(params)` (exported) runs exactly these checks and returns the query
`search()` would send, without a request; the CLI calls it before it logs the cleartext
warning, so a usage error is never preceded by that warning. `search()` also rejects a parameter key it doesn't take
(`{ filter: … }`, `{ revolvingdoordata: "true" }`, `__proto__`), which it used to ignore
and so return the whole register. The CLI's single-value options (`--sort`, `--page`,
`--page-size` and the global ones) may be given only once. On the reply the client also checks that `searchParameters.facets` echoes
each filter, which catches an attribute the register has dropped: a filter it did not
echo throws `LobbyError` (a reply without a `facets` array is not checked).

`sort` is sent verbatim. The register ignores an unknown or wrong-case value (HTTP
`200`) and falls back to its default order, so when `searchParameters.sortOrder`
names another order the result carries `sortIgnored: { requested, applied }`
(`ignoredSort` in `filters.ts`); the data is still returned. The CLI prints the
envelope without that field and turns it into a `WARN` record of `lobbyregister.api` on stderr.
`sortOrder` is the server's text, so `SortIgnored.applied` and the envelope keep it as sent,
and a message quotes it through `sortOrderForMessage` (exported): control characters
dropped (`sanitizeServerText`, as for an error detail), white space folded to one space,
cut at `MAX_QUOTED_LENGTH` (200). The CLI's sort-ignored `WARN` and relevance-paging `INFO`
both do; a hostile `sortOrder` used to forge log records, steer the terminal and fill
200 KB of stderr.

## Architecture

The repository is an **npm workspace** with two folders: `apps/` holds the programs it
publishes, `packages/` the libraries they are built from.

```
package.json         # private workspace manifest: no version, never packed
apps/cli/            # @maschinenlesbar.org/lobbyregister-cli — the published package
  package.json       # its version, bin, files (no workspace package in dependencies)
  src/index.ts       # library entry: re-exports @maschinenlesbar.org/lobbyregister-client
  src/cli/           # the CLI (below)
  test/              # CLI tests and every conformance-*.test.ts
packages/client/     # @maschinenlesbar.org/lobbyregister-client — private, shipped inside the CLI's tarball
  src/               # the API client (below)
  test/              # tests that only touch the client, + the transport helpers
tools/pack/          # prepack/postpack: ship the client (dist/node_modules) and commander in the tarball
tools/bump.mjs       # version bump + commit + tag (npm run bump)
tsconfig.docs.json   # TypeDoc only: the package entry, with the client read from its sources
```

- **The client is its own package** so a later MCP app can share it with the CLI. It is
  never published on its own: `apps/cli`'s `prepack` copies it into
  `apps/cli/dist/node_modules/`, where the CLI's imports find it, and the tarball ships it
  as plain files — so npm lists only commander (bundled) as a dependency, never the
  private client. `apps/cli/package.json` therefore doesn't name the client; prepack finds
  it through `apps/cli/tsconfig.json`'s project references. The library
  entry re-exports the client's `"."`, so `import { LobbyregisterClient } from
  "@maschinenlesbar.org/lobbyregister-cli"` is unchanged.
- **The client's exports:** `"."` is the public library surface (`src/index.ts`);
  `"./internal/*"` maps to any module (`…/lobbyregister-client/internal/engine`) for what
  the CLI needs beyond that; `"./test/*"` reaches the client's test helpers from the CLI's
  tests (not bundled). Only `"."` is part of the library.
- **Dependencies point one way:** the app depends on the client, the client on nothing
  in the workspace.
- **The version lives in `apps/cli/package.json`.** The root has none; a plain
  `npm version` at the root is refused. Release with `npm run bump -- <patch|minor|major>`,
  which bumps the app, commits (the bare version as the message) and tags `vX.Y.Z`.
- **TypeScript:** `tsconfig.base.json` holds the compiler options; every workspace has a
  `tsconfig.json` (`src/`) and a `tsconfig.test.json` (`test/`), and the root
  `tsconfig.json`/`tsconfig.test.json` reference them, built with `tsc -b`.

The client (`packages/client/src/`) and the CLI (`apps/cli/src/`):

```
packages/client/src/
    types.ts     # SearchResult envelope + SearchParams (entries kept as JsonObject)
    filters.ts   # facet filters: attribute allowlist, query keys, echo check
    query.ts     # dependency-free query-string builder
    http.ts      # the Transport interface + default node:http/https transport
    engine.ts    # URL building, retry/backoff, redirects (with cross-origin credential stripping), JSON decoding, error mapping
    errors.ts    # LobbyError / LobbyApiError / LobbyNetworkError / LobbyParseError / LobbyValidationError
    validate.ts  # Problem type + assertValid: the input rules the library and CLI share
    client.ts    # LobbyregisterClient — search + count over the engine
    index.ts     # the client's public surface (the library entry re-exports it)
apps/cli/src/cli/
    io.ts        # injectable I/O seam (stdout/stderr), the logger and the clock
    log.ts       # the stderr log: records with ts, level, topic; --log-format text|jsonl
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
- **Rendering** (`renderJson` in `apps/cli/src/cli/shared.ts`): an answer that can't be
  printed is an `OutputError` (an ERROR of `lobbyregister.output`, exit 1) that names the cause:
  a stack overflow is "nested too deeply to pretty-print" (or "to print"), V8's "Invalid string
  length" is "too large (more than 536870888 characters of JSON)". "; try --compact" is added
  only when `compactPrints` finds that the compact form of that very answer prints on this
  runtime: probed, never assumed from the Node version. `--compact` takes V8's fast path (`JSON.stringify(value)`), the only one
  that prints very deep nesting on Node 26, unless the answer holds a string or key of 64 Mi
  characters or more (`holdsHugeString`): on Node 26 the fast path aborts the process on a
  ~250 MB string, so such an answer goes through the gap path (an empty gap, the same text).
  `holdsHugeString` is iterative, linear and allocates nothing per value (arrays by index,
  objects by `for…in`; `Object.entries` made a pair per element and crashed on 48M numbers).
  The printed JSON escapes what `JSON.stringify` leaves raw although a terminal acts on it
  (`escapeControlChars`): DEL, the C1 range U+0080–U+009F and the bidi controls
  (`isBidiControl`: U+061C, U+200E, U+200F, U+202A–U+202E, U+2066–U+2069), so `U+202E`
  prints as `\u202e`. The text is equivalent, valid JSON. Each escaped character becomes six, so
  the length is counted first: an output past V8's longest string is an `OutputError`, `The
  answer is too large to print (N characters once its control characters are escaped).`;
  otherwise it is built in 64 Ki chunks and joined once (one `+=` per character crashed on an
  answer of 90 MB of DEL).

### Library / technical terms

**API client.** [`LobbyregisterClient`](packages/client/src/client.ts) — the typed wrapper
over `/sucheJson`, exposing `search()` and `count()`. Usable as a library
independently of the CLI.

**`search()` / `count()`.** The two client methods. `search()` returns the full
`SearchResult`; `count(q?)` returns just the number of matches.

**Transport.** A single function `(HttpRequest) => Promise<HttpResponse>`
([`http.ts`](packages/client/src/http.ts)). The default uses Node's built-in
`http`/`https`; tests inject a mock. This is the only HTTP seam.

**Request engine.** [`RequestEngine`](packages/client/src/engine.ts) — builds URLs,
serialises the query, follows redirects, applies retry/backoff, decodes JSON and
maps errors. Sits between the client and the transport.

**RawResponse.** The engine's low-level result: `{ data: Buffer, contentType,
status }` — raw bytes before JSON decoding.

**Query-string builder.** [`buildQueryString`](packages/client/src/query.ts) — a
dependency-free serialiser: omits `null`/`undefined`, repeats keys for arrays
(`?id=a&id=b`), renders booleans as `"true"`/`"false"`, `Date`s as ISO-8601, and
encodes spaces as `%20`.

**CliDeps / CliIO.** The dependency-injection seam for the CLI
([`io.ts`](apps/cli/src/cli/io.ts)): a client factory plus an I/O object (`out`/`err`),
letting the whole CLI run in tests with a mocked client and captured output — no
subprocess.

**Error types** ([`errors.ts`](packages/client/src/errors.ts)):

- **`LobbyError`** — the base class all the others extend.
- **`LobbyApiError`** — a non-2xx HTTP status; carries `status`, `detail`
  (extracted from the body's `detail`/`message`), `url`, `method` and `body`.
  `isRetryable` is true for `429`/`503`.
- **`LobbyNetworkError`** — a transport-level failure (DNS, connection reset,
  timeout — whatever a custom transport throws —, an invalid transport response, a
  body over `maxResponseBytes`). A bad configured `baseUrl` is a
  `LobbyValidationError` instead.
- **`LobbyParseError`** — the body could not be parsed as the expected JSON, or
  had an unexpected content type. Its message names the request, as `GET <url>: …` (the URL
  cut at 200 characters, userinfo redacted): `… unexpected content type "text/html" (expected
  JSON).`, `… unsupported response charset "x".`, `… empty response body.`, `… the answer is
  not valid JSON.`, `… unexpected response shape: expected …`. So does the `LobbyError` for a
  filter the reply did not echo (`… the register ignored the filter …`).
- **`LobbyValidationError`** — a rejected input: a client option or method argument
  that breaks one of the library's rules. Thrown before any request is made (a
  method rejects, the constructor throws), with the message
  `Invalid <name>: <reason>`. The CLI maps it to its usage exit code `2`.

**Input validation** ([`validate.ts`](packages/client/src/validate.ts)). Every rule about what
a request may contain lives in the library as a pure, exported function: a
`Problem` (`(value) => string | undefined`) returns the reason a value is invalid,
and `assertValid(name, value, problem)` throws `LobbyValidationError` with it. The
CLI's option parsers call the same functions and turn the reason into a usage error,
so the CLI and a library caller accept and reject the same inputs. The rules check the
type first: a wrong-typed input — `search({ q: 123 })`, `filters` that is not an array,
`count({ q: "Energie" })`, a string `transport`, a numeric `sleep`, `page: "2"` — is a
`LobbyValidationError` too, never a raw `TypeError`; `null` client options mean none.
Server text in a message (an error `detail`, a transport's error text, a redirect
target) is cut at 500 characters, never inside a surrogate pair (`cutText`), so the
message stays well-formed; any other value an own message quotes from a server answer or
the user's input (a redirect target, a filter, a parameter key, a sort order) at
`MAX_QUOTED_LENGTH` (200, `cutForMessage`), so `err.message` stays bounded for a library
caller. `LobbyApiError.body` keeps it all.

**Retry / backoff.** Transient `429` (rate-limited) and `503` responses are
retried automatically, with a linear backoff (`retryDelayMs * attempt`). A
server-provided `Retry-After` header (the delta-seconds and the IMF-fixdate
HTTP-date forms; `-1`, `1.5` and other date formats are ignored) can make a wait
longer, never shorter: `Retry-After: 0` or a date in the past still waits the
backoff, so the retries never burst. A long one is clamped to a 60 s ceiling, and
`retryDelayMs` is bounded by the same 60 s (`LobbyValidationError` above it). Count via
`--max-retries` / `maxRetries` (default `2`). A reset connection is retried the same
way, with the linear backoff (`isTransientNetworkError`: `ECONNRESET`/`EPIPE`/
`ECONNABORTED` or undici's `UND_ERR_SOCKET` anywhere in the error's `cause` chain;
`GET`/`HEAD` only); a refused connection, a DNS failure and a timeout are not retried.
`LobbyApiError` exposes `isRetryable`.

Each retry is announced: the engine option `onRetry(event: RetryEvent)` (exported type:
`{ retry` (1-based), `maxRetries`, `delayMs`, `status?` (absent for a reset), `url` (userinfo
redacted) `}`) is called once per retry right before the sleep, never when there is none, and
a throw in it is swallowed. The CLI's `action()` sets it to log one `WARN` record of
`lobbyregister.http`, `HTTP 503 from <host>: retry 1 of 3 in 2 s` (`retryMessage`; host only,
whole seconds, ms under 1 s). Tests: `apps/cli/test/retry-log.test.ts`.

**maxResponseBytes.** A hard cap on response body size (default 100 MiB; `0` =
unlimited) guarding against memory exhaustion from a hostile or buggy endpoint.
CLI: `--max-response-bytes`. The default transport aborts as soon as the cap is
passed; the engine also checks the body any transport returns, so the cap holds for
custom transports too. The message names both the option and the flag. With the cap lifted, a
body too large to be one string (512 MB and more: V8's longest string is 536870888 characters)
is a `LobbyParseError`, `GET <url>: the answer is too large to read as text (N bytes; …)`, an
`ERROR` of `lobbyregister.api` (it was "Unexpected error"); an error status with such a body
keeps its `LobbyApiError` and leaves the body out.

**timeoutMs.** A deadline for the whole request, response body included (default
30 s; `0` disables). The engine enforces it itself, for every transport: the
transport gets an `AbortSignal` (`HttpRequest.signal`) that fires at the deadline, and
the call rejects then with a `LobbyNetworkError` whether the transport stops or not,
so a `fetch` or `node:http` transport can't hang a caller. A timed-out request is not
retried.

**Custom transports.** A transport may return the body as a Buffer, any `ArrayBuffer`
view (fetch's `Uint8Array`, from any realm) or an `ArrayBuffer`, and the headers as a
plain record in any letter case, a `Headers` object or a `Map` (`Retry-After`,
`Location` and `Content-Type` are found in all of them). Whatever it throws, and a
response without a usable `status` (100–599), `headers` or `body`, becomes a
`LobbyNetworkError` whose message names the request (`GET <url> failed: socket hang
up`), with the original as `cause`. A redirect to anything but `http:`/`https:`
(`file:`, `data:`, `javascript:`, `ftp:`) is refused before the transport is called.

**Redirects & cross-origin credential stripping.** The engine follows up to
`maxRedirects` (default `5`) HTTP redirects (`301/302/303/307/308`).
Before following a redirect to a **different origin** (scheme + host + port) —
including a same-host `https:` -> `http:` downgrade — every header passed in
`headers` is dropped (`Authorization`, `Proxy-Authorization`, `Cookie`, `X-API-Key`,
`X-Auth-Token`, any other); only the engine's own `Accept` and `User-Agent` go
along, so no credential leaks to an arbitrary host named in a `Location` header, nor
crosses the wire in cleartext. Same-origin redirects keep the headers, whether the
`Location` is relative or absolute; a 401/403 that follows a redirect which dropped
them says so (`the server redirected http to https, so the credential headers were not
sent there; use an https base URL`). The engine never sends userinfo: a base URL may not
carry any (it is rejected, see above), request URLs are built from its scheme, host and
path, and a `Location`'s own userinfo is dropped. Transports are told
`redirect: "manual"` (`HttpRequest.redirect`) and must not follow redirects themselves;
a response whose `url` (fetch's `Response.url`) lies on another origin than the request
is rejected as a `LobbyNetworkError`. A same-origin redirect to the register's error
page (`/fehler`), its answer to a query it cannot parse (an unbalanced quote or
parenthesis, a very long query), is not followed: it surfaces as a `LobbyApiError` that
says the register rejected the request. A 3xx without a `Location`, or with one that
is not a valid http(s) URL, is not followed: it surfaces as a `LobbyApiError` whose `location`
field and message name the target (`HTTP 302 for GET …: redirect to http://[::1 not
followed`, or `redirect not followed (no Location header)`).

**Content-type guard.** A `2xx` response whose media type is not
`application/json` (or `*+json`) is rejected as a `LobbyParseError` rather than
mis-reported as malformed JSON — defends against a captive portal or
wildcard-DNS host returning HTML.

**Charset.** A JSON body is decoded by the charset its `Content-Type` declares
(`TextDecoder`; UTF-8 when it names none), so a mirror that answers in ISO-8859-1
reads correctly instead of as `B\uFFFDndnis`, and a leading byte order mark is dropped.
An unknown charset label is a `LobbyParseError`. The register itself sends UTF-8. Bytes that are not valid in that charset, and a lone surrogate written as a JSON escape
(`\ud800`, which `jq` refuses and with it the whole output), are replaced with U+FFFD
(`decodeBody` with a fatal decoder, then a replacing one; `wellFormedEscapes`): never silently,
since the engine option `onWarning(message)` is told how many and for which request (`GET <url>:
2 characters of the answer were not valid text (invalid bytes or a lone surrogate) and replaced
with U+FFFD.`), which the CLI's `action()` logs as a `WARN` record of `lobbyregister.api`. One
bad character never sinks a whole answer.

**Number check.** A `2xx` JSON answer with a number `JSON.parse` cannot carry exactly is a
`LobbyParseError` (CLI exit `1`, an `ERROR` of `lobbyregister.api`), never a changed value:
one out of a double's range (`1e400` would become `null` in the output), one past 2^53 in any
written form (`12345678901234567890`, `…890.0`, `9007199254740993e0`, `9007199254740992.5`),
a non-zero one too small for a double (`1e-400` would become `0`), and a subnormal one (below
2.2250738585072014e-308, where a double has fewer digits) that does not print as written
(`3e-324` would become `5e-324`; `5e-324` and `1e-310` pass). The message is
`GET <url>: the number <N> cannot be represented exactly.` Below
2^53 a decimal fraction in the normal range keeps a double's usual precision, as JSON means it, and past it a
double a server printed in its own shortest form (`1e23`, `1.7976931348623157E308`) passes,
since it prints as the same number. The register's
numbers (counts, euro amounts, staff numbers) are far below 2^53; register numbers are
strings (`R002297`). The engine option `bigIntegerKeys` (a set of member names) declares members
whose numbers may exceed 2^53: their values are delivered as the exact literal, as a JSON string,
whatever the size, and every other number keeps this rule. The client declares none (P25's
adapter: `BIG_INTEGER_KEYS = []`). The check and the declared members are one linear pass that
skips strings (`scanNumbers`), no reviver.

**Envelope check.** A `2xx` JSON answer must be the documented envelope: an object
with a non-negative integer `resultCount` and a `results` array whose entries are all
objects. `null`, `{}`, an error object, a string count or a `null` entry is a
`LobbyParseError` (CLI exit `1`), never data or "nothing found". A `resultCount` that
disagrees with the number of `results` (the endpoint returns every match, so they should
be equal) is not an error: `count()` trusts `resultCount`, `resultCountMismatch(result)`
(exported) names both numbers, and the CLI's `count` — which calls `search()` to keep the
envelope — logs that as a `WARN` record of `lobbyregister.api` on stderr.

## Testing

```bash
npm test          # builds, then runs `node --test` over each workspace's dist/test
npm run coverage  # the same tests in one run, with a coverage report
node --test apps/cli/dist/test/cli.test.js   # one file, after a build
```

The client's tests are in `packages/client/test/` (`query`, `http`, `engine`, `client`),
everything that drives the CLI is in `apps/cli/test/`.

- **`query.test.ts`** — query-string serialisation.
- **`http.test.ts`** — the default transport against a real loopback `http.createServer`.
- **`engine.test.ts`** — URL building, JSON decoding, error mapping, 429/503 retry (incl. `maxRetries: 0`), same-/cross-origin redirects (cross-origin credential stripping), missing-`Location` handling — mocked transport.
- **`client.test.ts`** — the search URL/param mapping, blank-query and blank-sort rejection and the `count` helper — mocked transport.
- **`validate.test.ts`** — `assertValid`, the `LobbyValidationError` -> exit `2` mapping, and the `parity()` helper (`apps/cli/test/helpers.ts`), which sends one input through `run()` and through the library on one recording mock transport.
- **`parity.test.ts`** — CLI <-> library parity: each input runs through the CLI and the library on one mock transport, and both must reject before any request or send the identical request.
- **`log.test.ts`** — the record helpers of `apps/cli/src/cli/log.ts` on their own
  (`escapeForRecord`, `formatLogRecord`, `installWarningLog`); the CLI-level checks are
  P23's. `io.test.ts` tests `handleOutputErrors` and `stderrAfterStdout` with fake streams
  (a closed pipe, a stdout write error as a record, a record held behind stdout's backlog).
- **`cli.test.ts`** — command parsing, `--page`/`--sort`/`--results-only` passthrough, `count`, and exit codes (404, 400-with-hint, network and parse errors) — mocked client.
- **`conformance-p*.test.ts`** — the shared checks of the 2026-10-05 fix patterns, the same
  files in every maschinenlesbar.org CLI with only the adapter block at the top changed:
  P1 (no credential from a base URL in any output line), P2 (none in a logged client or
  error; since base URLs with credentials are rejected, the secret the adapter's client
  holds is an `Authorization` header in `headers`), P3 (credential headers stay on their
  origin across redirects; this client never sends userinfo, and its adapter drops the
  `alice:s3cret@` the shared cases put into the base URL), P5 (`timeoutMs`, `maxResponseBytes`, header and body shapes for any
  transport), P6 (retries never faster than the backoff), P7 (closed pipes, run as a child
  process), P8/P9/P13 (charset, envelope shape, wrong-typed input) and P10 (filter keys,
  attributes, values and repeated flags). The follow-up round of 2026-10-06 added P20
  (`conformance-p20-cleartext-warning`: a remote plain `http:` base URL gets one `WARN`
  record of `lobbyregister.http` on stderr from the library's `cleartextProblem`, printed by `action()` in `shared.ts`
  after the command's checks (so never before a usage error) and before the client is built; no base-URL variable and no secret here, so those two cases
  are skipped, and so is the credentials case, since a base URL with credentials is a usage
  error here — a lobbyregister case at the end checks that instead) and P21 (`conformance-p21-readme-links`: every relative link in `README.md`
  points to a file `package.json` `files` ships, since npmjs.com shows the README; other
  documents are linked by their GitHub URL). P23 (`conformance-p23-log-format`, 2026-10-09)
  checks that every stderr line is a log record and `--log-format text|jsonl`, and since the
  fix plan of the 2026-10-09 sweep that a record is one line with nothing raw, well-formed
  and bounded, a secret is replaced in the message only, commander's help is one record per
  line, every failure has an ERROR, the format is commander's, a malformed answer is `api`
  and an `a:b@c` value is no credential. Its adapter sets `BASE_URL_USERINFO = false` (a
  base URL with userinfo is a usage error here, so the echoed-credentials check skips) and
  `OUTPUT_OPTION = undefined` (no `-o`). P24 (`conformance-p24-input-corpus`, 2026-10-21)
  sends a corpus of tricky values through every text filter (the query of `search` and
  `count`) on the CLI and in the library: both refuse it before any request, or both send it
  trimmed and in NFC; its id list is empty, since no command puts an id into a path. P25
  (`conformance-p25-response-corpus`) checks that a number the answer can't carry exactly,
  and an empty answer, are errors (exit 1, an ERROR of `lobbyregister.api`), never a changed
  value. Their adapters turn this repo's `parity` (which keeps the thrown error) into the
  shape the shared bodies read. P26 (`-o` integrity) does not apply: this CLI has no `-o`.

## Continuous integration

GitHub Actions workflows under `.github/workflows/`:

- **ci.yml** — type-check, build and test on Node 22/24/26 for every push and PR; then pack the
  real tarball, check the pack left nothing behind, install it globally with the registry out
  of reach and run the bin.
- **release.yml** — on a `v*` tag (made by `npm run bump`): verify the tag matches
  `apps/cli/package.json`, test, generate CycloneDX SBOMs (production and full graph, scoped
  to the `apps/cli` workspace), then `npm pack --workspace apps/cli`, and create a GitHub
  Release with the tarball and SBOMs.
- **publish.yml** — manual dispatch from the release tag (`gh workflow run publish.yml --ref vX.Y.Z`; the version is the tag's): `npm publish --workspace apps/cli` via OIDC **Trusted Publishing** (no stored `NPM_TOKEN`) with provenance.
- **docs.yml** — build the project website (`site/`, English and German) with the TypeDoc API docs
  under `/api/`, and deploy both to GitHub Pages on each `v*` tag.
  TypeDoc runs from the isolated, lockfile-pinned `tools/docs/` toolchain because it
  needs the TypeScript 6 compiler API, which TypeScript 7 no longer ships; locally,
  run `npm ci --prefix tools/docs` once before `npm run docs`.

## Skills

The five skills in `skills/` share a verbatim `## Tooling` stanza: it runs
`lobbyregister --version`, stops when the CLI is missing, and stops when it is older than
the minimum version the skills are written for (0.4.0; also in each skill's `compatibility`
and in `SKILLS.md`), asking the user to install or upgrade — a skill never installs or
upgrades anything. When a release changes behaviour the skills rely on, raise that minimum
in all five skills, `SKILLS.md` and this paragraph together, and bump `version` in
`.claude-plugin/plugin.json`.

## Website

The project website — <https://maschinenlesbar.org/lobbyregister-cli/> in English and
<https://maschinenlesbar.org/lobbyregister-cli/de/> in German — is built from `site/`
with [Jekyll](https://jekyllrb.com/), [banira](https://sebs.github.io/banira/) web components
and [Fylgja](https://fylgja.dev/) CSS, and deployed by `docs.yml` together with the TypeDoc API
reference under `/api/`. Its content comes from this repository: the README intro and quick
start, the command tree of the built CLI (`site/scripts/cli-reference.mjs`), `Usage.md`,
`GLOSSARY.md` and its German version `GLOSSARY.de.md`, the skills, and the skill examples in
`EXAMPLE.md` and `EXAMPLE.de.md`. The only repo-specific files are `site/_config.yml` (which
also says where the published manifest and the built program are: `manifest:
apps/cli/package.json`, `program: apps/cli/dist/src/cli/program.js`) and
`site/_data/project.yml` (the German intro and the access requirements); the rest of `site/` is
identical in every maschinenlesbar.org CLI, so change it in all of them together. When the
README intro changes, update the German intro in `site/_data/project.yml`.

The build also writes `sitemap.xml`: every page in both languages, and `/api/`. Crawlers
find it through `robots.txt` at the root of maschinenlesbar.org, which only the
organisation website can serve; its `site/_data/sites.yml` lists every site's sitemap, so a
new CLI gets a line there.

```bash
npm run build                        # the CLI, for the command reference
cd site && npm ci && bundle install  # once (Node >= 22.12, Ruby 3.4, Bundler)
npm run serve                        # http://127.0.0.1:4000/lobbyregister-cli/
```

## License

Dual-licensed under **[AGPL-3.0-or-later](LICENSE)** or a commercial license — see
**[LICENSING.md](LICENSING.md)**. This project does **not** accept external code
contributions; see **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## The log on stderr

Every diagnostic line on stderr is a log record (`apps/cli/src/cli/log.ts`): a timestamp, a level
(`ERROR`, `WARN`, `INFO`) and a topic, `lobbyregister.<area>`. `--log-format text` (the default)
writes it log4j style, `<ISO 8601 UTC> <LEVEL padded to 5> [<topic>] <message>`;
`--log-format jsonl` writes one JSON object per line with exactly `ts`, `level`, `topic`
and `msg`. A record is always one line: `formatLogRecord` runs `escapeForRecord` over
the message (text) or the whole JSON object (jsonl), which writes CR and LF as `\r`/`\n`,
every other C0 control but TAB, DEL and C1 as `\u00XX`, and U+2028, U+2029 and the bidi
controls as `\uXXXX`, so no text that reaches a record, by whatever path, can split it,
forge another one or steer the terminal. Before that a lone surrogate (half a
character, which jq rejects, stopping the whole stream) becomes U+FFFD (`toWellFormed`),
and a message longer than `MAX_RECORD_MESSAGE` (4000 characters, exported) is cut at a
code point and ends in `… (N more characters)`.
The library's error messages keep a server's line
breaks (`sanitizeServerText` strips only the other controls); the record escapes them. The areas are `cli` (usage errors, commander's messages, unexpected errors), `api` (the API's answers and the notes on them: HTTP errors and the 400 hint, a malformed answer — a `LobbyParseError`: bad JSON, the wrong shape or content type, an unknown charset —, a filter the reply did not echo (the plain `LobbyError`), invalid text replaced with U+FFFD (a WARN through `onWarning`), the ignored `--sort`, a `resultCount` that disagrees, relevance-order paging, a 0 after an unknown filter), `http` (the connection, the cleartext warning) and `output` (a failed write to stdout, and an answer too deeply nested or too large to print: `OutputError` in `shared.ts`, exit 1, whose pretty-print message suggests `--compact` where that prints it). A failed write to stdout other than a closed pipe (`handleOutputErrors`, in the bin shim, outside `run()`) is an ERROR record of `lobbyregister.output` (`Could not write to stdout: …`), and the shim's last-resort `Unexpected error: …` an ERROR of `lobbyregister.cli`, both in the format argv asks for and redacted like the run's log (`processLogger`), and so are Node's own process warnings (`NODE_TLS_REJECT_UNAUTHORIZED=0`), WARN records of `lobbyregister.cli`: the shim installs `installWarningLog`, which removes Node's default `warning` listener and logs `(node) <name>: <message>`. In `defaultDeps` a record waits for stdout (`stderrAfterStdout`): it is held while stdout has a backlog and written, in order, once it is gone, so with `2>&1 |` and a slow reader it never lands inside the data. Code logs through `logOf(deps)` and never writes diagnostics
with `io.err` directly. `run()` builds the logger from argv before commander parses it
(`logFormatFromArgv`, used only for the records of a parse error: it takes the first
`--log-format`, the one `once()` keeps, and skips the value of the program's own value
options, as commander does; a `preAction` hook then sets the format commander parsed, so
`--user-agent --log-format=jsonl` logs text),
so commander's own usage errors are records too: its `error: …` an ERROR of `cli` (a
`(Did you mean …?)` line joined to it), the help it shows after one an INFO record per
line, and a run without a command (or `help` for an unknown one) an ERROR "missing
command: `lobbyregister <subcommand>`" before that help, so every failed run has an ERROR
record (`writeCommanderErr`). A command's own usage error goes through `command.error()`
with commander's `error: ` prefix, so it is the same ERROR. The log is built with the
run's redaction
(`withRedactedOutput`), which replaces a secret in the message only, before it is
escaped: the frame is never touched, and a secret is kept out of the log in either format. `CliDeps.now` makes the timestamps
testable. stdout carries data only. Conformance test P23 checks all of this, and its
body is shared across the *-cli repos.
