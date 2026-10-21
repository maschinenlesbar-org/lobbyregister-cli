// Compile-time checks of the exported library types: every optional field of an option
// interface takes `undefined`, as the runtime treats it as omitted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LobbyregisterClient, filterQuery, parseFilter } from "../src/index.js";
import { constantJson } from "./helpers.js";

// Runs the TypeScript compiler over a consumer file.
const STARTS_A_PROCESS = { timeout: 30_000 };
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const INDEX = fileURLToPath(new URL("../src/index.js", import.meta.url));

test("a consumer with the strictest compiler settings can pass undefined for any option", STARTS_A_PROCESS, async () => {
  // Under exactOptionalPropertyTypes, `{ baseUrl: process.env.X }` fails to compile against an
  // option declared `?: string`, although the runtime treats undefined as omitted.
  const dir = mkdtempSync(join(tmpdir(), "lobbyregister-types-"));
  try {
    writeFileSync(
      join(dir, "use.ts"),
      [
        `import { LobbyregisterClient, LobbyApiError, filterQuery, parseFilter, type EngineOptions, type SearchParams } from ${JSON.stringify(INDEX)};`,
        "declare function allUndefined<T>(): { [K in keyof T]-?: undefined };",
        "export const options: EngineOptions = allUndefined<EngineOptions>();",
        "export const params: SearchParams = allUndefined<SearchParams>();",
        "export const client = new LobbyregisterClient({ baseUrl: process.env.LOBBYREGISTER_BASE_URL, timeoutMs: 15_000 });",
        "export const page = client.search({ q: process.env.Q, sort: process.env.SORT, page: undefined, pageSize: undefined });",
        "export const count = client.count(undefined, undefined, { allowUnknownFilters: undefined });",
        "export const filter = parseFilter('revolvingdoordata=true', { allowUnknown: undefined });",
        "export const query = filterQuery([filter], { allowUnknown: undefined });",
        "export const error = new LobbyApiError({ status: 500, url: 'https://x.test/', method: 'GET', body: '', detail: undefined, location: undefined, hint: undefined });",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          noEmit: true,
          skipLibCheck: false,
          types: ["node"],
          typeRoots: [join(ROOT, "node_modules/@types")],
        },
        files: ["use.ts"],
      }),
    );
    const tsc = join(ROOT, "node_modules/typescript/bin/tsc");
    const result = await new Promise<{ code: number; out: string }>((resolve) => {
      execFile(process.execPath, [tsc, "-p", join(dir, "tsconfig.json")], (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout + stderr }),
      );
    });
    assert.equal(result.code, 0, result.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an option given as undefined means its default, as an omitted one does", async () => {
  const mt = constantJson({ resultCount: 0, results: [] });
  const client = new LobbyregisterClient({
    baseUrl: undefined,
    userAgent: undefined,
    headers: undefined,
    timeoutMs: undefined,
    maxRetries: undefined,
    retryDelayMs: undefined,
    maxRedirects: undefined,
    maxResponseBytes: undefined,
    sleep: undefined,
    onRetry: undefined,
    onWarning: undefined,
    bigIntegerKeys: undefined,
    transport: mt.transport,
  });
  await client.search({
    q: undefined,
    page: undefined,
    pageSize: undefined,
    sort: undefined,
    filters: undefined,
    allowUnknownFilters: undefined,
  });
  assert.equal(mt.last().url, "https://www.lobbyregister.bundestag.de/sucheJson");
  assert.equal(mt.last().headers?.["User-Agent"], "lobbyregister-cli");
  assert.equal(mt.last().timeoutMs, 30_000);
  assert.equal(await client.count(undefined, undefined, { allowUnknownFilters: undefined }), 0);
  assert.deepEqual(parseFilter("revolvingdoordata=true", { allowUnknown: undefined }), {
    attribute: "revolvingdoordata",
    value: "true",
  });
  // allowUnknown: undefined is off, as omitted: an unknown attribute is still refused.
  assert.throws(() => filterQuery([{ attribute: "nosuch", value: "x" }], { allowUnknown: undefined }));
});
