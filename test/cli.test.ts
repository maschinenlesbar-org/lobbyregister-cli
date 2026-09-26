import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli/run.js";
import { LobbyregisterClient } from "../src/client/client.js";
import type { CliDeps } from "../src/cli/io.js";
import type { HttpRequest, HttpResponse } from "../src/client/http.js";
import { LobbyNetworkError } from "../src/client/errors.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";

function makeCli(responder: (req: HttpRequest) => HttpResponse) {
  const out: string[] = [];
  const err: string[] = [];
  const mt = makeMockTransport(responder);

  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
    },
    createClient: (opts) => new LobbyregisterClient({ ...opts, transport: mt.transport }),
  };
  return { deps, out, err, mt };
}

test("search passes the query and pageSize", async () => {
  const cli = makeCli(() => jsonResponse({ resultCount: 1, results: [{ id: "e1" }] }));
  const code = await run(["search", "Energie", "--page-size", "5"], cli.deps);
  assert.equal(code, 0);
  const url = new URL(cli.mt.last().url);
  assert.equal(url.pathname, "/sucheJson");
  assert.equal(url.searchParams.get("q"), "Energie");
  assert.equal(url.searchParams.get("pageSize"), "5");
});

test("--results-only prints just the results array", async () => {
  const cli = makeCli(() => jsonResponse({ resultCount: 1, results: [{ id: "e1" }] }));
  await run(["--compact", "search", "Energie", "--results-only"], cli.deps);
  assert.deepEqual(JSON.parse(cli.out.join("\n")), [{ id: "e1" }]);
});

test("count prints the resultCount", async () => {
  const cli = makeCli(() => jsonResponse({ resultCount: 99, results: [{}] }));
  await run(["--compact", "count", "Energie"], cli.deps);
  assert.deepEqual(JSON.parse(cli.out.join("\n")), { query: "Energie", resultCount: 99 });
});

test("DEL and C1 control characters in server data are escaped in the JSON output", async () => {
  const controls = String.fromCharCode(0x7f, 0x85, 0x9b) + "2J";
  const served = { resultCount: 1, results: [{ id: "e1", name: `Verband${controls}`, city: String.fromCharCode(0x1b) + "[31m" }] };
  for (const format of [[], ["--compact"]]) {
    const cli = makeCli(() => jsonResponse(served));
    assert.equal(await run([...format, "search", "Energie"], cli.deps), 0);
    const text = cli.out.join("\n");
    const raw = [...text].filter((c) => c.charCodeAt(0) < 0x20 ? c !== "\n" : c.charCodeAt(0) >= 0x7f && c.charCodeAt(0) <= 0x9f);
    assert.deepEqual(raw, [], format.join(" "));
    assert.match(text, /Verband\\u007f\\u0085\\u009b2J/);
    assert.deepEqual(JSON.parse(text), served);
  }
});

test("search forwards --page, --page-size and --sort to the API", async () => {
  const cli = makeCli(() => jsonResponse({ resultCount: 0, results: [] }));
  const code = await run(
    ["search", "Energie", "--page", "3", "--page-size", "5", "--sort", "REGISTRATION_DESC"],
    cli.deps,
  );
  assert.equal(code, 0);
  const url = new URL(cli.mt.last().url);
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("pageSize"), "5");
  assert.equal(url.searchParams.get("sort"), "REGISTRATION_DESC");
});

test("--page without --page-size is a usage error (exit 2)", async () => {
  const cli = makeCli(() => jsonResponse({ resultCount: 20, results: [] }));
  const code = await run(["search", "x", "--page", "2"], cli.deps);
  assert.equal(code, 2);
  assert.match(cli.err.join("\n"), /--page requires --page-size/);
});

test("--page-size alone slices the first page client-side", async () => {
  const results = Array.from({ length: 20 }, (_, i) => ({ n: i }));
  const cli = makeCli(() => jsonResponse({ resultCount: 20, results }));
  await run(["--compact", "search", "x", "--page-size", "5", "--results-only"], cli.deps);
  const printed = JSON.parse(cli.out.join("\n"));
  assert.equal(printed.length, 5);
  assert.deepEqual(printed[0], { n: 0 });
});

test("--page with --page-size slices the requested page client-side", async () => {
  const results = Array.from({ length: 20 }, (_, i) => ({ n: i }));
  const cli = makeCli(() => jsonResponse({ resultCount: 20, results }));
  await run(["--compact", "search", "x", "--page", "3", "--page-size", "5", "--results-only"], cli.deps);
  const printed = JSON.parse(cli.out.join("\n"));
  assert.equal(printed.length, 5);
  assert.deepEqual(printed[0], { n: 10 });
});

test("the `help` command and `help <subcommand>` exit 0", async () => {
  for (const argv of [["help"], ["help", "search"], ["help", "count"]]) {
    const cli = makeCli(() => jsonResponse({ resultCount: 0, results: [] }));
    const code = await run(argv, cli.deps);
    assert.equal(code, 0, `expected exit 0 for ${JSON.stringify(argv)}`);
  }
});

test("--help / -h / --version / -V exit 0", async () => {
  for (const argv of [["--help"], ["-h"], ["--version"], ["-V"], ["search", "--help"]]) {
    const cli = makeCli(() => jsonResponse({ resultCount: 0, results: [] }));
    const code = await run(argv, cli.deps);
    assert.equal(code, 0, `expected exit 0 for ${JSON.stringify(argv)}`);
  }
});

test("no command (auto-help) and unknown command/option exit 2", async () => {
  for (const argv of [[], ["frobnicate"], ["search", "x", "--nope"]]) {
    const cli = makeCli(() => jsonResponse({ resultCount: 0, results: [] }));
    const code = await run(argv, cli.deps);
    assert.equal(code, 2, `expected exit 2 for ${JSON.stringify(argv)}`);
  }
});

test("a near-miss command or option suggests the closest match", async () => {
  const cmd = makeCli(() => jsonResponse({ resultCount: 0, results: [] }));
  assert.equal(await run(["serch", "x"], cmd.deps), 2);
  assert.match(cmd.err.join("\n"), /Did you mean search\?/);

  const opt = makeCli(() => jsonResponse({ resultCount: 0, results: [] }));
  assert.equal(await run(["search", "x", "--sory", "X"], opt.deps), 2);
  assert.match(opt.err.join("\n"), /Did you mean --sort\?/);
});

test("a 404 from the API maps to exit code 4", async () => {
  const cli = makeCli(() => jsonResponse({}, 404));
  const code = await run(["search", "x"], cli.deps);
  assert.equal(code, 4);
});

test("a 400 (e.g. an invalid --sort) maps to exit 1 with a hint", async () => {
  const cli = makeCli(() => jsonResponse({}, 400));
  const code = await run(["search", "x", "--sort", "BOGUS"], cli.deps);
  assert.equal(code, 1);
  const stderr = cli.err.join("\n");
  assert.match(stderr, /HTTP 400/);
  assert.match(stderr, /--sort/);
});

test("a 400 with an API detail surfaces the detail (no generic hint)", async () => {
  const cli = makeCli(() => jsonResponse({ detail: "invalid sort value" }, 400));
  const code = await run(["search", "x", "--sort", "BOGUS"], cli.deps);
  assert.equal(code, 1);
  const stderr = cli.err.join("\n");
  assert.match(stderr, /invalid sort value/);
});

test("a network error maps to exit code 1", async () => {
  const cli = makeCli(() => {
    throw new LobbyNetworkError("connection reset");
  });
  const code = await run(["search", "x"], cli.deps);
  assert.equal(code, 1);
  assert.match(cli.err.join("\n"), /connection reset/);
});

test("an unparseable JSON body maps to exit code 1", async () => {
  const cli = makeCli(() => rawResponse("not json", "application/json"));
  const code = await run(["search", "x"], cli.deps);
  assert.equal(code, 1);
  assert.match(cli.err.join("\n"), /parse/i);
});

test("a blank query or --sort is a usage error, before any request", async () => {
  const cases: [string, string[]][] = [
    ["search query", ["search", ""]],
    ["search query (whitespace)", ["search", "   "]],
    ["search --sort", ["search", "Energie", "--sort", ""]],
    ["search --sort (whitespace)", ["search", "Energie", "--sort", " \t"]],
    ["count query", ["count", ""]],
    ["count query (whitespace)", ["count", "  "]],
  ];
  for (const [label, argv] of cases) {
    const cli = makeCli(() => jsonResponse({ resultCount: 0, results: [] }));
    const code = await run(argv, cli.deps);
    assert.notEqual(code, 0, label);
    assert.equal(cli.mt.calls.length, 0, `${label}: no request`);
  }
});

test("--timeout accepts the largest timer Node supports and rejects one above it", async () => {
  const ok = makeCli(() => jsonResponse({ resultCount: 0, results: [] }));
  assert.equal(await run(["--timeout", "2147483647", "count"], ok.deps), 0);
  assert.equal(ok.mt.last().timeoutMs, 2147483647);

  const tooBig = makeCli(() => jsonResponse({ resultCount: 0, results: [] }));
  const code = await run(["--timeout", "2147483648", "count"], tooBig.deps);
  assert.notEqual(code, 0);
  assert.equal(tooBig.mt.calls.length, 0);
  assert.match(tooBig.err.join("\n"), /Must be <= 2147483647\./);
});

test("a non-http(s) or malformed --base-url is a usage error before any request", async () => {
  for (const bad of ["file:///etc/passwd", "ftp://example.org", "notaurl"]) {
    const cli = makeCli(() => jsonResponse({ resultCount: 0, results: [] }));
    const code = await run(["--base-url", bad, "search", "Energie"], cli.deps);
    assert.equal(code, 2, bad);
    assert.equal(cli.mt.calls.length, 0, `${bad}: no request may reach the transport`);
    assert.match(cli.err.join("\n"), /--base-url/, bad);
  }
});

/** A /sucheJson stand-in that echoes the facet filters it received, as the live API does. */
function echoFacets(req: HttpRequest): HttpResponse {
  const facets: { attribute: string; value: string }[] = [];
  for (const key of new URL(req.url).searchParams.keys()) {
    const m = /^filter\[([^\]]+)\]\[([^\]]+)\]$/.exec(key);
    if (m) facets.push({ attribute: m[1]!, value: m[2]! });
  }
  return jsonResponse({ resultCount: 680, results: [], searchParameters: { facets } });
}

test("--filter sends register facet filters, repeatable, on search and count", async () => {
  const search = makeCli(echoFacets);
  const code = await run(
    ["search", "Energie", "--filter", "revolvingdoordata=true", "--filter", "RevolvingDoorPersonTypes=ENTRUSTED_PERSON", "--filter", "fieldsofinterest=FOI_WORK|FOI_WORK_POLICY"],
    search.deps,
  );
  assert.equal(code, 0, search.err.join("\n"));
  const params = new URL(search.mt.last().url).searchParams;
  assert.equal(params.get("filter[revolvingdoordata][true]"), "true");
  assert.equal(params.get("filter[revolvingdoorpersontypes][ENTRUSTED_PERSON]"), "true");
  assert.equal(params.get("filter[fieldsofinterest][FOI_WORK|FOI_WORK_POLICY]"), "true");
  assert.equal(params.get("q"), "Energie");

  const count = makeCli(echoFacets);
  assert.equal(await run(["--compact", "count", "--filter", "revolvingdoordata=true"], count.deps), 0);
  assert.deepEqual(JSON.parse(count.out.join("\n")), {
    query: null,
    filters: ["revolvingdoordata=true"],
    resultCount: 680,
  });
});

test("a malformed or unknown --filter is a usage error before any request", async () => {
  const cases: [string, RegExp][] = [
    ["revolvingdoor=true", /Unknown filter "revolvingdoor"\. The register ignores unknown filters/],
    ["revolvingdoordata", /expected attribute=value/],
    ["=true", /expected attribute=value/],
    ["revolvingdoordata= ", /expected attribute=value/],
    ["revolvingdoordata=a]b", /Invalid value "a\]b" for filter "revolvingdoordata"/],
    ["--nope", /Expected a value, got another option/],
  ];
  for (const [value, message] of cases) {
    for (const command of ["search", "count"]) {
      const cli = makeCli(echoFacets);
      const code = await run([command, "--filter", value], cli.deps);
      assert.equal(code, 2, `${command} --filter ${value}`);
      assert.equal(cli.mt.calls.length, 0, `${command} --filter ${value}: no request`);
      assert.match(cli.err.join("\n"), message, `${command} --filter ${value}`);
    }
  }
});

test("a filter the reply does not echo exits 1 instead of printing an unfiltered set", async () => {
  const cli = makeCli(() => jsonResponse({ resultCount: 6989, results: [], searchParameters: { facets: [] } }));
  const code = await run(["count", "--filter", "revolvingdoordata=true"], cli.deps);
  assert.equal(code, 1);
  assert.deepEqual(cli.out, []);
  assert.match(cli.err.join("\n"), /The register ignored the filter "revolvingdoordata=true"/);
});

test("paging in relevance order warns on stderr that pages across runs are unstable", async () => {
  const results = Array.from({ length: 20 }, (_, i) => ({ n: i }));
  const relevance = makeCli(() =>
    jsonResponse({ resultCount: 20, results, searchParameters: { sortOrder: "RELEVANCE_DESC" } }),
  );
  assert.equal(await run(["search", "x", "--page-size", "5", "--page", "2"], relevance.deps), 0);
  assert.match(relevance.err.join("\n"), /^Note: the results are in relevance order \(RELEVANCE_DESC\).*--sort REGISTRATION_DESC/);

  const byDate = makeCli(() =>
    jsonResponse({ resultCount: 20, results, searchParameters: { sortOrder: "REGISTRATION_DESC" } }),
  );
  assert.equal(await run(["search", "x", "--page-size", "5", "--sort", "REGISTRATION_DESC"], byDate.deps), 0);
  assert.deepEqual(byDate.err, []);

  const unpaged = makeCli(() => jsonResponse({ resultCount: 20, results, searchParameters: { sortOrder: "RELEVANCE_DESC" } }));
  assert.equal(await run(["search", "x"], unpaged.deps), 0);
  assert.deepEqual(unpaged.err, []);
});
