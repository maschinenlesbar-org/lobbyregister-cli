// Rendering the JSON output (renderJson in src/cli/shared.ts): a deep answer, a huge string,
// the characters a terminal acts on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli/run.js";
import { renderJson } from "../src/cli/shared.js";
import type { CliDeps } from "../src/cli/io.js";
import { LobbyregisterClient } from "@maschinenlesbar.org/lobbyregister-client/internal/client";
import type { HttpRequest, HttpResponse } from "@maschinenlesbar.org/lobbyregister-client/internal/http";
import { jsonResponse, makeMockTransport, untimed } from "./helpers.js";

function makeCli(responder: (req: HttpRequest) => HttpResponse = () => jsonResponse({ resultCount: 0, results: [] })) {
  const out: string[] = [];
  const err: string[] = [];
  const mt = makeMockTransport(responder);
  const deps: CliDeps = {
    io: { out: (s) => out.push(s), err: (s) => err.push(untimed(s)) },
    createClient: (opts) => new LobbyregisterClient({ ...opts, transport: mt.transport }),
  };
  return { deps, out, err, mt };
}

test("pretty-printing an answer nested too deeply is a clean error that suggests --compact", async () => {
  // A hostile or broken answer: JSON.parse reads it, the pretty printer's recursion can't.
  const depth = 200_000;
  const cli = makeCli(() => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: Buffer.from(`{"resultCount":1,"results":[{"x":${"[".repeat(depth)}${"]".repeat(depth)}}]}`),
  }));
  assert.equal(await run(["search", "Energie"], cli.deps), 1);
  assert.deepEqual(cli.out, []);
  assert.deepEqual(cli.err, ["ERROR [lobbyregister.output] The answer is nested too deeply to pretty-print; try --compact."]);
});

test("--compact takes the gap path only for an answer holding a huge string, the fast path otherwise", (t) => {
  // On Node 26 V8's fast stringifier (no gap) aborts the process on a ~250 MB string that
  // JSON.parse made ("Zone Allocation failed", exit 134); the gap path prints it. Only the fast
  // path is iterative there, though, and prints nesting the gap path refuses at ~7,000 levels.
  // So the path is chosen per answer. Too big a body for this suite: this pins the calls.
  const { deps, out } = makeCli();
  const stringify = t.mock.method(JSON, "stringify", () => '"stub"');
  const huge = "x".repeat(64 * 1024 * 1024);
  renderJson(deps, { compact: true }, { id: "a1", text: huge });
  renderJson(deps, { compact: true }, { id: "a1", x: [[["Rede"]]], text: huge.slice(1) });
  renderJson(deps, { compact: true }, { [huge]: 1 });
  renderJson(deps, { compact: true }, [[huge]]);
  renderJson(deps, {}, { id: "a1" });
  const calls = stringify.mock.calls.map((call) => call.arguments);
  stringify.mock.restore();
  assert.deepEqual(calls.map((args) => (args.length >= 3 ? args[2] : "none")), ["", "none", "", "", 2]);
  assert.deepEqual(out, ['"stub"', '"stub"', '"stub"', '"stub"', '"stub"']);
});

test("the bidi controls in server data are escaped in the JSON output, pretty and compact", async () => {
  // JSON.stringify leaves them raw; a terminal reorders the text after them ("Trojan Source").
  const bidi = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
  const served = { resultCount: 1, results: [{ name: `Verband ${String.fromCharCode(...bidi)} e.V.` }] };
  for (const format of [[], ["--compact"]]) {
    const cli = makeCli(() => jsonResponse(served));
    assert.equal(await run([...format, "search", "Energie"], cli.deps), 0);
    const text = cli.out.join("\n");
    assert.deepEqual([...text].filter((c) => bidi.includes(c.charCodeAt(0))), [], format.join(" "));
    assert.match(text, /\\u202e/);
    assert.ok(text.includes("\\u061c\\u200e\\u200f\\u202a\\u202b\\u202c\\u202d\\u202e\\u2066\\u2067\\u2068\\u2069"));
    assert.deepEqual(JSON.parse(text), served);
  }
});
