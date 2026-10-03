// CLI <-> library parity: the same input through run() and through the library,
// on one recording mock transport, must give the same outcome — both reject before
// any request, or both send the identical request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LobbyregisterClient } from "../src/client/client.js";
import { LobbyValidationError } from "../src/client/errors.js";
import { isBlank, nonEmptyProblem } from "../src/client/validate.js";
import type { Transport } from "../src/client/http.js";
import { parity, type CliOutcome, type LibOutcome } from "./helpers.js";

/** Both sides reject the input as a usage/validation error and send nothing. */
function assertBothReject(cli: CliOutcome, lib: LibOutcome, label: string): void {
  assert.equal(cli.code, 2, `${label}: CLI exit (stderr: ${cli.err})`);
  assert.deepEqual(cli.requests, [], `${label}: CLI requests`);
  assert.equal(lib.ok, false, `${label}: library should reject`);
  if (!lib.ok) assert.ok(lib.error instanceof LobbyValidationError, `${label}: ${String(lib.error)}`);
  assert.deepEqual(lib.requests, [], `${label}: library requests`);
}

/** Both sides succeed and send the identical request URLs. */
function assertSameRequests(cli: CliOutcome, lib: LibOutcome, label: string): void {
  assert.equal(cli.code, 0, `${label}: CLI exit (stderr: ${cli.err})`);
  assert.equal(lib.ok, true, `${label}: library should succeed (${lib.ok ? "" : String(lib.error)})`);
  assert.ok(cli.requests.length > 0, `${label}: CLI sent nothing`);
  assert.deepEqual(
    lib.requests.map((r) => r.url),
    cli.requests.map((r) => r.url),
    label,
  );
}

const client = (t: Transport) => new LobbyregisterClient({ transport: t });

// ---- finding 2: blank q / sort (PAT-9) -----------------------------------------

test("isBlank / nonEmptyProblem: empty and whitespace-only strings are blank", () => {
  for (const v of ["", " ", "   ", "\t", "\n "]) {
    assert.equal(isBlank(v), true, JSON.stringify(v));
    assert.equal(nonEmptyProblem(v), "Expected a non-empty value.");
  }
  for (const v of ["x", " Energie "]) {
    assert.equal(isBlank(v), false);
    assert.equal(nonEmptyProblem(v), undefined);
  }
});

test("parity: a blank query is rejected by both the CLI and the library", async () => {
  for (const q of ["", "   "]) {
    const c = await parity(["--compact", "count", "--", q], (t) => client(t).count(q));
    assertBothReject(c.cli, c.lib, `count ${JSON.stringify(q)}`);
    const s = await parity(["--compact", "search", "--", q], (t) => client(t).search({ q }));
    assertBothReject(s.cli, s.lib, `search ${JSON.stringify(q)}`);
  }
});

test("parity: a blank sort is rejected by both the CLI and the library", async () => {
  for (const sort of ["", "  "]) {
    const r = await parity(["--compact", "search", "Energie", "--sort", sort], (t) =>
      client(t).search({ q: "Energie", sort }),
    );
    assertBothReject(r.cli, r.lib, `sort ${JSON.stringify(sort)}`);
  }
});

test("parity: no query and a real query send the same request on both sides", async () => {
  const none = await parity(["--compact", "count"], (t) => client(t).count());
  assertSameRequests(none.cli, none.lib, "count");
  const some = await parity(["--compact", "search", "Energie", "--sort", "REGISTRATION_DESC"], (t) =>
    client(t).search({ q: "Energie", sort: "REGISTRATION_DESC" }),
  );
  assertSameRequests(some.cli, some.lib, "search Energie");
});
