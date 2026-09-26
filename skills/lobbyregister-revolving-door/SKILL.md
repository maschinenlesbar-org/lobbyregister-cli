---
name: lobbyregister-revolving-door
description: >
  Surface the "revolving door" in the German lobby register — registered
  lobbyists, or the people working for them, who recently held a Bundestag seat
  or a government office, using the lobbyregister-cli. Trigger when the user asks
  "which former MdBs are now lobbyists?", "revolving door in the lobby register",
  "ex-politicians lobbying on energy", "any former government officials
  registered for pharma?", or wants a conflict-of-interest / transparency check
  on a topic or the whole register.
compatibility: >
  Requires the `lobbyregister` CLI (npm package
  @maschinenlesbar.org/lobbyregister-cli) on PATH, installed by the user; the
  skill never installs it. Uses jq for JSON filtering. Network access to
  www.lobbyregister.bundestag.de.
---

# Lobbyregister Revolving Door

Find the registered interest representatives where someone **recently held public office** —
former members of the Bundestag, federal government, or other public functions now working
as lobbyists, legal representatives, entrusted persons or contractors. This is the
register's built-in revolving-door disclosure; the register filters on it server-side, the
CLI returns the details buried inside each entry, and this skill extracts, classifies and
ranks them into a transparency briefing.

## Tooling

This skill drives the `lobbyregister` command. **Before anything else, validate it is available** — run `command -v lobbyregister` (or `lobbyregister --version`). If it is not on your PATH, STOP and inform the user that the `lobbyregister` CLI (`@maschinenlesbar.org/lobbyregister-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

This skill also filters JSON with `jq`. **Validate it too** — run `command -v jq`. If it is missing, inform the user that `jq` is not installed — installing it is their responsibility; never install it yourself — and carry on without it: filter the CLI output with `node -e` instead (Node is already on your PATH, since the CLI runs on it).

Data comes from the `lobbyregister` CLI over the open German Lobbyregister search API — read-only, **no API key**, two commands (`search`, `count`).

Always `--results-only --compact`. An empty result set (`results: []`, exit `0`) is valid.

## Step 1 — Let the register filter, then split by what the JSON shows

The register has a **server-side revolving-door filter**, `--filter revolvingdoordata=true`:
it keeps every entry that records a recent public office for **any** of its people — the
lobbyist, a legal representative, an entrusted person (e.g. an employee who lobbies) or a
contractor. Count first, then fetch the set, scoped to the user's interest:

```bash
lobbyregister count             --filter revolvingdoordata=true   # whole register (680 on 2026-09-26)
lobbyregister count Energie     --filter revolvingdoordata=true   # topic (323 of 2,409)
lobbyregister count Energie                                       # the topic's total, for "N of M"
lobbyregister search Energie --filter revolvingdoordata=true --results-only --compact > /tmp/rd.json
```

Then split the set — the JSON carries the office details **only for the lobbyist
themselves**:

```bash
# office detail in the data (Step 2)
jq -c '[ .[] | select(.lobbyistIdentity.recentGovernmentFunctionPresent == true) ]' /tmp/rd.json
# office held by someone else (employee, entrusted person, …): details only on the register page
jq -r '.[] | select(.lobbyistIdentity.recentGovernmentFunctionPresent != true)
       | [.registerNumber, .lobbyistIdentity.name, .registerEntryDetails.detailsPageUrl] | @tsv' /tmp/rd.json
```

> **Never use the JSON flag alone as the revolving-door count.**
> `lobbyistIdentity.recentGovernmentFunctionPresent === true` covers only a lobbyist who is a
> natural person and held office themselves (every flagged entry was `identity: "NATURAL"`;
> organisations carry `null`). On 2026-09-26 it was set on **39** entries, while the
> register's own filter found **680** (Energie: 19 of 323). For the other entries
> `/sucheJson` returns no names, roles or dates of the office-holder — only the register
> page (`detailsPageUrl`) shows them, e.g. R002822 (UNITI) lists an employee who worked
> for an MdB ("Büroleiter/Persönlicher Referent/…") until 10/23. Report those entries as "revolving-door data on the
> register page" and offer the links; don't invent the role.

> **Narrow on the server.** Repeat `--filter` to split the set without downloading it:
> `revolvingdoorpersontypes=LOBBYIST`, `=LEGAL_REPRESENTATIVE`, `=ENTRUSTED_PERSON`,
> `=CONTRACTOR` (who held the office) and `revolvingdoorareas=HOUSE_OF_REPRESENTATIVES`,
> `=FEDERAL_GOVERNMENT`, `=FEDERAL_ADMINISTRATION` (where). Values of one attribute are
> alternatives, different attributes must all match, so
> `count --filter revolvingdoordata=true --filter revolvingdoorpersontypes=ENTRUSTED_PERSON`
> counts the entries with an entrusted person who held office. An unknown attribute is a
> usage error (exit `2`); a mistyped value matches nothing (`resultCount: 0`), so check the
> spelling before reporting "none".

> **A keyword hit isn't always visible in the returned data.** The search also matches text
> that `/sucheJson` doesn't return, such as the activity description on the entry's register
> page: of 216 results for `künstliche Intelligenz` on 2026-09-15, 200 contained none of
> "Intelligenz", "künstlich", "KI" or "AI" anywhere in their JSON. Read a topic set as
> "entries whose register text mentions the term", not "organisations that mainly lobby on
> it"; open `detailsPageUrl` to see why an entry matched.

## Step 2 — Read the office detail (lobbyist's own office)

For the flagged entries, the detail is under `lobbyistIdentity.recentGovernmentFunction`:

| Path | Meaning |
|---|---|
| `recentGovernmentFunction.type.de` (`.code`) | The institution — read this **first** to know which branch holds the role (see below) |
| `recentGovernmentFunction.ended` | `true` = the office has ended (genuinely "former") |
| `recentGovernmentFunction.endDate` | When it ended, e.g. `2025-03` — gauges how recent the move is |
| `lobbyistIdentity.name` | The person/organisation now lobbying (trim stray double spaces) |

> **The role nesting differs by institution — and the sub-key matches the `type.code`.**
> Read `type.code`, then pull the role from the matching sub-object. The three observed
> live (most are `Bundestag`):
>
> - `HOUSE_OF_REPRESENTATIVES` / `Bundestag` → `houseOfRepresentatives.function.de`
>   (e.g. `Mitglied des Deutschen Bundestages`, or `Funktion für eine Fraktion/Gruppe im
>   Deutschen Bundestag`). **This is the common case** among the flagged entries (25 of
>   38 register-wide on 2026-09-15; the rest were 11 Bundesverwaltung and 2
>   Bundesregierung).
>   Note the `.code` is `HOUSE_OF_REPRESENTATIVES`, *not* `BUNDESTAG` — only the `.de`
>   label reads "Bundestag".
> - `FEDERAL_GOVERNMENT` / `Bundesregierung` → `federalGovernment.function.de` (an
>   **object** with `de`/`en`, e.g. `Parlamentarische/-r Staatssekretär/-in`), plus
>   `federalGovernment.department.title` (the ministry, e.g. BMI).
> - `FEDERAL_ADMINISTRATION` / `Bundesverwaltung` → `federalAdministration.function` (a
>   plain **string**, e.g. `Abteilungsleiter`, *not* an object — don't append `.de`), plus
>   `federalAdministration.supremeFederalAuthority` / `…Short` (the authority, e.g. BMV).
>
> Falling back blindly to `houseOfRepresentatives.function` prints `?` for the executive
> branches — always select on `type.code`. If `ended === false`, the person may **still
> hold** the office — call that out separately from genuine ex-officials.

## Step 3 — Tie it to their lobbying

For each office-holder, pull the lobbying context so the conflict is legible:

| Path | Why |
|---|---|
| `activitiesAndInterests.activity.de` | What they now do (often `Beratungsunternehmen…` — a consultancy) |
| `activitiesAndInterests.fieldsOfInterest[].de` | The policy areas they now lobby on — compare against their former remit |
| `financialExpenses.financialExpensesEuro` | Declared spend `{from,to}` range (or `null`) — present as a band |
| `registerNumber` / `registerEntryDetails.detailsPageUrl` | Cite + drill-down link |
| `accountDetails.activeLobbyist` | `false` = inactive entry; note it |

## Step 4 — Brief the user

```
Revolving door — register entries on "Energie" with revolving-door data (323 of 2,409)
19 of them name the lobbyist's own former office in the data; for the other 304 the
office-holder (employee, entrusted person, …) is shown only on the register page.

• Marco Wanderwitz — former Mitglied des Deutschen Bundestages (Bundestag, ended 2025-03)
  Now: law firm / sole lawyer · lobbies on … · R007660 · https://www.lobbyregister…/…
• Volkmar Vogel — former Parl. Staatssekretär, BMI (Bundesregierung, ended 2021-12)
  Now: consultancy · R005605
• Dr. Sven Halldorn — former Abteilungsleiter, BMV (Bundesverwaltung, ended 2025-06)
  Now: consultancy · R002845
  …

Office held by someone working for the entry (details on the register page):
• UNITI Bundesverband EnergieMittelstand e.V. · R002822 · https://www.lobbyregister…/…
  …

Across the whole register, run the same sweep without a topic term for the full list.
```

Rules:
- Lead with **"N of M"** — N from `count … --filter revolvingdoordata=true`, M from the plain
  `count`. The ratio is the story. Then say how many of the N carry the office detail in
  the data (the flag) and that the rest are documented on the register pages.
- State institution + role + `endDate` for each; distinguish `ended: true` (former) from
  `ended: false` (still in office — a stronger conflict signal).
- Pair former remit with current `fieldsOfInterest` so a same-sector move is visible.
- Show declared spend as a **range**, labelled "declared"; `null` = "not declared".
- Trim stray spaces in names; cite `registerNumber` and offer `detailsPageUrl`.
- This data is a self-disclosure field — report what's declared, don't infer offices the
  data doesn't state. If the filtered count is zero, say so plainly; that's a valid,
  informative answer.
- For a comprehensive audit, sweep the whole register (no query term, with
  `--filter revolvingdoordata=true`) and group the entries by `activity.de`, by
  field-of-interest, or by person type / institution with the filters above.
