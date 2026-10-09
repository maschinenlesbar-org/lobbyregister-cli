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
request (`count` too). Omit `q` to match everything. `count` downloads the whole set
too — there is no count-only request.

`filters` are the facet filters of the register's website search, sent as
`filter[<attribute>][<value>]=true` (`src/client/filters.ts`). Each filter is first
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
flag works wherever it stands. `search()` also rejects a parameter key it doesn't take
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

```
src/
  client/
    types.ts     # SearchResult envelope + SearchParams (entries kept as JsonObject)
    filters.ts   # facet filters: attribute allowlist, query keys, echo check
    query.ts     # dependency-free query-string builder
    http.ts      # the Transport interface + default node:http/https transport
    engine.ts    # URL building, retry/backoff, redirects (with cross-origin credential stripping), JSON decoding, error mapping
    errors.ts    # LobbyError / LobbyApiError / LobbyNetworkError / LobbyParseError / LobbyValidationError
    validate.ts  # Problem type + assertValid: the input rules the library and CLI share
    client.ts    # LobbyregisterClient — search + count over the engine
  cli/
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
  timeout — whatever a custom transport throws —, an invalid transport response, a
  body over `maxResponseBytes`). A bad configured `baseUrl` is a
  `LobbyValidationError` instead.
- **`LobbyParseError`** — the body could not be parsed as the expected JSON, or
  had an unexpected content type.
- **`LobbyValidationError`** — a rejected input: a client option or method argument
  that breaks one of the library's rules. Thrown before any request is made (a
  method rejects, the constructor throws), with the message
  `Invalid <name>: <reason>`. The CLI maps it to its usage exit code `2`.

**Input validation** ([`validate.ts`](src/client/validate.ts)). Every rule about what
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

**maxResponseBytes.** A hard cap on response body size (default 100 MiB; `0` =
unlimited) guarding against memory exhaustion from a hostile or buggy endpoint.
CLI: `--max-response-bytes`. The default transport aborts as soon as the cap is
passed; the engine also checks the body any transport returns, so the cap holds for
custom transports too. The message names both the option and the flag.

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
An unknown charset label is a `LobbyParseError`. The register itself sends UTF-8.

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
npm test          # builds, then runs `node --test` over dist/test
```

- **`query.test.ts`** — query-string serialisation.
- **`http.test.ts`** — the default transport against a real loopback `http.createServer`.
- **`engine.test.ts`** — URL building, JSON decoding, error mapping, 429/503 retry (incl. `maxRetries: 0`), same-/cross-origin redirects (cross-origin credential stripping), missing-`Location` handling — mocked transport.
- **`client.test.ts`** — the search URL/param mapping, blank-query and blank-sort rejection and the `count` helper — mocked transport.
- **`validate.test.ts`** — `assertValid`, the `LobbyValidationError` -> exit `2` mapping, and the `parity()` helper (`test/helpers.ts`), which sends one input through `run()` and through the library on one recording mock transport.
- **`parity.test.ts`** — CLI <-> library parity: each input runs through the CLI and the library on one mock transport, and both must reject before any request or send the identical request.
- **`log.test.ts`** — the record helpers of `src/cli/log.ts` on their own
  (`escapeForRecord`, `formatLogRecord`); the CLI-level checks are P23's.
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
  before the client is built; no base-URL variable and no secret here, so those two cases
  are skipped, and so is the credentials case, since a base URL with credentials is a usage
  error here — a lobbyregister case at the end checks that instead) and P21 (`conformance-p21-readme-links`: every relative link in `README.md`
  points to a file `package.json` `files` ships, since npmjs.com shows the README; other
  documents are linked by their GitHub URL). P23 (`conformance-p23-log-format`, 2026-10-09)
  checks that every stderr line is a log record and `--log-format text|jsonl`.

## Continuous integration

GitHub Actions workflows under `.github/workflows/`:

- **ci.yml** — type-check, build and test on Node 22/24 for every push and PR.
- **release.yml** — on a `v*` tag: verify the tag matches `package.json`, test, `npm pack`, generate CycloneDX SBOMs (production and full graph), and create a GitHub Release with the tarball and SBOMs.
- **publish.yml** — manual dispatch from the release tag (`gh workflow run publish.yml --ref vX.Y.Z`; the version is the tag's): publish to npm via OIDC **Trusted Publishing** (no stored `NPM_TOKEN`) with provenance.
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

The project website — <https://maschinenlesbar-org.github.io/lobbyregister-cli/> in English and
<https://maschinenlesbar-org.github.io/lobbyregister-cli/de/> in German — is built from `site/`
with [Jekyll](https://jekyllrb.com/), [banira](https://sebs.github.io/banira/) web components
and [Fylgja](https://fylgja.dev/) CSS, and deployed by `docs.yml` together with the TypeDoc API
reference under `/api/`. Its content comes from this repository: the README intro and quick
start, the command tree of the built CLI (`site/scripts/cli-reference.mjs`), `Usage.md`,
`GLOSSARY.md` and its German version `GLOSSARY.de.md`, the skills, and the skill examples in
`EXAMPLE.md` and `EXAMPLE.de.md`. The only repo-specific files are `site/_config.yml` and
`site/_data/project.yml` (the German intro and the access requirements); the rest of `site/` is
identical in every maschinenlesbar.org CLI, so change it in all of them together. When the
README intro changes, update the German intro in `site/_data/project.yml`.

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

Every diagnostic line on stderr is a log record (`src/cli/log.ts`): a timestamp, a level
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
breaks (`sanitizeServerText` strips only the other controls); the record escapes them. The areas are `cli` (usage errors, commander's messages, unexpected errors), `api` (the API's answers and the notes on them: HTTP errors and the 400 hint, the ignored `--sort`, a `resultCount` that disagrees, relevance-order paging, a 0 after an unknown filter) and `http` (the connection, the cleartext warning). The `Output error:` line `handleOutputErrors` writes when stdout itself fails stays plain. Code logs through `logOf(deps)` and never writes diagnostics
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
