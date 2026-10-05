// Conformance test P8 + P9 + P13 (fix plan 2026-10-06): a body is decoded by its declared
// charset (P8); a 2xx body without the documented shape is a parse error, never data or
// "nothing found" (P9); every rejected input is the library's validation error, never a raw
// TypeError or RangeError (P13). Shared across the *-cli repos; only the adapter differs.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { HttpResponse } from "../src/client/http.js";

// ---- adapter (per repo) -------------------------------------------------------------
import { LobbyregisterClient as Client } from "../src/client/client.js";
import {
  LobbyError as BaseError,
  LobbyParseError as ParseError,
  LobbyValidationError as ValidationError,
} from "../src/client/errors.js";
/** A call whose answer contains a text field, and how to read that field from the result. */
const textCall = (client: Client): Promise<unknown> => client.search();
const textBody = (text: string): unknown => ({
  resultCount: 1,
  results: [{ registerNumber: "R000001", lobbyistIdentity: { name: text } }],
  searchParameters: {},
});
const readText = (result: unknown): string =>
  ((result as { results: Array<{ lobbyistIdentity: { name: string } }> }).results[0]!).lobbyistIdentity.name;
/** 2xx bodies the call must reject (error envelopes, empty or wrong shapes). */
const malformedBodies: unknown[] = [
  null,
  {},
  "text",
  42,
  [],
  { error: "boom" },
  { resultCount: 1 },
  { results: [] },
  { resultCount: "1", results: [] },
  { resultCount: -1, results: [] },
  { resultCount: 1, results: null },
  { resultCount: 1, results: [null] },
  { resultCount: 1, results: ["R000001"] },
];
/** Library calls with wrong-typed or out-of-range input. */
const never = async (): Promise<HttpResponse> => {
  throw new Error("no request may go out");
};
const c = (): Client => new Client({ transport: never });
const badCalls: Array<[string, () => unknown]> = [
  ["search({ q: 123 })", () => c().search({ q: 123 as unknown as string })],
  ["search({ q: null })", () => c().search({ q: null as unknown as string })],
  ["search({ sort: null })", () => c().search({ sort: null as unknown as string })],
  ["search({ sort: ['NAME_ASC'] })", () => c().search({ sort: ["NAME_ASC"] as unknown as string })],
  ["search({ filters: {…} })", () => c().search({ filters: { attribute: "revolvingdoordata", value: "true" } as never })],
  ["search({ filters: 'x' })", () => c().search({ filters: "revolvingdoordata=true" as never })],
  ["search({ filters: new Set() })", () => c().search({ filters: new Set() as never })],
  ["search({ filters: [null] })", () => c().search({ filters: [null] as never })],
  ["search({ filters: [{ value: true }] })", () => c().search({ filters: [{ attribute: "revolvingdoordata", value: true }] as never })],
  ["search({ allowUnknownFilters: 'yes' })", () => c().search({ allowUnknownFilters: "yes" as unknown as boolean })],
  ["search({ page: '2', pageSize: 2 })", () => c().search({ page: "2" as unknown as number, pageSize: 2 })],
  ["search({ page: 2 })", () => c().search({ page: 2 })],
  ["search({ pageSize: 0 })", () => c().search({ pageSize: 0 })],
  ["search('Energie')", () => c().search("Energie" as never)],
  ["count({ q: 'Energie' })", () => c().count({ q: "Energie" } as unknown as string)],
  ["count(undefined, 'x')", () => c().count(undefined, "revolvingdoordata=true" as never)],
  ["timeoutMs: 'x'", () => new Client({ timeoutMs: "x" as unknown as number })],
  ["timeoutMs: -1", () => new Client({ timeoutMs: -1 })],
  ["maxRetries: 1.5", () => new Client({ maxRetries: 1.5 })],
  ["retryDelayMs: 1e9", () => new Client({ retryDelayMs: 1e9 })],
  ["baseUrl: 5", () => new Client({ baseUrl: 5 as unknown as string })],
  ["userAgent: {}", () => new Client({ userAgent: {} as unknown as string })],
  ["transport: 'x'", () => new Client({ transport: "x" as unknown as never })],
  ["sleep: 5", () => new Client({ sleep: 5 as unknown as never })],
  ["headers: []", () => new Client({ headers: [] as unknown as Record<string, string> })],
  ["headers: { X: 5 }", () => new Client({ headers: { X: 5 } as unknown as Record<string, string> })],
];
// --------------------------------------------------------------------------------------

const respond = (body: Buffer, contentType: string) => async (): Promise<HttpResponse> => ({
  status: 200,
  headers: { "content-type": contentType },
  body,
});

test("P8: a body is decoded by its declared charset", async () => {
  const text = "Müller µg/l";
  for (const [charset, encoding] of [["iso-8859-1", "latin1"], ["utf-8", "utf8"]] as const) {
    const body = Buffer.from(JSON.stringify(textBody(text)), encoding);
    const client = new Client({ transport: respond(body, `application/json; charset=${charset}`) });
    assert.equal(readText(await textCall(client)), text, charset);
  }
});

test("P9: a 2xx body without the documented shape is a parse error", async () => {
  for (const body of malformedBodies) {
    const client = new Client({ transport: respond(Buffer.from(JSON.stringify(body)), "application/json"), maxRetries: 0 });
    await assert.rejects(textCall(client), ParseError, `body ${JSON.stringify(body)}`);
  }
  for (const raw of ["", "<html>maintenance</html>"]) {
    const client = new Client({ transport: respond(Buffer.from(raw), "text/html"), maxRetries: 0 });
    await assert.rejects(textCall(client), BaseError, `raw ${JSON.stringify(raw)}`);
  }
});

test("P13: every rejected input is the validation error, never a raw TypeError", async () => {
  for (const [label, fn] of badCalls) {
    await assert.rejects(async () => fn(), (e: unknown) => e instanceof ValidationError, label);
  }
});
