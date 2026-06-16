---
name: lobbyregister-new-entrants
description: >
  Track movement in and out of the German lobby register over time — who newly
  registered and who recently went inactive, using the lobbyregister-cli.
  Trigger when the user asks "who newly registered to lobby on hydrogen?", "new
  lobbyists since the election", "which interest groups appeared this year?",
  "who deregistered / went inactive on pharma?", or wants a "what's changed
  lately" monitor for a topic or the whole register. Keys on the registration
  date, not the last-edited date — so it finds genuine newcomers, not entries
  that were merely updated.
version: 1.0.0
userInvocable: true
---

# Lobbyregister New Entrants

Answer "who's *new*?" (and "who just *left*?") in the German lobby register. The register
grows and churns continuously — hundreds of entries register each year and hundreds go
inactive — but the search API hands back one flat array with no time view. This skill
slices that array by date into a clean "since <date>" briefing: fresh registrations first,
recent deregistrations second.

## Tooling

This skill drives the `lobbyregister` command. **Before anything else, validate it is available** — run `command -v lobbyregister` (or `lobbyregister --version`). If it is not on your PATH, STOP and inform the user that the `lobbyregister` CLI (`@maschinenlesbar.org/lobbyregister-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

All data comes from the `lobbyregister` CLI over the open German Lobbyregister search API (`/sucheJson`). It is read-only, needs **no API key**, and exposes just two commands: `search` and `count`. Always pass `--results-only --compact`. An empty result set (`results: []`, exit `0`) is valid — it means nobody matches, not an error.

## Step 1 — Pull the set, newest registration first

Scope to the user's topic (German keyword) or the whole register, and sort by registration
date so the newcomers are at the top:

```bash
# topic-scoped, newest registrations first
lobbyregister search Wasserstoff --sort REGISTRATION_DESC --results-only --compact > /tmp/ne.json
# whole register (~6,900 entries) — the firehose of everything new
lobbyregister search             --sort REGISTRATION_DESC --results-only --compact > /tmp/ne.json
```

> **`--sort REGISTRATION_DESC` orders by `firstPublicationDate`** (when the entry first
> appeared), which is exactly the "new entrant" signal. The endpoint returns every match in
> one response regardless of `--page`/`--page-size`, so one `search` gives the full set and
> you filter the window yourself in Step 3. Use the German term (hydrogen → `Wasserstoff`,
> climate → `Klimaschutz`); an English query finds little.

## Step 2 — The date fields (read this — they are easy to confuse)

| Path | Meaning |
|---|---|
| `accountDetails.firstPublicationDate` | **When the entry first entered the register.** This is the *new-entrant* date — sort and filter on this. |
| `registerEntryDetails.validFromDate` | When the **current version** took effect. Bumped on *every* edit. |
| `accountDetails.lastUpdateDate` | Last modification — same "latest edit" meaning as `validFromDate`. |
| `accountDetails.activeLobbyist` | `false` = the entry is no longer an active lobbyist. |
| `accountDetails.inactiveLobbyistStartDate` | When it went inactive — the *exit* date (present on ~660 entries). |
| `lobbyistIdentity.name` | Who registered / left (trim stray double spaces for display). |
| `registerNumber` / `registerEntryDetails.detailsPageUrl` | Cite + drill-down link. |

> **The core trap: do NOT use `validFromDate` (or `lastUpdateDate`) to find newcomers.**
> They reflect the *latest edit*, not the registration. A lobbyist registered in 2022 who
> tweaked their entry last week shows a 2026 `validFromDate` while its
> `firstPublicationDate` is still 2022 — that is an **update, not a new entry**. Filtering
> on `validFromDate` silently floods the "new" list with years-old lobbyists. Always key
> "new entrant" on `firstPublicationDate`. (If the user genuinely wants *recently updated*
> entries, that's a different question — use `validFromDate`/`lastUpdateDate` and label it
> "updated", not "new".)
>
> Dates are full ISO-8601 timestamps with offset (`2026-06-15T08:08:54.817+02:00`).
> Comparing the leading `YYYY-MM-DD` (or `YYYY-MM`) substring lexically is sufficient — no
> date parsing needed.

## Step 3 — Slice the window: arrivals, then departures

Pick the cutoff from the user's ask ("this year" → `2026`, "since the election" → the poll
date, "last 6 months" → compute the `YYYY-MM` floor). Compare on the date prefix.

```bash
SINCE=2026-01-01   # or 2025-02-23 for "since the 2025 election", etc.

# Arrivals — newly registered on/after the cutoff (keyed on firstPublicationDate)
jq -c --arg s "$SINCE" '
  [ .[] | select((.accountDetails.firstPublicationDate // "") [0:10] >= $s) ]
  | sort_by(.accountDetails.firstPublicationDate) | reverse' /tmp/ne.json > /tmp/arrivals.json

# Departures — went inactive on/after the cutoff
jq -c --arg s "$SINCE" '
  [ .[] | select(.accountDetails.activeLobbyist == false
                 and (.accountDetails.inactiveLobbyistStartDate // "") [0:10] >= $s) ]
  | sort_by(.accountDetails.inactiveLobbyistStartDate) | reverse' /tmp/ne.json > /tmp/departures.json
```

> A bare-`search` whole-register sweep registers **hundreds** per year (≈300 in the first
> half of 2026 alone), so for the unscoped case either keep a tight window or report counts
> + the top N rather than every name. For a topic scope the arrival list is usually small
> enough to show in full.

## Step 4 — Brief the user

Lead with the window and the counts, then arrivals (the headline), then departures.

```
Lobbyregister movement on "Wasserstoff" since 2026-01-01

Newly registered (7):
• Süd+Energie GmbH — registered 2026-06-15 · company · lobbies on Erneuerbare Energien · R0… 
• Enerparc AG — registered 2026-06-08 · company · R0…
  …

Went inactive (2):
• Beispiel e.V. — inactive since 2026-03-11 (was: industry association) · R0…

Net: +5 over the period.
```

Rules:
- **Lead with the window and the net change** ("+7 registered, −2 inactive since <date>").
  The flow over time is the story this skill tells.
- State each newcomer's **`firstPublicationDate`** explicitly — that date *is* the finding;
  never substitute `validFromDate`.
- For context, pair a newcomer with its `activity.de` (company / association / consultancy…)
  and one or two `fieldsOfInterest[].de` tags so the reader sees *what kind* of actor arrived.
- Trim stray spaces in names; cite `registerNumber` and offer `detailsPageUrl`.
- If the window yields zero arrivals, say so plainly — "no new registrations on <topic>
  since <date>" is a valid, informative answer.
- This skill reports *registration/deregistration events*, not why an entry left or what it
  lobbies for in detail — for a full topic profile hand off to **lobbyregister-sector-brief**,
  and for ex-official newcomers to **lobbyregister-revolving-door**.
- Don't infer dates the data doesn't carry; a missing `inactiveLobbyistStartDate` on an
  inactive entry = "exit date not recorded", not "still active".
