// The use cases against a mock of the register (fixtures.ts), with the skills' traps as cases: the
// set is fetched in parts that split it without overlap, older versions of an entry are dropped,
// spend is a band (zero, no figure yet and refused said apart), rankings leave inactive entries out
// and count them, newcomers are keyed on the first publication, the revolving door is "N of M" with
// the role read per institution, and an empty answer says what was searched and what to change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LobbyregisterClient } from "../src/client.js";
import { LobbyValidationError } from "../src/errors.js";
import {
  countEntries,
  displayName,
  fetchParts,
  findNewEntrants,
  findRevolvingDoor,
  formerOfficeOf,
  getEntry,
  newestVersions,
  profileSector,
  rankByEngagement,
  rankBySpend,
  searchEntries,
  spendOf,
} from "../src/operations.js";
import { entry, register, REGISTER } from "./fixtures.js";

const clientOf = (transport = register()) => ({ transport, client: new LobbyregisterClient({ transport: transport.transport, maxRetries: 0 }) });

/** The facet filters a request sent, as attribute=value. */
const facetsOf = (url: string) => [...new URL(url).searchParams.keys()].filter((k) => k.startsWith("filter[")).map((k) => k.replace(/^filter\[([^\]]+)\]\[(.+)\]$/, "$1=$2")).sort();

test("the register is fetched in three parts that split it without overlap: active with statements, active without, inactive", () => {
  const parts = fetchParts().map((p) => p.map((f) => `${f.attribute}=${f.value}`));
  assert.deepEqual(parts, [["activelobbyist=true", "statements=true"], ["activelobbyist=true", "statements=false"], ["activelobbyist=false"]]);
  assert.deepEqual(fetchParts([{ attribute: "activelobbyist", value: "true" }]).length, 2, "a facet the caller filters on is not split");
  assert.deepEqual(fetchParts([{ attribute: "statements", value: "true" }]).length, 2);
});

test("each part is one request with the topic; the union holds every entry once, the newest version of each", async () => {
  const { client, transport } = clientOf();
  const result = await rankBySpend(client, { topic: "Wasserstoff", includeInactive: true, limit: 100 });
  assert.equal(result.status, "ok");
  assert.deepEqual(transport.calls.map((c) => facetsOf(c.url)), [["activelobbyist=true", "statements=true"], ["activelobbyist=true", "statements=false"], ["activelobbyist=false"]]);
  assert.ok(transport.calls.every((c) => new URL(c.url).searchParams.get("q") === "Wasserstoff"));
  if (result.status !== "ok") return;
  const numbers = result.entries.map((e) => e.registerNumber);
  assert.equal(new Set(numbers).size, numbers.length, "no entry twice");
  assert.equal(result.entries.find((e) => e.registerNumber === "R000001")?.name, "Wasserstoff Verband Deutschland e.V.", "the newest version, from another part than the old one");
  assert.match(result.notes.join(" "), /1 older version of an entry too/);
});

test("newestVersions keeps the latest validFromDate per register number", () => {
  const old = entry({ registerNumber: "R1", name: "old", validFrom: "2025-01-01T00:00:00.000+01:00" });
  const now = entry({ registerNumber: "R1", name: "new", validFrom: "2026-01-01T00:00:00.000+01:00" });
  assert.deepEqual(newestVersions([now, old]).entries.map((e) => (e["lobbyistIdentity"] as { name: string }).name), ["new"]);
  assert.deepEqual(newestVersions([old, now]), { entries: [now], dropped: 1 });
});

test("spend is a band, never a point figure: declared, €0, no figure yet and refused said apart, with the fiscal year", () => {
  assert.deepEqual(spendOf(entry({ registerNumber: "R1", name: "a", spend: { from: 12730001, to: 12740000 } })), { kind: "declared", from: 12730001, to: 12740000, text: "€12,730,001 – €12,740,000 declared", period: "2025-01-01..2025-12-31" });
  assert.equal(spendOf(entry({ registerNumber: "R1", name: "a", spend: { from: 0, to: 0 } })).text, "€0 declared");
  assert.deepEqual(spendOf(entry({ registerNumber: "R1", name: "a", spend: null })), { kind: "noFigureYet", text: "no figure yet (the entry's first fiscal year is not completed)" });
  assert.deepEqual(spendOf(entry({ registerNumber: "R1", name: "a", refused: "Betriebsgeheimnis" })).text, "refused: Betriebsgeheimnis");
});

test("names lose their stray spaces for display", () => {
  assert.equal(displayName("  H2  Pipeline GmbH "), "H2 Pipeline GmbH");
});

test("rankBySpend: highest band first, inactive entries left out and counted, zero and no figure counted, the topic only selects", async () => {
  const { client } = clientOf();
  const result = await rankBySpend(client, { topic: "Wasserstoff" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.entries.map((e) => [e.rank, e.registerNumber]), [[1, "R000001"], [2, "R000004"], [3, "R000007"], [4, "R000002"], [5, "R000003"]]);
  assert.equal(result.inactiveLeftOut, 1, "R000005 has the highest band but is inactive");
  assert.deepEqual([result.total, result.ranked, result.declaredZero, result.noFigureYet], [6, 5, 1, 1]);
  assert.match(result.notes.join(" "), /never "spend on the term"/);
  const all = await rankBySpend(client, { topic: "Wasserstoff", includeInactive: true, limit: 1 });
  assert.equal(all.status === "ok" && all.entries[0]?.registerNumber, "R000005");
  assert.equal(all.status === "ok" && all.nextOffset, 1);
});

test("rankBySpend over the whole register sends no q; different fiscal years are pointed out", async () => {
  const { client, transport } = clientOf();
  const result = await rankBySpend(client, { limit: 3 });
  assert.ok(transport.calls.every((c) => !new URL(c.url).searchParams.has("q")));
  assert.equal(result.status === "ok" && result.entries[0]?.registerNumber, "R000006");
  assert.match(result.status === "ok" ? result.notes.join(" ") : "", /different fiscal years/);
});

test("rankByEngagement: statements by default, the other counts alongside; contracts surface the agency; all-zero counted", async () => {
  const { client } = clientOf();
  const byStatements = await rankByEngagement(client, {});
  assert.equal(byStatements.status === "ok" && byStatements.entries[0]?.registerNumber, "R000006");
  const byContracts = await rankByEngagement(client, { metric: "contracts" });
  assert.equal(byContracts.status === "ok" && byContracts.entries[0]?.registerNumber, "R000007");
  assert.equal(byContracts.status === "ok" && byContracts.entries[0]?.fieldsOfInterest, 2);
  assert.equal(byContracts.status === "ok" && byContracts.allZero, 5);
  assert.match(byContracts.status === "ok" ? byContracts.notes.join(" ") : "", /not their text/);
  await assert.rejects(rankByEngagement(client, { metric: "speeches" as never }), LobbyValidationError);
});

test("findNewEntrants keys arrivals on the first publication, never on the latest edit; departures on the inactive date", async () => {
  const { client } = clientOf();
  const result = await findNewEntrants(client, { topic: "Wasserstoff", since: "2026-01-01" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.arrivals.map((a) => [a.registerNumber, a.firstPublished]), [["R000003", "2026-09-01"], ["R000002", "2026-06-15"]]);
  assert.ok(!result.arrivals.some((a) => a.registerNumber === "R000004"), "edited in November, registered in 2022");
  assert.deepEqual(result.departures.map((d) => [d.registerNumber, d.inactiveSince]), [["R000005", "2026-03-11"]]);
  assert.deepEqual([result.arrivalCount, result.departureCount, result.net], [2, 1, 1]);
  assert.deepEqual(result.arrivals[1]?.topFields, ["Energienetze"]);
  const window = await findNewEntrants(client, { topic: "Wasserstoff", since: "2026-07-01", until: "2026-12-31" });
  assert.equal(window.status === "ok" && window.arrivalCount, 1);
  await assert.rejects(findNewEntrants(client, { since: "2026-02-30" }), /no calendar day/);
  await assert.rejects(findNewEntrants(client, { since: "2026-05-01", until: "2026-01-01" }), /before since/);
});

test("findRevolvingDoor: N of M from the register's filter; the lobbyist's own office read per institution; the rest pointed to the register page", async () => {
  const { client, transport } = clientOf();
  const result = await findRevolvingDoor(client, { topic: "Wasserstoff" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.ok(transport.calls.slice(0, 3).every((c) => facetsOf(c.url).includes("revolvingdoordata=true")));
  assert.equal(transport.calls.length, 6, "the filtered set and the topic's whole set, three parts each");
  assert.deepEqual([result.withRevolvingDoorData, result.total], [1, 6]);
  assert.deepEqual(result.officeOnRegisterPage.map((e) => e.registerNumber), ["R000007"]);
  assert.equal(result.ownOfficeCount, 0, "the agency's office-holder is an employee: no detail in the data");
  const all = await findRevolvingDoor(client, {});
  assert.equal(all.status, "ok");
  if (all.status !== "ok") return;
  assert.deepEqual(all.ownOffice.map((o) => [o.registerNumber, o.office]), [
    ["R000009", { institution: "Bundestag", role: "Mitglied des Deutschen Bundestages", ended: false }],
    ["R000008", { institution: "Bundesverwaltung", role: "Abteilungsleiter", department: "BMV", ended: true, endDate: "2025-06" }],
  ]);
  assert.match(all.notes.join(" "), /never invent the role/);
});

test("findRevolvingDoor narrows by who held the office and where, on the server", async () => {
  const { client, transport } = clientOf();
  const result = await findRevolvingDoor(client, { holder: "LOBBYIST", area: "HOUSE_OF_REPRESENTATIVES" });
  assert.deepEqual(facetsOf(transport.calls[0]?.url ?? ""), ["activelobbyist=true", "revolvingdoorareas=HOUSE_OF_REPRESENTATIVES", "revolvingdoordata=true", "revolvingdoorpersontypes=LOBBYIST", "statements=true"]);
  assert.equal(result.status === "ok" && result.withRevolvingDoorData, 1);
});

test("formerOfficeOf: a government role is an object, an administration role a plain string", () => {
  const minister = entry({ registerNumber: "R1", name: "a", identity: "NATURAL", office: { ended: true, endDate: "2021-12", type: { code: "FEDERAL_GOVERNMENT", de: "Bundesregierung" }, federalGovernment: { function: { de: "Parlamentarische/-r Staatssekretär/-in" }, department: { title: "Bundesministerium des Innern", shortTitle: "BMI" } } } });
  assert.deepEqual(formerOfficeOf(minister), { institution: "Bundesregierung", role: "Parlamentarische/-r Staatssekretär/-in", department: "BMI", ended: true, endDate: "2021-12" });
});

test("profileSector: the actor mix, the top spenders, the commonest fields, the flags; inactive left out and said", async () => {
  const { client } = clientOf();
  const result = await profileSector(client, { topic: "Wasserstoff", limit: 2 });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual([result.total, result.active, result.inactive], [6, 5, 1]);
  assert.deepEqual(result.actorMix, [{ activity: "Unternehmen", count: 3 }, { activity: "Beratungsunternehmen, selbständige Beraterinnen und Berater", count: 1 }, { activity: "Wirtschaftsverband", count: 1 }]);
  assert.deepEqual(result.topSpenders.map((s) => s.spend.text), ["€9,270,001 – €9,280,000 declared", "€120,001 – €130,000 declared"]);
  assert.equal(result.fieldsOfInterest[0]?.tag, "Erneuerbare Energien");
  assert.deepEqual(result.flags.codexViolations.map((s) => s.registerNumber), ["R000007"]);
  assert.match(result.notes.join(" "), /not spend on this topic/);
});

test("a field of interest narrows the set and is said; one nobody declares names the commonest instead", async () => {
  const { client } = clientOf();
  const narrowed = await profileSector(client, { topic: "Wasserstoff", field: "energienetze" });
  assert.equal(narrowed.status === "ok" && narrowed.total, 2);
  assert.match(narrowed.status === "ok" ? narrowed.notes.join(" ") : "", /Narrowed to the 2 of 6 entries/);
  const none = await profileSector(client, { topic: "Wasserstoff", field: "Raumfahrt" });
  assert.equal(none.status, "empty");
  assert.match(none.status === "empty" ? none.reason : "", /none declares a field of interest matching "Raumfahrt".*Erneuerbare Energien/);
});

test("an English term that matches nothing is empty, with the German hint: a valid answer", async () => {
  const { client } = clientOf();
  const result = await profileSector(client, { topic: "hydrogen" });
  assert.equal(result.status, "empty");
  assert.match(result.status === "empty" ? result.reason : "", /No entry's register text matches "hydrogen".*Wasserstoff.*valid answer/);
  assert.deepEqual(result.searched, { topic: "hydrogen" });
});

test("a blank topic or a bad limit is refused before any request", async () => {
  const { client, transport } = clientOf();
  await assert.rejects(rankBySpend(client, { topic: "  " }), LobbyValidationError);
  await assert.rejects(rankBySpend(client, { limit: 0 }), LobbyValidationError);
  await assert.rejects(profileSector(client, { limit: 26 }), LobbyValidationError);
  assert.equal(transport.calls.length, 0);
});

test("countEntries: each topic counted on its own, distinct entries, active apart; filters checked by the catalogue", async () => {
  const { client } = clientOf();
  const result = await countEntries(client, { topics: ["Wasserstoff", "Krankenversicherung"] });
  assert.deepEqual(result.counts, [{ topic: "Wasserstoff", total: 6, active: 5 }, { topic: "Krankenversicherung", total: 2, active: 2 }]);
  const filtered = await countEntries(client, { filters: ["revolvingdoordata=true"] });
  assert.deepEqual(filtered.counts, [{ total: 3, active: 3 }]);
  await assert.rejects(countEntries(client, { filters: ["revolvingdoor=true"] }), /revolvingdoor/);
  await assert.rejects(countEntries(client, { topics: ["a", "b", "c", "d", "e", "f"] }), /at most 5/);
});

test("searchEntries: one request in the register's order, paged; without a query or filter it is refused", async () => {
  const { client, transport } = clientOf();
  const result = await searchEntries(client, { query: "wasserstoff", limit: 2 });
  assert.equal(transport.calls.length, 1);
  assert.equal(result.status === "ok" && result.total, 6);
  assert.equal(result.status === "ok" && result.nextOffset, 2);
  await assert.rejects(searchEntries(client, {}), /query or a filter/);
  const none = await searchEntries(client, { query: "Zeppelin" });
  assert.equal(none.status, "empty");
});

test("getEntry: one entry in full by its register number, the newest version; an unknown one is empty with why; a malformed one refused", async () => {
  const { client, transport } = clientOf();
  const found = await getEntry(client, { registerNumber: "r000001" });
  assert.equal(found.status, "ok");
  assert.equal(new URL(transport.last().url).searchParams.get("q"), "R000001");
  assert.equal(found.status === "ok" && (found.entry["registerEntryDetails"] as { registerEntryId: number }).registerEntryId, 80000);
  const missing = await getEntry(client, { registerNumber: "R999999" });
  assert.equal(missing.status, "empty");
  assert.match(missing.status === "empty" ? missing.reason : "", /no entry R999999/);
  await assert.rejects(getEntry(client, { registerNumber: "Bitkom" }), /R and six digits/);
});

test("the fixture register mirrors the live split: the three parts add up to the whole register", async () => {
  const { client } = clientOf();
  const whole = await client.search({});
  const parts = await Promise.all(fetchParts().map((filters) => client.search({ filters })));
  assert.equal(parts.reduce((n, p) => n + p.resultCount, 0), whole.resultCount);
  assert.equal(whole.resultCount, REGISTER.length);
});

test("a page past the end is empty with a reason, the totals kept: the rankings and the search", async () => {
  const { client } = clientOf();
  const spend = await rankBySpend(client, { topic: "Wasserstoff", offset: 5, limit: 2 });
  assert.equal(spend.status, "empty");
  assert.match(spend.reason ?? "", /offset 5 is past the end: 5 entries are ranked; the last page starts at offset 3/);
  assert.equal("ranked" in spend && spend.ranked, 5);
  assert.equal("entries" in spend && spend.entries.length, 0);
  const engagement = await rankByEngagement(client, { offset: 100 });
  assert.equal(engagement.status, "empty");
  assert.match(engagement.reason ?? "", /offset 100 is past the end: 8 entries are ranked/);
  const search = await searchEntries(client, { query: "Wasserstoff", offset: 50 });
  assert.equal(search.status, "empty");
  assert.match(search.reason ?? "", /offset 50 is past the end: 6 entries match/);
  assert.equal("total" in search && search.total, 6);
  const last = await rankBySpend(client, { topic: "Wasserstoff", offset: 4 });
  assert.equal(last.status, "ok", "the last row is a page");
});

test("rankBySpend: no figure yet and refused rank after every €0 declared, never among them by name", async () => {
  const entries = [
    entry({ registerNumber: "R000101", name: "Zeta Null GmbH", spend: { from: 0, to: 0 } }),
    entry({ registerNumber: "R000102", name: "Alpha Neu GmbH", spend: null }),
    entry({ registerNumber: "R000103", name: "Beta Null GmbH", spend: { from: 0, to: 0 } }),
    entry({ registerNumber: "R000104", name: "Aaa Geheim GmbH", refused: "Betriebsgeheimnis" }),
    entry({ registerNumber: "R000105", name: "Mitte GmbH", spend: { from: 1, to: 10000 } }),
  ];
  const { client } = clientOf(register(entries));
  const result = await rankBySpend(client, {});
  assert.deepEqual(result.status === "ok" && result.entries.map((e) => [e.rank, e.spend.kind, e.registerNumber]), [
    [1, "declared", "R000105"],
    [2, "zero", "R000103"],
    [3, "zero", "R000101"],
    [4, "noFigureYet", "R000102"],
    [5, "refused", "R000104"],
  ]);
  const profile = await profileSector(client, {});
  assert.deepEqual(profile.status === "ok" && profile.topSpenders.map((e) => e.registerNumber), ["R000105", "R000103", "R000101", "R000102", "R000104"]);
});

test("field matches a word's start in the German or English name, or the code: never inside a word", async () => {
  const withFields = (registerNumber: string, fields: [string, string, string][]) => {
    const e = entry({ registerNumber, name: registerNumber });
    (e["activitiesAndInterests"] as { fieldsOfInterest: unknown })["fieldsOfInterest"] = fields.map(([code, de, en]) => ({ code, de, en }));
    return e;
  };
  const entries = [
    withFields("R000201", [["FOI_ECONOMY_BANKS", "Bank- und Finanzwesen", "Banking and finance"]]),
    withFields("R000202", [["FOI_SOCIAL_CHILDREN", "Kinder- und Jugendpolitik", "Children and youth policy"]]),
    withFields("R000203", [["FOI_SECURITY_CIVIL", "Bevölkerungsschutz", "Civil protection"]]),
    withFields("R000204", [["FOI_ENERGY_NET", "Energienetze", "Energy networks"]]),
    withFields("R000205", [["FOI_ENERGY_OIL", "Öl und Gas", "Oil and gas"]]),
  ];
  const { client } = clientOf(register(entries));
  const numbers = async (field: string) => {
    const answer = await rankBySpend(client, { field, includeInactive: true, limit: 100 });
    return answer.status === "ok" ? answer.entries.map((e) => e.registerNumber).sort() : [];
  };
  assert.deepEqual(await numbers("KI"), ["R000202"], "not Banking");
  assert.deepEqual(await numbers("Öl"), ["R000205"], "not Bevölkerungsschutz");
  for (const field of ["Energienetze", "energienetze", "FOI_ENERGY_NET", "Energy networks"]) assert.deepEqual(await numbers(field), ["R000204"], field);
  assert.deepEqual(await numbers("foi_energy"), ["R000204", "R000205"], "a code's leading segments");
  const said = await profileSector(client, { field: "KI" });
  assert.match(said.status === "ok" ? said.notes.join(" ") : "", /Narrowed to the 1 of 5 entries declaring a field of interest matching "KI".*: Kinder- und Jugendpolitik\./);
});
