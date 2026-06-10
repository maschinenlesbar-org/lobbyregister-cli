---
name: lobbyregister-revolving-door
description: >
  Surface the "revolving door" in the German lobby register — registered
  lobbyists who recently held a Bundestag seat or a government office, using the
  lobbyregister-cli. Trigger when the user asks "which former MdBs are now
  lobbyists?", "revolving door in the lobby register", "ex-politicians lobbying
  on energy", "any former government officials registered for pharma?", or wants
  a conflict-of-interest / transparency check on a topic or the whole register.
version: 1.0.0
userInvocable: true
---

# Lobbyregister Revolving Door

Find the registered interest representatives who **recently held public office** — former
members of the Bundestag, federal government, or other public functions now working as
lobbyists. This is the register's built-in revolving-door disclosure; the CLI returns it
buried inside each entry, and this skill extracts, classifies and ranks it into a
transparency briefing.

## Tooling

This skill drives the `lobbyregister` command. **Before anything else, validate it is available** — run `command -v lobbyregister` (or `lobbyregister --version`). If it is not on your PATH, STOP and inform the user that the `lobbyregister` CLI (`@maschinenlesbar.org/lobbyregister-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

Data comes from the `lobbyregister` CLI over the open German Lobbyregister search API — read-only, **no API key**, two commands (`search`, `count`).

Always `--results-only --compact`. An empty result set (`results: []`, exit `0`) is valid.

## Step 1 — Fetch the set, then filter to office-holders

There is **no server-side filter** for the revolving door — you fetch a set and filter it
yourself. Scope it to the user's interest:

```bash
# topic-scoped (German keyword)
lobbyregister search Energie --results-only --compact > /tmp/rd.json
# whole register (~6,900 entries; the comprehensive sweep)
lobbyregister search          --results-only --compact > /tmp/rd.json
```

Then keep only entries flagged as former office-holders:

```bash
jq -c '[ .[] | select(.lobbyistIdentity.recentGovernmentFunctionPresent == true) ]' /tmp/rd.json
```

> **The flag lives on `lobbyistIdentity`, and is usually on `NATURAL` (individual)
> entries.** `recentGovernmentFunctionPresent === true` is the gate. Most matches have
> `lobbyistIdentity.identity === "NATURAL"`, but an organisation can carry it too — don't
> pre-filter on identity, filter on the flag. The flag is **sparse**: a topic search may
> return only a handful (e.g. 2 of 402 for Wasserstoff), and that small count is itself the
> finding.

## Step 2 — Read the office detail

The detail is under `lobbyistIdentity.recentGovernmentFunction`:

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
> - `BUNDESTAG` / `Bundestag` → `houseOfRepresentatives.function.de`
>   (e.g. `Mitglied des Deutschen Bundestages`).
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
Revolving door — register entries on "Energie" with recent public office (17 of 2,352)

• Marco Wanderwitz — former Mitglied des Deutschen Bundestages (Bundestag, ended 2025-03)
  Now: law firm / sole lawyer · lobbies on … · R007660 · https://www.lobbyregister…/…
• Volkmar Vogel — former Parl. Staatssekretär, BMI (Bundesregierung, ended 2021-12)
  Now: consultancy · R005605
• Dr. Sven Halldorn — former Abteilungsleiter, BMV (Bundesverwaltung, ended 2025-06)
  Now: consultancy · R002845
  …

Across the whole register, run the same sweep without a topic term for the full list.
```

Rules:
- Lead with **"N of M"** — how many of the searched set held office. The ratio is the story.
- State institution + role + `endDate` for each; distinguish `ended: true` (former) from
  `ended: false` (still in office — a stronger conflict signal).
- Pair former remit with current `fieldsOfInterest` so a same-sector move is visible.
- Show declared spend as a **range**, labelled "declared"; `null` = "not declared".
- Trim stray spaces in names; cite `registerNumber` and offer `detailsPageUrl`.
- This data is a self-disclosure field — report what's declared, don't infer offices the
  data doesn't state. If a topic search yields zero office-holders, say so plainly; that's
  a valid, informative answer.
- For a comprehensive audit, sweep the whole register (no query term) and group the
  office-holders by `activity.de` or by field-of-interest.
