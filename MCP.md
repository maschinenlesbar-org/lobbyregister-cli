# lobbyregister-mcp

An [MCP](https://modelcontextprotocol.io/) server for the
[Lobbyregister](https://www.lobbyregister.bundestag.de) of the German Bundestag, the statutory
register of everyone who lobbies the Bundestag or the federal government (about 7,000 entries:
declared lobbying spend, staff, statements, regulatory projects, contracts, fields of interest,
recent public offices), as tools for AI agents. Read-only, no API key. The data is published under
§ 4 Abs. 2 LobbyRG with no open licence (see Licence).

It is the MCP side of [lobbyregister-cli](https://github.com/maschinenlesbar-org/lobbyregister-cli),
built on the same typed client, and released with it.

## Install

```bash
npm i -g @maschinenlesbar.org/lobbyregister-mcp
```

This installs the **`lobbyregister-mcp`** command (Node.js 22.12+). Or run the container
image, for linux/amd64 and linux/arm64, which needs no Node.js:

```bash
docker run -i --rm ghcr.io/maschinenlesbar-org/lobbyregister-mcp:latest
```

## Connect a client

The server speaks MCP on stdio by default.

**Claude Code**

```bash
claude mcp add lobbyregister -- lobbyregister-mcp
# or with the image:
claude mcp add lobbyregister -- docker run -i --rm ghcr.io/maschinenlesbar-org/lobbyregister-mcp:latest
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{ "mcpServers": { "lobbyregister": { "command": "lobbyregister-mcp" } } }
```

**VS Code** (`.vscode/mcp.json`)

```json
{ "servers": { "lobbyregister": { "type": "stdio", "command": "lobbyregister-mcp" } } }
```

**Over HTTP** (Streamable HTTP, one endpoint `POST /mcp`):

```bash
lobbyregister-mcp --transport http            # http://127.0.0.1:3000/mcp
claude mcp add --transport http lobbyregister http://127.0.0.1:3000/mcp
```

In a container, publish the port on loopback only:
`docker run --rm -p 127.0.0.1:3000:3000 ghcr.io/maschinenlesbar-org/lobbyregister-mcp:latest --transport http --host 0.0.0.0 --allowed-hosts localhost,127.0.0.1`.

For scripts and shared configs, pin a release and its digest from the
[release notes](https://github.com/maschinenlesbar-org/lobbyregister-cli/releases) instead of
`latest`: `…/lobbyregister-mcp:<version>@sha256:<digest>`. Check an image's provenance with
`gh attestation verify oci://ghcr.io/maschinenlesbar-org/lobbyregister-mcp:<version> --repo maschinenlesbar-org/lobbyregister-cli`.

## Tools

| Tool | What it answers |
|---|---|
| `profileSector` | Who lobbies on a topic: how many, the actor mix, the top declared spenders, the commonest fields of interest, the flags (code-of-conduct violations, a lobbyist's own former office). |
| `rankBySpend` | The league table of declared lobbying spend, highest euro band first; €0 declared, no figure yet and refused said apart (the last two ranked after €0), the fiscal years named, inactive entries left out and counted. |
| `rankByEngagement` | Ranked by statements filed, regulatory projects or lobbying contracts, the other two alongside. |
| `findNewEntrants` | Arrivals (first published) and departures (went inactive) in a window, with the net change. |
| `findRevolvingDoor` | Entries recording a recent public office of one of their people, as "N of M"; the lobbyist's own office read per institution, the rest pointed to the register page; `offset` pages both lists. |
| `countEntries` | How many distinct entries per German term (up to five) or in the whole register, active ones apart; its `source` names the search of every term, comma-separated. |
| `searchEntries` | The register's own search by name, word or register number, with facet filters and a sort order. |
| `getEntry` | One entry in full by its register number. |

A topic is a German search term (`Wasserstoff`, not `hydrogen`); it only selects entries, so spend
and counts are each entry's totals across all its topics. Spend is a self-declared euro band, never
a point figure. The register answers every match at once and the whole register is about 18 MB:
the use-case tools fetch it in three parts its own yes/no facets split without overlap, and keep the
newest version of an entry the register returns twice.

Every tool only reads. An answer is JSON (`structuredContent` and the same as text), with the
`source` it came from (whole, never cut like the data; an answer a redirect fetched from another
host says so there: "… (answered by https://other.example after a redirect)", and a WARN record
names both) and the data licence. A text over 2000 characters is cut and ends in `…[cut, N
characters in all]`, and the answer says `truncated`. An answer over `--max-result-chars` first
loses entries from the end of its page (then `nextOffset` says where to go on), then has its longest
texts cut further (each with that mark) or, when that isn't enough, its other lists shortened
(`reason` names them); a list keeps its first entry, `notes` stay whole, and the answer says
`truncated`. One that can't be cut down so far is a tool error that says to ask for less. A failure
is a tool error that says what to change (one over 5000 characters loses its middle, never its end,
where the reason is).

## Options

```
--transport <stdio|http>   stdio (default), or Streamable HTTP on POST /mcp
--host <address>           HTTP: the address to listen on (default 127.0.0.1)
--port <n>                 HTTP: the port (default 3000)
--allowed-hosts <list>     HTTP: Host header names to answer (default localhost,127.0.0.1,[::1])
--allowed-origins <list>   HTTP: browser origins allowed to call, exactly (https://app.example.org); none by default
--auth-token-file <path>   HTTP: a file with the bearer token every request must send (mode 600, 32+ characters)
--base-url <url>           API base URL (default https://www.lobbyregister.bundestag.de)
--timeout <ms>             per upstream request (default 30000)
--call-timeout <ms>        per tool call, retries included (default 45000)
--max-result-chars <n>     cap on one tool result's JSON (default 25000)
--max-pages <n>            pages a tool reads per list and call (default 10)
--user-agent <ua>          User-Agent header value (Latin-1, one line)
--log-format <text|jsonl>  the log records on stderr (default text)
```

## What it does and doesn't do

- **Read-only.** No tool changes anything, here or upstream.
- **No authentication** on HTTP unless you give one. It listens on loopback by default; it checks
  the `Host` header and, from a browser, the `Origin` (only the origins given with
  `--allowed-origins`, matched exactly) against DNS rebinding and other web pages; a page on one of
  those origins gets CORS (its preflight answered, the answers readable). With `--auth-token-file
  <path>` every request must send `Authorization: Bearer <token>` (the file holds one token of at
  least 32 characters, mode 600, owned by the user the server runs as, a regular file (a FIFO is
  refused at once, never waited on); read once at start; `(umask 077; openssl rand -hex 32 >
  mcp-token)` makes one); anything else is answered 401. Exposed beyond localhost (it logs a warning
  then), it belongs behind a proxy that authenticates or at least terminates TLS.
- **Gentle with the upstream.** One server process sends at most 2 requests at a time and 120 a
  minute to the API, pauses the requests to a host that answers HTTP 429 (as long as its Retry-After
  asks, at most 30 s; those to another host go on), and stops a tool call after its deadline (a tool
  that has read part of its answer by then may answer with that part, and says so). A request those
  limits would hold longer than it or its call may wait is not sent: the call fails at once, naming
  the limit and when to ask again (and the log says so). A request that fails after the client's
  retries ends in a tool error that says what to do: try again shortly (a timeout or a reset), in a
  few minutes (HTTP 5xx or 429), later (an answer that isn't the register's JSON).
- **Results are data.** Text from the API, keys included, is cleaned (control, bidi, zero-width, tag
  and other invisible characters removed, but an emoji keeps its joiners; a key that cleaning makes
  equal to another stays, as `name~2`), but it is still other people's text: a model can be told
  things in it. The server can't act on that (it has no tool that writes), but other tools in the
  same session could.
- **Stops cleanly.** On `docker stop` (SIGTERM) or Ctrl-C the HTTP server takes no new connection
  and lets calls in flight answer for up to 5 s, then exits 143 (130); a second signal ends it at
  once. On stdio a signal ends it at once; when stdin ends, it first answers the requests it has
  read (each within its call deadline), then exits.
- **In a container** it needs at least 12 processes and threads (`--pids-limit`) and about
  256 MB of memory.
- **Logs** go to stderr, one record per line; stdout carries only the protocol. A call that fails
  upstream or reaches its deadline leaves a WARN record naming the tool.
- **Never installs anything.**

## Licence

Code: AGPL-3.0-or-later or commercial
([LICENSING.md](https://github.com/maschinenlesbar-org/lobbyregister-cli/blob/main/LICENSING.md)).
Data: the register is published as statutory machine-readable open data (§ 4 Abs. 2
Lobbyregistergesetz) but with no open licence: the Bundestag's terms apply, which allow download
and print for private use and prohibit commercial use; official works are to be used unaltered and
with the source (§§ 62, 63 UrhG). Entries hold personal data (the GDPR applies to any reuse) and
may cite third-party copyrighted documents
([Impressum](https://www.bundestag.de/impressum),
[copyright notice](https://www.lobbyregister.bundestag.de/informationen-und-hilfe/hinweise-zum-urheberrecht),
[DATA_LICENSE.md](https://github.com/maschinenlesbar-org/lobbyregister-cli/blob/main/DATA_LICENSE.md)).
Every result carries this note in its `licence` field, with the register's date (`sourceDate`) and
each entry's register page (`url`) to cite. We provide the tool, not the data: running the server
as a service for others may need the provider's permission.
