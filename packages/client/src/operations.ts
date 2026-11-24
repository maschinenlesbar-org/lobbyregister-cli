// The use cases of the skills as library functions, built on the client: each carries the traps
// the skills document, so no caller (the CLI, the MCP server's tools, a library user) has to know
// them.
// - profileSector: who lobbies on a topic — the actor mix, the top declared spenders, the
//   fields of interest and the flags (lobbyregister-sector-brief);
// - rankBySpend: the league table of declared lobbying spend, a euro band per entry
//   (lobbyregister-money-ranking);
// - rankByEngagement: by statements, regulatory projects or contracts, all three shown
//   (lobbyregister-legislative-engagement);
// - findNewEntrants: arrivals by first publication and departures by the inactive date in a
//   window (lobbyregister-new-entrants);
// - findRevolvingDoor: the register's revolving-door filter, "N of M", split into the entries that
//   name the lobbyist's own former office and those whose office-holder is shown only on the
//   register page (lobbyregister-revolving-door);
// - countEntries, searchEntries and getEntry: the CLI's count and search, and one entry in full.
//
// Two traps hold for all of them. `/sucheJson` answers every match at once (it ignores paging),
// and the whole register is about 18 MB; so a set is fetched in parts the register's own yes/no
// facets split without overlap or gap (active with statements, active without, inactive; checked
// live on 2026-11-19: 2,285 + 4,089 + 672 = 7,046, the whole register), each a few MB. And the
// register can return two versions of one entry: the newest per register number is kept.

import type { LobbyregisterClient } from "./client.js";
import { LobbyValidationError, quoteValue } from "./errors.js";
import { parseFilter, type SearchFilter } from "./filters.js";
import type { JsonObject, JsonValue, RegisterEntry } from "./types.js";
import { assertValid, intInRangeProblem, normalizeText, textProblem } from "./validate.js";

/** A topic search and the facet filters every part of the fetch carries. */
export interface EntrySetInput {
  /** The German search term (the register's text is German); omitted, the whole register. */
  topic?: string | undefined;
  /** Facet filters, as the client takes them. */
  filters?: readonly SearchFilter[] | undefined;
}

/** A fetched set: the newest version of each entry, and what the fetch found on the way. */
export interface EntrySet {
  entries: RegisterEntry[];
  /** Older versions of an entry the register returned too, dropped. */
  olderVersionsDropped: number;
  /** The register's time of the answer (`sourceDate`). */
  sourceDate: string | undefined;
}

/**
 * The parts a set is fetched in: the register's yes/no facets `activelobbyist` and `statements`
 * split it without overlap or gap, each part well under the MCP server's 16 MiB cap (the whole
 * register is about 18 MB, the largest part about 10). A facet the caller filters on is not split.
 */
export function fetchParts(filters: readonly SearchFilter[] = []): SearchFilter[][] {
  const given = (attribute: string) => filters.some((f) => f.attribute === attribute);
  const yesNo = (attribute: string): SearchFilter[][] => [
    [{ attribute, value: "true" }],
    [{ attribute, value: "false" }],
  ];
  const active = given("activelobbyist") ? [[]] : yesNo("activelobbyist");
  return active.flatMap((part) => {
    // The inactive entries are few (672 on 2026-11-19): one part.
    const inactive = [...filters, ...part].some((f) => f.attribute === "activelobbyist" && f.value === "false");
    if (inactive || given("statements")) return [part];
    return yesNo("statements").map((split) => [...part, ...split]);
  });
}

/**
 * Every entry matching `topic` and `filters`, the newest version of each (by `validFromDate`),
 * fetched in parts (`fetchParts`), one request after the other.
 */
export async function fetchEntries(client: LobbyregisterClient, input: EntrySetInput = {}): Promise<EntrySet> {
  const filters = input.filters ?? [];
  const topic = input.topic === undefined ? undefined : checkedTopic(input.topic);
  let sourceDate: string | undefined;
  const all: RegisterEntry[] = [];
  for (const part of fetchParts(filters)) {
    const result = await client.search({ ...(topic === undefined ? {} : { q: topic }), filters: [...filters, ...part] });
    sourceDate ??= result.sourceDate;
    all.push(...result.results);
  }
  const { entries, dropped } = newestVersions(all);
  return { entries, olderVersionsDropped: dropped, sourceDate };
}

/** The newest version of each register number (by `validFromDate`), in the order first seen. */
export function newestVersions(entries: readonly RegisterEntry[]): { entries: RegisterEntry[]; dropped: number } {
  const newest = new Map<string, RegisterEntry>();
  for (const entry of entries) {
    const key = text(entry, "registerNumber") ?? JSON.stringify(entry);
    const seen = newest.get(key);
    if (seen === undefined || time(entry, "registerEntryDetails.validFromDate") > time(seen, "registerEntryDetails.validFromDate")) newest.set(key, entry);
  }
  return { entries: [...newest.values()], dropped: entries.length - newest.size };
}

// ---- reading an entry ----------------------------------------------------------------------

/** The value at a dotted path, or undefined. */
export function valueAt(entry: JsonValue | undefined, path: string): JsonValue | undefined {
  let value: JsonValue | undefined = entry;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    value = value[key];
  }
  return value;
}

function text(entry: JsonValue, path: string): string | undefined {
  const value = valueAt(entry, path);
  return typeof value === "string" ? value : undefined;
}

function number(entry: JsonValue, path: string): number | undefined {
  const value = valueAt(entry, path);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function time(entry: JsonValue, path: string): number {
  const value = Date.parse(text(entry, path) ?? "");
  return Number.isNaN(value) ? -Infinity : value;
}

/** The day of an ISO timestamp as the register wrote it (German local time): `2026-06-15`. */
function day(entry: JsonValue, path: string): string | undefined {
  return text(entry, path)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
}

/** A name as shown: the register's names carry stray leading, trailing and double spaces. */
export function displayName(name: string | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").trim();
}

/** An entry is active unless the register says it is not. */
const isActive = (entry: RegisterEntry): boolean => valueAt(entry, "accountDetails.activeLobbyist") !== false;

/** The declared lobbying spend of an entry: a euro band, €0, no figure yet, or refused. */
export interface Spend {
  /** declared: a band above 0; zero: exactly €0 declared; noFigureYet: the first fiscal year is not over; refused: the entry refuses to say; notStated: none of these. */
  kind: "declared" | "zero" | "noFigureYet" | "refused" | "notStated";
  from?: number;
  to?: number;
  /** How to say it: "€12,730,001 – €12,740,000 declared", "€0 declared", "no figure yet (…)", "refused: …". */
  text: string;
  /** The fiscal year the figure covers: `2025-01-01..2025-12-31`. */
  period?: string;
}

const euro = (value: number): string => `€${value.toLocaleString("en-US")}`;

/** The declared spend of `entry` (`financialExpenses`), never a point figure. */
export function spendOf(entry: RegisterEntry): Spend {
  const start = text(entry, "financialExpenses.relatedFiscalYearStart");
  const end = text(entry, "financialExpenses.relatedFiscalYearEnd");
  const period = start !== undefined && end !== undefined ? { period: `${start}..${end}` } : {};
  if (valueAt(entry, "financialExpenses.refuseFinancialExpensesInformation") === true) {
    const reason = displayName(text(entry, "financialExpenses.refuseFinancialExpensesInformationReason"));
    return { kind: "refused", text: reason === "" ? "refused" : `refused: ${reason}`, ...period };
  }
  const from = number(entry, "financialExpenses.financialExpensesEuro.from");
  const to = number(entry, "financialExpenses.financialExpensesEuro.to");
  if (from !== undefined && to !== undefined) {
    if (to === 0) return { kind: "zero", from, to, text: "€0 declared", ...period };
    return { kind: "declared", from, to, text: `${euro(from)} – ${euro(to)} declared`, ...period };
  }
  if (valueAt(entry, "financialExpenses.relatedFiscalYearFinished") === false) {
    return { kind: "noFigureYet", text: "no figure yet (the entry's first fiscal year is not completed)", ...period };
  }
  return { kind: "notStated", text: "not stated", ...period };
}

/** One entry in a list: who, what kind of actor, the figures the rankings use, the flags, the link. */
export interface EntrySummary {
  registerNumber: string;
  name: string;
  /** ORGANIZATION or NATURAL (a private person). */
  identity?: string;
  /** The kind of actor: Unternehmen, Wirtschaftsverband, Beratungsunternehmen … */
  activity?: string;
  active: boolean;
  /** The day the entry first entered the register. */
  firstPublished?: string;
  /** The day it went inactive (inactive entries only). */
  inactiveSince?: string;
  spend: Spend;
  /** Full-time equivalents on lobbying; null: not declared. */
  fte: number | null;
  statements: number;
  regulatoryProjects: number;
  contracts: number;
  /** How many fields of interest the entry declares: a broad association declares dozens. */
  fieldsOfInterest: number;
  /** The entry broke the register's code of conduct. */
  codexViolation?: true;
  /** The lobbyist (a person) held a public office recently (findRevolvingDoor has the detail). */
  formerOffice?: true;
  /** The entry's register page: why it matched a search, statements, the revolving-door detail. */
  url?: string;
}

/** The fields of an entry the lists show. */
export function summaryOf(entry: RegisterEntry): EntrySummary {
  const fte = number(entry, "employeesInvolvedInLobbying.employeeFTE");
  const fields = valueAt(entry, "activitiesAndInterests.fieldsOfInterest");
  const summary: EntrySummary = {
    registerNumber: text(entry, "registerNumber") ?? "",
    name: displayName(text(entry, "lobbyistIdentity.name")),
    active: isActive(entry),
    spend: spendOf(entry),
    fte: fte ?? null,
    statements: number(entry, "statements.statementsCount") ?? 0,
    regulatoryProjects: number(entry, "regulatoryProjects.regulatoryProjectsCount") ?? 0,
    contracts: number(entry, "contracts.contractsCount") ?? 0,
    fieldsOfInterest: Array.isArray(fields) ? fields.length : 0,
  };
  const identity = text(entry, "lobbyistIdentity.identity");
  if (identity !== undefined) summary.identity = identity;
  const activity = text(entry, "activitiesAndInterests.activity.de");
  if (activity !== undefined) summary.activity = displayName(activity);
  const first = day(entry, "accountDetails.firstPublicationDate");
  if (first !== undefined) summary.firstPublished = first;
  const inactive = day(entry, "accountDetails.inactiveLobbyistStartDate");
  if (inactive !== undefined && !summary.active) summary.inactiveSince = inactive;
  if (valueAt(entry, "accountDetails.accountHasCodexViolations") === true) summary.codexViolation = true;
  if (valueAt(entry, "lobbyistIdentity.recentGovernmentFunctionPresent") === true) summary.formerOffice = true;
  const url = text(entry, "registerEntryDetails.detailsPageUrl");
  if (url !== undefined) summary.url = url;
  return summary;
}

/** The fields of interest an entry declares, by their German names. */
function fieldTags(entry: RegisterEntry): { code: string; de: string; en: string }[] {
  const fields = valueAt(entry, "activitiesAndInterests.fieldsOfInterest");
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) => {
    const de = text(field, "de");
    return de === undefined ? [] : [{ code: text(field, "code") ?? "", de: displayName(de), en: text(field, "en") ?? "" }];
  });
}

// ---- input checks ----------------------------------------------------------------------------

function checkedTopic(topic: string): string {
  return normalizeText(assertValid("topic", topic, textProblem));
}

function checkedInt(name: string, value: number | undefined, fallback: number, min: number, max: number): number {
  return assertValid(name, value ?? fallback, intInRangeProblem(min, max));
}

/** A calendar day `YYYY-MM-DD`. */
function checkedDay(name: string, value: string): string {
  return assertValid(name, value, (v) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (match === null) return 'Expected a day as YYYY-MM-DD, e.g. "2026-01-01".';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toISOString().slice(0, 10) === v ? undefined : `${quoteValue(v)} is no calendar day.`;
  });
}

/**
 * A field-of-interest word, matched (any case) at the start of a word of the German or the English
 * name, or as the code or its leading segments (`FOI_ENERGY` for `FOI_ENERGY_NET`). Matched
 * anywhere, short words hit inside other words: "KI" the English "Banking", "Öl"
 * "Bevölkerungsschutz".
 */
function fieldMatcher(field: string | undefined): { tag: (tag: { code: string; de: string; en: string }) => boolean; entry: (entry: RegisterEntry) => boolean } | undefined {
  if (field === undefined) return undefined;
  const wanted = normalizeText(assertValid("field", field, textProblem)).toLocaleLowerCase("de");
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordStart = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}`, "u");
  const tag = (t: { code: string; de: string; en: string }): boolean => {
    const code = t.code.toLocaleLowerCase("de");
    return code === wanted || code.startsWith(`${wanted}_`) || [t.de, t.en].some((name) => wordStart.test(name.toLocaleLowerCase("de")));
  };
  return { tag, entry: (entry) => fieldTags(entry).some(tag) };
}

// ---- the shared frame of the topic answers ---------------------------------------------------

/** What a topic answer says it searched. */
export interface Searched {
  /** The search term, as sent; absent: the whole register. */
  topic?: string;
  /** The field-of-interest word the set was narrowed to. */
  field?: string;
  /** Facet filters, as `attribute=value`. */
  filters?: string[];
}

/** The common part of every topic answer. */
interface Frame {
  searched: Searched;
  /** When the register produced the answer. */
  sourceDate?: string;
  notes: string[];
}

/** The input every topic answer takes. */
export interface TopicInput {
  /** The German search term; omitted, the whole register. */
  topic?: string | undefined;
  /** Keep only entries declaring a field of interest with a word of its German or English name starting with this, or this code ("Energienetze", "FOI_ENERGY"). */
  field?: string | undefined;
}

const HIT_NOTE =
  "A search hit may be in register text the search API doesn't return (the activity description on the register page): the set is entries whose register text mentions the term, not organisations that mainly lobby on it; the url shows why one matched.";

const GERMAN_HINT = "The register's text is German: search the German term (hydrogen: Wasserstoff, climate: Klimaschutz, defence: Verteidigung or Rüstung, AI: künstliche Intelligenz or KI) or a synonym.";

/** Fetch the set of a topic answer and narrow it by `field`; or the empty answer. */
async function topicSet(
  client: LobbyregisterClient,
  input: TopicInput,
  filters: readonly SearchFilter[] = [],
): Promise<{ frame: Frame; entries: RegisterEntry[] } | { status: "empty"; searched: Searched; sourceDate?: string; reason: string }> {
  const topic = input.topic === undefined ? undefined : checkedTopic(input.topic);
  const matches = fieldMatcher(input.field);
  const searched: Searched = {};
  if (topic !== undefined) searched.topic = topic;
  if (input.field !== undefined) searched.field = normalizeText(input.field);
  if (filters.length > 0) searched.filters = filters.map((f) => `${f.attribute}=${f.value}`);
  const set = await fetchEntries(client, { topic, filters });
  const date = set.sourceDate === undefined ? {} : { sourceDate: set.sourceDate };
  if (set.entries.length === 0) {
    const what = topic === undefined ? "No entry matches these filters." : `No entry's register text matches ${quoteValue(topic)}${filters.length > 0 ? " with these filters" : ""}.`;
    return { status: "empty", searched, ...date, reason: `${what} ${topic === undefined ? "" : GERMAN_HINT + " "}A valid answer, not an error.` };
  }
  const entries = matches === undefined ? set.entries : set.entries.filter(matches.entry);
  if (entries.length === 0) {
    const common = topTags(set.entries, 8).map((t) => t.tag).join(", ");
    return {
      status: "empty",
      searched,
      ...date,
      reason: `${set.entries.length} entries matched, but none declares a field of interest matching ${quoteValue(searched.field ?? "")} (at the start of a word of its name, or its code). The commonest in this set: ${common}.`,
    };
  }
  const notes: string[] = [];
  if (topic !== undefined) notes.push(HIT_NOTE);
  if (matches !== undefined) {
    const named = new Map<string, number>();
    for (const entry of entries) for (const t of fieldTags(entry)) if (matches.tag(t)) named.set(t.de, (named.get(t.de) ?? 0) + 1);
    const fields = [...named].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).map(([name]) => name);
    const shown = fields.length > 8 ? `${fields.slice(0, 8).join(", ")} and ${fields.length - 8} more` : fields.join(", ");
    notes.push(`Narrowed to the ${entries.length} of ${set.entries.length} entries declaring a field of interest matching ${quoteValue(searched.field ?? "")} (at the start of a word of its German or English name, or its code): ${shown}.`);
  }
  if (set.olderVersionsDropped > 0) {
    notes.push(`The register returned ${set.olderVersionsDropped} older version${set.olderVersionsDropped === 1 ? "" : "s"} of an entry too; only the newest of each counts.`);
  }
  return { frame: { searched, ...date, notes }, entries };
}

/** The commonest fields of interest of `entries`, by the German name. */
function topTags(entries: readonly RegisterEntry[], limit: number): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) for (const tag of new Set(fieldTags(entry).map((t) => t.de))) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "de")).slice(0, limit);
}

type Empty = { status: "empty"; searched: Searched; sourceDate?: string; reason: string };

// ---- profileSector -----------------------------------------------------------------------------

export interface ProfileSectorInput extends TopicInput {
  /** How many top spenders to list (1–25, default 10). */
  limit?: number | undefined;
}

export type SectorProfile =
  | (Frame & {
      status: "ok";
      /** Distinct entries matching, inactive ones included. */
      total: number;
      active: number;
      inactive: number;
      /** The kinds of actor among the active entries, commonest first. */
      actorMix: { activity: string; count: number }[];
      /** The active entries with the highest declared spend (each entry's total, not on the topic). */
      topSpenders: EntrySummary[];
      /** The commonest declared fields of interest of the active entries. */
      fieldsOfInterest: { tag: string; count: number }[];
      /** The newsworthy entries: code-of-conduct violations, a lobbyist's own former office. */
      flags: { codexViolations: EntrySummary[]; formerOffice: EntrySummary[]; formerOfficeCount: number };
    })
  | Empty;

/** Who lobbies on a topic: the actor mix, the top declared spenders, the fields of interest, the flags. */
export async function profileSector(client: LobbyregisterClient, input: ProfileSectorInput = {}): Promise<SectorProfile> {
  const limit = checkedInt("limit", input.limit, 10, 1, 25);
  const set = await topicSet(client, input);
  if ("status" in set) return set;
  const active = set.entries.filter(isActive);
  const mix = new Map<string, number>();
  for (const entry of active) {
    const activity = displayName(text(entry, "activitiesAndInterests.activity.de")) || "not stated";
    mix.set(activity, (mix.get(activity) ?? 0) + 1);
  }
  const summaries = active.map(summaryOf);
  const flagged = summaries.filter((s) => s.formerOffice);
  const notes = [
    ...set.frame.notes,
    "Spend is each entry's total declared lobbying spend for a fiscal year across everything it lobbies on, not spend on this topic; a self-declared band, not an audited figure.",
    `Ranked and counted: the ${active.length} active entries; ${set.entries.length - active.length} inactive left out.`,
    "formerOffice names only a lobbyist who is a person and held office; the register's revolving-door filter (findRevolvingDoor) finds many more, with the office of an employee or contractor.",
  ];
  return {
    status: "ok",
    ...set.frame,
    notes,
    total: set.entries.length,
    active: active.length,
    inactive: set.entries.length - active.length,
    actorMix: [...mix].map(([activity, count]) => ({ activity, count })).sort((a, b) => b.count - a.count || a.activity.localeCompare(b.activity, "de")),
    topSpenders: bySpend(summaries).slice(0, limit),
    fieldsOfInterest: topTags(active, 15),
    flags: {
      codexViolations: set.entries.map(summaryOf).filter((s) => s.codexViolation),
      formerOffice: flagged.slice(0, limit),
      formerOfficeCount: flagged.length,
    },
  };
}

/** Where a kind of spend ranks: a declared band, then exactly €0, then no figure, refused, not stated. */
const SPEND_ORDER: Record<Spend["kind"], number> = { declared: 0, zero: 1, noFigureYet: 2, refused: 3, notStated: 4 };

/**
 * Highest declared band first (`to`, then `from`), then €0 declared, then the entries without a
 * figure (no figure yet, refused, not stated), each group by name. No figure is not €0: ranked
 * as 0, an entry without one stood among the €0 rows by name, a "lowest spender" it isn't.
 */
function bySpend(summaries: readonly EntrySummary[]): EntrySummary[] {
  return [...summaries].sort(
    (a, b) =>
      SPEND_ORDER[a.spend.kind] - SPEND_ORDER[b.spend.kind] ||
      (b.spend.to ?? 0) - (a.spend.to ?? 0) ||
      (b.spend.from ?? 0) - (a.spend.from ?? 0) ||
      a.name.localeCompare(b.name, "de"),
  );
}

// ---- rankBySpend -------------------------------------------------------------------------------

export interface RankInput extends TopicInput {
  /** Rank the inactive entries too (default: left out, and counted). */
  includeInactive?: boolean | undefined;
  /** Where the page starts (default 0). */
  offset?: number | undefined;
  /** How many rows (1–100, default 15). */
  limit?: number | undefined;
}

export type SpendRanking =
  | (Frame & {
      /** empty: the page starts past the end (`reason` says where the last one starts). */
      status: "ok" | "empty";
      reason?: string;
      /** Distinct entries matching. */
      total: number;
      /** Entries in the ranking. */
      ranked: number;
      inactiveLeftOut: number;
      /** Of the ranked: exactly €0 declared, no figure yet, refused. */
      declaredZero: number;
      noFigureYet: number;
      refused: number;
      /** The fiscal years the listed rows cover, commonest first: bands of different years aren't comparable. */
      periods: { period: string; count: number }[];
      entries: (EntrySummary & { rank: number })[];
      nextOffset?: number;
    })
  | Empty;

/** The league table of declared lobbying spend, highest band first. */
export async function rankBySpend(client: LobbyregisterClient, input: RankInput = {}): Promise<SpendRanking> {
  const { offset, limit } = page(input);
  const set = await topicSet(client, input);
  if ("status" in set) return set;
  const pool = input.includeInactive === true ? set.entries : set.entries.filter(isActive);
  const ranked = bySpend(pool.map(summaryOf));
  const rows = ranked.slice(offset, offset + limit).map((s, i) => ({ rank: offset + i + 1, ...s }));
  const kinds = (kind: Spend["kind"]) => ranked.filter((s) => s.spend.kind === kind).length;
  const periods = new Map<string, number>();
  for (const row of rows) if (row.spend.period !== undefined) periods.set(row.spend.period, (periods.get(row.spend.period) ?? 0) + 1);
  const notes = [
    ...set.frame.notes,
    "Each figure is the entry's total declared lobbying spend for one fiscal year, across everything it lobbies on: a topic only selects the entries. Head a table \"entries matching the term, by total declared spend\", never \"spend on the term\".",
    "Bands are self-declared (€10,000 steps from €1), not audited: always give both ends and say declared. €0 declared is exactly zero; no figure yet means the first fiscal year is not over. Entries without a figure (no figure yet, refused) rank after every €0 declared: they are no lowest spenders.",
  ];
  if (periods.size > 1) notes.push("The listed rows cover different fiscal years (periods): say so when comparing them.");
  const next = offset + rows.length < ranked.length ? { nextOffset: offset + rows.length } : {};
  return {
    ...pageStatus(offset, limit, ranked.length, "entries are ranked"),
    ...set.frame,
    notes,
    total: set.entries.length,
    ranked: ranked.length,
    inactiveLeftOut: set.entries.length - pool.length,
    declaredZero: kinds("zero"),
    noFigureYet: kinds("noFigureYet"),
    refused: kinds("refused"),
    periods: [...periods].map(([period, count]) => ({ period, count })).sort((a, b) => b.count - a.count),
    entries: rows,
    ...next,
  };
}

function page(input: { offset?: number | undefined; limit?: number | undefined }): { offset: number; limit: number } {
  return { offset: checkedInt("offset", input.offset, 0, 0, 100_000), limit: checkedInt("limit", input.limit, 15, 1, 100) };
}

/**
 * A page that starts past the end of `length` rows: status empty and why, where the last page
 * starts; else status ok. A page past the end was `ok` with no rows and no word why.
 */
function pageStatus(offset: number, limit: number, length: number, what: string): { status: "ok" } | { status: "empty"; reason: string } {
  if (offset === 0 || offset < length) return { status: "ok" };
  return { status: "empty", reason: `The page at offset ${offset} is past the end: ${length} ${what}; the last page starts at offset ${Math.max(0, length - limit)}.` };
}

// ---- rankByEngagement --------------------------------------------------------------------------

/** What `rankByEngagement` ranks on. */
export const ENGAGEMENT_METRICS = ["statements", "regulatoryProjects", "contracts"] as const;
export type EngagementMetric = (typeof ENGAGEMENT_METRICS)[number];

export interface RankByEngagementInput extends RankInput {
  /** statements (default: formal statements filed), regulatoryProjects (breadth) or contracts (lobbying for clients). */
  metric?: EngagementMetric | undefined;
}

export type EngagementRanking =
  | (Frame & {
      /** empty: the page starts past the end (`reason` says where the last one starts). */
      status: "ok" | "empty";
      reason?: string;
      metric: EngagementMetric;
      total: number;
      ranked: number;
      inactiveLeftOut: number;
      /** Ranked entries with 0 on all three counts (registered, nothing recorded yet): ranked last. */
      allZero: number;
      entries: (EntrySummary & { rank: number })[];
      nextOffset?: number;
    })
  | Empty;

/** Entries ranked by statements, regulatory projects or contracts, the other two shown alongside. */
export async function rankByEngagement(client: LobbyregisterClient, input: RankByEngagementInput = {}): Promise<EngagementRanking> {
  const metric = input.metric ?? "statements";
  if (!ENGAGEMENT_METRICS.includes(metric)) {
    throw new LobbyValidationError(`Invalid metric: expected one of ${ENGAGEMENT_METRICS.join(", ")}, got ${quoteValue(String(metric))}.`);
  }
  const { offset, limit } = page(input);
  const set = await topicSet(client, input);
  if ("status" in set) return set;
  const pool = input.includeInactive === true ? set.entries : set.entries.filter(isActive);
  const others = ENGAGEMENT_METRICS.filter((m) => m !== metric);
  const ranked = pool
    .map(summaryOf)
    .sort((a, b) => b[metric] - a[metric] || others.reduce((d, m) => d || b[m] - a[m], 0) || a.name.localeCompare(b.name, "de"));
  const rows = ranked.slice(offset, offset + limit).map((s, i) => ({ rank: offset + i + 1, ...s }));
  const notes = [
    ...set.frame.notes,
    "Counts measure footprint, not influence or content: the register reports how many statements, regulatory projects and contracts, not their text, which laws or which clients (the url's register page has them).",
    "The counts are each entry's totals across all its topics, not activity on the term; fieldsOfInterest (how many it declares) tells a broad association from a specialist.",
    "statements: formal statements filed; regulatoryProjects: projects it works on (breadth); contracts: lobbying contracts held, mostly agencies working for clients.",
  ];
  const next = offset + rows.length < ranked.length ? { nextOffset: offset + rows.length } : {};
  return {
    ...pageStatus(offset, limit, ranked.length, "entries are ranked"),
    ...set.frame,
    notes,
    metric,
    total: set.entries.length,
    ranked: ranked.length,
    inactiveLeftOut: set.entries.length - pool.length,
    allZero: ranked.filter((s) => s.statements === 0 && s.regulatoryProjects === 0 && s.contracts === 0).length,
    entries: rows,
    ...next,
  };
}

// ---- findNewEntrants ---------------------------------------------------------------------------

export interface NewEntrantsInput extends TopicInput {
  /** The first day of the window, YYYY-MM-DD (German local time, as the register writes it). */
  since: string;
  /** The last day of the window (default: no end). */
  until?: string | undefined;
  /** How many arrivals and departures to list each (1–100, default 20); the counts are complete. */
  limit?: number | undefined;
}

/** An arrival or a departure, with what kind of actor it is and two of its fields of interest. */
export type Movement = EntrySummary & { topFields: string[] };

export type NewEntrants =
  | (Frame & {
      status: "ok";
      window: { since: string; until?: string };
      /** Distinct entries matching (the set the window was taken from). */
      total: number;
      /** First published in the window (accountDetails.firstPublicationDate), newest first. */
      arrivals: Movement[];
      arrivalCount: number;
      /** Went inactive in the window (accountDetails.inactiveLobbyistStartDate), newest first. */
      departures: Movement[];
      departureCount: number;
      /** arrivalCount - departureCount. */
      net: number;
      /** Inactive entries without an inactive date: exit date not recorded (not "still active"). */
      inactiveWithoutDate: number;
    })
  | Empty;

/** Who newly registered and who went inactive in a window: arrivals keyed on the first publication, never on the latest edit. */
export async function findNewEntrants(client: LobbyregisterClient, input: NewEntrantsInput): Promise<NewEntrants> {
  const since = checkedDay("since", input.since);
  const until = input.until === undefined ? undefined : checkedDay("until", input.until);
  if (until !== undefined && until < since) throw new LobbyValidationError(`Invalid until: ${until} is before since (${since}).`);
  const limit = checkedInt("limit", input.limit, 20, 1, 100);
  const set = await topicSet(client, input);
  if ("status" in set) return set;
  const within = (date: string | undefined) => date !== undefined && date >= since && (until === undefined || date <= until);
  const movement = (entry: RegisterEntry): Movement => ({ ...summaryOf(entry), topFields: fieldTags(entry).slice(0, 2).map((t) => t.de) });
  const newest = (path: string) => (a: RegisterEntry, b: RegisterEntry) => time(b, path) - time(a, path);
  const arrivals = set.entries.filter((e) => within(day(e, "accountDetails.firstPublicationDate"))).sort(newest("accountDetails.firstPublicationDate"));
  const inactive = set.entries.filter((e) => !isActive(e));
  const departures = inactive.filter((e) => within(day(e, "accountDetails.inactiveLobbyistStartDate"))).sort(newest("accountDetails.inactiveLobbyistStartDate"));
  const notes = [
    ...set.frame.notes,
    "Arrivals are keyed on firstPublished (when the entry entered the register), never on the latest edit (validFromDate, lastUpdateDate), which every update moves: an entry of 2022 edited last week is no newcomer.",
    "An arrival that is already inactive again is listed with active false.",
  ];
  return {
    status: "ok",
    ...set.frame,
    notes,
    window: until === undefined ? { since } : { since, until },
    total: set.entries.length,
    arrivals: arrivals.slice(0, limit).map(movement),
    arrivalCount: arrivals.length,
    departures: departures.slice(0, limit).map(movement),
    departureCount: departures.length,
    net: arrivals.length - departures.length,
    inactiveWithoutDate: inactive.filter((e) => day(e, "accountDetails.inactiveLobbyistStartDate") === undefined).length,
  };
}

// ---- findRevolvingDoor -------------------------------------------------------------------------

/** Who held the office (the register's `revolvingdoorpersontypes`). */
export const OFFICE_HOLDERS = ["LOBBYIST", "LEGAL_REPRESENTATIVE", "ENTRUSTED_PERSON", "CONTRACTOR"] as const;
/** Where the office was (the register's `revolvingdoorareas`, the top level). */
export const OFFICE_AREAS = ["HOUSE_OF_REPRESENTATIVES", "FEDERAL_GOVERNMENT", "FEDERAL_ADMINISTRATION"] as const;

export interface RevolvingDoorInput extends TopicInput {
  /** Only entries where this kind of person held the office. */
  holder?: (typeof OFFICE_HOLDERS)[number] | undefined;
  /** Only offices in this branch. */
  area?: (typeof OFFICE_AREAS)[number] | undefined;
  /** Where the page of both lists starts (default 0). */
  offset?: number | undefined;
  /** How many of each list (1–100, default 20). */
  limit?: number | undefined;
}

/** A lobbyist's own former office, as the data states it. */
export interface FormerOffice {
  /** Bundestag, Bundesregierung or Bundesverwaltung. */
  institution?: string;
  /** The role, read where the institution keeps it. */
  role?: string;
  /** The ministry or authority (government and administration). */
  department?: string;
  /** false: the person may still hold the office (a stronger signal than a former one). */
  ended?: boolean;
  /** When it ended: `2025-03`. */
  endDate?: string;
}

/** Read the office: the role sits in a different place per institution (`type.code`). */
export function formerOfficeOf(entry: RegisterEntry): FormerOffice {
  const f = valueAt(entry, "lobbyistIdentity.recentGovernmentFunction") as JsonObject | undefined;
  const office: FormerOffice = {};
  if (f === undefined || f === null) return office;
  const institution = text(f, "type.de");
  if (institution !== undefined) office.institution = institution;
  const code = text(f, "type.code");
  // Bundestag and Bundesregierung keep the role as { code, de, en }; Bundesverwaltung as a plain string.
  const role =
    code === "HOUSE_OF_REPRESENTATIVES" ? text(f, "houseOfRepresentatives.function.de")
    : code === "FEDERAL_GOVERNMENT" ? text(f, "federalGovernment.function.de")
    : code === "FEDERAL_ADMINISTRATION" ? text(f, "federalAdministration.function")
    : undefined;
  if (role !== undefined) office.role = displayName(role);
  const department =
    code === "FEDERAL_GOVERNMENT" ? (text(f, "federalGovernment.department.shortTitle") ?? text(f, "federalGovernment.department.title"))
    : code === "FEDERAL_ADMINISTRATION" ? (text(f, "federalAdministration.supremeFederalAuthorityShort") ?? text(f, "federalAdministration.supremeFederalAuthority"))
    : undefined;
  if (department !== undefined) office.department = displayName(department);
  const ended = valueAt(f, "ended");
  if (typeof ended === "boolean") office.ended = ended;
  const endDate = text(f, "endDate");
  if (endDate !== undefined) office.endDate = endDate;
  return office;
}

export type RevolvingDoor =
  | (Frame & {
      /** empty: the page starts past the end of both lists (`reason` says where the last one starts). */
      status: "ok" | "empty";
      reason?: string;
      /** Entries the register's revolving-door filter finds ("N"). */
      withRevolvingDoorData: number;
      /** All entries matching the topic ("M"). */
      total: number;
      /** Entries naming the lobbyist's own office in the data, with it. */
      ownOffice: (EntrySummary & { office: FormerOffice; topFields: string[] })[];
      ownOfficeCount: number;
      /** Entries whose office-holder (an employee, contractor …) is shown only on the register page (url). */
      officeOnRegisterPage: EntrySummary[];
      officeOnRegisterPageCount: number;
      /** Where the next page of both lists starts, while either has more. */
      nextOffset?: number;
    })
  | Empty;

/** The revolving door: entries recording a recent public office of one of their people, "N of M". */
export async function findRevolvingDoor(client: LobbyregisterClient, input: RevolvingDoorInput = {}): Promise<RevolvingDoor> {
  const offset = checkedInt("offset", input.offset, 0, 0, 100_000);
  const limit = checkedInt("limit", input.limit, 20, 1, 100);
  const filters: SearchFilter[] = [{ attribute: "revolvingdoordata", value: "true" }];
  if (input.holder !== undefined) filters.push(parseFilter(`revolvingdoorpersontypes=${input.holder}`));
  if (input.area !== undefined) filters.push(parseFilter(`revolvingdoorareas=${input.area}`));
  const set = await topicSet(client, input, filters);
  if ("status" in set) return set;
  // M: the topic's whole set (the field narrowing applied to it too), for "N of M".
  const everyone = await topicSet(client, { topic: input.topic, field: input.field });
  const total = "status" in everyone ? 0 : everyone.entries.length;
  const own = set.entries.filter((e) => valueAt(e, "lobbyistIdentity.recentGovernmentFunctionPresent") === true);
  const others = set.entries.filter((e) => !own.includes(e)).map(summaryOf).sort((a, b) => a.name.localeCompare(b.name, "de"));
  const ownRows = own
    .map((e) => ({ ...summaryOf(e), office: formerOfficeOf(e), topFields: fieldTags(e).slice(0, 5).map((t) => t.de) }))
    .sort((a, b) => Number(a.office.ended !== false) - Number(b.office.ended !== false) || (b.office.endDate ?? "").localeCompare(a.office.endDate ?? ""));
  // Both lists are paged with the same offset: the own-office list ignored it, so a model paging on
  // got its first rows again and never the rest (43 lobbyists with their own office, 20 shown).
  const rows = others.slice(offset, offset + limit);
  const longest = Math.max(ownRows.length, others.length);
  const notes = [
    ...set.frame.notes,
    `Lead with "${set.entries.length} of ${total}": the register's filter keeps every entry recording a recent public office of any of its people (the lobbyist, a legal representative, an entrusted person such as an employee, a contractor).`,
    "Only a lobbyist who is a person carries the office in the data (ownOffice); for the others the search API returns no name, role or date: say the office is documented on the register page (url) and never invent the role.",
    "office.ended false: the person may still hold the office. Pair the former remit with topFields to show a same-sector move. This is self-disclosure: report what is declared.",
    "offset and limit page both lists together; nextOffset is where the next page of both starts.",
  ];
  const next = offset + limit < longest ? { nextOffset: offset + limit } : {};
  return {
    ...pageStatus(offset, limit, longest, "entries are in the longer of the two lists"),
    ...set.frame,
    notes,
    withRevolvingDoorData: set.entries.length,
    total,
    ownOffice: ownRows.slice(offset, offset + limit),
    ownOfficeCount: ownRows.length,
    officeOnRegisterPage: rows,
    officeOnRegisterPageCount: others.length,
    ...next,
  };
}

// ---- countEntries, searchEntries, getEntry -----------------------------------------------------

/** Facet filters as `attribute=value` (the CLI's --filter), checked by the client's catalogue. */
function filtersOf(texts: readonly string[] | undefined): SearchFilter[] {
  return (texts ?? []).map((t) => parseFilter(t));
}

export interface CountEntriesInput {
  /** Up to 5 German search terms, each counted on its own; omitted, the whole register. */
  topics?: readonly string[] | undefined;
  /** Facet filters, `attribute=value` (`revolvingdoordata=true`, `fieldsofinterest=FOI_ENERGY`). */
  filters?: readonly string[] | undefined;
}

export interface EntryCounts {
  status: "ok";
  searched: { filters?: string[] };
  sourceDate?: string;
  /** Per topic (or one row for the whole register): distinct entries, of them active. */
  counts: { topic?: string; total: number; active: number }[];
  notes: string[];
}

/** How many distinct entries match each topic (and the filters), active ones apart. */
export async function countEntries(client: LobbyregisterClient, input: CountEntriesInput = {}): Promise<EntryCounts> {
  const topics = input.topics === undefined || input.topics.length === 0 ? [undefined] : input.topics.map(checkedTopic);
  if (topics.length > 5) throw new LobbyValidationError(`Invalid topics: at most 5, got ${topics.length}.`);
  const filters = filtersOf(input.filters);
  const counts: EntryCounts["counts"] = [];
  let sourceDate: string | undefined;
  for (const topic of topics) {
    const set = await fetchEntries(client, { topic, filters });
    sourceDate ??= set.sourceDate;
    counts.push({ ...(topic === undefined ? {} : { topic }), total: set.entries.length, active: set.entries.filter(isActive).length });
  }
  const notes = ["Each count is of distinct entries (the newest version of each), inactive ones included; active counts those still registered as active."];
  if (topics[0] !== undefined) notes.push(HIT_NOTE, GERMAN_HINT);
  return {
    status: "ok",
    searched: filters.length === 0 ? {} : { filters: filters.map((f) => `${f.attribute}=${f.value}`) },
    ...(sourceDate === undefined ? {} : { sourceDate }),
    counts,
    notes,
  };
}

export interface SearchEntriesInput {
  /** Free text: a name, a word of the register's text, a register number. */
  query?: string | undefined;
  /** Facet filters, `attribute=value`. */
  filters?: readonly string[] | undefined;
  /** A sort order of the register (`SORT_ORDERS`); default relevance with a query. */
  sort?: string | undefined;
  offset?: number | undefined;
  /** 1–100, default 15. */
  limit?: number | undefined;
}

export type EntrySearch =
  | { status: "ok" | "empty"; reason?: string; searched: { query?: string; filters?: string[]; sort?: string }; sourceDate?: string; total: number; entries: EntrySummary[]; nextOffset?: number; notes: string[] }
  | { status: "empty"; searched: { query?: string; filters?: string[]; sort?: string }; sourceDate?: string; reason: string };

/**
 * The register's search as one request, in the register's order (relevance, or `sort`): a query
 * or a filter is needed, since the whole register is too large for one answer (the rankings
 * fetch it in parts).
 */
export async function searchEntries(client: LobbyregisterClient, input: SearchEntriesInput): Promise<EntrySearch> {
  const query = input.query === undefined ? undefined : checkedTopic(input.query);
  const filters = filtersOf(input.filters);
  if (query === undefined && filters.length === 0) {
    throw new LobbyValidationError("Give a query or a filter: the whole register is too large for one search (rankBySpend and the other rankings read it in parts).");
  }
  const { offset, limit } = page(input);
  const result = await client.search({ ...(query === undefined ? {} : { q: query }), filters, ...(input.sort === undefined ? {} : { sort: input.sort }) });
  const searched = {
    ...(query === undefined ? {} : { query }),
    ...(filters.length === 0 ? {} : { filters: filters.map((f) => `${f.attribute}=${f.value}`) }),
    ...(input.sort === undefined ? {} : { sort: String(result.searchParameters?.["sortOrder"] ?? input.sort) }),
  };
  const date = result.sourceDate === undefined ? {} : { sourceDate: result.sourceDate };
  // Keep the register's order, with the newest version of an entry where the older one stood.
  const { entries } = newestVersions(result.results);
  if (entries.length === 0) {
    return { status: "empty", searched, ...date, reason: `No entry matches${query === undefined ? "" : ` ${quoteValue(query)}`}. ${GERMAN_HINT} A valid answer, not an error.` };
  }
  const rows = entries.slice(offset, offset + limit).map(summaryOf);
  const notes = query === undefined ? [] : [HIT_NOTE];
  if (result.sortIgnored !== undefined) notes.push(`The register did not apply the sort ${result.sortIgnored.requested}; the order is ${result.sortIgnored.applied ?? "its default"}.`);
  return {
    ...pageStatus(offset, limit, entries.length, "entries match"),
    searched,
    ...date,
    total: entries.length,
    entries: rows,
    ...(offset + rows.length < entries.length ? { nextOffset: offset + rows.length } : {}),
    notes,
  };
}

export type EntryLookup =
  | { status: "ok"; searched: { registerNumber: string }; sourceDate?: string; summary: EntrySummary; entry: RegisterEntry }
  | { status: "empty"; searched: { registerNumber: string }; reason: string };

/** One entry in full by its register number (`R002822`), the newest version. */
export async function getEntry(client: LobbyregisterClient, input: { registerNumber: string }): Promise<EntryLookup> {
  const registerNumber = assertValid("registerNumber", String(input.registerNumber ?? "").trim().toUpperCase(), (v) =>
    /^R\d{6}$/.test(v) ? undefined : 'Expected a register number: R and six digits, e.g. "R002822".',
  );
  const result = await client.search({ q: registerNumber });
  const { entries } = newestVersions(result.results.filter((e) => text(e, "registerNumber") === registerNumber));
  const entry = entries[0];
  const searched = { registerNumber };
  if (entry === undefined) {
    return { status: "empty", searched, reason: `The register has no entry ${registerNumber}: a register number comes from another tool's answer; an entry removed from the register is no longer searchable.` };
  }
  return { status: "ok", searched, ...(result.sourceDate === undefined ? {} : { sourceDate: result.sourceDate }), summary: summaryOf(entry), entry };
}
