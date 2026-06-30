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
