import { test } from "node:test";
import assert from "node:assert/strict";
import { assertValid, type Problem } from "../src/client/validate.js";
import { LobbyError, LobbyValidationError } from "../src/client/errors.js";
import * as lib from "../src/index.js";
import { LobbyregisterClient } from "../src/client/client.js";
import { run } from "../src/cli/run.js";
import type { CliDeps } from "../src/cli/io.js";
import { makeMockTransport, jsonResponse, parity, EMPTY_SEARCH, untimed } from "./helpers.js";

const notBlank: Problem<string> = (v) => (v.trim() === "" ? "Expected a non-empty value." : undefined);

test("assertValid returns a valid value unchanged", () => {
  assert.equal(assertValid("q", "Energie", notBlank), "Energie");
});

test("assertValid throws LobbyValidationError with 'Invalid <name>: <reason>'", () => {
  assert.throws(
    () => assertValid("q", "  ", notBlank),
    (err: unknown) =>
      err instanceof LobbyValidationError &&
      err instanceof LobbyError &&
      err.name === "LobbyValidationError" &&
      err.message === "Invalid q: Expected a non-empty value.",
  );
});

test("the library root exports LobbyValidationError and assertValid", () => {
  assert.equal(lib.LobbyValidationError, LobbyValidationError);
  assert.equal(lib.assertValid, assertValid);
});

test("run() maps a LobbyValidationError from an action to exit 2 and an ERROR record", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const mt = makeMockTransport(() => jsonResponse(EMPTY_SEARCH));
  const deps: CliDeps = {
    io: { out: (s) => out.push(s), err: (s) => err.push(s) },
    createClient: (opts) => {
      const client = new LobbyregisterClient({ ...opts, transport: mt.transport });
      // `count` runs client.search() (it keeps the envelope to compare resultCount).
      client.search = async () => {
        throw new LobbyValidationError("Invalid q: Expected a non-empty value.");
      };
      return client;
    },
  };
  const code = await run(["count", "Energie"], deps);
  assert.equal(code, 2);
  assert.deepEqual(err.map(untimed), ["ERROR [lobbyregister.cli] Invalid q: Expected a non-empty value."]);
  assert.deepEqual(out, []);
  assert.equal(mt.calls.length, 0);
});

test("run() keeps exit 1 for a plain LobbyError, an ERROR of lobbyregister.api", async () => {
  const err: string[] = [];
  const deps: CliDeps = {
    io: { out: () => {}, err: (s) => err.push(s) },
    createClient: (opts) => {
      // A transport that fails loudly: should the stub ever miss, no request goes out.
      const client = new LobbyregisterClient({
        ...opts,
        transport: async () => {
          throw new Error("no network in tests");
        },
      });
      client.search = async () => {
        throw new LobbyError("boom");
      };
      return client;
    },
  };
  assert.equal(await run(["count"], deps), 1);
  // The library's plain LobbyError is the register's answer not matching the request (a
  // filter it did not echo): `api`, like a malformed answer (2026-10-09, L9).
  assert.deepEqual(err.map(untimed), ["ERROR [lobbyregister.api] boom"]);
});

test("parity() sends the same input through the CLI and the library on one transport", async () => {
  const { cli, lib: libOutcome } = await parity(["--compact", "count", "Energie"], (t) =>
    new LobbyregisterClient({ transport: t }).count("Energie"),
  );
  assert.equal(cli.code, 0);
  assert.deepEqual(JSON.parse(cli.out), { query: "Energie", resultCount: 0 });
  assert.equal(libOutcome.ok, true);
  assert.deepEqual(
    libOutcome.requests.map((r) => r.url),
    cli.requests.map((r) => r.url),
  );
  assert.equal(cli.requests.length, 1);
});
