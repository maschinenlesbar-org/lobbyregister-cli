---
name: lobbyregister-sector-brief
description: >
  Profile who lobbies the German Bundestag on a topic, using the
  lobbyregister-cli. Trigger when the user asks "who lobbies on hydrogen?",
  "which organisations are registered for energy / pharma / defence?", "give me
  a lobbying briefing on Klimaschutz", "what interest groups work on AI in
  Germany?", or wants an overview of the players in a sector. Turns one search
  into a ranked, deduplicated briefing — top spenders, headcount, activity-type
  mix and field-of-interest tags — instead of raw register JSON.
version: 1.0.0
userInvocable: true
---

# Lobbyregister Sector Brief

Answer "who lobbies on <topic>?" with a single, ranked briefing of the registered
interest representatives for that topic — the players, how much they declare spending,
who they are (company vs. association vs. NGO), and what they say they care about.
The CLI returns one large array of raw register entries; the whole job of this skill is
the aggregation, ranking and summarisation it deliberately doesn't do.

## Tooling

This skill drives the `lobbyregister` command. **Before anything else, validate it is available** — run `command -v lobbyregister` (or `lobbyregister --version`). If it is not on your PATH, STOP and inform the user that the `lobbyregister` CLI (`@maschinenlesbar.org/lobbyregister-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

All data comes from the `lobbyregister` CLI over the open German Lobbyregister search API (`/sucheJson`). It is read-only, needs **no API key**, and exposes just two commands: `search` and `count`.

Always pass `--results-only --compact` so you get a single-line JSON **array** ready for
`jq`. A search that matches nothing prints a full envelope with `"resultCount": 0` and
`"results": []` (exit `0`) — that is **not** an error, it means "no one is registered for
that term". The query is German: search `Wasserstoff`, not "hydrogen" (see Step 1).

## Step 1 — Size the topic, then pull the entries

First gauge the footprint cheaply:

```bash
lobbyregister count Wasserstoff      # → { "query": "Wasserstoff", "resultCount": 402 }
```

Then fetch the records. The endpoint **returns every match in one response** regardless of
`--page` / `--page-size` (those slice client-side; `resultCount` is always the true total),
so a single `search` gives you the whole set:

```bash
lobbyregister search Wasserstoff --results-only --compact > /tmp/sector.json
```

> **Use the German term.** The register's text is German; querying English words finds
> little. Map the user's topic to the German keyword (hydrogen → `Wasserstoff`, climate →
> `Klimaschutz`, defence → `Rüstung`/`Verteidigung`, AI → `künstliche Intelligenz` or
> `KI`). If a term is ambiguous or returns a surprisingly low `count`, try a synonym and
> say which term you used. A bare `search` with no query returns the **entire** register
> (~6 900 entries) — only do that when the user truly wants "all lobbyists".

## Step 2 — The fields that matter

Each entry is a large, schema-versioned object. The keys you actually brief on:

| Path | Meaning |
|---|---|
| `registerNumber` | Stable id, e.g. `R008020` — cite it |
| `lobbyistIdentity.name` | The organisation / person name |
| `lobbyistIdentity.identity` | `ORGANIZATION` or `NATURAL` (a private individual) |
| `activitiesAndInterests.activity.de` | What kind of actor: `Unternehmen` (company), `Wirtschaftsverband…` (industry association), gemeinnützige Org (NGO/charity), `Beratungsunternehmen…` (consultancy), `Berufsverband`, etc. |
| `activitiesAndInterests.fieldsOfInterest[]` | Array of `{code, de, en}` topic tags, e.g. `Erneuerbare Energien`, `Energienetze` — the self-declared interest areas |
| `financialExpenses.financialExpensesEuro` | `{from, to}` **euro range** of declared lobbying spend (or `null`). See Step 3 — it's a band, not a number |
| `employeesInvolvedInLobbying.employeeFTE` | Full-time-equivalent staff on lobbying (number or `null`). `employeeCount` is almost always `null` — use `employeeFTE`. |
| `accountDetails.activeLobbyist` | `true`/`false` — `false` = a deregistered / inactive entry, flag or filter it |
| `accountDetails.accountHasCodexViolations` | `true` = the entity breached the register's code of conduct — always surface |
| `lobbyistIdentity.recentGovernmentFunctionPresent` | `true` = a former MdB / government official (revolving door) — worth a flag here, full treatment in **lobbyregister-revolving-door** |
| `registerEntryDetails.detailsPageUrl` | Public profile URL — give it as the citation link |
| `registerEntryDetails.validFromDate` | When this version of the entry took effect |

## Step 3 — Aggregate

Build the briefing numbers from the array — don't enumerate all 400 entries:

- **Actor mix.** Group `activitiesAndInterests.activity.de` and report the breakdown
  (e.g. "233 companies, 49 industry associations, 34 NGOs…"). This is the single most
  informative summary of who lobbies a sector.
- **Top spenders.** Sort by `financialExpenses.financialExpensesEuro.to` (descending),
  treating `null` as 0, and list the top ~10. **The value is a range** like
  `{from: 12730001, to: 12740000}` — present it as a band ("€12.73M–€12.74M"), never a
  point figure. Many entries are `{from: 0, to: 0}` (declared zero or below threshold).
- **Field-of-interest tags.** Tally `fieldsOfInterest[].de` across the set to show the
  sub-themes within the topic (e.g. within Wasserstoff: Energienetze, Erneuerbare
  Energien, Nachhaltigkeit…).
- **Flags.** Count and list any `accountHasCodexViolations === true`,
  `recentGovernmentFunctionPresent === true`, and `activeLobbyist === false` entries —
  these are the newsworthy ones.

> **Watch the data quirks.** Names sometimes carry stray leading/trailing or double
> spaces (`"Andreas  Rimkus H2-Botschaft "`) — trim for display, keep the original for
> matching. `financialExpensesEuro`, `employeeFTE` and the count objects can each be
> `null`; never sort or sum without a `// 0` fallback. The `count` command is a thin
> wrapper that reads back `resultCount`; trust it for totals rather than `length` on a
> sliced array.

## Step 4 — Brief the user

Lead with the total and the actor mix, then the ranked players, then the flags.

```
Lobbying on Wasserstoff — 402 registered (385 active)
Actor mix: 233 companies · 49 industry assoc. · 34 NGOs · 24 consultancies · 16 prof. assoc.

Top declared lobbying spend (annual range):
 1. Verband der Automobilindustrie e.V.   €10.27M–€10.28M   industry assoc.   R0…
 2. BDEW Bundesverband Energie/Wasser      €9.27M–€9.28M     industry assoc.   R0…
 3. Verband der Chemischen Industrie e.V.  €9.15M–€9.16M     industry assoc.
 …
Most common interest tags: Erneuerbare Energien, Energienetze, Nachhaltigkeit, …

⚠ Flags: 2 entries are former Bundestag members now lobbying (see revolving-door);
   0 code-of-conduct violations; 17 inactive entries excluded from the ranking.
```

Rules:
- **Summarise, don't dump.** A topic can return 400+ entries; give counts and the top ~10,
  not the whole list. Offer to widen the list or filter (by actor type, by field-of-interest
  tag, by spend threshold) on request.
- Always show spend as a **range with units**, and say "declared" — these are self-reported
  bands, not audited figures, and `{0,0}` means "below threshold or none declared", not
  "no lobbying".
- Cite `registerNumber` and offer `detailsPageUrl` for any entry the user wants to open.
- Exclude `activeLobbyist === false` from rankings by default but say how many you dropped.
- If the user names two topics, run two searches and compare counts/spend side by side
  (the `count` command is perfect for a quick footprint comparison across terms).
- Don't invent figures the data doesn't carry; `null` financials/FTE = "not declared".
