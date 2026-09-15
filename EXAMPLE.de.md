# Beispiele

Echte Beispiele für die Claude-Code-Skills des Plugins `lobbyregister`, eines pro Skill: eine
Anfrage, die `lobbyregister`-Befehle, die der Skill ausgeführt hat, und Claudes Antwort.

Jedes Beispiel lief am 15. September 2026 mit `lobbyregister` 0.0.7 gegen die Live-API.
Die Daten ändern sich, Ihre Ergebnisse werden also abweichen; mit den gezeigten IDs und
Schlüsseln können Sie die Anfragen selbst ausprobieren. Lange Listen sind gekürzt.

Zum Ausprobieren installieren Sie die CLI und das Plugin – siehe [SKILLS.md](SKILLS.md) (englisch).

Skills: [lobbyregister-legislative-engagement](#lobbyregister-legislative-engagement) · [lobbyregister-money-ranking](#lobbyregister-money-ranking) · [lobbyregister-new-entrants](#lobbyregister-new-entrants) · [lobbyregister-revolving-door](#lobbyregister-revolving-door) · [lobbyregister-sector-brief](#lobbyregister-sector-brief)

## lobbyregister-legislative-engagement

> Wer bringt sich am stärksten in die Gesetzgebung zur Krankenversicherung ein? Bitte die Lobbyisten nach eingereichten Stellungnahmen ranken.

```bash
lobbyregister search Krankenversicherung --results-only --compact > le.json   # 816 Einträge, ein Aufruf
```

Die Zählwerte gehören zum ganzen Eintrag, nicht zum Thema. Das Stichwort trifft jeden Eintrag, der
Krankenversicherung unter seinen Interessen führt (Bitkom nennt 90), deshalb stehen breit
aufgestellte Verbände oben. Der Skill hat zum Vergleich die Verbände der Krankenversicherer
herausgesucht.

```
Gesetzgeberisch aktivste Einträge zu „Krankenversicherung" – sortiert nach Stellungnahmen
776 aktive Einträge (40 inaktive ausgeblendet); 444 haben mindestens eine Stellungnahme eingereicht

  #  Stellgn.  Vorhaben  Aufträge  Wer
  1   200       222        0      Bitkom e.V.                                    Wirtschaftsverband  R000672
  2   191       117        0      Verbraucherzentrale Bundesverband e.V.         NGO                 R001211
  3   185       185        0      Deutscher Anwaltverein e.V.                    Berufsverband       R000952
  4   180       162        0      Bundesverband der Deutschen Industrie e.V.     Wirtschaftsverband  R000534
  5   178       171        0      Zentralverband des Deutschen Handwerks (ZDH)   Wirtschaftsverband  R002265
  6   137       127        0      VDMA e.V.                                      Wirtschaftsverband  R000802
  7   120        46        0      Verband Forschender Arzneimittelhersteller e.V. (vfa)              R000762
  8   106       187        0      Vereinigung der Bayerischen Wirtschaft e. V.   Wirtschaftsverband  R000989
  9   102        45        0      Pharma Deutschland e.V.                        Wirtschaftsverband  R000739
 10   100        70        0      Bundesärztekammer                              Kammern             R002002
  … 766 weitere; 92 aktive Einträge haben bei allen drei Werten 0

Verbände der Krankenversicherer: Verband der Privaten Krankenversicherung e.V. 46 / 39 / 0 (R000815),
Verband der Ersatzkassen e.V. (vdek) 34 / 13 / 0, BKK Dachverband e.V. 20 / 10 / 0,
AOK-Bundesverband 9 / 11 / 0.
Meiste Aufträge (Agenturen für Auftraggeber): von Beust & Coll. (46), Christ & Company (46),
Rud Pedersen Public Affairs Germany (42), EUTOP Europe (33), Fuchs & Cie. (33).

Die Werte zeigen, wie viel ein Eintrag insgesamt im Register tut – nicht nur zur
Krankenversicherung. Texte der Stellungnahmen, Gesetzestitel oder Auftraggeber enthalten sie nicht.
Details: https://www.lobbyregister.bundestag.de/suche/R000815/85634
```

## lobbyregister-money-ranking

> Wer gibt am meisten für Lobbyarbeit rund um Arzneimittel und Pharma aus?

```bash
lobbyregister count Arzneimittel --compact        # 655
lobbyregister count Pharma --compact              # 307
lobbyregister search Arzneimittel --results-only --compact > money.json
```

`Arzneimittel` traf gut doppelt so viele Einträge wie `Pharma`, also hat der Skill diese Menge
gerankt. Der Begriff ist breit: Ganz oben steht der Dachverband der Versicherer, der erste Verband
der Arzneimittelhersteller ist der vfa auf Platz 4.

```
Höchste angegebene Lobbyausgaben – Thema „Arzneimittel" (655 registriert, 603 aktiv)
Selbst angegebene Jahresspannen, für 524 der 603 Geschäftsjahr 2025; 0–0 € = unter der Schwelle / keine.

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

52 inaktive Einträge ausgeblendet; 73 aktive Einträge gaben 0–0 € an, 8 gaben nichts an.
Unter den Top 15 keine Verstöße gegen den Verhaltenskodex und keine früheren Regierungsämter.
```

## lobbyregister-new-entrants

> Welche Unternehmen und Lobbyisten haben sich dieses Jahr neu zum Thema Rüstung registriert, und wer ist ausgeschieden?

```bash
lobbyregister search Rüstung --sort REGISTRATION_DESC --results-only --compact > ne.json   # 473 Einträge
```

440 der 473 Einträge haben ein `validFromDate` aus 2026, aber nur 56 wurden in diesem Jahr
erstmals registriert. Erst der Bezug auf `firstPublicationDate`, auf dem der Skill besteht, hält
bloße Änderungen aus der Liste heraus.

```
Bewegung im Lobbyregister zu „Rüstung" seit 2026-01-01
+56 neu registriert · −18 inaktiv geworden · netto +38

Neu registriert (56: 37 Unternehmen, 12 Beratungen, 3 Kanzleien, 4 sonstige):
• ICEYE Intelligence GmbH – registriert 2026-09-15 · Unternehmen · Sonstiges im Bereich "Innere Sicherheit" · R008226
• Dr. Hans-Peter Friedrich – registriert 2026-09-14 · Kanzlei / Einzelanwalt · Innere Sicherheit, Verkehrsinfrastruktur · R008222
• Rift Dynamics AS – 2026-09-11 · Unternehmen · Rüstungsangelegenheiten, Außenwirtschaft · R008215
• Senop Oy – 2026-09-03 · Unternehmen · Rüstungsangelegenheiten, Bundeswehrangelegenheiten · R008202
• Cambridge Aerospace Deutschland GmbH – 2026-08-21 · Unternehmen · Industriepolitik, Verteidigungspolitik · R008179
• Shield AI – 2026-08-07 · Unternehmen · Außenpolitik, Verteidigungspolitik · R008159
• Hanwha Defence Deutschland GmbH – 2026-07-30 · Unternehmen · Industriepolitik, Verteidigungspolitik · R008143
• Anduril Industries UK Ltd – 2026-06-01 · Unternehmen · Rüstungsangelegenheiten · R008039
• DEUTZ Defense Systems GmbH – 2026-02-09 · Unternehmen · Verteidigungspolitik, Rüstungsangelegenheiten · R007831
  … 47 weitere; die meisten im Juli (11) und August (9)
  Vier Neuzugänge sind als frühere Amtsträger markiert: Friedrich, Karsten Klein (R008114),
  Oliver Grundmann (R007878), Till Mansmann (R007834) → siehe lobbyregister-revolving-door

Inaktiv geworden (18):
• Tancredis GmbH – inaktiv seit 2026-08-11 (Beratung, registriert 2025-08-01) · R007520
• Klausch AutoPublish GbR – 2026-07-08 (Beratung) · R007385
• Wasserstoff-Leitprojekt TransHyDE – 2026-07-02 (Plattform / Netzwerk) · R005704
• Stéphane Beemelmans Beemelmans Consulting – 2026-04-09 (Beratung) · R007260
• QinetiQ GmbH – 2026-04-03 (Unternehmen) · R006346
• Umlaut SE – 2026-02-24 (Beratung) · R002854
  … 12 weitere, 8 davon am 2026-01-05
```

## lobbyregister-revolving-door

> Welche ehemaligen Bundestagsabgeordneten oder Bundesbediensteten sind heute als Lobbyisten registriert?

```bash
lobbyregister search --results-only --compact > rd.json      # ganzes Register: 6979 Einträge, 17,8 MB, ein Aufruf
```

Alle 38 markierten Einträge sind natürliche Personen. Die Funktion stammt jeweils aus dem
Unterobjekt, das zum `type.code` passt; bei `FEDERAL_ADMINISTRATION` ist sie ein einfacher String.

```
Drehtür – Registereinträge mit kürzlichem öffentlichem Amt: 38 von 6.979
25 Bundestag · 11 Bundesverwaltung · 2 Bundesregierung · 6 der Einträge inaktiv

Noch im Amt (ended: false):
• Dr. Reinhard Göhner – Mitglied des Nationalen Normenkontrollrates (Bundesverwaltung, NKR)
  Heute: Privatperson · Arbeit und Beschäftigung, Politisches Leben, Parteien · angegeben 1–10.000 € · R007123

Jüngste Wechsel (Amt 2025 oder später beendet: 20):
• Dr. Joachim Stamp – Sonderbevollmächtigter der Bundesregierung für Migrationsabkommen, BKAmt
  (Bundesverwaltung, bis 2025-12) · Heute: Beratung · registriert 2026-07-10 · angegeben 0–0 € · R008103
• Dr. Sven Halldorn – Abteilungsleiter, BMV (bis 2025-06) · Beratung · Verkehrsinfrastruktur · R002845
• Silvia Bender – Staatssekretärin, BMLEH (Bundesverwaltung, bis 2025-05) · Heute: Beratung ·
  Land- und Forstwirtschaft, Fischerei/Aquakultur, Lebensmittelsicherheit · registriert 2026-09-02 · R008201
• Burkhard Blienert – Beauftragter der Bundesregierung für Sucht- und Drogenfragen, BMG (bis 2025-05)
  Heute: Beratung · Kultur, Arbeitsrecht/Arbeitsbedingungen · angegeben 1–10.000 € · R007582
• Dr. Hans-Peter Friedrich – Mitglied des Deutschen Bundestages (bis 2025-03)
  Heute: Kanzlei / Einzelanwalt · Innere Sicherheit, Verkehrsinfrastruktur · registriert 2026-09-14 · R008222
• Christine Aschenberg-Dugnus – MdB (bis 2025-03) · Kanzlei · Gesundheitsversorgung, Krankenversicherung · R007688
• Marco Wanderwitz – MdB (bis 2025-03) · Kanzlei · Energienetze, Rechtspolitik · R007660
  … 13 weitere (12 ehemalige MdB, z. B. Karsten Klein, Oliver Grundmann, Till Mansmann, Torsten Herbst)
Früher: Annegret Kramp-Karrenbauer – Bundesministerin der Verteidigung (Bundesregierung, bis 2021-12),
Eintrag inaktiv · R007251; Volkmar Vogel – Parl. Staatssekretär, BMI (bis 2021-12) · R005605; … 15 weitere.

8 der 38 haben sich 2026 registriert; zuletzt Reinhard Klingen (Abteilungsleiter BMV bis 2021-12)
am 2026-09-15 · R008225.
```

## lobbyregister-sector-brief

> Wer betreibt beim Bundestag Lobbyarbeit zum Thema künstliche Intelligenz?

```bash
lobbyregister count "künstliche Intelligenz" --compact   # 216
lobbyregister count KI --compact                          # 404
lobbyregister search "künstliche Intelligenz" --results-only --compact > sector.json
```

Der Skill hat den vollen Begriff statt des Kürzels `KI` verwendet. Nur 16 der 216 Treffer erwähnen
künstliche Intelligenz, KI oder AI überhaupt im JSON, das die Suche liefert – der Treffer muss also
aus Registertext stammen, den die API nicht mitliefert.

```
Lobbyarbeit zu „künstliche Intelligenz" – 216 registriert (207 aktiv)
Akteure: 89 Unternehmen · 26 gemeinnützig · 21 Wirtschaftsverbände · 18 Beratungen · 13 priv. Organisationen
         · 13 Forschung · 12 Berufsverbände · 8 NGOs · 7 sonstige

Höchste angegebene Lobbyausgaben (Jahresspanne, Geschäftsjahr 2025, sofern nicht anders angegeben):
 1. Bundesverband der Deutschen Industrie e.V.   9,55–9,56 Mio. €   Wirtschaftsverband  38,75 VZÄ  R000534
 2. Wirtschaftsrat der CDU e.V.                   6,07–6,08 Mio. €   Berufsverband       24,21 VZÄ  R001795
 3. ZVEI e.V.                                     5,66–5,67 Mio. €   Wirtschaftsverband  23,19 VZÄ  R002101
 4. Bundesverband deutscher Banken e.V.           5,19–5,20 Mio. €   Wirtschaftsverband  18,63 VZÄ  R001458
 5. VDMA e.V.                                     4,24–4,25 Mio. €   Wirtschaftsverband  15,35 VZÄ  R000802
 6. Bundesärztekammer                             3,92–3,93 Mio. €   Kammern (GJ bis 2025-06-30)    R002002
 7. BASF SE                                       3,60–3,61 Mio. €   Unternehmen          6,08 VZÄ  R002326
 8. Deutsche Akademie der Naturforscher Leopoldina e.V.  3,32–3,33 Mio. €  Forschung  22,16 VZÄ  R004939
 9. Rud Pedersen Public Affairs Germany GmbH      3,00–3,01 Mio. €   Beratung            17,25 VZÄ  R001413
10. Deutscher Sparkassen- und Giroverband e.V.    2,89–2,90 Mio. €   priv. Organisation   9,7 VZÄ   R002090
 …
Häufigste Interessenbereiche: Digitalisierung (135), Wissenschaft, Forschung und Technologie (132),
EU-Gesetzgebung (118), Datenschutz und Informationssicherheit (108), Kommunikations- und Informationstechnik (98)

Hinweise: 0 Verstöße gegen den Verhaltenskodex · 0 frühere Amtsträger · 9 inaktive Einträge ausgeblendet;
22 aktive Einträge gaben 0–0 € an, 5 machten keine Angabe.
```

Als Nächstes angeboten: dieselbe Übersicht für `KI` (404 Einträge) oder nur Unternehmen.
