# lobbyregister-cli — Claude Code Skills

A set of [Claude Code](https://code.claude.com/docs/en/skills) **Agent Skills** for German
lobby-register intelligence, all powered by the **[lobbyregister](README.md)** CLI over the
open [Lobbyregister](https://www.lobbyregister.bundestag.de/) search API
(`lobbyregister.bundestag.de/sucheJson`) — the federal register of interest
representatives (lobbyists) before the Bundestag and the federal government.

Each skill teaches Claude how to drive the `lobbyregister` CLI to answer a specific,
real-world question — "who lobbies on hydrogen?", "who declares the biggest lobbying
budgets in energy?", "which former MdBs are now lobbyists?" — and to report the answer with
evidence and the right caveats rather than guesswork. The bare CLI returns one big array of
raw, schema-versioned register entries; the skills do the cross-entry aggregation,
ranking, filtering and flagging it deliberately doesn't, and encode the parts that are easy
to get wrong (spend is a *range* not a number, German-only search terms, the per-institution
nesting of the revolving-door field).

## Skills

| Skill | What it does | Ask it… |
|---|---|---|
| **lobbyregister-sector-brief** | Turns one topic search into a ranked briefing: actor mix (company/association/NGO/consultancy), top declared spenders, common interest tags, and transparency flags. | "who lobbies on Wasserstoff?", "which groups are registered for pharma?", "lobbying briefing on Klimaschutz" |
| **lobbyregister-money-ranking** | "Follow the money" — ranks registered lobbyists by the declared lobbying-spend *range*, for a topic or the whole register. | "who spends the most on lobbying?", "biggest lobbying budgets in energy", "rank lobbyists by expenses" |
| **lobbyregister-revolving-door** | Surfaces registered lobbyists who recently held a Bundestag seat or government office, with role, ministry and end date. | "which former MdBs are now lobbyists?", "revolving door in the register", "ex-officials lobbying on energy?" |
| **lobbyregister-legislative-engagement** | Activity-led (not money-led) league table — ranks entries by formal statements filed, regulatory projects engaged, and lobbying contracts held. | "who files the most statements on legislation?", "most active lobbyists on energy", "which agencies hold the most contracts?" |
| **lobbyregister-new-entrants** | Time view of register churn — who newly registered and who recently went inactive, keyed on the registration date (not the last-edited date). | "who newly registered on hydrogen this year?", "new lobbyists since the election", "who deregistered on pharma?" |

## Requirements

- **[Claude Code](https://code.claude.com/docs/en/overview)** (or any harness that loads
  Agent Skills).
- **The `lobbyregister` CLI** installed globally:
  ```bash
  npm i -g @maschinenlesbar.org/lobbyregister-cli   # installs the `lobbyregister` bin
  ```
  No API key is required — the Lobbyregister search API is free, open, and read-only.

## Installation

### Plugin marketplace (recommended)

This repo is a Claude Code **plugin marketplace**, so installation is two commands inside
Claude Code:

```
/plugin marketplace add maschinenlesbar-org/lobbyregister-cli
/plugin install lobbyregister@lobbyregister-skills
```

The first command registers the marketplace; the second installs the `lobbyregister`
plugin, which bundles all five skills. Update later with `/plugin marketplace update`.

### Manual (copy the skill folders)

Prefer not to use the marketplace? Copy the skills into your **personal** directory
(available across all your projects):

```bash
git clone https://github.com/maschinenlesbar-org/lobbyregister-cli tmp-skills
mkdir -p ~/.claude/skills
cp -R tmp-skills/skills/* ~/.claude/skills/
rm -rf tmp-skills
```

…or into a single project's `.claude/skills/` by swapping `~/.claude/skills` for
`.claude/skills`. Each skill lives in its own directory with a `SKILL.md`, e.g.
`skills/lobbyregister-sector-brief/SKILL.md`. Start a new Claude Code session and the
skills are picked up automatically.

## Usage

You don't normally invoke these by name — Claude auto-selects the right skill from your
request. Just ask in natural language:

> Who lobbies the Bundestag on hydrogen, and which of them spend the most?

> Rank the registered lobbyists in the energy sector by declared lobbying budget.

> Are any former Bundestag members or government officials now lobbying on defence?

You can also invoke a skill explicitly with its slash command, e.g.
`/lobbyregister-sector-brief`.

## How it works

Every skill is a single `SKILL.md` — a short, model-facing playbook describing which
`lobbyregister` subcommands to call (just `search` and `count`), how to slice the JSON, and
how to interpret it. The skills encode the non-obvious parts of this API, for example:

- **declared spend is a `{from, to}` euro *range*, not a number** — rank on `to`, always
  present both ends as a band, and label it "declared"; `{0,0}` means "below threshold /
  none", while `null` means "not declared" — coalesce to 0 before sorting either way
  (see **lobbyregister-money-ranking**);
- **search is German-only** — querying English words finds little; map the topic to its
  German keyword (hydrogen → `Wasserstoff`, climate → `Klimaschutz`) and a bare `search`
  with no query returns the *entire* register (~6,900 entries);
- **paging is client-side** — `/sucheJson` ignores `--page`/`--page-size` and returns every
  match in one response; `resultCount` (and the `count` command) is always the true total,
  so one `search` call gives you the whole set to aggregate;
- **the revolving-door role nests by institution** — read `recentGovernmentFunction.type.code`
  first, then pull the role from the matching sub-object: `houseOfRepresentatives.function.de`
  for the Bundestag, `federalGovernment.function.de` (an object, with a `department`) for
  the Bundesregierung, `federalAdministration.function` (a plain string, with a
  `supremeFederalAuthority`) for the Bundesverwaltung — a blind fallback prints `?`
  (see **lobbyregister-revolving-door**);
- **entry names carry stray double / trailing spaces** and several fields
  (`financialExpensesEuro`, `employeeFTE`, the count objects) are frequently `null` — trim
  for display, coalesce before maths, and never sort without a `// 0` fallback.

## Contributing

This project does not accept external code contributions (see
[CONTRIBUTING.md](CONTRIBUTING.md)). When adding a skill internally, keep `SKILL.md`
focused, give it a `description` with concrete trigger phrases, and follow the
[official skill format](https://code.claude.com/docs/en/skills).

## License

[AGPL-3.0-or-later](LICENSE) © Sebastian Schürmann. See [LICENSING.md](LICENSING.md) for
the dual-licensing / commercial option.
