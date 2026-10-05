# Examples

Real examples for the Claude Code skills of the `lobbyregister` plugin, one per skill: a request,
the `lobbyregister` commands the skill ran, and the answer Claude gave.

Every example ran against the live API on 15 September 2026 with `lobbyregister` 0.0.7, unless
its section says it was re-run later.
The data changes, so your results will differ; the ids and keys shown work for trying the
requests yourself. Long lists are shortened.

To try them, install the CLI and the plugin — see [SKILLS.md](SKILLS.md).

Skills: [lobbyregister-legislative-engagement](#lobbyregister-legislative-engagement) · [lobbyregister-money-ranking](#lobbyregister-money-ranking) · [lobbyregister-new-entrants](#lobbyregister-new-entrants) · [lobbyregister-revolving-door](#lobbyregister-revolving-door) · [lobbyregister-sector-brief](#lobbyregister-sector-brief)

## lobbyregister-legislative-engagement

> Who is most active in shaping health-insurance legislation? Rank the lobbyists by the statements they filed.

Re-run on 6 October 2026 with `lobbyregister` 0.3.0.

```bash
lobbyregister search Krankenversicherung --results-only --compact > le.json   # 824 entries, one call
jq -c 'group_by(.registerNumber) | map(max_by(.registerEntryDetails.validFromDate))' \
  le.json > le.json.tmp && mv le.json.tmp le.json                           # still 824
```

Keeping the newest version per `registerNumber` changed nothing: no entry came back twice. The
counts belong to each entry as a whole, not to the topic, so the skill showed the number of
declared fields of interest (`areas`) next to them: broad associations such as Bitkom (90 areas)
lead the table. It also picked out the health insurers' own associations for comparison.

```
Entries matching "Krankenversicherung", ranked by statements filed on all topics (active entries, 2026-10-06)
786 active entries (38 inactive dropped); 454 have filed at least one statement

  #  stmts  projects  contracts  areas  who
  1   200     222        0        90    Bitkom e.V.                                          R000672
  2   199     183        0        76    Bundesverband der Deutschen Industrie e.V.           R000534
  3   196     187        0         1    Zentralverband des Deutschen Handwerks (ZDH)         R002265
  4   193     119        0        50    Verbraucherzentrale Bundesverband e.V.               R001211
  5   185     185        0        28    Deutscher Anwaltverein e.V.                          R000952
  6   155     128        0        71    VDMA e.V.                                            R000802
  7   126      73        0        35    Bundesärztekammer                                    R002002
  8   120      46        0         9    Verband Forschender Arzneimittelhersteller e.V. (vfa) R000762
  9   117     100        0        54    Bundesverband Großhandel, Außenhandel, Dienstleistungen e.V. (BGA)  R001756
 10   107     187        0       100    Vereinigung der Bayerischen Wirtschaft e. V.         R000989
  … 776 more; 93 active entries score 0 on all three

Health insurers' associations (stmts / projects / contracts, areas):
Verband der Privaten Krankenversicherung e.V. 46 / 39 / 0, 8 areas (R000815);
Verband der Ersatzkassen e.V. (vdek) 36 / 13 / 0, 17; BKK Dachverband e.V. 20 / 10 / 0, 17;
AOK-Bundesverband 9 / 11 / 0, 10.
Top by contracts (agencies lobbying for clients): von Beust & Coll. (45), Christ & Company (44),
Rud Pedersen Public Affairs Germany (43), Fuchs & Cie. (35), EUTOP Europe (32).

Counts = each entry's total engagement across all its topics, not activity on health
insurance, and not its content: the register reports how many statements / projects /
contracts, not their text or which laws. areas = declared fields of interest.
Details: https://www.lobbyregister.bundestag.de/suche/R000815/85634
```

## lobbyregister-money-ranking

> Who spends the most on lobbying around medicines and pharma?

Re-run on 26 September 2026 with `lobbyregister` 0.1.0.

```bash
lobbyregister count Pharma --compact                                        # 310
lobbyregister search Arzneimittel --results-only --compact > money.json     # 655 entries
jq -c 'group_by(.registerNumber) | map(max_by(.registerEntryDetails.validFromDate))' \
  money.json > money.json.tmp && mv money.json.tmp money.json                # still 655
```

`Arzneimittel` matched twice as many entries as `Pharma`, so the skill ranked that set. Keeping
the newest version per `registerNumber` changed nothing here: the entry the API returns twice
(R000534, BDI) is not in this set. The term is broad and the spend is each entry's total, not
its spend on medicines: the insurers' umbrella association tops the table, and the first
drug-maker association is vfa at #4.

```
Top total declared lobbying spend — entries matching "Arzneimittel" (655 registered, 605 active; 2026-09-26)
Self-declared annual ranges for each entry's lobbying as a whole, FY 2025 for 525 of the 605;
€0–0 = €0 declared.

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

50 inactive entries left out. Of the 605 active: 73 declared €0, 8 have no figure yet (first
fiscal year not completed), none refused to state their spend.
No code-of-conduct violations or recent government functions among the top 15.
```

## lobbyregister-new-entrants

> Which companies and lobbyists newly registered on arms and defence (Rüstung) this year, and who dropped out?

Re-run on 6 October 2026 with `lobbyregister` 0.3.0.

```bash
lobbyregister search Rüstung --sort REGISTRATION_DESC --results-only --compact > ne.json   # 480 entries
jq -c 'group_by(.registerNumber) | map(max_by(.registerEntryDetails.validFromDate))' \
  ne.json > ne.json.tmp && mv ne.json.tmp ne.json                                         # still 480
```

453 of the 480 entries have a `validFromDate` in 2026, but only 64 first registered this year.
Keying on `firstPublicationDate`, as the skill insists, is what keeps edits out of the list.

```
Lobbyregister movement on "Rüstung" since 2026-01-01
+64 newly registered · −19 went inactive · net +45

Newly registered (64: 43 companies, 14 consultancies, 3 law firms, 4 other):
• HOCHTIEF Infrastructure GmbH — registered 2026-10-05 · company · Energienetze, Verkehrsinfrastruktur · R008259
• Materna Information & Communications — 2026-09-29 · company · Energienetze, Verkehrsinfrastruktur · R008251
• CS Group - Germany GmbH — 2026-09-23 · company · Wissenschaft, Forschung und Technologie, Rüstungsangelegenheiten · R008242
• VRM Advisory Ltd. — 2026-09-21 · consultancy · Industriepolitik, Verteidigungspolitik · R008237
• HD Advanced Technologies GmbH — 2026-09-17 · company · Rüstungsangelegenheiten · R008232
• ICEYE Intelligence GmbH — 2026-09-15 · company · Sonstiges im Bereich "Innere Sicherheit" · R008226
• Dr. Hans-Peter Friedrich — 2026-09-14 · law firm / sole lawyer · Sonstiges im Bereich "Innere Sicherheit", Verkehrsinfrastruktur · R008222
• Rift Dynamics AS — 2026-09-11 · company · Rüstungsangelegenheiten, Außenwirtschaft · R008215
• Senop Oy — 2026-09-03 · company · Rüstungsangelegenheiten, Bundeswehrangelegenheiten · R008202
• Shield AI — 2026-08-07 · company · Sonstiges im Bereich "Innere Sicherheit", Luft- und Raumfahrt · R008159
• Anduril Industries UK Ltd — 2026-06-01 · company · Rüstungsangelegenheiten · R008039
  … 53 more; busiest months September (12) and July (11)
  Four newcomers are flagged as former office-holders: Friedrich, Karsten Klein (R008114),
  Oliver Grundmann (R007878), Till Mansmann (R007834) → see lobbyregister-revolving-door

Went inactive (19):
• hiALtitude Consulting — inactive since 2026-09-18 (consultancy, registered 2025-12-30) · R007761
• Tancredis GmbH — 2026-08-11 (consultancy, registered 2025-08-01) · R007520
• Klausch AutoPublish GbR — 2026-07-08 (consultancy) · R007385
• Wasserstoff-Leitprojekt TransHyDE — 2026-07-02 (platform / network) · R005704
• QinetiQ GmbH — 2026-04-03 (company) · R006346
• Umlaut SE — 2026-02-24 (consultancy) · R002854
  … 13 more, 8 of them on 2026-01-05
```

## lobbyregister-revolving-door

> Which former Bundestag members or federal officials are now registered lobbyists?

Re-run on 26 September 2026 with `lobbyregister` 0.1.0.

```bash
lobbyregister count --filter revolvingdoordata=true --compact     # 680
lobbyregister count --compact                                     # 6989 (whole register)
lobbyregister search --filter revolvingdoordata=true --results-only --compact > rd.json   # 2.2 MB
jq -c 'group_by(.registerNumber) | map(max_by(.registerEntryDetails.validFromDate))' \
  rd.json > rd.json.tmp && mv rd.json.tmp rd.json                  # 679: R000534 (BDI) came twice
```

The register's own revolving-door filter found 680 entries, 679 distinct once the second
version of R000534 (BDI) was dropped. Only 39 of them carry the office detail in the data
(`recentGovernmentFunctionPresent`): natural persons who held the office themselves. The
other 640 are organisations where someone working for them held it; `/sucheJson` doesn't say
who, only the register page does. Each role was read from the sub-object that matches its
`type.code`; for `FEDERAL_ADMINISTRATION` the function is a plain string.

```
Revolving door — register entries with revolving-door data: 680 of 6,989
(counts as the API reports them; the fetched 680 held R000534/BDI twice, so 679 distinct)
39 name the lobbyist's own former office in the data: 25 Bundestag · 12 Bundesverwaltung ·
2 Bundesregierung, 6 of them inactive. For the other 640 the office-holder (employee,
entrusted person, …) is shown only on the register page.

Still in office (ended: false):
• Dr. Reinhard Göhner — Mitglied des Nationalen Normenkontrollrates (Bundesverwaltung, NKR)
  Now: Privatperson · Arbeit und Beschäftigung, Politisches Leben, Parteien · declared €1–10,000 · R007123

Most recent moves (office ended 2025 or later: 20):
• Dr. Joachim Stamp — Sonderbevollmächtigter der Bundesregierung für Migrationsabkommen, BKAmt
  (Bundesverwaltung, ended 2025-12) · Now: consultancy · registered 2026-07-10 · declared €0 · R008103
• Dr. Sven Halldorn — Abteilungsleiter, BMV (ended 2025-06) · consultancy · Verkehrsinfrastruktur · R002845
• Silvia Bender — Staatssekretärin, BMLEH (Bundesverwaltung, ended 2025-05) · Now: consultancy ·
  Land- und Forstwirtschaft, Fischerei/Aquakultur, Lebensmittelsicherheit · registered 2026-09-02 ·
  declared €0 · R008201
• Burkhard Blienert — Beauftragter der Bundesregierung für Sucht- und Drogenfragen, BMG (ended 2025-05)
  Now: consultancy · Kultur, Arbeitsrecht/Arbeitsbedingungen · declared €1–10,000 · R007582
• Dr. Hans-Peter Friedrich — Mitglied des Deutschen Bundestages (ended 2025-03)
  Now: law firm / sole lawyer · Innere Sicherheit, Verkehrsinfrastruktur · registered 2026-09-14 ·
  declared €0 · R008222
• Christine Aschenberg-Dugnus — MdB (ended 2025-03) · law firm · Gesundheitsversorgung, Krankenversicherung · R007688
• Marco Wanderwitz — MdB (ended 2025-03) · law firm · Energienetze, Rechtspolitik · R007660
  … 13 more (12 former MdBs, e.g. Karsten Klein, Oliver Grundmann, Till Mansmann, Torsten Herbst)
Earlier: Annegret Kramp-Karrenbauer — Bundesministerin der Verteidigung (Bundesregierung, ended 2021-12),
entry inactive · R007251; Volkmar Vogel — Parl. Staatssekretär, BMI (ended 2021-12) · R005605; … 16 more.

9 of the 39 registered in 2026; the latest, Gunther Beger (Abteilungsleiter BMZ until 2022-02),
on 2026-09-25 · no figure yet (first fiscal year not completed) · R008244.

Office held by someone working for the entry (details on the register page): 640 entries
161 companies · 154 non-profit organisations · 98 industry/trade associations · 50 consultancies ·
46 private organisations · 39 NGOs · 39 platforms/networks · 31 professional associations ·
22 other; 19 inactive.
Largest declared spenders among them: Gesamtverband der Deutschen Versicherungswirtschaft (R000774),
Verbraucherzentrale Bundesverband (R001211), Verband der Automobilindustrie (R001243),
BDEW (R000888), BDI (R000534), e.g. https://www.lobbyregister.bundestag.de/suche/R000774/86322
```

## lobbyregister-sector-brief

> Who lobbies the Bundestag on artificial intelligence?

Re-run on 6 October 2026 with `lobbyregister` 0.3.0.

```bash
lobbyregister count "künstliche Intelligenz" --compact   # 221
lobbyregister count KI --compact                          # 414
lobbyregister search "künstliche Intelligenz" --results-only --compact > sector.json
jq -c 'group_by(.registerNumber) | map(max_by(.registerEntryDetails.validFromDate))' \
  sector.json > sector.json.tmp && mv sector.json.tmp sector.json        # still 221
```

The skill used the full German term rather than the two-letter `KI`. Only 16 of the 221 hits
mention künstliche Intelligenz, KI or AI anywhere in the JSON the search returns, so the match
comes from register text the API doesn't hand back.

```
Lobbying on "künstliche Intelligenz" — 221 registered (212 active)
Actor mix: 97 companies · 27 non-profits · 21 industry assoc. · 21 consultancies · 13 private org.
           · 13 research · 12 prof. assoc. · 8 NGOs · 9 other

Top declared lobbying spend (annual range for each entry's lobbying as a whole, FY 2025 unless noted):
 1. Bundesverband der Deutschen Industrie e.V.   €9.55M–€9.56M   industry assoc.  38.75 FTE  R000534
 2. Wirtschaftsrat der CDU e.V.                   €6.07M–€6.08M   prof. assoc.     24.21 FTE  R001795
 3. ZVEI e.V.                                     €5.66M–€5.67M   industry assoc.  23.19 FTE  R002101
 4. Bundesverband deutscher Banken e.V.           €5.19M–€5.20M   industry assoc.  18.63 FTE  R001458
 5. VDMA e.V.                                     €4.24M–€4.25M   industry assoc.  15.35 FTE  R000802
 6. Bundesärztekammer                             €3.92M–€3.93M   chambers (FY 2024-07-01 – 2025-06-30)  R002002
 7. BASF SE                                       €3.60M–€3.61M   company           6.08 FTE  R002326
 8. Deutsche Akademie der Naturforscher Leopoldina e.V.  €3.32M–€3.33M  research  22.16 FTE  R004939
 9. Rud Pedersen Public Affairs Germany GmbH      €3.00M–€3.01M   consultancy      17.25 FTE  R001413
10. Deutscher Sparkassen- und Giroverband e.V.    €2.89M–€2.90M   private org.      9.7 FTE   R002090
 …
Most common interest tags: Digitalisierung (145), Wissenschaft, Forschung und Technologie (140),
EU-Gesetzgebung (128), Datenschutz und Informationssicherheit (117), Kommunikations- und Informationstechnik (104)

Flags: 0 code-of-conduct violations · 0 former office-holders · 9 inactive entries excluded;
of the 212 active, 23 declared €0 and 5 have no figure yet (first fiscal year not completed).
```

Next steps offered: the same brief for `KI` (414 entries), or filtering to companies only.
