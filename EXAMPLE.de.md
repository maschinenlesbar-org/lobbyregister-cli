# Beispiele

Echte Beispiele für die Claude-Code-Skills des Plugins `lobbyregister`, eines pro Skill: eine
Anfrage, die `lobbyregister`-Befehle, die der Skill ausgeführt hat, und Claudes Antwort.

Jedes Beispiel lief am 15. September 2026 mit `lobbyregister` 0.0.7 gegen die Live-API, sofern
sein Abschnitt keinen späteren Lauf nennt.
Die Daten ändern sich, Ihre Ergebnisse werden also abweichen; mit den gezeigten IDs und
Schlüsseln können Sie die Anfragen selbst ausprobieren. Lange Listen sind gekürzt.

Zum Ausprobieren installieren Sie die CLI und das Plugin – siehe [SKILLS.md](SKILLS.md) (englisch).

Skills: [lobbyregister-legislative-engagement](#lobbyregister-legislative-engagement) · [lobbyregister-money-ranking](#lobbyregister-money-ranking) · [lobbyregister-new-entrants](#lobbyregister-new-entrants) · [lobbyregister-revolving-door](#lobbyregister-revolving-door) · [lobbyregister-sector-brief](#lobbyregister-sector-brief)

## lobbyregister-legislative-engagement

> Wer bringt sich am stärksten in die Gesetzgebung zur Krankenversicherung ein? Bitte die Lobbyisten nach eingereichten Stellungnahmen ranken.

Neu ausgeführt am 6. Oktober 2026 mit `lobbyregister` 0.3.0.

```bash
lobbyregister search Krankenversicherung --results-only --compact > le.json   # 824 Einträge, ein Aufruf
jq -c 'group_by(.registerNumber) | map(max_by(.registerEntryDetails.validFromDate))' \
  le.json > le.json.tmp && mv le.json.tmp le.json                           # weiterhin 824
```

Nur die neueste Fassung je `registerNumber` zu behalten, hat nichts geändert: Kein Eintrag kam
doppelt. Die Zählwerte gehören zum ganzen Eintrag, nicht zum Thema, deshalb hat der Skill die Zahl
der angegebenen Interessenbereiche (`Bereiche`) danebengestellt: Breit aufgestellte Verbände wie
Bitkom (90 Bereiche) stehen oben. Zum Vergleich hat er die Verbände der Krankenversicherer
herausgesucht.

```
Einträge zu „Krankenversicherung", sortiert nach Stellungnahmen zu allen Themen (aktive Einträge, 2026-10-06)
786 aktive Einträge (38 inaktive ausgeblendet); 454 haben mindestens eine Stellungnahme eingereicht

  #  Stellgn.  Vorhaben  Aufträge  Bereiche  Wer
  1   200       222        0        90     Bitkom e.V.                                          R000672
  2   199       183        0        76     Bundesverband der Deutschen Industrie e.V.           R000534
  3   196       187        0         1     Zentralverband des Deutschen Handwerks (ZDH)         R002265
  4   193       119        0        50     Verbraucherzentrale Bundesverband e.V.               R001211
  5   185       185        0        28     Deutscher Anwaltverein e.V.                          R000952
  6   155       128        0        71     VDMA e.V.                                            R000802
  7   126        73        0        35     Bundesärztekammer                                    R002002
  8   120        46        0         9     Verband Forschender Arzneimittelhersteller e.V. (vfa) R000762
  9   117       100        0        54     Bundesverband Großhandel, Außenhandel, Dienstleistungen e.V. (BGA)  R001756
 10   107       187        0       100     Vereinigung der Bayerischen Wirtschaft e. V.         R000989
  … 776 weitere; 93 aktive Einträge haben bei allen drei Werten 0

Verbände der Krankenversicherer (Stellungnahmen / Vorhaben / Aufträge, Bereiche):
Verband der Privaten Krankenversicherung e.V. 46 / 39 / 0, 8 Bereiche (R000815);
Verband der Ersatzkassen e.V. (vdek) 36 / 13 / 0, 17; BKK Dachverband e.V. 20 / 10 / 0, 17;
AOK-Bundesverband 9 / 11 / 0, 10.
Meiste Aufträge (Agenturen für Auftraggeber): von Beust & Coll. (45), Christ & Company (44),
Rud Pedersen Public Affairs Germany (43), Fuchs & Cie. (35), EUTOP Europe (32).

Die Werte zeigen, wie viel ein Eintrag insgesamt zu allen seinen Themen tut – nicht nur zur
Krankenversicherung – und nicht, was er inhaltlich vertritt: Das Register nennt die Anzahl der
Stellungnahmen, Vorhaben und Aufträge, nicht ihre Texte oder die Gesetze. Bereiche = angegebene
Interessenbereiche.
Details: https://www.lobbyregister.bundestag.de/suche/R000815/85634
```

## lobbyregister-money-ranking

> Wer gibt am meisten für Lobbyarbeit rund um Arzneimittel und Pharma aus?

Neu ausgeführt am 26. September 2026 mit `lobbyregister` 0.1.0.

```bash
lobbyregister count Pharma --compact                                        # 310
lobbyregister search Arzneimittel --results-only --compact > money.json     # 655 Einträge
jq -c 'group_by(.registerNumber) | map(max_by(.registerEntryDetails.validFromDate))' \
  money.json > money.json.tmp && mv money.json.tmp money.json                # weiterhin 655
```

`Arzneimittel` traf gut doppelt so viele Einträge wie `Pharma`, also hat der Skill diese Menge
gerankt. Das Behalten der neuesten Version je `registerNumber` änderte hier nichts: Der Eintrag,
den die API doppelt liefert (R000534, BDI), gehört nicht zu dieser Menge. Der Begriff ist breit,
und die Ausgaben sind jeweils die Gesamtausgaben eines Eintrags, nicht seine Ausgaben für
Arzneimittel: Ganz oben steht der Dachverband der Versicherer, der erste Verband der
Arzneimittelhersteller ist der vfa auf Platz 4.

```
Höchste angegebene Lobbyausgaben insgesamt – Einträge zu „Arzneimittel" (655 registriert, 605 aktiv; 2026-09-26)
Selbst angegebene Jahresspannen für die gesamte Lobbyarbeit des Eintrags, für 525 der 605
Geschäftsjahr 2025; 0–0 € = 0 € angegeben.

 #  Angegebene Ausgaben (Spanne)  Lobbyist                                                  Art                 VZÄ
 1  15,83 – 15,84 Mio. €          Gesamtverband der Deutschen Versicherungswirtschaft e.V.  Wirtschaftsverband  31,21
 2  12,43 – 12,44 Mio. €          Verbraucherzentrale Bundesverband e.V.                    NGO                 75,45
 3  9,43 – 9,44 Mio. €            Verband der Chemischen Industrie e.V.                     Wirtschaftsverband  27,94
 4  5,65 – 5,66 Mio. €            Verband Forschender Arzneimittelhersteller e.V. (vfa)     Wirtschaftsverband  11,21
 5  5,15 – 5,16 Mio. €            Bitkom e.V.                                               Wirtschaftsverband  24,32
 6  4,57 – 4,58 Mio. €            AOK-Bundesverband eGbR                                    priv. Organisation  33,55
 7  4,48 – 4,49 Mio. €            Deutscher Bauernverband e.V.                              Berufsverband       19,86
 8  3,92 – 3,93 Mio. €            Bundesärztekammer (GJ 2024-07-01 – 2025-06-30)            Kammern             24,61
 9  3,32 – 3,33 Mio. €            Deutsche Akademie der Naturforscher Leopoldina e.V.       Forschung           22,16
10  3,00 – 3,01 Mio. €            Rud Pedersen Public Affairs Germany GmbH                  Beratung            17,25
11  2,72 – 2,73 Mio. €            Deutscher Caritasverband e. V.                            gemeinnützig        13,35
12  2,57 – 2,58 Mio. €            Fraunhofer-Gesellschaft zur Förderung der angewandten Forschung e. V.  Forschung  11,3
13  2,22 – 2,23 Mio. €            Evonik Industries AG                                      Unternehmen         4,65
14  2,20 – 2,21 Mio. €            ABDA - Bundesvereinigung Deutscher Apothekerverbände e. V.  priv. Organisation  5,6
15  2,18 – 2,19 Mio. €            Bayer AG                                                  Unternehmen         4,59

50 inaktive Einträge ausgeblendet. Von den 605 aktiven gaben 73 0 € an, 8 haben noch keinen
Betrag (erstes Geschäftsjahr nicht abgeschlossen), keiner hat die Angabe verweigert.
Unter den Top 15 keine Verstöße gegen den Verhaltenskodex und keine früheren Regierungsämter.
```

## lobbyregister-new-entrants

> Welche Unternehmen und Lobbyisten haben sich dieses Jahr neu zum Thema Rüstung registriert, und wer ist ausgeschieden?

Neu ausgeführt am 6. Oktober 2026 mit `lobbyregister` 0.3.0.

```bash
lobbyregister search Rüstung --sort REGISTRATION_DESC --results-only --compact > ne.json   # 480 Einträge
jq -c 'group_by(.registerNumber) | map(max_by(.registerEntryDetails.validFromDate))' \
  ne.json > ne.json.tmp && mv ne.json.tmp ne.json                                         # weiterhin 480
```

453 der 480 Einträge haben ein `validFromDate` aus 2026, aber nur 64 wurden in diesem Jahr
erstmals registriert. Erst der Bezug auf `firstPublicationDate`, auf dem der Skill besteht, hält
bloße Änderungen aus der Liste heraus.

```
Bewegung im Lobbyregister zu „Rüstung" seit 2026-01-01
+64 neu registriert · −19 inaktiv geworden · netto +45

Neu registriert (64: 43 Unternehmen, 14 Beratungen, 3 Kanzleien, 4 sonstige):
• HOCHTIEF Infrastructure GmbH – registriert 2026-10-05 · Unternehmen · Energienetze, Verkehrsinfrastruktur · R008259
• Materna Information & Communications – 2026-09-29 · Unternehmen · Energienetze, Verkehrsinfrastruktur · R008251
• CS Group - Germany GmbH – 2026-09-23 · Unternehmen · Wissenschaft, Forschung und Technologie, Rüstungsangelegenheiten · R008242
• VRM Advisory Ltd. – 2026-09-21 · Beratung · Industriepolitik, Verteidigungspolitik · R008237
• HD Advanced Technologies GmbH – 2026-09-17 · Unternehmen · Rüstungsangelegenheiten · R008232
• ICEYE Intelligence GmbH – 2026-09-15 · Unternehmen · Sonstiges im Bereich "Innere Sicherheit" · R008226
• Dr. Hans-Peter Friedrich – 2026-09-14 · Kanzlei / Einzelanwalt · Sonstiges im Bereich "Innere Sicherheit", Verkehrsinfrastruktur · R008222
• Rift Dynamics AS – 2026-09-11 · Unternehmen · Rüstungsangelegenheiten, Außenwirtschaft · R008215
• Senop Oy – 2026-09-03 · Unternehmen · Rüstungsangelegenheiten, Bundeswehrangelegenheiten · R008202
• Shield AI – 2026-08-07 · Unternehmen · Sonstiges im Bereich "Innere Sicherheit", Luft- und Raumfahrt · R008159
• Anduril Industries UK Ltd – 2026-06-01 · Unternehmen · Rüstungsangelegenheiten · R008039
  … 53 weitere; die meisten im September (12) und Juli (11)
  Vier Neuzugänge sind als frühere Amtsträger markiert: Friedrich, Karsten Klein (R008114),
  Oliver Grundmann (R007878), Till Mansmann (R007834) → siehe lobbyregister-revolving-door

Inaktiv geworden (19):
• hiALtitude Consulting – inaktiv seit 2026-09-18 (Beratung, registriert 2025-12-30) · R007761
• Tancredis GmbH – 2026-08-11 (Beratung, registriert 2025-08-01) · R007520
• Klausch AutoPublish GbR – 2026-07-08 (Beratung) · R007385
• Wasserstoff-Leitprojekt TransHyDE – 2026-07-02 (Plattform / Netzwerk) · R005704
• QinetiQ GmbH – 2026-04-03 (Unternehmen) · R006346
• Umlaut SE – 2026-02-24 (Beratung) · R002854
  … 13 weitere, 8 davon am 2026-01-05
```

## lobbyregister-revolving-door

> Welche ehemaligen Bundestagsabgeordneten oder Bundesbediensteten sind heute als Lobbyisten registriert?

Neu ausgeführt am 26. September 2026 mit `lobbyregister` 0.1.0.

```bash
lobbyregister count --filter revolvingdoordata=true --compact     # 680
lobbyregister count --compact                                     # 6989 (ganzes Register)
lobbyregister search --filter revolvingdoordata=true --results-only --compact > rd.json   # 2,2 MB
jq -c 'group_by(.registerNumber) | map(max_by(.registerEntryDetails.validFromDate))' \
  rd.json > rd.json.tmp && mv rd.json.tmp rd.json                  # 679: R000534 (BDI) kam doppelt
```

Der Drehtür-Filter des Registers fand 680 Einträge, 679 verschiedene, nachdem die zweite Version
von R000534 (BDI) entfernt war. Nur 39 davon enthalten die Amtsangaben in den Daten
(`recentGovernmentFunctionPresent`): natürliche Personen, die das Amt selbst innehatten. Die
übrigen 640 sind Organisationen, für die jemand arbeitet, der das Amt innehatte; wer, sagt
`/sucheJson` nicht, nur die Registerseite. Die Funktion stammt jeweils aus dem Unterobjekt, das
zum `type.code` passt; bei `FEDERAL_ADMINISTRATION` ist sie ein einfacher String.

```
Drehtür – Registereinträge mit Drehtür-Angaben: 680 von 6.989
(Zahlen wie von der API gemeldet; die abgerufenen 680 enthielten R000534/BDI doppelt, also 679 verschiedene)
39 nennen das eigene frühere Amt des Lobbyisten in den Daten: 25 Bundestag · 12 Bundesverwaltung ·
2 Bundesregierung, 6 davon inaktiv. Bei den übrigen 640 steht die Person mit dem Amt
(Beschäftigte, betraute Person, …) nur auf der Registerseite.

Noch im Amt (ended: false):
• Dr. Reinhard Göhner – Mitglied des Nationalen Normenkontrollrates (Bundesverwaltung, NKR)
  Heute: Privatperson · Arbeit und Beschäftigung, Politisches Leben, Parteien · angegeben 1–10.000 € · R007123

Jüngste Wechsel (Amt 2025 oder später beendet: 20):
• Dr. Joachim Stamp – Sonderbevollmächtigter der Bundesregierung für Migrationsabkommen, BKAmt
  (Bundesverwaltung, bis 2025-12) · Heute: Beratung · registriert 2026-07-10 · angegeben 0 € · R008103
• Dr. Sven Halldorn – Abteilungsleiter, BMV (bis 2025-06) · Beratung · Verkehrsinfrastruktur · R002845
• Silvia Bender – Staatssekretärin, BMLEH (Bundesverwaltung, bis 2025-05) · Heute: Beratung ·
  Land- und Forstwirtschaft, Fischerei/Aquakultur, Lebensmittelsicherheit · registriert 2026-09-02 ·
  angegeben 0 € · R008201
• Burkhard Blienert – Beauftragter der Bundesregierung für Sucht- und Drogenfragen, BMG (bis 2025-05)
  Heute: Beratung · Kultur, Arbeitsrecht/Arbeitsbedingungen · angegeben 1–10.000 € · R007582
• Dr. Hans-Peter Friedrich – Mitglied des Deutschen Bundestages (bis 2025-03)
  Heute: Kanzlei / Einzelanwalt · Innere Sicherheit, Verkehrsinfrastruktur · registriert 2026-09-14 ·
  angegeben 0 € · R008222
• Christine Aschenberg-Dugnus – MdB (bis 2025-03) · Kanzlei · Gesundheitsversorgung, Krankenversicherung · R007688
• Marco Wanderwitz – MdB (bis 2025-03) · Kanzlei · Energienetze, Rechtspolitik · R007660
  … 13 weitere (12 ehemalige MdB, z. B. Karsten Klein, Oliver Grundmann, Till Mansmann, Torsten Herbst)
Früher: Annegret Kramp-Karrenbauer – Bundesministerin der Verteidigung (Bundesregierung, bis 2021-12),
Eintrag inaktiv · R007251; Volkmar Vogel – Parl. Staatssekretär, BMI (bis 2021-12) · R005605; … 16 weitere.

9 der 39 haben sich 2026 registriert; zuletzt Gunther Beger (Abteilungsleiter BMZ bis 2022-02)
am 2026-09-25 · noch kein Betrag (erstes Geschäftsjahr nicht abgeschlossen) · R008244.

Amt bei jemandem, der für den Eintrag arbeitet (Angaben auf der Registerseite): 640 Einträge
161 Unternehmen · 154 gemeinnützige Organisationen · 98 Wirtschafts-/Gewerbeverbände ·
50 Beratungen · 46 priv. Organisationen · 39 NGOs · 39 Plattformen/Netzwerke · 31 Berufsverbände ·
22 sonstige; 19 inaktiv.
Größte angegebene Ausgaben darunter: Gesamtverband der Deutschen Versicherungswirtschaft (R000774),
Verbraucherzentrale Bundesverband (R001211), Verband der Automobilindustrie (R001243),
BDEW (R000888), BDI (R000534), z. B. https://www.lobbyregister.bundestag.de/suche/R000774/86322
```

## lobbyregister-sector-brief

> Wer betreibt beim Bundestag Lobbyarbeit zum Thema künstliche Intelligenz?

Neu ausgeführt am 6. Oktober 2026 mit `lobbyregister` 0.3.0.

```bash
lobbyregister count "künstliche Intelligenz" --compact   # 221
lobbyregister count KI --compact                          # 414
lobbyregister search "künstliche Intelligenz" --results-only --compact > sector.json
jq -c 'group_by(.registerNumber) | map(max_by(.registerEntryDetails.validFromDate))' \
  sector.json > sector.json.tmp && mv sector.json.tmp sector.json        # weiterhin 221
```

Der Skill hat den vollen Begriff statt des Kürzels `KI` verwendet. Nur 16 der 221 Treffer erwähnen
künstliche Intelligenz, KI oder AI überhaupt im JSON, das die Suche liefert – der Treffer muss also
aus Registertext stammen, den die API nicht mitliefert.

```
Lobbyarbeit zu „künstliche Intelligenz" – 221 registriert (212 aktiv)
Akteure: 97 Unternehmen · 27 gemeinnützig · 21 Wirtschaftsverbände · 21 Beratungen · 13 priv. Organisationen
         · 13 Forschung · 12 Berufsverbände · 8 NGOs · 9 sonstige

Höchste angegebene Lobbyausgaben (Jahresspanne für die Lobbyarbeit des ganzen Eintrags, Geschäftsjahr 2025,
sofern nicht anders angegeben):
 1. Bundesverband der Deutschen Industrie e.V.   9,55–9,56 Mio. €   Wirtschaftsverband  38,75 VZÄ  R000534
 2. Wirtschaftsrat der CDU e.V.                   6,07–6,08 Mio. €   Berufsverband       24,21 VZÄ  R001795
 3. ZVEI e.V.                                     5,66–5,67 Mio. €   Wirtschaftsverband  23,19 VZÄ  R002101
 4. Bundesverband deutscher Banken e.V.           5,19–5,20 Mio. €   Wirtschaftsverband  18,63 VZÄ  R001458
 5. VDMA e.V.                                     4,24–4,25 Mio. €   Wirtschaftsverband  15,35 VZÄ  R000802
 6. Bundesärztekammer                             3,92–3,93 Mio. €   Kammern (GJ 2024-07-01 – 2025-06-30)  R002002
 7. BASF SE                                       3,60–3,61 Mio. €   Unternehmen          6,08 VZÄ  R002326
 8. Deutsche Akademie der Naturforscher Leopoldina e.V.  3,32–3,33 Mio. €  Forschung  22,16 VZÄ  R004939
 9. Rud Pedersen Public Affairs Germany GmbH      3,00–3,01 Mio. €   Beratung            17,25 VZÄ  R001413
10. Deutscher Sparkassen- und Giroverband e.V.    2,89–2,90 Mio. €   priv. Organisation   9,7 VZÄ   R002090
 …
Häufigste Interessenbereiche: Digitalisierung (145), Wissenschaft, Forschung und Technologie (140),
EU-Gesetzgebung (128), Datenschutz und Informationssicherheit (117), Kommunikations- und Informationstechnik (104)

Hinweise: 0 Verstöße gegen den Verhaltenskodex · 0 frühere Amtsträger · 9 inaktive Einträge ausgeblendet;
von den 212 aktiven gaben 23 0 € an, 5 haben noch keine Angabe (erstes Geschäftsjahr nicht abgeschlossen).
```

Als Nächstes angeboten: dieselbe Übersicht für `KI` (414 Einträge) oder nur Unternehmen.
