# Plan Etappe 14: Neue Demo-Songs im Stil von Just Dance

Ziel: Die zwei synthetischen Demos („Pink Pulse“, „Sunset Kick“) werden durch vier
Demos ersetzt, die sich wie Just Dance anfühlen: echte Songs mit Aufbau (Intro, Strophe,
Refrain, Bridge, Outro, ca. 2:30–3:00), fließende menschliche Bewegung, ein Refrain mit immer
derselben Phrase und Gold Moves an den Höhepunkten.

Voraussetzungen: [Etappe 13](etappe-13.md) (Motion-Paket mit AIST++-Clips, Generator mit
festem Plan) und [Etappe 12](etappe-12.md) (Coach und Piktogramme). Diese Etappe baut keine
eigene Bewegungs-Pipeline mehr, sondern beschreibt jeden Demo-Song als Manifest und lässt den
Generator daraus die Choreografie bauen.

Gewählte Wege:

- **Musik:** vier eigene, KI-generierte Songs (Gemini, Pro-Abo des Nutzers), als MP3 im Repo.
- **Choreo:** Clips aus dem Motion-Paket (AIST++, Demo-Posen, selbst getanzt über den
  Video-Import), Abfolge fest im Manifest.

## 14-0 Entscheidungen und Lizenzen (erledigt 2026-10-22)

1. **AIST++-Bewegungen werden ausgeliefert.**
   - Die Annotationen (3D-Keypoints, SMPL) stehen unter **CC BY 4.0** (Google LLC): Weitergabe
     und kommerzielle Nutzung erlaubt, Namensnennung Pflicht.
   - Die Choreografien stammen aus der **AIST Dance Video Database**. Der Nutzer hat deren
     Terms of Use gelesen: abgeleitete Bewegungsdaten dürfen in einer öffentlich gehosteten App
     ausgeliefert werden. Claude hat die Terms nicht selbst geprüft; die Entscheidung beruht auf
     der Aussage des Nutzers.
   - Pflichten für die Credits (14c): CC-BY-Namensnennung (Google LLC) und Zitat des
     ISMIR-2019-Papers (verlangt die AIST-Startseite).
   - Die AIST-Musik wird **nicht** verwendet (nur Bewegung).
   - Gilt auch für das Motion-Paket aus Etappe 13, sobald es AIST-Clips enthält. Die
     Fallbacks CMU Motion Capture Database und selbst getanzte Clips sind nicht nötig, bleiben
     aber als Ergänzung möglich. Die Freigabe 13-0.7 (Python-Konverter, 13h-2) ist davon
     getrennt.
2. **Musik: KI-generiert mit Gemini (Pro-Abo des Nutzers), 4 Songs, MP3.**
   - Dateien in `public/demo-audio/`: `Gold_in_My_Pocket`, `Gold_on_the_Glass`,
     `Lemonade_Skies`, `Rise_Until_The_Morning`.
   - **Lizenz:** Die Nutzungsbedingungen von Gemini für Musik hat Claude nicht geprüft. Der
     Nutzer liest sie selbst und hebt einen Nachweis (Abo, Erzeugungs- bzw. Download-Datum)
     außerhalb des Repos auf. Das Repo enthält keine Konto- oder Abodaten.
   - Die Songs gehören dem Nutzer (kein geschütztes Fremdmaterial); die Credits kennzeichnen sie
     als KI-generiert mit Gemini (genauer Wortlaut in 14c).
   - Vorgaben für die Prompts waren: 4/4-Takt, feste BPM, klarer Aufbau mit Refrain,
     tanzbarer Pop/Dance, kein Bezug auf echte Künstler oder Songs. Die tatsächliche BPM misst
     14a nach (siehe Risiko „Tempo“), die Prompt-BPM zählt nicht.
3. **Audio liegt im Repo.** Ausnahme in `.gitignore` nur für `public/demo-audio/*.mp3`, Ordner
   angelegt. Die Dateien kommen von der eigenen Adresse (kein externer Abruf, keine neue Zeile in
   „Externe Abrufe“), ca. 3–4 MB pro Song. Abweichung in 14a-2: Der Service Worker cacht sie
   nicht, weil der Seed sie einmal nach IndexedDB kopiert (sonst lägen sie doppelt vor). Die
   Regel „Keine geschützten Songs im Repo“ bleibt erfüllt. CLAUDE.md hat die Zeile zur Ausnahme
   seit 14a-2. Verworfen: Audio nur auf Vercel (Build nicht reproduzierbar, `bun run dev` ohne
   Demos).
4. **Alte Demos werden ersetzt** (neue IDs; die alten werden beim nächsten Seed entfernt, sofern
   sie noch Demo-Audio spielen und nicht bearbeitet wurden). Löschen von Code nur nach Freigabe
   (CLAUDE.md, Arbeitsweise).

**Stand:** 14-0 erledigt. 14a startet erst nach ausdrücklicher Freigabe des Nutzers.

## 14a Musik erzeugen und Manifest

Aufgeteilt: **14a-1** Messung (`bun run measure-audio`), Manifest-Schema und die vier Manifeste
(umgesetzt, siehe [roadmap.md](../roadmap.md)); **14a-2** Seed mit den MP3s (umgesetzt,
Abweichungen siehe [roadmap.md](../roadmap.md)). Abschnittslängen in Beats (Vielfaches von 4) statt
8er-Zählzeiten.

- Der Nutzer hat vier Songs mit Gemini erzeugt (14-0.2). BPM je Song so wählen, dass genug
  Clips im Motion-Paket innerhalb ±12 % liegen (`bun run eval-choreo` aus 13g zeigt die
  Abdeckung pro BPM).
- Pro Song ein **Manifest** `src/data/demos/<slug>.manifest.json` (von Hand, zod-geprüft):
  - Titel, Künstlerzeile („DanceBeat Original“), Farben (Schlüssel aus `SONG_PALETTES` in
    `src/theme.ts`, keine Hex-Werte im Manifest), Schwierigkeit, Audiodatei.
  - BPM und Beat-Phase: gemessen mit der vorhandenen Analyse (`analyzeAudio`, `refineBpm`), von
    Hand nachgeprüft.
  - **Abschnitte** in Beats ab dem ersten Downbeat: `intro`, `verse`, `prechorus`, `chorus`,
    `bridge`, `outro`, je mit Länge in 8er-Zählzeiten.
  - **Phrasen:** pro Abschnittstyp eine feste Clip-Folge (IDs aus dem Motion-Paket) oder
    `"auto"` (Generator wählt mit dem Seed des Songs). Gold Moves als Positionen
    (Abschnitt, Zählzeit); optional Move-Namen pro Clip.
- Seed (`src/data/demo.ts`): Demo-Audio kommt per `fetch` von `/demo-audio/<slug>.mp3` statt aus
  `synthTrack`. `DEMO_AUDIO_VERSION` → 5; bei Version < 5 werden die Audiodaten wie bisher
  einmalig ersetzt. Ein Abruf-Fehler (offline beim ersten Start) lässt den Song weg und versucht
  es beim nächsten Seed erneut, die Bibliothek bleibt bedienbar.
- `synthTrack` bleibt nur, wenn der Sync-Test oder Tests es brauchen; sonst Entfernen vorschlagen.
- Tests: Manifest-Schema (unbekannte Clip-IDs, Abschnitte ohne Phrase), Seed mit gemocktem
  `fetch` (Erfolg, Fehler, Versionswechsel, gelöschte Demos bleiben gelöscht).

## 14b Songaufbau über den Generator

Umgesetzt, Abweichungen siehe [roadmap.md](../roadmap.md) und
[choreography-format.md](../choreography-format.md#demo-pipeline).

`scripts/build-demo.ts` (`bun run build-demo <manifest>`), Logik rein in
`src/lib/demoBuild.ts`:

- `planFromManifest(manifest)` erzeugt den `Plan` aus 13f (Abschnitte, Phrasen, Gold-Slots)
  statt `planStructure`; feste Clip-Folgen ersetzen `selectMoves`, `"auto"` ruft es mit dem Seed
  auf. `realizeFrames` aus 13f baut Frames, Überblendung und Moves.
- Der **Refrain verwendet bei jeder Wiederholung exakt dieselbe Phrase**, Strophe 1 und 2 auch
  (folgt aus der festen Clip-Folge pro Abschnittstyp).
- Intro: Bewegung ohne Moves (4–8 Beats). Outro: Schlusspose als letzter Move.
- Clips mit mehr als ±12 % Tempounterschied zum Song: Abbruch mit Meldung (Bewegung wirkt sonst
  gehetzt oder zäh).
- Ergebnis: `src/data/demos/<slug>.choreo.json` (Format aus 13d, mit `pose3d`), geprüft mit
  `ChoreographySchema`, per dynamischem `import()` geladen, damit das Haupt-Bundle klein bleibt.
  Ziel < 1 MB pro Song.
- **Kein eigener Formatwechsel.** Namensnennung steht nicht in der Choreo, sondern in einer
  festen Credits-Liste (14c).
- Tests (`src/test/demoBuild.test.ts`): Plan aus Manifest, Refrain-Wiederholungen mit identischen
  relativen Frames, Moves auf Beats, Gold Moves wie im Manifest, Tempo-Grenze, ausgelieferte
  JSON-Dateien bestehen das Schema, Scoring mit dem simulierten Spieler bei Rauschen 0 ergibt
  die Höchstwertung.

## 14c Einbinden, Credits, Spielbarkeit

- `DEMOS` in `src/data/demo.ts` liest Manifest und Choreo-JSON statt `seq`/`POSES`.
- Umgang mit den alten Demos laut Entscheidung 14-0.4.
- **Credits:** Abschnitt „Über und Credits“ in den Einstellungen: AIST++ (CC BY 4.0, Google
  LLC, mit Link), AIST Dance Video Database (Zitat laut deren Vorgabe), Musik („erstellt mit
  <Generator>“). Links öffnen sich erst auf Tippen (kein Abruf beim Laden).
- **Spielbarkeit prüfen:** pro Song mit `?sim=1&noise=10&miss=0.1` Score und Sterne ansehen;
  Schwierigkeit (Flammen) danach festlegen. Clips, die die Kamera schlecht erkennt, im Manifest
  ersetzen.
- Doku: [choreography-format.md](../choreography-format.md) (Abschnitt „Demo-Pipeline“),
  [architecture.md](../architecture.md) (Auslieferung der Demo-Audiodateien, Service-Worker-Cache),
  README (Credits), CLAUDE.md (Audio-Ausnahme), Roadmap-Eintrag.

## 14d Prüfung

- Nach jeder Teiletappe: `bun run typecheck`, `test`, `lint`, `build`.
- Playwright (projektlokaler Server, Flags vorher per `ps` prüfen): Bibliothek mit den neuen
  Demos, Spiel mit `?sim=1` in 390×844 und 844×390, Credits-Seite, Konsole ohne eigene Fehler.
  Screenshots danach löschen.
- **Nur am Gerät prüfbar** (im Bericht so benennen, nicht als getestet ausgeben):
  - Klingen die Songs am iPhone-Lautsprecher gut (MP3 statt Synthese)?
  - Treffen Moves und Coach den Takt ohne Korrektur?
  - Fühlt sich die Choreo wie Just Dance an (Refrain wiedererkennbar, Gold Moves am Höhepunkt)?
  - Erkennt die Kamera die Bewegungen zuverlässig, ist die Schwierigkeit passend?

## Reihenfolge und Commits

| Schritt | Inhalt                                   | Hängt ab von                  | Modell |
| ------- | ---------------------------------------- | ----------------------------- | ------ |
| 14-0    | Entscheidungen, Lizenzprüfung (erledigt) | –                             | –      |
| 14a     | Musik einbinden, Manifest, Seed          | 14-0.2, 14-0.3, 13e (BPM)     | Sonnet |
| 14b     | Songaufbau über den Generator            | 14a, 13f-1, 14-0.1            | Opus   |
| 14c     | Einbinden, Credits, Spielbarkeit, Doku   | 14b, 14-0.4, 12 (Darstellung) | Sonnet |
| 14d     | Playwright, Gerätetest                   | alle                          | –      |

Ein Commit pro Teiletappe.

## Risiken

- **Stil:** AIST++ ist Streetdance, nicht Party-Choreo. Ohne sorgfältige Clip-Auswahl wirkt es
  eher wie Tanzschule als wie Just Dance. Notfalls Phrasen mit Demo-Posen oder selbst getanzten
  Clips ergänzen.
- **Erkennung:** Schnelle oder gedrehte Bewegungen erkennt MediaPipe mit der Handykamera
  schlechter als das Mocap-System; die Wertung kann unfair wirken. Gegenmittel: Filter im
  Motion-Paket, Clips im Manifest ersetzen, Schwierigkeit ehrlich angeben.
- **Lizenz:** AIST++ ist freigegeben (14-0.1). Offen bleibt der Nachweis zur Gemini-Musik, den
  der Nutzer außerhalb des Repos führt (14-0.2). Ändern sich die Bedingungen oder ist der
  Nachweis nicht möglich, werden die MP3-Dateien ersetzt; Manifeste und Code bleiben.
- **Tempo:** KI-Generatoren halten die gewünschte BPM nicht immer exakt. Deshalb BPM nach dem
  Erzeugen messen und die Grenze von ±12 % prüfen, statt der Prompt-BPM zu vertrauen.
