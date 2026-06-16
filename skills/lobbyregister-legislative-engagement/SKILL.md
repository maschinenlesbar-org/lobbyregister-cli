---
name: lobbyregister-legislative-engagement
description: >
  Rank German lobby-register entries by how actively they engage in
  lawmaking — the number of formal statements they filed, regulatory projects
  they worked, and lobbying contracts they hold, using the lobbyregister-cli.
  Trigger when the user asks "who files the most statements on legislation?",
  "most legislatively active lobbyists on energy", "who's involved in the most
  regulatory projects?", "which consultancies hold the most lobbying
  contracts?", or wants an activity-led (not money-led) league table. The
  footprint-of-engagement complement to lobbyregister-money-ranking.
version: 1.0.0
userInvocable: true
---

# Lobbyregister Legislative Engagement

Answer "who is most *active* in shaping legislation?" — ranked by engagement volume rather
than by euros. The register records, per entry, how many formal **statements**
(Stellungnahmen) it filed, how many **regulatory projects** (Vorhaben) it engaged on, and
how many lobbying **contracts** it holds. This skill turns those counts into a league table.
A big-budget association and a hyperactive-but-cheap one rank very differently here than in
the money table — that gap is the point.

## Tooling

This skill drives the `lobbyregister` command. **Before anything else, validate it is available** — run `command -v lobbyregister` (or `lobbyregister --version`). If it is not on your PATH, STOP and inform the user that the `lobbyregister` CLI (`@maschinenlesbar.org/lobbyregister-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

All data comes from the `lobbyregister` CLI over the open German Lobbyregister search API (`/sucheJson`). It is read-only, needs **no API key**, and exposes just two commands: `search` and `count`. Always pass `--results-only --compact`. An empty result set (`results: []`, exit `0`) is valid.

## Step 1 — Pull the set

Scope to the user's topic (German keyword) or the whole register. The endpoint returns every
match in one response, so a single `search` gives the full set to rank client-side:

```bash
# topic-scoped
lobbyregister search Energie --results-only --compact > /tmp/le.json
# whole register (~6,900 entries) — the all-comers league table
lobbyregister search         --results-only --compact > /tmp/le.json
```

> There is **no server-side sort by these counts** (`--sort` only offers RELEVANCE / 
> REGISTRATION orderings), so you rank with `jq` in Step 3. Use the German term (energy →
> `Energie`, hydrogen → `Wasserstoff`); an English query finds little.

## Step 2 — The three engagement metrics

| Path | Meaning |
|---|---|
| `statements.statementsCount` | Count of formal **statements / Stellungnahmen** the entry filed on legislation. The most direct "footprint on lawmaking" signal — **lead with this**. |
| `regulatoryProjects.regulatoryProjectsCount` | Count of distinct **regulatory projects / Vorhaben** the entry is engaged on — breadth across the legislative agenda. |
| `contracts.contractsCount` | Count of lobbying **contracts** held — mostly non-zero for consultancies / agencies lobbying *on behalf of clients*; usually `0` for in-house lobbyists. |
| `lobbyistIdentity.name` | The organisation / person (trim stray double spaces). |
| `activitiesAndInterests.activity.de` | Actor type — company, industry association, consultancy… (context for the ranking). |
| `accountDetails.activeLobbyist` | `false` = inactive; exclude from the ranking by default, note how many dropped. |
| `registerNumber` / `registerEntryDetails.detailsPageUrl` | Cite + drill-down link. |

> **These are counts, not contents.** The search API returns *how many* statements /
> projects / contracts, **not** the statement texts, the bill titles, or the client names.
> So this skill ranks *how much* an entry engages, never *what it said* or *which law* —
> be explicit about that when briefing, and don't imply you can see the substance. All
> three can be `0`; treat missing as `0` (`// 0`) before sorting.

## Step 3 — Rank

Build the table for the metric the user cares about (default: statements), excluding inactive
entries. Pull all three counts so you can show the fuller picture:

```bash
jq -r '
  [ .[]
    | select(.accountDetails.activeLobbyist != false)
    | { name: (.lobbyistIdentity.name | gsub("  +";" ") | gsub("^ +| +$";"")),
        stmts: (.statements.statementsCount // 0),
        proj:  (.regulatoryProjects.regulatoryProjectsCount // 0),
        contr: (.contracts.contractsCount // 0),
        actor: (.activitiesAndInterests.activity.de // "?"),
        reg:   .registerNumber } ]
  | sort_by(-.stmts)            # swap to -.proj or -.contr per the user ask
  | .[:15][]
  | "\(.stmts | tostring | (" "*(4-length)) + .)  proj=\(.proj)  contr=\(.contr)  \(.name)  [\(.reg)]"
' /tmp/le.json
```

> **Pick the metric to the question.** "Most statements" → `statementsCount`; "engaged on
> the most projects / broadest agenda" → `regulatoryProjectsCount`; "most client contracts"
> → `contractsCount` (this is the one that surfaces the big agencies/consultancies). When
> unsure, lead with statements and show projects + contracts alongside so the reader sees
> all three.

## Step 4 — Brief the user

Lead with the metric and scope, then the ranked table, then a note on what the counts do and
don't mean.

```
Most legislatively active on "Energie" — ranked by statements filed (active entries)

  #  stmts  projects  contracts  who
  1   175     230        0       BDEW Bundesverband Energie/Wasser   (industry assoc.) R0…
  2   142     188        0       Verband der Chemischen Industrie    (industry assoc.) R0…
  …
Top by contracts (agencies lobbying for clients): Agentur X (23), …

Counts = volume of engagement, not its content: the register reports how many statements /
projects / contracts, not their text or which laws.
```

Rules:
- **State which metric you ranked on** in the header, and show the other two columns for
  context — the divergence between them is often the story (high projects + zero contracts =
  a busy in-house association; high contracts = an agency working for many clients).
- **Counts measure footprint, not influence or content.** Say so. Never describe *what* an
  entry argued or *which* bill — the API doesn't carry it. Offer the `detailsPageUrl` for
  anyone who wants the actual statements on the register website.
- Exclude `activeLobbyist === false` from the ranking by default; report how many you dropped.
- Trim stray spaces in names; cite `registerNumber`.
- Many entries score `0` on all three (registered but not yet recorded as engaging) — that's
  valid; rank them last, don't drop them silently if the user wants the full picture.
- For a money-led table use **lobbyregister-money-ranking**; for the sector overview use
  **lobbyregister-sector-brief**. This skill is the engagement-volume cut.
