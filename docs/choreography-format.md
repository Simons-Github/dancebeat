# Choreografie-Format

Aktuelle Version: **2**. Maßgeblich ist das zod-Schema in `src/lib/schema.ts`; dieses Dokument
beschreibt Bedeutung und Konventionen.

## Felder

### Choreografie

| Feld                     | Typ           | Bedeutung                                                            |
| ------------------------ | ------------- | -------------------------------------------------------------------- |
| `version`                | `2`           | Formatversion                                                        |
| `id`                     | UUID          | stabile ID (`crypto.randomUUID`)                                     |
| `title`                  | Text, 1–120   | Titel                                                                |
| `bpm`                    | 30–300        | Tempo; darf gebrochen sein (die Analyse liefert 0,1-Schritte)        |
| `offsetMs`               | Zahl          | Verschiebung der Choreografie gegen die Audiozeit (positiv = später) |
| `accentColor`            | `#RRGGBB`     | Songfarbe (Hintergrund, Piktogramme, Effekte)                        |
| `secondaryColor`         | `#RRGGBB`     | Zweitfarbe (Pfeile, Wackellinien)                                    |
| `frames`                 | Liste         | Referenz-Posen über die Zeit, **nach `timeMs` sortiert**             |
| `moves`                  | Liste         | bewertete Moves, **nach `timeMs` sortiert**                          |
| `createdAt`, `updatedAt` | ms seit Epoch | Zeitstempel                                                          |

### Frame

| Feld            | Typ              | Bedeutung                                                            |
| --------------- | ---------------- | -------------------------------------------------------------------- |
| `timeMs`        | ≥ 0              | Zeitpunkt in der Choreografie                                        |
| `landmarks`     | bis zu 33 Punkte | MediaPipe-Indizes; je Punkt `[x, y]` oder `[x, y, visibility]`       |
| `angles`        | Objekt           | Winkel je Gelenk (siehe unten); fehlende Schlüssel = nicht verfügbar |
| `lowVisibility` | optional, bool   | Frame mit schlechter Erkennung (Video-Import)                        |
| `pose3d`        | optional, Objekt | 3D-Pose als [`Skeleton3D`](#skeleton3d) (seit v2, Video-Import)      |

Zwischen zwei Frames interpoliert `frameAt` Landmarks, Winkel und `pose3d`: bei höchstens
`DENSE_FRAME_GAP_MS` (150 ms) Abstand linear (Video-Import alle 50 ms, Generator alle 100 ms),
bei größerem Abstand mit Smoothstep (Schlüsselposen der Demo-Songs). Vor 13f-1 galt Smoothstep
immer; bei dichten Frames bremste das die Bewegung an jedem Frame ab (10–20 Hz Ruckeln).

### Move

| Feld     | Typ        | Bedeutung                                     |
| -------- | ---------- | --------------------------------------------- |
| `timeMs` | ≥ 0        | Zielzeitpunkt; bewertet wird im Fenster darum |
| `label`  | Text, ≤ 60 | Anzeigename, z. B. „Arme hoch“                |
| `iconId` | Text, ≤ 60 | Piktogramm-Kennung                            |
| `gold`   | bool       | Gold Move (5-fache Punkte)                    |

Die Soll-Winkel eines Moves werden aus den Frames zum Zeitpunkt `timeMs` interpoliert
(`frameAt`, Winkel über den kürzesten Bogen).

`pose3d` ist optional und ergänzt die 2D-Daten, ersetzt sie aber nicht: Bewertung und Anzeige
nutzen weiter `landmarks` und `angles`. `frameAt` interpoliert `pose3d` mit derselben
Glättungskurve wie die Landmarks über `interpolate`, und zwar zwischen den nächsten Frames mit
`pose3d`. Dabei darf höchstens ein Frame ohne `pose3d` dazwischen liegen (der Video-Import
schreibt es nur an etwa jeden zweiten Frame); sonst fehlt `pose3d` im Ergebnis. Genau auf einem
Frame mit `pose3d` kommt dessen Pose unverändert zurück. Am Anfang und Ende gilt der erste bzw.
letzte Frame unverändert.

### Song (Bibliothekseintrag, nicht Teil des Exports)

`id` (UUID), `title`, `artist`, `bpm`, `difficulty` (1–3), `source` (`local` mit `blobId`,
`url`, `youtube` mit `videoId`, `spotify` mit `trackUri`), `syncOffsetMs`, `startOffsetMs`,
optional `playbackRate` (0.5–2; wirkt bei Datei, URL und YouTube, Spotify spielt immer 1×), `choreo`, `highscore`, `stars` (0–5), `createdAt`, `updatedAt`.

## Koordinaten

- Landmarks sind auf 0..1 normiert und liegen in einem **quadratischen** Raum (gleicher Maßstab
  für x und y). Kamera- und Videobilder werden über `computeAngles(…, { aspect })` entzerrt.
- Gespeicherte Choreografien liegen im **Spiegelraum**: Die Seitenbezeichnungen meinen die
  Körperseiten des Spielers, und dessen linke Seite (Index 11, 13, 15, …) erscheint links auf
  dem Bildschirm, wie in einem Spiegel. Die Demo-Figuren folgen dieser Konvention.

## Winkel

Alle Winkel sind vorzeichenbehaftet, in Grad, im Bereich −180 bis 180. Vergleich und
Interpolation laufen über den kürzesten Bogen (179° und −179° liegen 2° auseinander).

| Schlüssel                       | Bezug → Segment              | 0°                  | positiv                                                            |
| ------------------------------- | ---------------------------- | ------------------- | ------------------------------------------------------------------ |
| `leftShoulder`, `rightShoulder` | Rumpfachse → Oberarm         | Arm hängt am Körper | vom Körper weg (seitlich hoch); 180° = Arm oben                    |
| `leftElbow`, `rightElbow`       | Oberarm → Unterarm           | Arm gestreckt       | Beugung in Abduktionsrichtung (seitlicher Arm: Unterarm nach oben) |
| `leftHip`, `rightHip`           | Rumpfachse → Oberschenkel    | Bein in Rumpflinie  | vom Körper weg                                                     |
| `leftKnee`, `rightKnee`         | Oberschenkel → Unterschenkel | Bein gestreckt      | Beugung wie beim Ellbogen, je Seite gespiegelt                     |
| `torsoLean`                     | Bildsenkrechte → Rumpfachse  | aufrecht            | Neigung zur linken Körperseite                                     |

- Die Rumpfachse läuft von der Schulter- zur Hüftmitte. Sind die Hüften nicht sichtbar, gilt die
  Bildsenkrechte als Rumpfachse (Schulterwinkel bleiben messbar, `torsoLean` und Hüftwinkel
  fehlen).
- Vorzeichen folgen der Körperachse (rechte → linke Schulter), nicht der Bildrichtung. Ein rohes
  Kamerabild und sein Spiegelbild ergeben deshalb dieselben Winkel.
- Ohne beide sichtbaren Schultern ist keine Orientierung bestimmbar; dann fehlen alle Winkel.
- Landmarks mit `visibility < 0.5` gelten als nicht verfügbar; betroffene Winkel fehlen.
- Grenze: In 2D sind seitlich zur Kamera ausgeführte Bewegungen mehrdeutig.

## Spiegeln

`mirrorChoreo` (in `src/lib/choreo.ts`) tauscht links und rechts (Landmark-Paare und
Winkel-Schlüssel) und kehrt `torsoLean` um; die Positionen bleiben. Das braucht der Video-Import:
Ein Tänzer, der frontal zur Kamera tanzt, wird ungespiegelt gezeigt, und der Spieler tanzt
spiegelbildlich mit. Zweimal angewendet ergibt sich das Original.

## Skeleton3D

Interne 3D-Darstellung einer Pose (`src/lib/skeleton/`, seit Etappe 13a). Seit Format v2
(Etappe 13d) optional als `pose3d` am Frame gespeichert, geprüft durch `Skeleton3DSchema` in
`src/lib/schema.ts`:

```json
{
  "root": { "pos": [0.012, -0.004, 0.031], "yawDeg": -3.5 },
  "bones": { "torso": [0.021, 0.998, -0.06], "leftUpperArm": [0.64, -0.766, 0.05], "…": "…" }
}
```

`root.pos` hat 3 Zahlen, `yawDeg` ist endlich, jeder Knochen ein Vektor mit Komponenten in
−1..1; unbekannte Knochennamen werden abgelehnt, fehlende Knochen sind erlaubt (nie als
Nullvektor). 2D (`landmarks`, `angles`) bleibt die Grundlage für Bewertung und Anzeige.

- **Welt:** Meter, x zur linken Körperseite des Tänzers bei Gier 0, y nach oben, z zum
  Betrachter. `fromLandmarks3d` rechnet MediaPipe-Weltpunkte (x Bild rechts, y unten, z von der
  Kamera weg) um: x bleibt, y und z kehren sich um.
- **Wurzel:** `root.pos` = Beckenmitte relativ zum Startpunkt, `root.yawDeg` = Blickrichtung um
  die Senkrechte; 0 = zum Betrachter, positiv = zur eigenen linken Seite gedreht. Die Gier kommt
  aus der waagerechten Hüftachse, ohne Hüften aus der Schulterachse.
- **Körpersystem:** x links, y oben (immer senkrecht, keine Neigung in der Wurzel), z vorn.
  Rumpfneigung steckt im Knochen `torso`.
- **12 Knochen** als Einheitsvektoren im Körpersystem: `torso` (Becken → Schultermitte), `neck`
  (Schultermitte → Nase), `shoulders` und `hips` (rechtes → linkes Gelenk), Ober- und Unterarm,
  Ober- und Unterschenkel je links und rechts. Ohne Drehung entlang des Knochens, ohne Hände und
  Füße. Ist ein Gelenk unsicher (`visibility < 0.5`), fehlt der Knochen; er wird nie als 0
  gesetzt.
- **Demo-Posen** (seit 13b): `figure3d(p)` baut die Strichfigur der eingebauten Posen als
  flaches Skelett (z = 0, Gier 0); `figure()` ist dessen Projektion.
- **Projektion** (`project`): Standardlängen `BONE_LENGTHS` (Proportionen von `figure()`,
  0,44 Einheiten je Meter), frontal orthografisch in den quadratischen Spiegelraum, Beckenmitte
  bei (0,5; 0,58). Tiefe entfällt. Nicht setzbare Punkte bekommen Sichtbarkeit 0. Ohne Hüften
  werden die Schultern aufrecht über dem Becken verankert (nur Lage, kein Rumpfwinkel).
- **Interpolation:** slerp je Knochen, Wurzel linear, Gier über den kürzesten Bogen; fehlt ein
  Knochen auf einer Seite, fehlt er im Ergebnis. Unterarme und Unterschenkel laufen seit 13f-1
  relativ zum Elternknochen (Oberarm, Oberschenkel): Die Zielrichtung wird um die Drehung des
  Elternknochens zurückgedreht, darin per slerp interpoliert und mit dem interpolierten
  Elternknochen mitgedreht (`rotateBetween`). So beugt sich der Ellbogen gleichmäßig. Je Knochen
  einzeln klappte etwa „Locker“ → „Muskeln“ den Unterarm (180° Drehung) durch die Blickachse,
  der 2D-Ellbogenwinkel sprang dabei um 162° in 100 ms. Fehlt der Elternknochen, gilt slerp je
  Knochen.
- **Spiegeln** (`mirror3d`): links und rechts tauschen, x spiegeln, Gier umkehren. Die Winkel
  entsprechen `mirrorAngles` wie bei `mirrorChoreo`; anders als dort wird die Figur auch auf dem
  Bildschirm gespiegelt (x → 1 − x), damit die bewegte Seite im Spiegelraum richtig liegt.
  Zweimal angewendet ergibt sich das Original. `mirrorChoreo` spiegelt `pose3d` damit; weil
  die Landmarks dort nur umbenannt werden, zeigen Projektion und gespeicherte Landmarks danach
  dieselbe Bewegung.

## Motion-Paket

Alle Moves, die der Generator (Etappe 13f) verwenden darf, als eigenes Datenartefakt mit eigener
Version (seit Etappe 13e-1): `src/data/motion-pack.json`, erzeugt mit `bun run build-motion-pack`
(`scripts/build-motion-pack.ts`, Logik in `src/lib/motionPack.ts`), zur Laufzeit erst bei Bedarf
per dynamischem `import()` geladen (`loadMotionPack`) und gegen `MotionPackSchema`
(`src/lib/schema.ts`) geprüft. Die Datei ist generiert: nicht von Hand bearbeiten (in
`.prettierignore`); ein Test schlägt fehl, wenn sie nicht mehr zum Erzeugungsergebnis passt.

```json
{
  "version": 1,
  "clips": [
    {
      "id": "demo:left-up",
      "label": "Links hoch",
      "iconId": "left-up",
      "styles": ["party"],
      "difficulty": 1,
      "energy": 0.352,
      "beats": 1,
      "anchorBeat": 0,
      "keyframes": [
        { "beat": 0, "pose3d": { "…": "…" } },
        { "beat": 1, "pose3d": { "…": "…" } }
      ],
      "mirrorOf": "demo:right-up",
      "playability": 1,
      "source": "demo"
    }
  ],
  "transitions": { "party": { "demo:left-up": { "demo:right-up": 3 } } }
}
```

| Feld          | Bedeutung                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | eindeutig, mit Quellpräfix (`demo:<Pose-ID>`, Video: `video:<slug>:<n>`)                                                                |
| `label`       | Anzeigename (Deutsch)                                                                                                                   |
| `iconId`      | optional, wird `Move.iconId` (Demo: Pose-ID wie bisher)                                                                                 |
| `styles`      | mindestens ein Stil; Demo-Posen: `party`                                                                                                |
| `difficulty`  | 1–3: 2, wenn ein Beinknochen mehr als `LEG_DIFFICULTY_DEG` (15°) von `neutral` abweicht, sonst 1; 3 bleibt späteren Quellen vorbehalten |
| `energy`      | 0–1: mittlerer Knochenwinkel zu `neutral` / `ENERGY_FULL_DEG` (90°)                                                                     |
| `beats`       | Länge 1–4 Beats                                                                                                                         |
| `anchorBeat`  | Beat in [0, `beats`], an dem bewertet wird                                                                                              |
| `keyframes`   | mindestens einer, `{ beat, pose3d }`, Beats streng steigend in [0, `beats`]                                                             |
| `mirrorOf`    | ID des Spiegel-Clips, immer gegenseitig; fehlt bei symmetrischen Clips                                                                  |
| `playability` | Anteil der 8 Arm- und Beinwinkel, die in der Frontalprojektion sicher messbar sind                                                      |
| `sourceBpm`   | optional, Tempo der Quelle; fehlt bei Posen ohne eigenes Tempo                                                                          |
| `source`      | Kennung der Quelle (Credits, Filter), Demo: `demo`, Video: `video:<Dateiname>`                                                          |

`transitions`: pro Stil Gewichte `von → nach` (positive Zahlen, dünn besetzt, fehlendes Paar =
Grundgewicht des Generators). Das Schema prüft eindeutige IDs, gegenseitige `mirrorOf` und dass
jeder Übergang auf vorhandene Clips zeigt, die den Stil des Übergangs tragen. Version: `MOTION_PACK_VERSION` = 1.

**Anker und Keyframes:** Ein Clip beginnt mit der Ankunft in seiner Pose; die Überblendung vom
vorigen Move hinein erledigt der Generator vor dem Clip. Demo-Posen sind gehaltene Posen: 1 Beat,
Keyframes bei Beat 0 und 1 mit derselben `figure3d`-Pose, Anker bei Beat 0, ohne `sourceBpm`.
`neutral` ist als Clip enthalten (Energie 0); ob er verwendet wird, entscheidet der Generator.
Zwischen Keyframes wird mit `interpolate` überblendet.

**Erzeugung** (`buildMotionPack`), alle Zahlen auf 3 Stellen gerundet, Clips nach ID sortiert:

1. **Maße:** Abstand zweier Posen = größter Winkel zwischen entsprechenden Knochenrichtungen
   (Maximum, nicht Mittelwert: `disco-l` und `left-up` unterscheiden sich fast nur in einem
   Unterarm); der Unterschied der Blickrichtung (Gier) zählt als weiterer Winkel, eine um 40°
   gedrehte Pose ist also nicht gleich der frontalen. Fehlt einer der 12 Knochen, ist der
   Abstand unendlich. Ein Winkel ist „sicher
   messbar“, wenn `computeAngles(project(pose))` ihn liefert und Segment und Bezugssegment (für
   Schulter und Hüfte der Rumpf) nach der Projektion mindestens `MIN_PROJECTED_FRACTION` (50 %)
   ihrer Länge behalten.
2. **Filter** (je einer mit Begründung, das Skript gibt verworfene Clips aus): Vollständigkeit,
   jedes Keyframe trägt alle 12 Knochen (Video-Posen können Knochen unter der
   Sichtbarkeitsschwelle verlieren); am Anker mindestens
   `MIN_MEASURABLE_ANGLES` (4) sicher messbare Winkel; an allen Keyframes Gier höchstens
   `MAX_YAW_DEG` (±45°); keine Bodenarbeit an irgendeinem Keyframe: Rumpf höchstens 45° aus der
   Senkrechten (`MIN_TORSO_UP` = cos 45°, sonst Liegen), mittlere Kniehöhe mindestens
   `KNEE_MARGIN_M` (0,1 m) unter dem Becken (sonst Sitzen), Becken mindestens
   `MIN_PELVIS_HEIGHT_FRACTION` (0,55) der Beinlänge über dem tiefsten Knöchel (Knien ergibt
   0,5, die Demo-Hocke etwa 0,8); Höhen aus Hüftachse, Ober- und Unterschenkeln mit
   `BONE_LENGTHS` (das Körpersystem ist nur um die Senkrechte gedreht, y ist also Welt-oben),
   fehlende Knochen überspringen die jeweilige Prüfung. Schnellster Knochen zwischen zwei
   Keyframes höchstens `MAX_BONE_SPEED_DEG_PER_S` (720°/s), Knochen in Weltrichtung verglichen
   und die Gieränderung als eigene Drehung gezählt; Beats über `sourceBpm` umgerechnet, ohne mit
   `FALLBACK_BPM` (150).
3. **Gruppieren:** Leader-Clustering nach ID sortiert, Ankerabstand höchstens `GROUP_MAX_DEG`
   (20°), nur unter Clips mit gleichem `beats` und gleicher Stilmenge (sonst änderte das
   Zusammenfassen die Länge oder hängte Übergänge an einen Clip ohne diesen Stil); von jeder
   Gruppe bleibt das Medoid (kleinste Abstandssumme) unter den Mitgliedern der frühesten Quelle
   (Reihenfolge in `sources`, Demo zuerst): ein kuratierter Demo-Clip mit Piktogramm gewinnt so
   gegen einen ähnlichen Video-Clip.
4. **Spiegelpaare:** Partner ist der Clip gleicher Länge, dessen Anker dem gespiegelten eigenen
   Anker (`mirror3d`) am nächsten liegt, höchstens `MIRROR_MAX_DEG` (5°); ist das der Clip
   selbst, ist er symmetrisch. Nur gegenseitige Paare bleiben.
5. **Übergänge:** aufeinanderfolgende Paare der Quellsequenzen (Demo: die Moves der Demo-Songs),
   über die Gruppenvertreter abgebildet und pro Stil gezählt; Paare mit verworfenem Clip zählen
   nicht (keine Überbrückung).

### Quelle Video-Spuren (Etappe 13e-2)

`videoMotionSource` (`src/lib/motionPackVideo.ts`) schneidet Clips aus einer im Dev-Modus
exportierten Pose-Spur (`*.posetrack.json`, Version 2 mit Weltpunkten):

- **Schnitt:** Die Spur wird wie im Video-Import umgerechnet, immer mit Haltepunkt-Platzierung
  (`holds`), sodass die Moves auf den ruhigsten Beats liegen. Beat-Index eines Moves =
  `round(timeMs / Beatdauer)`. Clip _n_ ist die Bewegung vom Haltepunkt *n*−1 zum Haltepunkt _n_;
  `beats` = Abstand der Beat-Indizes, außerhalb 1–4 wird der Clip verworfen.
- **Keyframes:** alle `VIDEO_KEYFRAME_STEP_BEATS` (0,25 Beat) von Beat 0 bis `beats`, Pose =
  `pose3d` von `frameAt` (gespiegelt wie die importierte Choreografie). Keyframes ohne `pose3d`
  entfallen; fehlt sie am Start oder am Anker, wird der Clip verworfen.
- **Anker:** `anchorBeat` = `beats`, also auf dem Haltepunkt am Clipende: dort kommt die tanzende Person
  an und hält, der Weg dorthin ist die Bewegung des Clips. Der Generator legt den Anker auf den
  Slot-Beat und spielt den Anlauf davor.
- **Kennung:** `id` = `video:<slug>:<n>` (Dateiname klein, Nicht-Alphanumerisches als `-`, höchstens
  40 Zeichen), `label` = Dateiname ohne Endung und _n_, `source` = `video:<Dateiname>`,
  `sourceBpm` = Tempo der Spur, Stil aus `--style` (Standard `party`), kein `iconId` (der Move
  zeigt die Clip-ID).
- **Übergänge:** eine Sequenz mit allen Clips der Spur in Reihenfolge, verworfene eingeschlossen,
  damit kein Übergang über einen verworfenen Clip hinweg entsteht.

Aufruf: `bun run build-motion-pack [--style=party] [--out=Pfad] a.posetrack.json …` baut Demo
plus Video-Spuren und schreibt standardmäßig `eval-results/motion-pack.video.json` (von git
ignoriert); prüfen mit `bun run eval-choreo --pack=Pfad`. Unlesbare Dateien werden mit Meldung
übersprungen; die Ausgabe nennt je Datei geschnittene und verworfene Clips, die Filtergründe,
behaltene Clips (davon Video), Spiegelpaare unter den Video-Clips und Übergänge je Stil. Ein Paket
mit Video-Clips wird nie nach `src/data/motion-pack.json` geschrieben (das Skript bricht ab): Die
Rechte an fremden Choreografien sind ungeklärt, das Ausliefern braucht eine ausdrückliche
Entscheidung. Ohne Dateien erzeugt das Skript unverändert das ausgelieferte Paket.

## Generator

Erzeugt die Choreografie für Songs ohne eigene (`autoChoreo` in `src/data/demo.ts`, seit Etappe
13f-1) aus dem Motion-Paket. Reine Funktionen in `src/lib/generator/`, deterministisch: Zufall
nur über `randomFromString(seed)` (`src/lib/random.ts`, FNV-1a + mulberry32), Seed ist die
Song-ID. Gleicher Song, gleiche Choreo. Drei austauschbare Stufen:

```ts
planStructure(input) → Plan                          // plan.ts
selectMoves(plan, pack, input, random) → ClipRef[]   // select.ts
realizeFrames(plan, clips, pack) → { frames, moves } // realize.ts
generateChoreo(input, pack) = alle drei              // generate.ts
```

Eingabe `GenerationInput`: `bpm`, `beatPhaseMs` (Zeit eines Beats), `durationMs`, optional
`energy` (Kurve mit `hopMs` und `values`, z. B. die Onset-Hüllkurve von `analyzeAudio`), `style`
(bis 13f-2 immer `party`), `difficulty` (1–3), `seed`. `realizeFrames` geht auch ohne die ersten
beiden Stufen (feste Clip-Folgen für die Demo-Songs aus Etappe 14).

**Aufbau** (`planStructure`, ohne Zufall):

- Beat k liegt bei `beatPhaseMs + k · Beat` (Phase auf einen Beat normiert). Intro 4 Beats ohne
  Moves, 8, falls 4 Beats vor `MIN_INTRO_MS` (2 s) enden; kurze Songs kürzen das Intro, aber
  nie unter 1 Beat (10 s bei 30 BPM: 3 Beats, ein Move). Der letzte Move liegt mindestens
  `END_MARGIN_BEATS` (2) vor dem Ende. Ist dafür kein Platz, hat der Song keine Moves, und der
  Coach steht durchgehend in der Ruhepose.
- Phrasen zu 8 Beats, je 4 Phrasen eine Gruppe mit dem Muster A A B A. Gruppen wechseln zwischen
  Strophe (eigene Phrasen je Strophe) und Refrain (jeder Refrain dieselben Phrasen,
  `chorus-A`/`chorus-B`). Gleicher Schlüssel = exakt dieselbe Clip-Folge.
- Dichte (Beats pro Move, 1, 2 oder 4): Grundwert nach Schwierigkeit (1: 2, 2: 2, 3: 1);
  Phrasenenergie unter ⅓ verdoppelt, ab ⅔ halbiert (nur Schwierigkeit 2 und 3); danach wird
  verdoppelt, bis Moves mindestens `MIN_STEP_MS` (400 ms) auseinanderliegen.
- Phrasenenergie: mit Kurve der Rang (0–1) des Mittelwerts je Phrase unter allen Phrasen (vom
  Pegel unabhängig); reicht die Kurve nicht über alle Phrasen, gilt die Struktur: Strophe A 0,3,
  B 0,5, Refrain A 0,55, B 0,65 (bleibt unter ⅔, nur eine gemessene Kurve verdichtet
  Schwierigkeit 2). Gleiche Schlüssel teilen den Mittelwert, damit Wiederholungen dieselben
  Slots haben. Zielenergie der Clips 0,2 + 0,6 · Phrasenenergie.
- Gold: letzter Slot jeder Refrain-B-Phrase (ohne Refrain: der ersten B-Phrase), mit Kurve
  zusätzlich der letzte Slot der lautesten Phrase, und die Schlusspose. Die Schlusspose ersetzt
  den letzten Slot und wird bis zum Songende gehalten.

**Auswahl** (`selectMoves`): Kandidaten sind Clips des Stils (gibt es keinen, alle Stile) mit
Schwierigkeit ≤ Eingabe, Energie ≥ `MIN_MOVE_ENERGY` (0,1; `neutral` ist nie ein Move) und, falls
sie `sourceBpm` haben, höchstens `TEMPO_TOLERANCE` (±12 %) Tempounterschied; Länge ≤ Slot. Pro
Phrasenschlüssel (in Reihenfolge des ersten Auftretens) eine gewichtete Markov-Kette:
`(BASE_TRANSITION_WEIGHT + Anzahl im Paket) · Energiepassung · Spiegelbonus · Stufenbonus ·
playability`. Energiepassung als Gauß-Glocke um die Zielenergie (σ = `ENERGY_SIGMA` 0,25); der
Spiegelpartner des vorigen Clips zählt `MIRROR_BONUS` (4) mal, aber nicht zurück (kein L R L);
Clips genau der gewählten Schwierigkeit zählen `LEVEL_BONUS` (2) mal. Kein Clip folgt direkt auf
sich selbst, auch nicht über Phrasengrenzen und Wiederholungen: Der erste Slot meidet den letzten
Clip jeder schon gewählten Vorgängerphrase, der letzte Slot den ersten Clip jeder schon gewählten
Nachfolgerphrase (auch der eigenen). Bleibt bei sehr kleinen Paketen nichts übrig, werden die
Ausschlüsse gelockert. Schlusspose: symmetrischer Clip (ohne `mirrorOf`), gewichtet nach
Energie². Ohne passenden Clip bricht der Generator mit „Motion-Paket enthält keine passenden
Clips“ ab.

**Frames** (`realizeFrames`): Zeitleiste aus Keyframes. Im Intro steht die Ruhepose (Clip mit
der geringsten Energie unter `MIN_MOVE_ENERGY`, die einen Stil mit dem ersten Move teilt, sonst
dessen Ankerpose). Der Anker
eines Clips liegt auf dem Slot-Beat (`ClipRef.beat`), der Clip beginnt also `anchorBeat` früher;
so halten Moves Abstand und Endmarge, gleich welche Anker die Clips haben. Jeder Clip beginnt
mit seinem ersten Keyframe; davor wird die vorige Pose gehalten und über `BLEND_BEATS`
(1 Beat) mit Smoothstep hineingeblendet. Ein Clip behält seine Keyframes bis
`BLEND_BEATS` vor dem Start des nächsten Clips (bei Anker 0: Slotlänge − 1 Beat), mindestens
bis zum Anker; der letzte bis zum Songende. Frames liegen
auf jedem Keyframe und Move und alle `FRAME_STEP_MS` (100 ms), solange sich die Pose ändert;
gehaltene Posen brauchen keine Zwischenframes. Die Überblendung ist so schon geglättet
abgetastet; `frameAt` interpoliert dazwischen linear (siehe Frame). Jeder Frame hat `pose3d` (gerundet wie beim
Video-Import, `src/lib/precision.ts`), 33 Landmarks per `project` (4 Stellen) und Winkel per
`computeAngles` mit `aspect` 1 (0,1°). Zeiten in ganzen Millisekunden. Moves liegen auf den
Ankern, mit `label` und `iconId` (sonst `id`) des Clips.

**Größe:** 3 Minuten bei 120 BPM ca. 0,9 MB (Schwierigkeit 1 und 2) bzw. 1,5 MB
(Schwierigkeit 3); die alte `autoChoreo` ohne `pose3d` war kleiner, Video-Choreos liegen bei
1,4–1,8 MB.

**Aufruf in der App:** „Song hinzufügen“ mit automatischer Choreografie lädt das Paket per
`loadMotionPack()` (eigener Chunk, vom Service Worker vorab gecacht) und übergibt
`buildNewSong` die Schwierigkeit des Formulars. Bei einer analysierten Audiodatei kommen
Onset-Hüllkurve (Energie) und Beat-Phase (`estimateBeatPhaseMs` über die ersten 10 s) dazu, die
Moves liegen dann auf den Beats der Musik; bei URL, YouTube und Spotify ist die Phase 0. Dev-Songs
(`?devsong=…`) nutzen Schwierigkeit 1. Die eingebauten Demo-Songs sind unverändert (Etappe 14).

### Messplatz

`bun run eval-choreo` (`scripts/eval-choreo.ts`, Kennzahlen in `src/lib/generator/metrics.ts`,
Hilfen in `scripts/evalChoreo.ts`): je BPM 90, 110, 128, 150, Schwierigkeit 1–3 und 20 Seeds
eine 3-Minuten-Choreo, verglichen mit der alten `autoChoreo` (jetzt `legacyAutoChoreo`, nur
noch Basislinie). Tabelle in der Konsole, alle Läufe als JSON in `eval-results/` (ignoriert).
Optionen: `--seeds`, `--bpm`, `--noise`, `--miss`, `--out`, `--baseline-only`.

| Kennzahl    | Bedeutung                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------- |
| Moves/min   | (Moves − 1) pro Minute zwischen erstem und letztem Move                                      |
| Messbar     | Mittel je Move: Anteil der 8 Gliedmaßenwinkel, die sicher messbar sind (`measurableAngles`)  |
| Schritt °   | mittlerer Winkelabstand aufeinanderfolgender Moves                                           |
| Wiederh.    | Anteil aufeinanderfolgender Moves mit praktisch gleicher Pose (alle Winkel unter 5° Abstand) |
| Abdeckung   | Anteil der Paket-Clips (ohne Ruheposen), die mindestens einmal vorkommen                     |
| max/p95 °/s | höchste bzw. 95.-Perzentil-Winkelgeschwindigkeit einer Gliedmaße, `frameAt` alle 20 ms       |
| Score sim   | simulierter Spieler (`simulatedAngles`, 30 Bilder/s, Standard 10° Rauschen, 10 % Ausfall)    |

Stand 13f-1 nach dem Review (20 Seeds, 10° Rauschen, 10 % Ausfall; Generator-Spitzen vor der
hierarchischen Interpolation bis 2400°/s, vor der linearen `frameAt`-Interpolation 525–813°/s):

| BPM | alt: Moves/min | Generator 1 / 2 / 3: Moves/min | alt: max (p95) °/s | Generator: max °/s | Generator p95 °/s (1 / 2 / 3) |
| --- | -------------- | ------------------------------ | ------------------ | ------------------ | ----------------------------- |
| 90  | 45             | 36 / 36 / 72                   | 599 (493)          | 355                | 292 / 229 / 285               |
| 110 | 55             | 45 / 45 / 89                   | 732 (597)          | 430                | 358 / 278 / 349               |
| 128 | 64             | 52 / 52 / 103                  | 852 (700)          | 500                | 409 / 320 / 395               |
| 150 | 75             | 61 / 61 / 121                  | 991 (774)          | 549                | 488 / 378 / 479               |

Beide sind zu 100 % messbar und ohne direkte Wiederholung; Schrittweite alt 34°, Generator
33–39°; Abdeckung alt 1, Generator 0,64 bei Schwierigkeit 1 (nur Arm-Moves, 7 von 11 Clips)
und 0,99–1 sonst; Gold alt 3, Generator 5–8. Der simulierte Spieler holt bei 10° Rauschen in
beiden Varianten jeden Move als PERFECT (der Scorer nimmt die beste Pose aus ±250 ms); erst
`--noise=30 --miss=0.2` trennt etwas (PERFECT-Anteil alt 0,50–0,55, Generator 0,44–0,56, bei
Schwierigkeit 3 am niedrigsten). Reaktionszeit simuliert er nicht: Ob dichte Stufe-3-Phrasen
mitzumachen sind, zeigt nur ein Gerätetest.

## Video-Import

`choreoFromPoseTrack` (`src/lib/videoChoreo.ts`) baut aus einer Pose-Spur eines Videos eine
Choreografie im Format v2:

1. Zeitbereich zuschneiden; der Anfang des Bereichs wird 0.
2. Glätten (One-Euro, vorwärts und rückwärts; Standard `minCutoff` 2 Hz, `beta` 40, `dCutoff`
   1 Hz). Punkte mit `visibility < 0.5` laufen nie durch den Filter und bleiben unsichtbar; nach
   einer Lücke beginnt der Filter des Punkts neu. Begründung der Werte: siehe
   [Standardwerte](#standardwerte-aus-der-messung-etappe-8g-5).
3. Winkel über `computeAngles(…, { aspect })` aus den Rohkoordinaten. Gespeichert werden die
   Landmarks im quadratischen Raum: mit `s = max(aspect, 1)` gilt
   `x' = 0.5 + (x − 0.5) · aspect / s` und `y' = 0.5 + (y − 0.5) / s`. Die längere Bildseite
   füllt also 0..1, die kürzere liegt mittig.
4. Spiegeln (`mirrorChoreo`) ist Standard, weil ein Video den Tänzer ungespiegelt zeigt (siehe
   [Spiegeln](#spiegeln)). Bereits gespiegelte Aufnahmen (Selfie, Dance-Practice „Mirrored“) mit
   `mirror: false`. Der Dialog belegt den Schalter je neuer Datei nach dem Dateinamen vor
   (`looksMirrored`: „mirror“/„mirrored“, „gespiegelt“, „spiegelverkehrt“ als ganze Wörter,
   „거울“; nicht „ungespiegelt“ oder „nicht gespiegelt“). yt-dlp übernimmt den Videotitel in den
   Dateinamen (Etappe 8g-4d).
5. Frames etwa alle 100 ms. Koordinaten auf 4 Stellen gerundet, Winkel auf 1 Stelle. Die
   Visibility wird auf 2 Stellen **abgerundet**, damit kein unsicherer Punkt über die Schwelle
   rutscht. Ab 0.99 entfällt sie (`[x, y]` = voll sichtbar). `lowVisibility` steht, wenn nicht
   beide Schultern und beide Hüften sichtbar sind. Drei Minuten ergeben etwa 1,3 MB JSON.
   Mit Weltpunkten (Pose-Spur v2) bekommt etwa **jeder zweite** Frame `pose3d` =
   `fromLandmarks3d(world)` aus derselben geglätteten Probe (MediaPipe-Weltpunkte ohne weitere
   Umrechnung), gerundet auf 3 Stellen (Wurzelposition in m, Knochenrichtungen) und die Gier auf
   0,1°; ohne Knochen (keine Körperachse sichtbar) entfällt es. Ausgedünnt wird nach dem
   Verschieben um die Beat-Phase: Ein Frame behält seinen `pose3d`, wenn er der erste oder
   letzte ist, der vorige keinen hat oder der nächste keinen Kandidaten hat. Zwei Frames in
   Folge ohne `pose3d` gibt es also nur, wo das Video an mindestens einem davon keine
   brauchbaren Weltpunkte (oder keine Körperachse) lieferte; nur dort fehlt die 3D-Pose auch in
   `frameAt`. `landmarks` und `angles` kommen
   weiter aus den 2D-Punkten. Gemessen an einer synthetischen 3-Minuten-Choreo (1800 Frames, 33
   Landmarks, Test in `src/test/choreoV2.test.ts`): `pose3d` an jedem Frame +57,8 % (mit 2
   Stellen +51,3 %), ausgedünnt +29,0 % (1,37 → 1,77 MB). Ziel war unter +50 %.
6. Moves nach `movePlacement` (Etappe 8g-4c). Ein Kandidat entfällt, wenn der Frame dort
   fehlt, `lowVisibility` hat oder weniger als 4 Arm- und Beinwinkel trägt.
   - `"grid"` („Fester Takt“): Moves alle `beatsPerMove` Beats (Standard 2) ab
     `beatOffsetMs`.
   - `"holds"` (Standard seit 8g-5, „Haltepunkte“): Die Beats werden in Fenster zu k Beats geteilt, k =
     `beatsPerMove` gerundet, mindestens 1. Jedes Fenster beginnt an einem Rasterpunkt
     `beatOffsetMs + n · k Beats` im Abschnitt (bei ganzzahligem `beatsPerMove` genau die
     Rasterpunkte von `"grid"`); Beats vor dem ersten Rasterpunkt gehören zu keinem Fenster. Je
     Fenster gewinnt der Beat mit der geringsten Bewegung (`poseMotionAt`: mittlere
     Winkeländerung der Arm- und Beinwinkel in °/s zwischen ±¼ Beat, mindestens 4 Winkel auf
     beiden Seiten, beide Zeitpunkte innerhalb der Frames; bei Gleichstand der frühere). Beats
     näher als max(300 ms, 1 Beat) am vorigen Move entfallen. Ist kein Beat eines Fensters
     messbar (etwa am Rand), gilt sein Rasterpunkt, wenn er brauchbar ist und den Abstand hält.
     Höchstens ein Move je Fenster, etwa so viele wie beim festen Takt (weniger, wenn
     Rasterpunkte unbrauchbar sind oder über 200 BPM der Mindestabstand greift).

   `label` ist „Move“, `iconId` ist „video“. Die Beat-Phase (`beatOffsetMs` modulo Beatlänge)
   landet in `offsetMs`; Frames und Moves rücken um sie nach vorn (Frames vor 0 entfallen). So
   liegen die Moves auf `k · Beatlänge`, wie Beat-Puls und Sync-Test es erwarten, und die Lage
   zum Audio bleibt gleich.

7. Gold-Vorschlag: 2–4 Moves (etwa jeder achte) mit der größten Winkeländerung zum vorigen Move,
   mit Mindestabstand über den Song verteilt.

Bleiben weniger als 2 Frames oder 2 Moves übrig, bricht der Import mit einer Meldung ab.

Im Dialog „Song hinzufügen“ (Etappe 8c, `buildVideoChoreo` in `src/lib/library/videoImport.ts`)
gilt Videozeit = Audiozeit. Für den Bereich `[start, ende]` und eine Beat-Phase `P` in Videozeit
(Zeitpunkt irgendeines Beats, Standard 0):

- `choreoFromPoseTrack` bekommt den Bereich und `beatOffsetMs = P − start` (darf negativ sein).
- `choreo.offsetMs = start + ((P − start) mod Beatlänge)`. Ein Move bei Choreo-Zeit `t` liegt
  damit bei Audiozeit `t + offsetMs`, also genau dort, wo er im Video getanzt wird, und auf
  `P + k · Beatlänge`.
- `song.startOffsetMs = start`: Die Musik beginnt am Bereichsanfang. `syncOffsetMs` ist 0.
- BPM kommt aus dem Formular und darf gebrochen sein (Analyse auf 0,1 BPM, Etappe 8g-4a). Kein
  Formatwechsel, keine neue Version.
- Mehrere Personen im Video (Etappe 8f): Die Analyse kennt bis zu 3 Personen je Probe;
  `choreoFromPoseTrack` bekommt nur die gewählte Zielperson (`trackTarget`, siehe
  [architecture.md](architecture.md#zielperson-etappe-8f)). Am Format ändert sich nichts.
- `P` kann „Takt erkennen“ setzen (Etappe 8e): erster Beat ab `start`, geschätzt aus der
  Onset-Hüllkurve der Musikdatei oder der Tonspur des Videos (`estimateBeatPhaseMs`, siehe
  [architecture.md](architecture.md#bpm-schätzung-und-beat-phase)). Jeder Beat ist als `P`
  gleichwertig, der Wert ab `start` ist nur leichter zu lesen.

### Standardwerte aus der Messung (Etappe 8g-5)

Gemessen mit `bun run tune-video` an zwei echten Videos (Modell „full“): einer BTS Dance
Practice (36 s, 119 BPM) und einem TikTok-Tanz (18 s, 122 BPM). Holdout-Fehler in Grad,
niedriger ist besser:

| Einstellung                    | BTS   | TikTok | Mittel |
| ------------------------------ | ----- | ------ | ------ |
| bisher `minCutoff 1, beta 10`  | 12,64 | 8,19   | 10,41  |
| ungeglättet                    | 12,71 | 7,79   | 10,25  |
| **neu `minCutoff 2, beta 40`** | 12,58 | 7,64   | 10,11  |

- Die bisherigen Werte glätteten zu stark: Beim TikTok-Tanz waren sie schlechter als gar keine
  Glättung, weil schnelle Moves abgeschnitten wurden. `minCutoff 2, beta 40` lag bei beiden
  Videos vorn und innerhalb eines erweiterten Rasters (`minCutoff` bis 1000, `beta` bis 320),
  also nicht am Rand. Bei BTS ist der Abstand (0,06°) nicht aussagekräftig.
- `maxGapMs` hatte keine Wirkung (keine längeren Lücken in den Videos) und bleibt 250.
- Haltepunkte (`"holds"`) sind jetzt Standard: gleicher Holdout-Fehler wie `"grid"`, aber
  ruhigere Zielposen an den Moves (`moveMotionDegPerS` 98 statt 107 °/s bei BTS, 116 statt
  155 °/s beim TikTok) und bei BTS mehr brauchbare Moves (33 statt 31 von 36).
- Kein Formatwechsel: Gespeicherte Choreografien bleiben unverändert, die Werte gelten für neue
  Importe. Dev-Rohdaten ohne `movePlacement` (vor 8g-4c) werden weiter mit `"grid"` gerechnet.
- Zwei Videos sind eine kleine Basis; mit weiteren Videos (Party-Klassiker, Zumba) erneut
  prüfen. Ob sich Haltepunkte im Spiel besser anfühlen, bleibt ein Gerätetest.

## Editor

Der Choreografie-Editor (Etappen 8d-1 und 8d-2a, `/edit/$songId`) ändert `moves[].gold` und
`moves[].timeMs`, entfernt Moves (mindestens 2 bleiben), fügt Moves ein, verschiebt `choreo.offsetMs` (ganze ms, höchstens ±10 s um den
gespeicherten Wert, kein Move vor Musikzeit 0) und setzt das Song-Feld `playbackRate` (0,75 oder 1,25; bei 1× entfällt das
Feld). Beim Speichern setzt er `choreo.updatedAt`, `updatedAt` des Songs setzt das Repository.
Für Move-Zeiten gilt (Verschieben um ½ oder 1 Beat, Einfügen): auf 0,1 ms gerundet (wie beim
Video-Import, halbe Beats driften nicht), Moves bleiben nach `timeMs` sortiert, mindestens 300 ms
Abstand zum Nachbar-Move (`MIN_MOVE_GAP_MS`, Grenze der Spielbarkeit, ein Beat Abstand bis
200 BPM; Bewertungsfenster dürfen überlappen, der Scorer merkt sich die beste Abweichung pro Move), Zeit innerhalb der Frames
(erste bis letzte Frame-Zeit), dort eine brauchbare Zielpose (gleiche Regel wie beim Import: kein
`lowVisibility`-Frame und genug Gliedmaßen-Winkel in der per `frameAt` interpolierten Pose, die
auch die Bewertung nutzt), nicht vor 0 und nicht vor Musikzeit 0 (`timeMs + offsetMs`). Verstöße
werden abgelehnt, nicht begrenzt. Ein neuer Move liegt in der Mitte zum nächsten Move, gerastet
auf das Beat-Raster der Choreografie-Zeit (k · Beatlänge; die Beat-Phase steckt in `offsetMs`),
sonst ungerastet; nach dem letzten Move zwei Beats später. Er ist kein Gold Move, `label` ist
leer, `iconId` ist „editor“. Frames und vorhandene Labels bleiben unverändert.
Kein Formatwechsel, keine neue Version.

## Export-Datei

Choreografien werden ohne Audio als JSON exportiert:

```json
{
  "format": "dancebeat-choreo",
  "version": 2,
  "exportedAt": 1760000000000,
  "song": {
    "title": "…",
    "artist": "…",
    "bpm": 120,
    "difficulty": 2,
    "syncOffsetMs": 0,
    "startOffsetMs": 0
  },
  "choreo": { "version": 2, "id": "…", "…": "…" }
}
```

Quelle, Highscore und Sterne werden nicht exportiert. Beim Import wird die Datei geprüft (inkl.
Sortierung), ältere Choreografie-Versionen werden migriert, und Song und Choreografie bekommen
neue UUIDs. Exportiert wird Version 2; Dateien der Version 1 bleiben lesbar und kommen als
Version 2 heraus. Ein Import überschreibt also nie einen vorhandenen Eintrag.

## Versionen und Migration

| Version | Änderung                                                                    |
| ------- | --------------------------------------------------------------------------- |
| 0       | ohne `version`-Feld; Winkel ohne Vorzeichen (Innenwinkel 0–180°), freie IDs |
| 1       | `version`, UUIDs, `createdAt`/`updatedAt`, vorzeichenbehaftete Winkel       |
| 2       | optional `pose3d` je Frame (`Skeleton3D`, Etappe 13d)                       |

Migration 0 → 1 (`src/lib/library/migrations.ts`): Winkel werden aus den Landmarks neu
berechnet; Frames ohne Landmarks verlieren ihre Winkel (nicht verfügbar statt falsch). Nicht-UUID-IDs
werden ersetzt. Die IndexedDB-Version 2 führt diese Migration beim Öffnen aus.

Migration 1 → 2: nur die Version wird gesetzt, Frames und Zeitstempel bleiben unverändert.
`migrateChoreo` läuft die Schritte 0 → 1 → 2 ab der gespeicherten Version durch und prüft erst
danach gegen das Schema. Die IndexedDB-Version 3 führt sie beim Öffnen aus (gleicher Durchlauf
über alle Songs wie bei Version 2).

Bei einer Formatänderung: Version erhöhen, Migrationsschritt ergänzen, IndexedDB-Version erhöhen,
Tests und diese Tabelle aktualisieren.
