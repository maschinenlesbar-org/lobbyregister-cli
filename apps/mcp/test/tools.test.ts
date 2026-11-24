// This server's tools against a mock of the register (the client's live-shaped entries), with the
// skills' traps as cases: each tool answers through the protocol (its structuredContent checked by
// the SDK against its output schema), a set is fetched in parts and the newest version of an entry
// kept, spend is a band, rankings leave the inactive out and say so, newcomers are keyed on the first
// publication, the revolving door is "N of M", an English term is empty with the German hint, and
// every result carries the source, the licence and the register's date.
// The rules every server follows are the conformance tests (M1–M10).

import { test } from "node:test";
import assert from "node:assert/strict";
import { listTools } from "../src/mcp/server.js";
import { TOOLS } from "../src/mcp/tools.js";
import { connect } from "./harness.js";
import { register } from "./helpers.js";

const BASE = "https://www.lobbyregister.bundestag.de";

test("eight tools: the five use cases, then the count, the search and one entry", () => {
  assert.deepEqual(listTools().map((t) => t.name), ["profileSector", "rankBySpend", "rankByEngagement", "findNewEntrants", "findRevolvingDoor", "countEntries", "searchEntries", "getEntry"]);
});

test("profileSector: the briefing of a topic, with the source, the register's date and the licence", async () => {
  const connection = await connect({ transport: register() });
  const result = await connection.call("profileSector", { topic: "Wasserstoff", limit: 3 });
  const content = result.structuredContent ?? {};
  assert.equal(content["status"], "ok", result.content[0]?.text);
  assert.deepEqual([content["total"], content["active"], content["inactive"]], [6, 5, 1]);
  assert.equal((content["actorMix"] as { activity: string }[])[0]?.activity, "Unternehmen");
  assert.equal(content["source"], `${BASE}/sucheJson?q=Wasserstoff`);
  assert.equal(content["sourceDate"], "2026-11-19T17:42:28.062+01:00");
  assert.match(String(content["licence"]), /^Quelle: Lobbyregister beim Deutschen Bundestag.*no open licence.*impressum/);
  await connection.close();
});

test("rankBySpend: three requests for the parts, a band per row, the inactive left out and counted, paged", async () => {
  const transport = register();
  const connection = await connect({ transport });
  const content = (await connection.call("rankBySpend", { topic: "Wasserstoff", limit: 2 })).structuredContent ?? {};
  assert.equal(transport.calls.length, 3);
  const rows = content["entries"] as { rank: number; name: string; spend: { text: string } }[];
  assert.deepEqual(rows.map((r) => [r.rank, r.name, r.spend.text]), [[1, "Wasserstoff Verband Deutschland e.V.", "€9,270,001 – €9,280,000 declared"], [2, "Wasserstoff Altbau GmbH", "€120,001 – €130,000 declared"]]);
  assert.deepEqual([content["inactiveLeftOut"], content["nextOffset"]], [1, 2]);
  assert.match((content["notes"] as string[]).join(" "), /older version of an entry.*never "spend on the term"/);
  await connection.close();
});

test("rankByEngagement by contracts surfaces the agency, with the other counts alongside", async () => {
  const connection = await connect({ transport: register() });
  const content = (await connection.call("rankByEngagement", { metric: "contracts", limit: 1 })).structuredContent ?? {};
  assert.deepEqual((content["entries"] as { registerNumber: string; contracts: number; statements: number }[]).map((e) => [e.registerNumber, e.contracts, e.statements]), [["R000007", 46, 3]]);
  assert.equal(content["metric"], "contracts");
  await connection.close();
});

test("findNewEntrants: arrivals by the first publication, the old entry edited last week left out; departures and the net", async () => {
  const connection = await connect({ transport: register() });
  const content = (await connection.call("findNewEntrants", { topic: "Wasserstoff", since: "2026-01-01" })).structuredContent ?? {};
  assert.deepEqual((content["arrivals"] as { registerNumber: string }[]).map((a) => a.registerNumber), ["R000003", "R000002"]);
  assert.deepEqual([content["arrivalCount"], content["departureCount"], content["net"]], [2, 1, 1]);
  const wrong = await connection.call("findNewEntrants", { since: "2026-02-30" });
  assert.equal(wrong.isError, true);
  assert.match(wrong.content[0]?.text ?? "", /no calendar day/);
  await connection.close();
});

test("findRevolvingDoor: N of M, the own office read per institution, the rest pointed to the register page; the source names the filter", async () => {
  const connection = await connect({ transport: register() });
  const content = (await connection.call("findRevolvingDoor", { holder: "LOBBYIST" })).structuredContent ?? {};
  assert.deepEqual([content["withRevolvingDoorData"], content["total"], content["ownOfficeCount"]], [2, 9, 2]);
  assert.deepEqual((content["ownOffice"] as { office: { role: string } }[]).map((o) => o.office.role), ["Mitglied des Deutschen Bundestages", "Abteilungsleiter"]);
  assert.equal(content["source"], `${BASE}/sucheJson?filter%5Brevolvingdoordata%5D%5Btrue%5D=true&filter%5Brevolvingdoorpersontypes%5D%5BLOBBYIST%5D=true`);
  await connection.close();
});

test("countEntries per topic; an unknown filter is a tool error naming the valid attributes, before any request", async () => {
  const transport = register();
  const connection = await connect({ transport });
  const content = (await connection.call("countEntries", { topics: ["Wasserstoff", "Krankenversicherung"] })).structuredContent ?? {};
  assert.deepEqual(content["counts"], [{ topic: "Wasserstoff", total: 6, active: 5 }, { topic: "Krankenversicherung", total: 2, active: 2 }]);
  const before = transport.calls.length;
  const wrong = await connection.call("countEntries", { filters: ["revolvingdoor=true"] });
  assert.equal(wrong.isError, true);
  assert.match(wrong.content[0]?.text ?? "", /revolvingdoordata/);
  assert.equal(transport.calls.length, before);
  await connection.close();
});

test("an English term is empty with the German hint, a valid answer", async () => {
  const connection = await connect({ transport: register() });
  const content = (await connection.call("profileSector", { topic: "hydrogen" })).structuredContent ?? {};
  assert.equal(content["status"], "empty");
  assert.match(String(content["reason"]), /German term.*Wasserstoff/);
  await connection.close();
});

test("searchEntries without a query or filter is a tool error; getEntry gives one entry in full, an unknown one empty", async () => {
  const connection = await connect({ transport: register() });
  const none = await connection.call("searchEntries", {});
  assert.equal(none.isError, true);
  assert.match(none.content[0]?.text ?? "", /query or a filter/);
  const found = (await connection.call("getEntry", { registerNumber: "R000008" })).structuredContent ?? {};
  assert.equal((found["summary"] as { formerOffice: boolean }).formerOffice, true);
  assert.equal(found["source"], `${BASE}/sucheJson?q=R000008`);
  const missing = (await connection.call("getEntry", { registerNumber: "R999999" })).structuredContent ?? {};
  assert.equal(missing["status"], "empty");
  await connection.close();
});

test("the deadline's advice fits every tool: each option it names is named with the tools that take it", async () => {
  const hanging = { transport: (): Promise<never> => new Promise<never>(() => {}) };
  const connection = await connect({ transport: hanging, config: { callTimeoutMs: 30 } });
  const text = (await connection.call("getEntry", { registerNumber: "R000001" })).content[0]?.text ?? "";
  await connection.close();
  assert.match(text, /took longer than .* and was stopped/);
  assert.match(text, /try again shortly/);
  assert.match(text, /getEntry .*only be tried again/, "the one-entry lookup has nothing to narrow");
  const schemas = new Map(TOOLS.map((tool) => [tool.name, Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties)]));
  const pairs = [...text.matchAll(/(\w+(?: or \w+)*) \((\w+(?:, \w+)*)\)/g)];
  assert.ok(pairs.length >= 3, text);
  for (const [, options, tools] of pairs) {
    for (const tool of (tools as string).split(", ")) {
      for (const option of (options as string).split(" or ")) assert.ok(schemas.get(tool)?.includes(option), `${tool} takes no ${option}: ${text}`);
    }
  }
  const named = new Set(pairs.flatMap(([, options]) => (options as string).split(" or ")));
  for (const option of ["topic", "topics", "query", "filters", "field"]) {
    assert.ok(!new RegExp(`\\b${option}\\b`).test(text) || named.has(option), `${option} named without its tools: ${text}`);
  }
});
