# Plan Etappe 13: 3D-Kern und Choreo-Generator

Ziel: Bewegung wird intern dreidimensional dargestellt (`Skeleton3D`), 2D wird daraus
abgeleitet. Darauf baut ein Generator, der für Songs ohne Tanzvideo Choreografien mit
Phrasen, Wiederholungen und Spiegelpaaren erzeugt, statt wie heute `autoChoreo` 13 Posen in
fester Reihenfolge abzuspielen. Mocap-Daten (AIST++, 13h) und der Video-Import liefern die
Bewegungen ohne Verlust der Tiefe.

Abgrenzung: **Kein 3D-Coach und keine 3D-Bewertung** in dieser Etappe. Scoring, Coach und
Piktogramme arbeiten weiter mit 2D (`landmarks`, `angles`, `computeAngles` mit `aspect`). Beides
ist als Ausblick unten beschrieben (Etappen 15 und 16) und hängt an dieser Etappe. Die
Demo-Songs ([Etappe 14](etappe-14.md)) nutzen Motion-Paket und Generator dieser Etappe.

Lizenzfragen der Datensätze sind hier bewusst ausgeklammert; für ausgelieferte Daten gilt
14-0.1 in [etappe-14.md](etappe-14.md).

## Ausgangslage

- `Landmark` ist 2D (x, y, visibility, [types.ts](../../src/lib/types.ts)). Der Estimator liest
  nur `.landmarks` von MediaPipe, `worldLandmarks` (3D, Meter, Hüftmitte als Ursprung) werden
  verworfen ([mediapipePoseEstimator.ts](../../src/lib/mediapipePoseEstimator.ts)).
- `autoChoreo` ([demo.ts](../../src/data/demo.ts)) erzeugt alle 2 Beats eine von 13 Posen
  (`(i * 7 + 3) % n`), dazwischen „Locker“. Aufrufer: `src/lib/library/newSong.ts`,
  `src/data/devSongs.ts`, Tests in `newSong.test.ts`.
- `frameAt` ([pose.ts](../../src/lib/pose.ts)) interpoliert Landmarks linear und Winkel über
  den kürzesten Bogen.
- Choreografie-Format v1 (`CHOREO_VERSION = 1`), IndexedDB `DB_VERSION = 2`.

## 13-0 Entscheidungen

1. **Darstellung `Skeleton3D`: Knochenrichtungen im Körper-Koordinatensystem.**
   - Wurzel: Beckenmitte (Position in Metern relativ zum Startpunkt) und Blickrichtung (Gier,
     Grad, um die Senkrechte).
   - Pro Knochen ein Einheitsvektor im Körpersystem (Becken: x nach links des Tänzers, y nach
     oben, z nach vorn). Knochen: Rumpf (Becken → Schultermitte), Hals/Kopf, Schulterachse,
     Hüftachse, Ober- und Unterarm, Ober- und Unterschenkel, je links und rechts (12 Knochen).
   - Fehlt ein Knochen (Gelenk unsicher), fehlt der Eintrag; nie als 0 gewertet.
   - Ohne Drehung entlang des Knochens (Twist). Hände und Füße nicht als eigene Knochen.
   - Begründung: unabhängig von der Körpergröße, für jedes Rig nutzbar, über slerp
     interpolierbar, über Standard-Knochenlängen nach 2D projizierbar.
2. **2D bleibt die Wahrheit für Scoring und Anzeige.** `landmarks` und `angles` werden aus
   `Skeleton3D` per frontaler orthografischer Projektion abgeleitet, wo eine 3D-Quelle existiert.
   `computeAngles` mit `aspect` bleibt der einzige Weg zu Winkeln.
3. **Formatwechsel additiv:** Choreografie v2 bekommt optional `pose3d` am Frame. Alte
   Choreos bleiben gültig, Tiefe wird nicht erfunden.
4. **Generator deterministisch:** Zufall nur über einen Seed-RNG (Seed = Song-ID), keine
   Abhängigkeit von `Math.random`. Gleicher Song, gleiche Choreo.
5. **Keine neuen Abhängigkeiten.** Vektor- und Quaternion-Rechnung als kleine eigene Funktionen.
6. **Offen, vom Nutzer zu entscheiden:** Bekommt „Song bearbeiten“ einen Knopf
   „Choreografie neu erzeugen“ (neuer Seed) und Auswahl für Stil und Schwierigkeit? Empfehlung:
   ja, aber erst in 13f-2 nach dem Messplatz; bis dahin nutzt der Generator die vorhandene
   `difficulty` des Songs und den Stil „party“.
7. **Python für den AIST++-Konverter (13h):** AIST++ liefert `.pkl`-Dateien (Python-Pickle mit
   NumPy-Arrays). Vorschlag: ein einmaliges Python-Skript mit `numpy` außerhalb der App
   (`scripts/aist/`), kein Teil von Build oder Tests. Neue Werkzeug-Abhängigkeit, daher
   Freigabe nötig. Betrifft nur 13h.

## 13a Skeleton-Kern (Logik, kein Formatwechsel)

Neuer Ordner `src/lib/skeleton/`:

- `types.ts`: `BoneId`, `Skeleton3D` mit `root` (`pos`, `yawDeg`) und `bones`
  (`Partial<Record<BoneId, Vec3>>`), `BONE_LENGTHS` (Standardproportionen, passend zu
  `figure()`).
- `vec.ts`: `Vec3`, Normieren, Kreuzprodukt, slerp zwischen Einheitsvektoren, Gier-Rotation.
- `fromLandmarks3d(lm3d, minVis)`: aus 33 MediaPipe-Weltpunkten (oder abgebildeten COCO-17) ein
  `Skeleton3D`. Körpersystem aus Hüft- und Schulterachse; Gelenke mit `visibility < 0.5`
  liefern keinen Knochen.
- `project(sk, view)`: Standardlängen ansetzen, Punkte aufbauen, frontal orthografisch
  projizieren, skalieren und zentrieren wie `figure()` (Hüfte bei y ≈ 0,58). Ergebnis sind
  33 `Landmark`s im heutigen Format; nicht gesetzte Punkte bekommen Sichtbarkeit 0.
- `interpolate(a, b, t)`: slerp je Knochen, Wurzel linear bzw. Gier über den kürzesten Bogen.
  Fehlt ein Knochen auf einer Seite, fehlt er im Ergebnis.
- `mirror3d(sk)`: links und rechts tauschen, x spiegeln, Gier umkehren. Zweimal angewendet
  gleich dem Original; Konvention passend zu `mirrorChoreo`.
- Tests `src/test/skeleton.test.ts`:
  - `project(fromLandmarks3d(x))` ergibt für eine frontale Figur dieselben `computeAngles` wie
    die 2D-Figur (Toleranz 1°).
  - Um 90° gedrehte Figur: Winkel wie aus der Seitenansicht erwartet.
  - slerp: Endpunkte exakt, Mitte normiert, Gegenrichtung ohne NaN.
  - `mirror3d` zweimal = Identität; gespiegelte Projektion = `mirrorLandmarks` der Projektion.
  - Fehlende Gelenke → fehlende Knochen → fehlende Winkel.

## 13b Demo-Posen über Skeleton3D (Refactoring, kein Formatwechsel)

- `figure(p: FigureParams)` bekommt ein 3D-Gegenstück `figure3d(p)` (z = 0, also flach), das
  `Skeleton3D` liefert; `figure()` wird `project(figure3d(p))`.
- `build` und `autoChoreo` bleiben äußerlich gleich.
- Tests: Für alle 13 Posen weichen Landmarks höchstens 0,002 und Winkel höchstens 0,5° vom
  bisherigen `figure()` ab (Vergleich gegen eine einmal erzeugte Referenz im Test).
- Zweck: Die Demo-Posen sind die erste Quelle des Motion-Pakets (13e), ohne dass sich im Spiel
  etwas ändert.

## 13c Pose-Spur v2 mit Weltpunkten

- `PoseEstimator.detect` / `detectAll` liefern zusätzlich `world: Landmark3d[] | null`
  (x, y, z, visibility). `Landmark3d` in `src/lib/schema.ts` als zod-Schema.
- `videoAnalysis.ts`: Weltpunkte der Zielperson mitschreiben (gleiche Personenwahl wie für die
  2D-Punkte, `targetPerson.ts`).
- `PoseTrack.samples[]` bekommt optional `world`. `smoothTrack` glättet die Weltpunkte mit
  denselben One-Euro-Werten (`DEFAULT_ONE_EURO`), vorwärts und rückwärts.
- `poseTrackFile.ts`: Version 2 mit optionalem `world`; Version 1 bleibt lesbar.
  `scripts/tune-video-choreo.ts` liest beide.
- Live-Kamera (`usePoseTracking`): **keine** Änderung in dieser Etappe, Weltpunkte werden dort
  nicht weitergereicht (erst Etappe 16).
- Tests: Schema v1 und v2, Glättung der Weltpunkte, Analyse mit Fake-Estimator liefert `world`.
- Gerätetest offen: Kostet das Auslesen der Weltpunkte im Import messbar Zeit?

## 13d Choreografie v2 mit `pose3d`

- `FrameSchema` bekommt optional `pose3d: Skeleton3DSchema`. `CHOREO_VERSION` → 2.
- Migration 1 → 2 in `migrations.ts`: nur Version setzen, Frames unverändert. IndexedDB
  `DB_VERSION` → 3 mit Upgrade über dieselbe Migration.
- `frameAt` interpoliert `pose3d` über `interpolate`, wenn beide Nachbarn es haben, sonst fehlt
  es.
- `mirrorChoreo` spiegelt auch `pose3d` (`mirror3d`).
- `choreoFromPoseTrack`: Mit Weltpunkten bekommt jeder Frame `pose3d`; `landmarks` und `angles`
  kommen weiter aus den 2D-Punkten des Videos (sie sind dort genauer als eine Projektion).
- Größe: Werte auf 3 Stellen runden. Messen, wie groß eine 3-Minuten-Choreo wird; Ziel unter
  +50 % gegenüber v1, sonst `pose3d` nur an jedem zweiten Frame.
- Export/Import: Dateien v1 und v2 lesbar, Export schreibt v2.
- Tests: Migration, Schema mit und ohne `pose3d`, `frameAt` mit gemischten Frames, Spiegeln,
  Import alter Exportdateien, Größe einer Beispiel-Choreo.
- Doku: [choreography-format.md](../choreography-format.md) (Felder, Versionen, Konvention
  `Skeleton3D`).

## 13e Motion-Paket

Ein Datenartefakt mit allen Moves, die der Generator verwenden darf, getrennt von Code und
mit eigener Version.

Geteilt: **13e-1** Schema, Logik, Skript und Startpaket aus den Demo-Posen (umgesetzt);
**13e-2** Pose-Spuren v2 aus dem Video-Import als Quelle mit Segmentierung an Haltepunkten
(umgesetzt).

- Schema `MotionPackSchema` in `src/lib/schema.ts`:
  - `version`, `clips[]`: `id`, `label`, `styles[]`, `difficulty` (1–3), `energy` (0–1),
    `beats` (Länge 1–4), `anchorBeat` (Beat, an dem bewertet wird), `keyframes[]`
    (`beat`, `pose3d`), `mirrorOf` (ID des gespiegelten Clips oder fehlt bei symmetrischen),
    `playability` (Anteil sicher messbarer Winkel in der Frontalprojektion), `sourceBpm`
    (Tempo der Quelle; fehlt bei Posen ohne eigenes Tempo), `source` (Kennung der Quelle für
    Credits und Filter).
  - `transitions`: pro Stil Gewichte `von → nach` (dünn besetzt, fehlend = Grundgewicht).
- Erzeugung offline, `scripts/build-motion-pack.ts` (`bun run build-motion-pack`), Logik rein in
  `src/lib/motionPack.ts`:
  1. Quellen: Demo-Posen (13b), Pose-Spuren v2 aus dem Video-Import (Dev-Export),
     AIST++-Clips (13h).
  2. Segmentieren mit der Haltepunkt-Logik aus 8g-4c; Clip = Bewegung vom vorigen Haltepunkt
     bis zu diesem, Anker auf dem Haltepunkt.
  3. Gruppieren: ähnliche Clips (Abstand der Knochenrichtungen am Anker) zusammenfassen, der
     Clip nächst der Gruppenmitte bleibt.
  4. Filter für die Spielbarkeit: Projektion muss mindestens 4 Arm- und Beinwinkel liefern;
     Blickrichtung höchstens ±45° von frontal; keine Clips mit Hüfte unter Kniehöhe
     (Bodenarbeit); maximale Winkelgeschwindigkeit begrenzt.
  5. Übergänge zählen: Welche Gruppe folgt in den Quellen auf welche (pro Stil).
- Ausgeliefertes Paket: `src/data/motion-pack.json`, per dynamischem `import()` geladen, erst
  wenn generiert wird. Startpaket = nur die 13 Demo-Posen (gleiches Verhalten wie heute
  möglich).
- Tests: Schema, Segmentierung an synthetischer Spur, Gruppierung, jeder Filter einzeln,
  Übergangszählung, `mirrorOf` paarweise konsistent.

## 13f Generator

`src/lib/generator/`, reine Funktionen, keine Browser-APIs:

```ts
interface GenerationInput {
  bpm: number;
  beatPhaseMs: number;
  durationMs: number;
  energy?: number[]; // Hüllkurve aus der Audioanalyse, falls vorhanden
  style: string;
  difficulty: 1 | 2 | 3;
  seed: string;
}
planStructure(input) → Plan            // Abschnitte, Phrasen, Gold-Slots, Dichte
selectMoves(plan, pack, rng) → ClipRef[] // austauschbare Stufe
realizeFrames(clips, plan) → Choreography
```

- **13f-1 Kern:**
  - `planStructure`: Intro 4–8 Beats ohne Moves; danach Phrasen zu 8 Beats; Muster
    A A B A je 4 Phrasen; Wiederholung bedeutet exakt dieselbe Clip-Folge; Dichte (ein Move
    pro 1, 2 oder 4 Beats) aus `difficulty` und, falls vorhanden, Energie; Gold-Slots am Ende
    jeder B-Phrase und auf dem Energie-Maximum; Schlusspose am Ende.
  - `selectMoves`: gewichtete Markov-Kette über `transitions`, gefiltert nach Stil,
    Schwierigkeit und Energie; Clips mit `sourceBpm` nur innerhalb ±12 % der Song-BPM (sonst
    wirkt die Bewegung gehetzt oder zäh); Spiegelpaare bevorzugt direkt hintereinander; kein
    Clip zweimal direkt hintereinander außer in Wiederholungen.
  - `realizeFrames`: Keyframes der Clips auf die Beats legen, Frames alle 100 ms über
    `interpolate`; zwischen Clips 1 Beat Überblendung; daraus `landmarks` per `project` und
    `angles` per `computeAngles` (aspect 1); `pose3d` bleibt am Frame. Moves auf den Ankern,
    `label` und `iconId` aus dem Clip.
  - `autoChoreo` ruft den Generator auf; Signatur bekommt optional `seed` und `difficulty`.
    Aufrufer in `newSong.ts` und `devSongs.ts` reichen die Song-ID als Seed durch.
  - Plan und Clip-Folge lassen sich auch von außen vorgeben (`realizeFrames` ohne
    `planStructure`/`selectMoves`); das braucht der Songaufbau der Demos in Etappe 14.
- **13f-2 Oberfläche (nach Entscheidung 13-0.6 und nach 13g):** „Choreografie neu erzeugen“
  in „Song bearbeiten“, Auswahl Stil und Schwierigkeit.
- Tests `src/test/generator.test.ts`: gleicher Seed = gleiche Choreo; anderer Seed = andere;
  Moves auf Beats und mit Mindestabstand `MIN_MOVE_GAP_MS`; A-Phrasen identisch; Spiegelpaare;
  Gold-Slots; Ergebnis besteht `ChoreographySchema`; Scoring mit dem simulierten Spieler
  (`src/lib/game/simulatedPlayer.ts`) bei Rauschen 0 ergibt die Höchstwertung.

## 13g Messplatz

`scripts/eval-choreo.ts` (`bun run eval-choreo`), Logik in `src/lib/generator/metrics.ts`:

- Erzeugt pro Kombination aus BPM (90, 110, 128, 150), Schwierigkeit und 20 Seeds eine Choreo.
- Kennzahlen: Anteil messbarer Winkel je Move, mittlerer Winkelabstand aufeinanderfolgender
  Moves, Wiederholungsrate, Abdeckung des Pakets, höchste Winkelgeschwindigkeit, Score des
  simulierten Spielers bei Rauschen 10° und Ausfall 0,1.
- Vergleich gegen das alte `autoChoreo` als Basislinie (Zahlen vor 13f einmal festhalten).
- Ausgabe als Tabelle in der Konsole und als JSON in einem ignorierten Ordner.
- Tests: Kennzahlen an kleinen, von Hand berechneten Beispielen.

## 13h AIST++ als Quelle (offline, nicht im Build)

Ablauf: `.pkl` → Python → neutrales JSON → Bun-Skript → Pose-Spur v2 mit Weltpunkten → 13e.
Die 3D-Daten werden **nicht** flach projiziert; das geschieht erst über `project`.

1. **Clip-Auswahl:** Genres mit stehendem Tanz, die dem Just-Dance-Stil nahekommen: House, LA
   Hip-Hop, Middle Hip-Hop, Locking, Waacking, Jazz Ballet. Kein Break, kein Krump (Bodenarbeit,
   zu schwer zu erkennen). „Basic“- und „Advanced“-Clips, Liste (Dateinamen, Genre, AIST-BPM)
   als JSON neben dem Skript.
2. **`scripts/aist/convert.py`** (Python, `numpy`, mit `python -I` aufgerufen, Freigabe 13-0.7):
   - Die heruntergeladenen `.pkl` sind fremde Daten: **kein** `pickle.load`, sondern ein
     eingeschränkter `Unpickler`, der nur NumPy-Array-Klassen und Grundtypen zulässt, alles
     andere bricht ab.
   - Liest `keypoints3d_optim` (COCO-17, 60 fps, Zentimeter) und schreibt
     `{fps, joints: number[][][]}` als JSON.
   - Rohdaten und Zwischen-JSON liegen außerhalb des Repos oder in einem ignorierten Ordner
     (`*.aist.json` in `.gitignore`).
3. **`scripts/aist/to-pose-track.ts`** (Bun), Logik rein in `src/lib/aist.ts`:
   - **Gelenk-Abbildung COCO-17 → MediaPipe-33:** Nase 0→0, Schultern 5/6→11/12, Ellbogen
     7/8→13/14, Handgelenke 9/10→15/16, Hüften 11/12→23/24, Knie 13/14→25/26, Knöchel 15/16→27/28.
     Fehlende MediaPipe-Punkte bekommen keine Sichtbarkeit (werden übersprungen, nie 0).
   - Achsen und Einheiten auf die Konvention der Weltpunkte bringen (Meter, y nach oben,
     Hüftmitte als Ursprung); links/rechts gegen die Spiegelkonvention prüfen (`mirror3d`),
     damit der Coach wie in Just Dance spiegelbildlich tanzt.
   - Blickrichtung pro Clip aus der mittleren Hüftachse, nicht pro Bild (sonst sehen Drehungen
     falsch aus); als Gier der Wurzel.
   - 2D-Landmarks der Spur über `project` mit dieser festen Blickrichtung (nur für die
     Diagnose und vorhandene Werkzeuge; das Paket nutzt die Weltpunkte).
   - Ausgabe: Pose-Spur v2 mit `bpm` aus der AIST-Liste und `sourceBpm` für die Clips.

- Tests (`src/test/aist.test.ts`): Gelenk-Abbildung inkl. links/rechts, Achsen und Einheiten,
  feste Blickrichtung bei einer synthetisch gedrehten Figur, Projektion ergibt erwartete Winkel
  über `computeAngles` mit `aspect` = 1. Das Python-Skript wird nicht in `bun run test`
  ausgeführt; der Unpickler bekommt einen eigenen kleinen Test im Skript-Ordner.

## Reihenfolge und Commits

| Schritt | Inhalt                              | Hängt ab von | Modell |
| ------- | ----------------------------------- | ------------ | ------ |
| 13a     | Skeleton-Kern                       | –            | Opus   |
| 13b     | Demo-Posen über Skeleton3D          | 13a          | Sonnet |
| 13g-0   | Basislinie mit altem `autoChoreo`   | –            | Sonnet |
| 13c     | Pose-Spur v2 mit Weltpunkten        | 13a          | Sonnet |
| 13d     | Choreografie v2 mit `pose3d`        | 13a, 13c     | Opus   |
| 13e     | Motion-Paket                        | 13b, 13d     | Opus   |
| 13h     | AIST++ als Quelle                   | 13c, 13-0.7  | Opus   |
| 13f-1   | Generator                           | 13e          | Opus   |
| 13g     | Messplatz, Vergleich zur Basislinie | 13f-1        | Sonnet |
| 13f-2   | Oberfläche „neu erzeugen“           | 13g, 13-0.6  | Sonnet |

Ein Commit pro Schritt. Nach jedem Schritt `bun run typecheck`, `test`, `lint`, `build`.
Playwright nur für 13d (Bibliothek lädt alte Songs, Export/Import) und 13f-2 (Dialog), je in
390×844 und 844×390.

## Ausblick (nicht Teil dieser Etappe)

- **Etappe 15: 3D-Coach.** Schnittstelle `CoachRenderer.draw(pose, view)` vor
  `drawCoach`/`drawMoveFigure`; erste Umsetzung = heutiger 2D-Zeichner über `project`. Danach
  WebGL-Avatar mit eigenem Modell (neue Abhängigkeit, z. B. three.js, nur nach Freigabe), lazy
  geladen, Schalter mit Rückfall auf 2D. Vorbedingung: Gerätetest Akku und Wärme aus 8h-2a.
- **Etappe 16: 3D-Bewertung als Experiment.** Weltpunkte auch live durchreichen, Schicht
  `PoseFeatures` (`angles2d` Standard, `bones3d` optional, gewichtet nach Sicherheit). Erst
  messen (Stabilität der Tiefe bei echten Tänzen am Handy), dann entscheiden.

## Risiken

- **Projektion ≠ Videowinkel:** Winkel aus `project(Skeleton3D)` weichen von Winkeln aus echten
  2D-Punkten ab (Standardlängen statt echter Proportionen). Deshalb behalten Video-Choreos ihre
  2D-Daten; nur generierte und Mocap-Choreos nutzen die Projektion.
- **Tiefe aus dem Video ist verrauscht:** `pose3d` aus dem Video-Import ist schlechter als aus
  Mocap. Im Motion-Paket Video-Clips deshalb strenger filtern oder kennzeichnen.
- **Dateigröße:** `pose3d` vergrößert Choreos in IndexedDB und Exporten; siehe Ziel in 13d.
- **Gefühl:** Ob die Choreos sich „wie Just Dance“ anfühlen, zeigt kein Test. Messplatz für
  Fairness, Gerätetest für das Gefühl.
