# Data license

> **This tool does not include, host, or redistribute any data.**
> `lobbyregister-cli` is a *client*. It only accesses data served live by the
> **Lobbyregister beim Deutschen Bundestag**. That data is the Bundestag's and is
> governed by **their** terms, summarized below. The license of this CLI's own
> source code is a separate matter — see [LICENSING.md](LICENSING.md).

| | |
|---|---|
| **Data provider** | Deutscher Bundestag (registerführende Stelle) |
| **API / source** | `https://www.lobbyregister.bundestag.de` (public `/sucheJson`); documented Open-Data REST API: `https://api.lobbyregister.bundestag.de/rest/v2/` |
| **Data license** | **Custom terms.** Published as statutory machine-readable open data (§ 4 Abs. 2 LobbyRG) but with **no standard open-data license** (no `dl-de`, no CC). |
| **Authoritative terms** | https://www.bundestag.de/impressum · copyright notice: https://www.lobbyregister.bundestag.de/informationen-und-hilfe/hinweise-zum-urheberrecht |
| **Attribution** | Recommended (no mandated string found). |
| **Commercial use** | **Unclear / restrictive** — the Bundestag Impressum permits download/print "für den privaten Gebrauch" and prohibits "die kommerzielle Verwendung". |
| **Redistribution / modification** | No explicit open grant; for *amtliche Werke* the Bundestag requires unaltered use (§ 62 UrhG) + source attribution (§ 63 UrhG). |

## Notes & caveats

- The register data is **mandated** to be published machine-readably by § 4 Abs. 2
  Lobbyregistergesetz, but no reuse license is attached — the Bundestag's general
  (restrictive, private-use-oriented) website terms apply. Whether they bind this
  statutory transparency register as strictly is genuinely ambiguous; seek written
  clarification from the registerführende Stelle for commercial reuse.
- Entries may contain **third-party copyrighted material** in uploaded documents
  (Stellungnahmen/Gutachten) — "Eine Nutzung ist nur im urheberrechtlich
  zulässigen Rahmen erlaubt."
- Entries contain **personal data** (names, financial/personnel data) — GDPR/DSGVO
  obligations apply to reuse, independent of copyright.

## Attribution (recommended)

```
Quelle: Lobbyregister beim Deutschen Bundestag
(https://www.lobbyregister.bundestag.de) — Daten gemäß § 4 Abs. 2
Lobbyregistergesetz; es gelten die Nutzungsbedingungen des Deutschen Bundestages.
```

## Sources

- https://www.lobbyregister.bundestag.de/informationen-und-hilfe/open-data-1049716 — Open Data / API page
- https://www.bundestag.de/impressum — Bundestag usage terms (private use; commercial prohibited)
- https://www.gesetze-im-internet.de/lobbyrg/__4.html — § 4 Abs. 2 LobbyRG

---

*Good-faith summary compiled 2026-06-16; not legal advice. The provider's terms
are authoritative and can change — verify at the source, and obtain clarification
before commercial reuse or redistribution.*
