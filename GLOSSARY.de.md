# Glossar

Ein Nachschlagewerk für die Fachbegriffe und projektspezifischen Begriffe, die in
`lobbyregister-cli` verwendet werden. Die Fachsprache des Lobbyregisters ist deutsch;
dieses Glossar nennt die deutschen Begriffe zusammen mit den Bezeichnungen, die CLI und
API verwenden, wo es solche gibt.

> **Umfang.** Dieses Tool kapselt einen einzigen offenen Endpoint – die JSON-Suche des
> Lobbyregisters (`/sucheJson`). Die folgenden Begriffe sind die, die in den Typen des
> Clients, den Suchparametern und den beiden CLI-Befehlen tatsächlich vorkommen. Die
> Registereinträge selbst sind große, schemaversionierte JSON-Dokumente, die der Client
> untypisiert durchreicht (siehe **RegisterEntry**); ihre internen Feldnamen werden
> deshalb bewusst *nicht* aufgezählt.

---

## Das Lobbyregister

**Lobbyregister.** Das öffentliche Register des Bundes für **Interessenvertreter**
(„Lobbyisten“), die gegenüber dem Bundestag und der Bundesregierung Interessen
vertreten. Geführt vom Deutschen Bundestag und veröffentlicht unter
[`lobbyregister.bundestag.de`](https://www.lobbyregister.bundestag.de/).

**Interessenvertreter.** Eine im Lobbyregister eingetragene Person oder Organisation.
Jeder wird durch einen **Registereintrag** beschrieben.

**Lobbyregistergesetz (LobbyRG).** Die gesetzliche Grundlage, die das Register und seine
öffentliche Einsehbarkeit vorschreibt. (Nur zum Hintergrund – kein Feld, das der Client
liest.)

---

## Ressource & Endpoint

**`/sucheJson`.** Der einzige offene Endpoint (ohne Authentifizierung), den dieser Client
aufruft: eine JSON-Suche im Register, bereitgestellt unter der Basis-URL
`https://www.lobbyregister.bundestag.de`. `getJson` sendet ein `GET` an ihn.
Das Gegenstück für Menschen ist die Suchseite der Website; die Antwort gibt deren URL in
`searchUrl` zurück.

**Open Data / nur lesend.** Der Endpoint `/sucheJson` braucht keinen API-Schlüssel,
kein Token und kein Login. Dieser Client implementiert **nur** dieses lesende `GET`; er
schreibt nie.

---

## Suchanfrage

**`q` (Suchanfrage).** Der Freitext-Suchbegriff. Optional – ein fehlendes oder leeres `q`
liefert das gesamte Register. In der CLI ist es das Positionsargument `[query]` von
`search` und `count`. Ein Suchbegriff, der mit einem Bindestrich beginnt, muss nach einem
Trenner `--` übergeben werden (z. B. `search -- -Energie`). Der Server durchsucht auch
Text, den die Antwort nicht enthält (etwa die Tätigkeitsbeschreibung auf der Registerseite
eines Eintrags); ein Eintrag kann also passen, ohne dass der Begriff irgendwo in seinem JSON
vorkommt.

**`sort`.** Die Sortierreihenfolge der Ergebnisse; wird unverändert weitergegeben und
clientseitig **nicht** geprüft. Beobachtete Werte: `RELEVANCE_DESC` (Standard, nach
Relevanz), `REGISTRATION_DESC` (neueste Registrierungen zuerst) und `REGISTRATION_ASC`
(älteste zuerst). Der Live-Endpoint ignoriert einen unbekannten Wert stillschweigend
(HTTP `200`), statt ihn abzulehnen. CLI: `search --sort <order>`.

**Filter (`filter[<attribute>][<value>]`).** Die Facettenfilter der Suche auf der
Website des Registers; `/sucheJson` nimmt sie als `filter[<attribute>][<value>]=true`
an und gibt sie in `searchParameters.facets` zurück. Beispiele: `revolvingdoordata=true`
(ein Eintrag verzeichnet ein kürzlich ausgeübtes öffentliches Amt für die
Interessenvertretung selbst, eine gesetzliche Vertretung, eine betraute Person oder
einen Auftragnehmer – weit mehr Einträge, als das Merkmal
`recentGovernmentFunctionPresent` tragen, das nur die Interessenvertretung selbst
abdeckt), `revolvingdoorpersontypes`, `revolvingdoorareas`, `activelobbyist`,
`fieldsofinterest` (`FOI_ENERGY`, Unterbereiche als `FOI_WORK|FOI_WORK_POLICY`),
`activity`, `legalform`, `donationsreceived`. Werte desselben Attributs sind
Alternativen, verschiedene Attribute müssen alle zutreffen. Die API ignoriert ein
unbekanntes Attribut (und lieferte dann alles), deshalb nimmt die CLI nur die bekannten
an; ein unbekannter Wert trifft nichts. CLI: `search`/`count --filter <attribute=value>`
(wiederholbar); Bibliothek: `SearchParams.filters`, `SEARCH_FILTER_ATTRIBUTES`.

**`page` / `pageSize`.** Eine Seitennummer ab 1 und eine Seitengröße. Beide gibt es in
`SearchParams`, ein Live-Test (2026-06) hat aber gezeigt, dass `/sucheJson` sie
**ignoriert**: Es liefert immer das vollständige `results`-Array. Die CLI wendet
`--page` / `--page-size` deshalb **clientseitig** an und schneidet das gelieferte Array
zu; der gemeldete `resultCount` ist immer die tatsächliche Gesamtzahl. Weil jeder Aufruf
die Menge neu lädt und die Relevanz-Reihenfolge (`RELEVANCE_DESC`) bei identischen Anfragen
wechselt, passen Seiten aus getrennten Aufrufen nur bei einer Datumssortierung wie
`REGISTRATION_DESC` zusammen. CLI: `search --page <n> --page-size <n>`.

---

## Suchantwort

**SearchResult (der Envelope).** Die typisierte oberste Struktur, die `/sucheJson`
liefert: `resultCount` plus das Array `results`, mit optionalen Metadatenfeldern
(`$schema`, `source`, `sourceUrl`, `sourceDate`, `jsonDocumentationUrl`,
`searchUrl`, `searchParameters`).

**`resultCount`.** Die Gesamtzahl der Registereinträge, die zur Suchanfrage passen – die
*tatsächliche* Gesamtzahl, unabhängig davon, wie viele Einträge wirklich geliefert oder
zugeschnitten werden. Dies ist die eine Zahl, die der Befehl `count` ausgibt.

**`results`.** Das Array der passenden Registereinträge (jeweils ein **RegisterEntry**).

**RegisterEntry.** Ein Registereintrag – ein registrierter Interessenvertreter.
Typisiert als rohes `JsonObject` (ein unverändertes, untypisiertes JSON-Dokument), weil
Einträge groß und schemaversioniert sind; der Client rät ihre interne Struktur nicht.

**`$schema`.** Eine URL, die das JSON Schema benennt, dem jeder Eintrag in `results`
entspricht (das veröffentlichte, versionierte Dokumentschema des Registers).

**`source` / `sourceUrl` / `sourceDate`.** Herkunftsmetadaten des Datensatzes:
sein Name, eine kanonische URL und das Erstellungsdatum.

**`searchUrl`.** Die URL der Suchseite für Menschen, die derselben Suchanfrage
entspricht und sich im Browser öffnen lässt.

**`searchParameters`.** Die Parameter, die der Server für diese Suche ausgewertet hat,
als JSON-Objekt zurückgegeben: `queryString`, `sortOrder`, `facets` (die angewandten
Filter als `{attribute, value}`) und `numberRanges`.

**`jsonDocumentationUrl`.** Eine URL zur Dokumentation des JSON-Antwortformats.

---

## CLI-Befehle

**`search [query]`.** Führt eine Suche aus und gibt den vollständigen
**SearchResult**-Envelope aus. `--results-only` gibt nur das Array `results` aus;
`--compact` gibt einzeiliges JSON aus. Unterstützt `--page`, `--page-size`, `--sort`
und `--filter` (siehe oben).

**`count [query]`.** Gibt nur die Trefferzahl aus: `{ query, resultCount }` (mit
`filters`, wenn `--filter` angegeben wurde). Eine dünne Hülle um `search` mit
`pageSize: 1`, die `resultCount` ausliest. Nimmt den optionalen Suchbegriff, `--filter`
und die globalen Optionen entgegen.

---

## Exit-Codes

**Exit-Codes.** Die CLI bildet Ergebnisse auf Exit-Codes des Prozesses ab: `0` bei
Erfolg; `2` bei Aufruf- bzw. Argumentfehlern (unbekannter oder fehlender Befehl,
unbekannte Option, ungültiger Optionswert oder gar kein Befehl angegeben); `4` bei einem
`404` der API; `1` bei jedem anderen Fehler (Netzwerk, Parsen oder ein anderer
HTTP-Status als 404). Ein `400` endet mit `1` und gibt die Fehlerdetails der API aus;
nur wenn die API keine Details sendet, ergänzt die CLI einen Hinweis, `--sort` zu prüfen.
`--help` / `--version` liefern `0`.

---

> **Bibliothek & Interna.** Begriffe zum TypeScript-Client und seinen Interna –
> `LobbyregisterClient`, die Request-Engine, Transport, Retry/Backoff, Fehlertypen,
> Query-Builder, Verhalten bei Weiterleitungen – finden Sie jetzt in
> **[DEVELOPING.md](DEVELOPING.md)** (englisch).
