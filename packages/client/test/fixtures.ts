// A mock of the register's `/sucheJson` for the use cases' tests (and the MCP server's): entries
// in the live shape (schema R2.27, 2026-11-19; organisations made up), searched and filtered as the
// live register does — `q` in any case in the name, the activity and the fields of interest, the
// facets activelobbyist, statements and the revolving-door ones, every filter echoed in
// `searchParameters.facets`, every match in one answer.

import type { HttpRequest, HttpResponse } from "../src/http.js";
import type { JsonObject, RegisterEntry } from "../src/types.js";
import { jsonResponse, makeMockTransport, type MockTransport } from "./helpers.js";

/** What a made-up entry is built from; everything has a live-like default. */
export interface EntrySpec {
  registerNumber: string;
  name: string;
  entryId?: number;
  identity?: "ORGANIZATION" | "NATURAL";
  activity?: [code: string, de: string];
  fields?: [code: string, de: string][];
  active?: boolean;
  firstPublished?: string;
  validFrom?: string;
  inactiveSince?: string;
  spend?: { from: number; to: number } | null;
  period?: [string, string];
  refused?: string;
  fte?: number | null;
  statements?: number;
  projects?: number;
  contracts?: number;
  codex?: boolean;
  /** The register's revolving-door filter finds it, for this person type and area. */
  revolvingDoor?: { holder: string; area: string };
  /** The lobbyist's own office, as the data states it. */
  office?: JsonObject;
}

const COMPANY: [string, string] = ["ACT_ORGANIZATION", "Unternehmen"];

/** A register entry in the live shape. */
export function entry(spec: EntrySpec): RegisterEntry & { _revolvingDoor?: { holder: string; area: string } } {
  const period = spec.period ?? ["2025-01-01", "2025-12-31"];
  const unfinished = spec.spend === null;
  const fiscal: JsonObject = unfinished ? { relatedFiscalYearFinished: false } : { relatedFiscalYearFinished: true, relatedFiscalYearStart: period[0], relatedFiscalYearEnd: period[1] };
  const activity = spec.activity ?? COMPANY;
  const result: RegisterEntry = {
    registerNumber: spec.registerNumber,
    registerEntryDetails: {
      registerEntryId: spec.entryId ?? 80000,
      legislation: "GL2024",
      detailsPageUrl: `https://www.lobbyregister.bundestag.de/suche/${spec.registerNumber}/${spec.entryId ?? 80000}`,
      validFromDate: spec.validFrom ?? "2026-06-30T13:17:33.859+02:00",
    },
    accountDetails: {
      activeLobbyist: spec.active ?? true,
      firstPublicationDate: spec.firstPublished ?? "2022-03-02T14:10:39.268+01:00",
      ...(spec.inactiveSince === undefined ? {} : { inactiveLobbyistStartDate: spec.inactiveSince }),
      lastUpdateDate: spec.validFrom ?? "2026-06-30T13:17:33.859+02:00",
      accountHasCodexViolations: spec.codex ?? false,
      ...(spec.codex === true ? { codexViolations: [{ codexViolationName: "Verstoß gg. Ziffer 8 des Verhaltenskodex (veröffentlicht: 04.12.2024)" }] } : {}),
    },
    lobbyistIdentity: {
      identity: spec.identity ?? "ORGANIZATION",
      name: spec.name,
      ...(spec.identity === "NATURAL" ? { recentGovernmentFunctionPresent: spec.office !== undefined } : {}),
      ...(spec.office === undefined ? {} : { recentGovernmentFunction: spec.office }),
      entrustedPersonsCount: 3,
      membershipsCount: 2,
    },
    activitiesAndInterests: {
      activity: { code: activity[0], de: activity[1], en: activity[1] },
      fieldsOfInterest: (spec.fields ?? [["FOI_ENERGY_RENEWABLE", "Erneuerbare Energien"]]).map(([code, de]) => ({ code, de, en: de })),
    },
    employeesInvolvedInLobbying: { ...fiscal, ...(unfinished ? {} : { employeeFTE: spec.fte === undefined ? 1.5 : spec.fte }) } as JsonObject,
    financialExpenses: {
      ...fiscal,
      ...(spec.refused !== undefined
        ? { refuseFinancialExpensesInformation: true, refuseFinancialExpensesInformationReason: spec.refused }
        : unfinished ? {} : { financialExpensesEuro: spec.spend ?? { from: 1, to: 10000 } }),
    } as JsonObject,
    regulatoryProjects: { regulatoryProjectsCount: spec.projects ?? 0 },
    statements: { statementsCount: spec.statements ?? 0 },
    contracts: { contractsCount: spec.contracts ?? 0 },
  };
  return spec.revolvingDoor === undefined ? result : Object.defineProperty(result, "_revolvingDoor", { value: spec.revolvingDoor, enumerable: false });
}

const ENERGY: [string, string] = ["FOI_ENERGY_RENEWABLE", "Erneuerbare Energien"];
const GRIDS: [string, string] = ["FOI_ENERGY_NETS", "Energienetze"];
const HEALTH: [string, string] = ["FOI_HEALTH_INSURANCE", "Krankenversicherung"];
const ASSOCIATION: [string, string] = ["ACT_TRADE_ASSOC", "Wirtschaftsverband"];
const CONSULTING: [string, string] = ["ACT_CONSULTING", "Beratungsunternehmen, selbständige Beraterinnen und Berater"];

/** A small register: hydrogen players, a health insurer, an agency, two revolving-door cases. */
export const REGISTER: RegisterEntry[] = [
  entry({ registerNumber: "R000001", name: "Wasserstoff Verband Deutschland e.V.", activity: ASSOCIATION, fields: [ENERGY, GRIDS], spend: { from: 9270001, to: 9280000 }, statements: 40, projects: 30, fte: 12.5 }),
  entry({ registerNumber: "R000002", name: "  Wasserstoff  Netz GmbH ", fields: [GRIDS], spend: { from: 0, to: 0 }, firstPublished: "2026-06-15T08:08:54.817+02:00", validFrom: "2026-06-15T08:08:54.817+02:00" }),
  entry({ registerNumber: "R000003", name: "Wasserstoff Zentrum Elektrolyse AG", fields: [ENERGY], spend: null, firstPublished: "2026-09-01T10:00:00.000+02:00", validFrom: "2026-09-01T10:00:00.000+02:00" }),
  // An old entry edited last week: no newcomer.
  entry({ registerNumber: "R000004", name: "Wasserstoff Altbau GmbH", fields: [ENERGY], spend: { from: 120001, to: 130000 }, firstPublished: "2022-03-02T14:10:39.268+01:00", validFrom: "2026-11-12T09:00:00.000+01:00" }),
  entry({ registerNumber: "R000005", name: "Wasserstoff Ex GmbH", active: false, inactiveSince: "2026-03-11T09:27:16.192+01:00", fields: [ENERGY], spend: { from: 20000001, to: 20010000 } }),
  entry({ registerNumber: "R000006", name: "Krankenkassen Bund e.V.", activity: ASSOCIATION, fields: [HEALTH], spend: { from: 15830001, to: 15840000 }, statements: 200, projects: 222, fte: 31.2, period: ["2024-07-01", "2025-06-30"] }),
  entry({ registerNumber: "R000007", name: "Agentur Wasserstoff & Partner", activity: CONSULTING, fields: [ENERGY, HEALTH], contracts: 46, statements: 3, projects: 12, codex: true, revolvingDoor: { holder: "ENTRUSTED_PERSON", area: "HOUSE_OF_REPRESENTATIVES" } }),
  entry({
    registerNumber: "R000008",
    name: "Erika Beispiel",
    identity: "NATURAL",
    activity: CONSULTING,
    fields: [ENERGY],
    revolvingDoor: { holder: "LOBBYIST", area: "FEDERAL_ADMINISTRATION" },
    office: { ended: true, endDate: "2025-06", type: { code: "FEDERAL_ADMINISTRATION", de: "Bundesverwaltung", en: "Federal administration" }, federalAdministration: { supremeFederalAuthority: "Bundesministerium für Verkehr (BMV)", supremeFederalAuthorityShort: "BMV", function: "Abteilungsleiter " } },
  }),
  entry({
    registerNumber: "R000009",
    name: "Max Muster",
    identity: "NATURAL",
    activity: CONSULTING,
    fields: [ENERGY],
    revolvingDoor: { holder: "LOBBYIST", area: "HOUSE_OF_REPRESENTATIVES" },
    office: { ended: false, type: { code: "HOUSE_OF_REPRESENTATIVES", de: "Bundestag", en: "House of representatives" }, houseOfRepresentatives: { function: { code: "MEMBER", de: "Mitglied des Deutschen Bundestages", en: "Member" } } },
  }),
  // An older version of R000001, which the register sometimes returns as well.
  entry({ registerNumber: "R000001", entryId: 70000, name: "Wasserstoff Verband (alt)", activity: ASSOCIATION, fields: [ENERGY], validFrom: "2025-01-01T00:00:00.000+01:00" }),
];

/** The words `q` matches in an entry: its name, activity and fields of interest. */
function searchable(e: RegisterEntry): string {
  const identity = e["lobbyistIdentity"] as JsonObject;
  const interests = e["activitiesAndInterests"] as JsonObject;
  const fields = (interests["fieldsOfInterest"] as JsonObject[]).map((f) => f["de"]);
  return [e["registerNumber"], identity["name"], (interests["activity"] as JsonObject)["de"], ...fields].join(" ").toLocaleLowerCase("de");
}

/** Whether `e` passes one facet filter, as the register reads it. */
function passes(e: RegisterEntry & { _revolvingDoor?: { holder: string; area: string } }, attribute: string, values: string[]): boolean {
  const account = e["accountDetails"] as JsonObject;
  const rd = e._revolvingDoor;
  switch (attribute) {
    case "activelobbyist":
      return values.includes(String(account["activeLobbyist"] !== false));
    case "statements":
      return values.includes(String(((e["statements"] as JsonObject)["statementsCount"] as number) > 0));
    case "revolvingdoordata":
      return values.includes(String(rd !== undefined));
    case "revolvingdoorpersontypes":
      return rd !== undefined && values.includes(rd.holder);
    case "revolvingdoorareas":
      return rd !== undefined && values.some((v) => v.split("|")[0] === rd.area);
    default:
      return true;
  }
}

/** The register's answer to one request (`/sucheJson?q=…&filter[a][v]=true`). */
export function registerAnswer(entries: readonly RegisterEntry[], request: HttpRequest): HttpResponse {
  const url = new URL(request.url);
  if (!url.pathname.endsWith("/sucheJson")) return jsonResponse({ error: "not found" }, 404);
  const q = url.searchParams.get("q");
  const facets: { attribute: string; value: string }[] = [];
  for (const [key] of url.searchParams) {
    const match = /^filter\[([^\]]+)\]\[(.+)\]$/.exec(key);
    if (match !== null) facets.push({ attribute: match[1] ?? "", value: match[2] ?? "" });
  }
  const byAttribute = new Map<string, string[]>();
  for (const f of facets) byAttribute.set(f.attribute, [...(byAttribute.get(f.attribute) ?? []), f.value]);
  const results = entries.filter(
    (e) => (q === null || searchable(e).includes(q.toLocaleLowerCase("de"))) && [...byAttribute].every(([attribute, values]) => passes(e, attribute, values)),
  );
  return jsonResponse({
    $schema: "https://www.lobbyregister.bundestag.de/json-schemas/R2.27/Lobbyregistersuche-Registereintrag-schema-R2.27.json",
    source: "Deutscher Bundestag, Lobbyregister für die Interessenvertretung gegenüber dem Deutschen Bundestag und der Bundesregierung",
    sourceUrl: "https://www.lobbyregister.bundestag.de",
    sourceDate: "2026-11-19T17:42:28.062+01:00",
    searchParameters: { queryString: q ?? "", sortOrder: url.searchParams.get("sort") ?? (q === null ? "REGISTRATION_DESC" : "RELEVANCE_DESC"), facets, numberRanges: [] },
    resultCount: results.length,
    results,
  });
}

/** A mock register over `entries` (default REGISTER), recording every request. */
export function register(entries: readonly RegisterEntry[] = REGISTER): MockTransport {
  return makeMockTransport((request) => registerAnswer(entries, request));
}
