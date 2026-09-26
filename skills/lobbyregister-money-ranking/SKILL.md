---
name: lobbyregister-money-ranking
description: >
  Follow the money in the German lobby register — rank registered lobbyists by
  the lobbying spend they declare, using the lobbyregister-cli. Trigger when the
  user asks "who spends the most on lobbying?", "biggest lobbying budgets in
  energy", "top-spending lobbyists on pharma", "rank by lobbying expenses", or
  wants a money-led league table for a topic or the whole register. Handles the
  declared-spend value being a euro *range*, not a number, and the null / zero
  declarations.
compatibility: >
  Requires the `lobbyregister` CLI (npm package
  @maschinenlesbar.org/lobbyregister-cli) on PATH, installed by the user; the
  skill never installs it. Uses jq for JSON filtering. Network access to
  www.lobbyregister.bundestag.de.
---

# Lobbyregister Money Ranking

Produce a "follow the money" league table: the registered interest representatives that
declare the **largest lobbying budgets**, for a topic or across the whole register. The
CLI hands back raw entries with spend buried inside each; this skill extracts the declared
euro band, ranks on it correctly, and presents it with the caveats it demands.

## Tooling

This skill drives the `lobbyregister` command. **Before anything else, validate it is available** — run `command -v lobbyregister` (or `lobbyregister --version`). If it is not on your PATH, STOP and inform the user that the `lobbyregister` CLI (`@maschinenlesbar.org/lobbyregister-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

This skill also filters JSON with `jq`. **Validate it too** — run `command -v jq`. If it is missing, inform the user that `jq` is not installed — installing it is their responsibility; never install it yourself — and carry on without it: filter the CLI output with `node -e` instead (Node is already on your PATH, since the CLI runs on it).

Data comes from the `lobbyregister` CLI over the open German Lobbyregister search API — read-only, **no API key**, two commands (`search`, `count`).

Always `--results-only --compact` to get one JSON array for `jq`. `"resultCount": 0` /
`results: []` (exit `0`) is a valid "nobody matched", not an error.

## Step 1 — Fetch the candidate set

For a topic, search the **German** keyword; for "the whole register" run `search` with no
query (returns ~6 900 entries — large but fine to rank). The endpoint returns *all* matches
in one response (paging is client-side; `resultCount` is the true total), so one call
suffices:

```bash
lobbyregister search Energie --results-only --compact > /tmp/money.json    # topic
lobbyregister search          --results-only --compact > /tmp/money.json    # whole register
```

> **The API can return two versions of one entry.** On 2026-09-26 `R000534` (BDI) came back
> twice — an older version (`registerEntryId` 84196) and the current one (85248) — so
> `resultCount` (and `count`) was one higher than the number of distinct entries (Energie
> 2,409 vs 2,408; whole register 6,989 vs 6,988), and a ranking listed BDI twice. Keep the
> newest version per `registerNumber` right after fetching, and count entries from the
> deduplicated array:
>
> ```bash
> jq -c 'group_by(.registerNumber) | map(max_by(.registerEntryDetails.validFromDate))' \
>   /tmp/money.json > /tmp/money.json.tmp && mv /tmp/money.json.tmp /tmp/money.json
> ```

> **A topic only selects the entries; the spend is not per topic.** `financialExpenses` is
> an entry's total declared lobbying spend across everything it lobbies on, so a broad
> association tops many topic tables. Head the table "entries matching <term>, by total
> declared spend", never "spend on <term>".

> **A keyword hit isn't always visible in the returned data.** The search also matches text
> that `/sucheJson` doesn't return, such as the activity description on the entry's register
> page: of 216 results for `künstliche Intelligenz` on 2026-09-15, 200 contained none of
> "Intelligenz", "künstlich", "KI" or "AI" anywhere in their JSON. Read a topic set as
> "entries whose register text mentions the term", not "organisations that mainly lobby on
> it"; open `detailsPageUrl` to see why an entry matched.

## Step 2 — Extract the declared spend — it's a RANGE

The number to rank on lives at:

```
financialExpenses.financialExpensesEuro = { "from": <int>, "to": <int> }   // or null
```

> **This is a band, never a single figure.** Entries declare a *bracket*, e.g.
> `{from: 12730001, to: 12740000}` ("between €12.73M and €12.74M"). Rank on `to`
> (descending) as the upper bound, but **always present both ends** as a range. Pitfalls,
> all observed live:
> - `financialExpensesEuro` can be **`null`**. On 2026-09-26 all 120 such entries came with
>   `financialExpenses.relatedFiscalYearFinished: false`: the entry's first fiscal year is
>   not over yet, so there is no figure to declare. Coalesce to 0 before sorting
>   (`(.financialExpenses.financialExpensesEuro.to // 0)`), and label such entries "no
>   figure yet (first fiscal year not completed)" — not "€0", not "refused".
> - An entry can also **refuse** to state its spend: `financialExpenses.refuseFinancialExpensesInformation`
>   is then `true`, with the reason in `…refuseFinancialExpensesInformationReason`. Label it
>   "refused" and quote the reason.
> - `{from: 0, to: 0}` is common and means exactly **€0 declared**. There is no reporting
>   threshold: every non-zero declaration is a €10,000 band starting at 1 (`1–10,000`,
>   `12,430,001–12,440,000`). It sits at the bottom of the table.
> - `financialExpenses.relatedFiscalYearStart` / `…End` give the **period** the figure
>   covers — surface it so two entries' bands are comparable (most are a calendar year).

(`--sort FINANCIALEXPENSES_DESC` sorts by spend on the server too, but the response is
the whole set either way; rank the deduplicated array with `jq` so the rules below apply.)

A ready `jq` for the table (active entries only; see the rules):

```bash
jq -r 'map(select(.accountDetails.activeLobbyist != false))
  | sort_by(.financialExpenses.financialExpensesEuro.to // 0) | reverse
  | .[0:15][]
  | [ .registerNumber,
      (.financialExpenses.financialExpensesEuro.from // "n/a"),
      (.financialExpenses.financialExpensesEuro.to   // "n/a"),
      .lobbyistIdentity.name ] | @tsv' /tmp/money.json

# how many inactive entries the table left out
jq '[.[] | select(.accountDetails.activeLobbyist == false)] | length' /tmp/money.json
```

## Step 3 — Context fields worth pulling per row

| Path | Why |
|---|---|
| `lobbyistIdentity.name` | The spender (trim stray double/trailing spaces for display) |
| `registerNumber` | Cite it |
| `activitiesAndInterests.activity.de` | Company / industry assoc. / NGO / consultancy — who's spending |
| `employeesInvolvedInLobbying.employeeFTE` | Staff on lobbying — pair with budget for a "€ per FTE" sense (FTE can be `null`) |
| `accountDetails.activeLobbyist` | Exclude `false` (inactive) from the league table by default |
| `accountDetails.accountHasCodexViolations` | `true` → flag a big spender that also broke the code |
| `registerEntryDetails.detailsPageUrl` | Citation / drill-down link |

## Step 4 — Present the league table

```
Top total declared lobbying spend — entries matching "Energie" (2,401 registered, 2,185 active; 2026-09-15)
Figures are self-declared annual ranges (FY2025) for each entry's lobbying as a whole, not
for "Energie"; €0–0 = €0 declared.

 #  Declared spend (range)     Lobbyist                                                  Type             FTE
 1  €15.83M – €15.84M          Gesamtverband der Deutschen Versicherungswirtschaft e.V.  industry assoc.  31.2
 2  €12.43M – €12.44M          Verbraucherzentrale Bundesverband e.V.                    NGO              75.5
 3  €10.27M – €10.28M          Verband der Automobilindustrie e.V.                       industry assoc.  27.3
 …
(262 active entries declared €0 or have no figure yet; 216 inactive entries left out.)
```

Rules:
- **Always a range, always "declared".** These are self-reported brackets, not audited
  spend; say so once, up front.
- Sort by `to` descending; tie-break by `from`. Coalesce `null`/missing to 0 so the sort
  is stable, but render those as "no figure yet" (or "refused", see above), not "€0".
- State the **fiscal period** (`relatedFiscalYearStart`/`End`) the figures cover; warn if
  entries in the table span different periods.
- Exclude `activeLobbyist === false` by default; report how many you dropped.
- Cap the table (~10–15 rows) unless asked for more; mention how many declared zero/none.
- Flag any top-table entry with `accountHasCodexViolations === true` or
  `recentGovernmentFunctionPresent === true`.
- For a footprint comparison across topics, `count <term>` per topic prints just the totals
  (it still downloads each topic's full set; the API has no count-only mode).
