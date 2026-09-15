# Examples

Real examples for the Claude Code skills of the `lobbyregister` plugin, one per skill: a request,
the `lobbyregister` commands the skill ran, and the answer Claude gave.

Every example ran against the live API on 15 September 2026 with `lobbyregister` 0.0.7.
The data changes, so your results will differ; the ids and keys shown work for trying the
requests yourself. Long lists are shortened.

To try them, install the CLI and the plugin — see [SKILLS.md](SKILLS.md).

Skills: [lobbyregister-legislative-engagement](#lobbyregister-legislative-engagement) · [lobbyregister-money-ranking](#lobbyregister-money-ranking) · [lobbyregister-new-entrants](#lobbyregister-new-entrants) · [lobbyregister-revolving-door](#lobbyregister-revolving-door) · [lobbyregister-sector-brief](#lobbyregister-sector-brief)

## lobbyregister-legislative-engagement

> Who is most active in shaping health-insurance legislation? Rank the lobbyists by the statements they filed.

```bash
lobbyregister search Krankenversicherung --results-only --compact > le.json   # 816 entries, one call
```

The counts belong to each entry as a whole, not to the topic. The keyword matches any entry
that lists Krankenversicherung among its interests (Bitkom lists 90), so broad associations lead
the table. The skill also picked out the health insurers' own associations for comparison.

```
Most legislatively active entries matching "Krankenversicherung" — ranked by statements filed
776 active entries (40 inactive dropped); 444 have filed at least one statement

  #  stmts  projects  contracts  who
  1   200     222        0       Bitkom e.V.                                    industry assoc.   R000672
  2   191     117        0       Verbraucherzentrale Bundesverband e.V.         NGO               R001211
  3   185     185        0       Deutscher Anwaltverein e.V.                    prof. assoc.      R000952
  4   180     162        0       Bundesverband der Deutschen Industrie e.V.     industry assoc.   R000534
  5   178     171        0       Zentralverband des Deutschen Handwerks (ZDH)   industry assoc.   R002265
  6   137     127        0       VDMA e.V.                                      industry assoc.   R000802
  7   120      46        0       Verband Forschender Arzneimittelhersteller e.V. (vfa)            R000762
  8   106     187        0       Vereinigung der Bayerischen Wirtschaft e. V.   industry assoc.   R000989
  9   102      45        0       Pharma Deutschland e.V.                        industry assoc.   R000739
 10   100      70        0       Bundesärztekammer                              chambers          R002002
  … 766 more; 92 active entries score 0 on all three

Health insurers' associations: Verband der Privaten Krankenversicherung e.V. 46 / 39 / 0 (R000815),
Verband der Ersatzkassen e.V. (vdek) 34 / 13 / 0, BKK Dachverband e.V. 20 / 10 / 0,
AOK-Bundesverband 9 / 11 / 0.
Top by contracts (agencies lobbying for clients): von Beust & Coll. (46), Christ & Company (46),
Rud Pedersen Public Affairs Germany (42), EUTOP Europe (33), Fuchs & Cie. (33).

Counts show how much each entry engages across its whole register record, not just on
health insurance. They carry no statement texts, bill titles or client names.
Details: https://www.lobbyregister.bundestag.de/suche/R000815/85634
```

## lobbyregister-money-ranking

> Who spends the most on lobbying around medicines and pharma?

```bash
lobbyregister count Arzneimittel --compact        # 655
lobbyregister count Pharma --compact              # 307
lobbyregister search Arzneimittel --results-only --compact > money.json
```

`Arzneimittel` matched twice as many entries as `Pharma`, so the skill ranked that set. The term
is broad: the insurers' umbrella association tops the table, and the first drug-maker
association is vfa at #4.

```
Top declared lobbying spend — topic "Arzneimittel" (655 registered, 603 active)
Self-declared annual ranges, FY 2025 for 524 of the 603; €0–0 = below threshold / none.

 #  Declared spend (range)  Lobbyist                                                  Type             FTE
 1  €15.83M – €15.84M       Gesamtverband der Deutschen Versicherungswirtschaft e.V.  industry assoc.  31.21
 2  €12.43M – €12.44M       Verbraucherzentrale Bundesverband e.V.                    NGO              75.45
 3  €9.43M – €9.44M         Verband der Chemischen Industrie e.V.                     industry assoc.  27.94
 4  €5.65M – €5.66M         Verband Forschender Arzneimittelhersteller e.V. (vfa)     industry assoc.  11.21
 5  €5.15M – €5.16M         Bitkom e.V.                                               industry assoc.  24.32
 6  €4.57M – €4.58M         AOK-Bundesverband eGbR                                    private org.     33.55
 7  €4.48M – €4.49M         Deutscher Bauernverband e.V.                              prof. assoc.     19.86
 8  €3.92M – €3.93M         Bundesärztekammer (FY 2024-07-01 – 2025-06-30)            chambers         24.61
 9  €3.32M – €3.33M         Deutsche Akademie der Naturforscher Leopoldina e.V.       research         22.16
10  €3.00M – €3.01M         Rud Pedersen Public Affairs Germany GmbH                  consultancy      17.25
11  €2.72M – €2.73M         Deutscher Caritasverband e. V.                            non-profit       13.35
12  €2.57M – €2.58M         Fraunhofer-Gesellschaft zur Förderung der angewandten Forschung e. V.  research  11.3
13  €2.22M – €2.23M         Evonik Industries AG                                      company          4.65
14  €2.20M – €2.21M         ABDA - Bundesvereinigung Deutscher Apothekerverbände e. V.  private org.   5.6
15  €2.18M – €2.19M         Bayer AG                                                  company          4.59

52 inactive entries dropped; 73 active entries declared €0–0 and 8 declared nothing.
No code-of-conduct violations or recent government functions among the top 15.
```

## lobbyregister-new-entrants

> Which companies and lobbyists newly registered on arms and defence (Rüstung) this year, and who dropped out?

```bash
lobbyregister search Rüstung --sort REGISTRATION_DESC --results-only --compact > ne.json   # 473 entries
```

440 of the 473 entries have a `validFromDate` in 2026, but only 56 first registered this year.
Keying on `firstPublicationDate`, as the skill insists, is what keeps edits out of the list.

```
Lobbyregister movement on "Rüstung" since 2026-01-01
+56 newly registered · −18 went inactive · net +38

Newly registered (56: 37 companies, 12 consultancies, 3 law firms, 4 other):
• ICEYE Intelligence GmbH — registered 2026-09-15 · company · Sonstiges im Bereich "Innere Sicherheit" · R008226
• Dr. Hans-Peter Friedrich — registered 2026-09-14 · law firm / sole lawyer · Innere Sicherheit, Verkehrsinfrastruktur · R008222
• Rift Dynamics AS — 2026-09-11 · company · Rüstungsangelegenheiten, Außenwirtschaft · R008215
• Senop Oy — 2026-09-03 · company · Rüstungsangelegenheiten, Bundeswehrangelegenheiten · R008202
• Cambridge Aerospace Deutschland GmbH — 2026-08-21 · company · Industriepolitik, Verteidigungspolitik · R008179
• Shield AI — 2026-08-07 · company · Außenpolitik, Verteidigungspolitik · R008159
• Hanwha Defence Deutschland GmbH — 2026-07-30 · company · Industriepolitik, Verteidigungspolitik · R008143
• Anduril Industries UK Ltd — 2026-06-01 · company · Rüstungsangelegenheiten · R008039
• DEUTZ Defense Systems GmbH — 2026-02-09 · company · Verteidigungspolitik, Rüstungsangelegenheiten · R007831
  … 47 more; busiest months July (11) and August (9)
  Four newcomers are flagged as former office-holders: Friedrich, Karsten Klein (R008114),
  Oliver Grundmann (R007878), Till Mansmann (R007834) → see lobbyregister-revolving-door

Went inactive (18):
• Tancredis GmbH — inactive since 2026-08-11 (consultancy, registered 2025-08-01) · R007520
• Klausch AutoPublish GbR — 2026-07-08 (consultancy) · R007385
• Wasserstoff-Leitprojekt TransHyDE — 2026-07-02 (platform / network) · R005704
• Stéphane Beemelmans Beemelmans Consulting — 2026-04-09 (consultancy) · R007260
• QinetiQ GmbH — 2026-04-03 (company) · R006346
• Umlaut SE — 2026-02-24 (consultancy) · R002854
  … 12 more, 8 of them on 2026-01-05
```

## lobbyregister-revolving-door

> Which former Bundestag members or federal officials are now registered lobbyists?

```bash
lobbyregister search --results-only --compact > rd.json      # whole register: 6979 entries, 17.8 MB, one call
```

All 38 flagged entries are natural persons. Each role was read from the sub-object that matches
its `type.code`; for `FEDERAL_ADMINISTRATION` the function is a plain string.

```
Revolving door — register entries with recent public office: 38 of 6,979
25 Bundestag · 11 Bundesverwaltung · 2 Bundesregierung · 6 of the entries inactive

Still in office (ended: false):
• Dr. Reinhard Göhner — Mitglied des Nationalen Normenkontrollrates (Bundesverwaltung, NKR)
  Now: Privatperson · Arbeit und Beschäftigung, Politisches Leben, Parteien · declared €1–10,000 · R007123

Most recent moves (office ended 2025 or later: 20):
• Dr. Joachim Stamp — Sonderbevollmächtigter der Bundesregierung für Migrationsabkommen, BKAmt
  (Bundesverwaltung, ended 2025-12) · Now: consultancy · registered 2026-07-10 · declared €0–0 · R008103
• Dr. Sven Halldorn — Abteilungsleiter, BMV (ended 2025-06) · consultancy · Verkehrsinfrastruktur · R002845
• Silvia Bender — Staatssekretärin, BMLEH (Bundesverwaltung, ended 2025-05) · Now: consultancy ·
  Land- und Forstwirtschaft, Fischerei/Aquakultur, Lebensmittelsicherheit · registered 2026-09-02 · R008201
• Burkhard Blienert — Beauftragter der Bundesregierung für Sucht- und Drogenfragen, BMG (ended 2025-05)
  Now: consultancy · Kultur, Arbeitsrecht/Arbeitsbedingungen · declared €1–10,000 · R007582
• Dr. Hans-Peter Friedrich — Mitglied des Deutschen Bundestages (ended 2025-03)
  Now: law firm / sole lawyer · Innere Sicherheit, Verkehrsinfrastruktur · registered 2026-09-14 · R008222
• Christine Aschenberg-Dugnus — MdB (ended 2025-03) · law firm · Gesundheitsversorgung, Krankenversicherung · R007688
• Marco Wanderwitz — MdB (ended 2025-03) · law firm · Energienetze, Rechtspolitik · R007660
  … 13 more (12 former MdBs, e.g. Karsten Klein, Oliver Grundmann, Till Mansmann, Torsten Herbst)
Earlier: Annegret Kramp-Karrenbauer — Bundesministerin der Verteidigung (Bundesregierung, ended 2021-12),
entry inactive · R007251; Volkmar Vogel — Parl. Staatssekretär, BMI (ended 2021-12) · R005605; … 15 more.

8 of the 38 registered in 2026; the latest, Reinhard Klingen (Abteilungsleiter BMV until 2021-12),
on 2026-09-15 · R008225.
```

## lobbyregister-sector-brief

> Who lobbies the Bundestag on artificial intelligence?

```bash
lobbyregister count "künstliche Intelligenz" --compact   # 216
lobbyregister count KI --compact                          # 404
lobbyregister search "künstliche Intelligenz" --results-only --compact > sector.json
```

The skill used the full German term rather than the two-letter `KI`. Only 16 of the 216 hits
mention künstliche Intelligenz, KI or AI anywhere in the JSON the search returns, so the match
comes from register text the API doesn't hand back.

```
Lobbying on "künstliche Intelligenz" — 216 registered (207 active)
Actor mix: 89 companies · 26 non-profits · 21 industry assoc. · 18 consultancies · 13 private org.
           · 13 research · 12 prof. assoc. · 8 NGOs · 7 other

Top declared lobbying spend (annual range, FY 2025 unless noted):
 1. Bundesverband der Deutschen Industrie e.V.   €9.55M–€9.56M   industry assoc.  38.75 FTE  R000534
 2. Wirtschaftsrat der CDU e.V.                   €6.07M–€6.08M   prof. assoc.     24.21 FTE  R001795
 3. ZVEI e.V.                                     €5.66M–€5.67M   industry assoc.  23.19 FTE  R002101
 4. Bundesverband deutscher Banken e.V.           €5.19M–€5.20M   industry assoc.  18.63 FTE  R001458
 5. VDMA e.V.                                     €4.24M–€4.25M   industry assoc.  15.35 FTE  R000802
 6. Bundesärztekammer                             €3.92M–€3.93M   chambers (FY to 2025-06-30)  R002002
 7. BASF SE                                       €3.60M–€3.61M   company           6.08 FTE  R002326
 8. Deutsche Akademie der Naturforscher Leopoldina e.V.  €3.32M–€3.33M  research  22.16 FTE  R004939
 9. Rud Pedersen Public Affairs Germany GmbH      €3.00M–€3.01M   consultancy      17.25 FTE  R001413
10. Deutscher Sparkassen- und Giroverband e.V.    €2.89M–€2.90M   private org.      9.7 FTE   R002090
 …
Most common interest tags: Digitalisierung (135), Wissenschaft, Forschung und Technologie (132),
EU-Gesetzgebung (118), Datenschutz und Informationssicherheit (108), Kommunikations- und Informationstechnik (98)

Flags: 0 code-of-conduct violations · 0 former office-holders · 9 inactive entries excluded;
22 active entries declared €0–0 and 5 declared no spend.
```

Next steps offered: the same brief for `KI` (404 entries), or filtering to companies only.
