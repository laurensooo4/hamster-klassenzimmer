# 🐹 Hamster-Klassenzimmer

Lern-Plattform zum Programmieren mit dem Hamster – mit **Lehrer- und Schüler-Logins**,
Klassen, Aufgaben (mit Territorium-Editor), Abgaben und Abgabe-Matrix.

**Live: https://laurensooo4.github.io/hamster-simulator/**

## Zugang

Zugangsdaten gibt es von der Schule. Schüler:innen können sich registrieren und treten
mit einem **Klassencode** bei; Lehrkräfte brauchen einen **persönlichen Einladungscode**,
den die Administration im Admin-Bereich erzeugt.

## Herkunft & Abgrenzung

Beide Simulator-Werkzeuge sind **eigenständige Neuimplementierungen in JavaScript**:

- **Hamster:** angelehnt an das [Java-Hamster-Modell](https://www.java-hamster-modell.de/)
  von Dr.-Ing. Dietrich Boles (Universität Oldenburg). Es wurde **kein Programmcode und
  keine Grafik** übernommen.
- **Netzwerke:** angelehnt an [FILIUS](https://www.lernsoftware-filius.de/)
  (Universität Siegen). Es wurde **kein Quellcode** übernommen; die Oberflächen-Grafiken
  in `filius-gfx/` stammen jedoch aus FILIUS und werden unter der **GNU GPL v3**
  weitergegeben — siehe [`filius-gfx/HERKUNFT.md`](filius-gfx/HERKUNFT.md).

Beides sind **keine offiziellen Produkte** der genannten Projekte oder Universitäten.
Vollständige Urheber-, Lizenz- und Quellenangaben: [`lizenzen.html`](lizenzen.html)
und [`LICENSE`](LICENSE).

## Funktionen

- **Logins** (Username + Passwort, sicher gehasht über Supabase)
- **Lehrer:** Klassen anlegen (mit Einlade-Code), Aufgaben stellen (Beschreibung +
  Territorium per Editor + optionaler Auto-Check), **Abgabe-Matrix**, Abgaben ansehen
- **Schüler:** Klasse per Code beitreten, Aufgaben im eingebetteten Hamster-Simulator
  lösen, **Abgeben**-Button
- **Auto-Check:** prüft die Abgabe automatisch (z. B. „alle Körner gefressen")
- Voller Hamster-Java-Sprachumfang (Schleifen, Verzweigungen, Prozeduren, Arrays,
  `String`, `Territorium`-Abfragen …) im Editor mit Syntax-Highlighting & Einzelschritt

## Technik

- **Frontend:** statisch (HTML/CSS/JS), gehostet auf GitHub Pages
- **Backend:** [Supabase](https://supabase.com) (PostgreSQL + Auth), Zugriff über
  Row-Level-Security. Schema/Regeln in [`schema.sql`](schema.sql), Einrichtung in
  [`SETUP.md`](SETUP.md).
- `engine.js` enthält den kompletten Hamster-Simulator als wiederverwendbare Komponente.

## Hinweise

- Der frühere **freie Simulator** (ohne Login) liegt lokal im Ordner
  `freier-simulator-backup/` und in der Git-Historie dieses Repos.
- Änderungen veröffentlichen: `index.html`/`app.js`/`engine.js` anpassen, dann
  `git push` (bzw. `publish.bat`) – GitHub Pages baut in ~1 Minute neu.
