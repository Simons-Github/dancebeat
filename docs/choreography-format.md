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

Optional `videoBlobId` (seit Etappe 8h-2b-1): Schlüssel eines eigenen Tanzvideo-Blobs im Store
`blobs`, wenn beim Video-Import „Video behalten“ an war und die Musik nicht aus dem Video kommt.
Es gilt dieselbe Zeitachsen-Annahme wie beim Import (Videozeit = Musikzeit). Das Feld gehört
zum Bibliothekseintrag, nicht zur Choreografie, und wird nicht exportiert. Keine neue Version
und keine Migration: Es ist optional, alte Einträge bleiben gültig (wie bei `playbackRate`).
Löschen entfernt beide Blobs. Nachträglich anhängen, ersetzen oder entfernen (seit 8h-2b-2a)
geht nur über `SongRepository.setVideo`, das den alten Blob in derselben Transaktion löscht und
jedes neue Video unter einer neuen `videoBlobId` ablegt.

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
`.prettierignore`); ein Test schlägt fehl, wenn ihre Demo-Clips nicht mehr zum Erzeugungsergebnis
passen. Seit Etappe 13i enthält sie neben den 12 Demo-Clips eine Auswahl der AIST++-Clips
(Abschnitt [Ausgelieferte AIST-Auswahl](#aist-auswahl)), als kompaktes JSON.

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
Rechte an fremden Choreografien sind ungeklärt. Ausgeliefert werden nur AIST++-Clips (`--ship`,
siehe unten). Ohne Dateien erzeugt das Skript das reine Demo-Paket; enthält
`src/data/motion-pack.json` schon AIST++-Clips, bricht es ab und nennt den `--ship`-Aufruf.

### Quelle AIST++ (Etappe 13h)

<a id="aist"></a>Mocap-Clips aus AIST++ werden zu Pose-Spuren v2 und laufen dann denselben Weg
wie Video-Spuren. Ablauf: `.pkl` → `scripts/aist/convert.py` → neutrales JSON und Clip-Liste →
`bun run aist-track` → `*.posetrack.json` → `build-motion-pack`. Logik in `src/lib/aist.ts`.

- **Konverter** (Python, `numpy` aus `scripts/aist/requirements.txt` in einer venv außerhalb des
  Repos, immer mit `python -I`):
  `<venv>/bin/python -I scripts/aist/convert.py --out=Ordner [--ignore=ignore_list.txt] *.pkl`.
  Die Pickles sind fremde Daten. Ein eingeschränkter Unpickler löst nur die
  NumPy-Hilfsfunktionen zum Wiederaufbau von Arrays auf; jede andere Klasse bricht die Datei ab.
  Gelesen wird `keypoints3d_optim`, das ein Float-Array der Form (N, 17, 3) sein muss. Gelenke
  mit nicht endlichen Werten werden `null`, Zentimeter sind auf 0,01 gerundet. Der Konverter
  überspringt Genres ohne stehenden Tanz und Namen aus der `ignore_list.txt` von AIST++. Er
  schreibt `clips.json` mit dem BPM des Musikstücks laut AIST Dance DB: House `mHO0`–`mHO5`
  110–135 in 5er-Schritten, alle anderen 80–130 in 10er-Schritten. Ohne `beatPhaseMs`, also
  Phase 0 (begründet unter [Musik und Beat-Phase](#aist-musik)). Test:
  `<venv>/bin/python -I scripts/aist/test_convert.py` (nicht Teil von `bun run test`).

- **Eingabe** `<Clipname>.aist.json`: `{ "fps": 60, "joints": [[[x, y, z] | null, … 17], …] }`,
  `keypoints3d_optim` als COCO-17 in Zentimetern, AIST-Welt mit y nach oben, rechtshändig.
  Fehlende Gelenke sind `null`.
- **Clip-Liste** (`--list`, JSON-Array): `{ "name": "gHO_sBM_cAll_d19_mHO0_ch01", "bpm": 120,
"beatPhaseMs": 0 }`, `beatPhaseMs` optional. Zugelassen sind nur Genres mit stehendem Tanz (`AIST_STANDING_GENRES`:
  House, LA- und Middle-Hip-Hop, Locking, Waacking, Jazz Ballet), kein Break und kein Krump.
  Namen müssen eindeutig sein. Das BPM kommt aus der AIST-Tabelle (an den Musikdateien
  nachgemessen, siehe unten). Der Konverter lässt `beatPhaseMs` weg, also 0: Clip-Zeit 0 liegt auf dem Beat.
- **Gelenke** (`COCO_TO_MEDIAPIPE`): Nase 0→0, Augen 1/2→2/5, Ohren 3/4→7/8, Schultern 5/6→11/12,
  Ellbogen 7/8→13/14, Handgelenke 9/10→15/16, Hüften 11/12→23/24, Knie 13/14→25/26,
  Knöchel 15/16→27/28 (ungerade COCO-Indizes = links). Alle anderen MediaPipe-Punkte bekommen
  Sichtbarkeit 0 und werden übersprungen, nie als 0 gewertet.
- **Achsen** (`cocoToWorld`): Meter, Ursprung Hüftmitte (ohne beide Hüften Schultermitte, ohne
  beide `null`), MediaPipe-Konvention (x gleich, y und z umgedreht). Das ist eine Drehung um 180°
  um x, also keine Spiegelung.
- **Blickrichtung** (`clipYawDeg`): Kreismittel der Gier über alle Bilder des Clips. Alle Bilder
  werden um diesen einen Wert gedreht, sodass die Person im Mittel zur Kamera schaut. Drehungen
  innerhalb des Clips bleiben sichtbar.
- **Spur:** Abtastung alle `AIST_STEP_MS` (50 ms, wie die Video-Analyse) mit dem nächstgelegenen
  Bild. Weltpunkte wie oben, auf 4 Stellen gerundet. 2D-Landmarks sind `project` des Skeletts
  mit x → 1 − x, also Kameraraum wie bei einem ungespiegelten Frontvideo; dazu `mirror: true`,
  `aspect` 1, `movePlacement` `holds`, `video` = `AIST++ <Clipname>` (Clip-IDs damit
  `video:aist-…`).
- **Warnungen:** Zeigt die Nase in den meisten Bildern nach hinten (Median der Vorwärtskomponente
  des Knochens `neck` < 0), sind die Achsen vermutlich gespiegelt oder vertauscht. Eine zweite Warnung kommt, wenn
  mehr als die Hälfte der Proben keine Pose hat. Ganz ohne Pose bricht das Skript für diese Datei
  ab.

Aufruf: `bun run aist-track --list=clips.json [--out=Ordner] a.aist.json …`, Ausgabe standardmäßig
`eval-results/aist/<Clipname>.posetrack.json`. `*.aist.json` und Pose-Spuren sind von git
ignoriert, weil es fremde Daten sind. Das AIST erlaubt die nicht-kommerzielle Nutzung
(Auskunft 2026-10-23, 14-0.1); ausgeliefert wird eine Auswahl (nächster Abschnitt).

### Musik und Beat-Phase der AIST-Clips (Etappe 13h-3)

<a id="aist-musik"></a>Die 60 Musikstücke der AIST Dance DB liegen lokal in
`Rohdaten/aist-music/` (von git ignoriert, Fremdinhalt; Quelle in der Roadmap unter 13h-3).
`bun run aist-music Rohdaten/aist-music/m{HO,LH,MH,LO,WA,JB}?.mp3` (`scripts/aist/measure-music.ts`,
braucht `ffmpeg`) misst die 36 Stücke der stehenden Genres und schreibt
`scripts/aist/music.json`. Eingecheckt sind nur die Zahlen, nie die Dateien. Schlägt eine Datei
fehl, bleibt die Tabelle unverändert; gemessen wird deshalb immer der ganze Satz.

- **Format** (`AistMusicTableSchema`): `{ "mHO0": { "bpm": 110, "measuredBpm": 110.03,
"beatPhaseMs": 60, "durationMs": 54545 }, … }`. `bpm` ist der Tabellenwert
  (`aistMusicBpm`, gleiche Tabelle wie `music_bpm` im Konverter), `beatPhaseMs` der erste Beat
  in der Musikdatei, unter einem Beat.
- **Tempo:** frei geschätzt landet es oft auf einem falschen Verhältnis (mMH0 160 statt 80, mLH1
  120 statt 90). Das Skript sucht deshalb nur ±0,5 BPM um den Tabellenwert (Kammfilter über das
  ganze Stück, Vollband) und warnt ab 0,1 BPM Abweichung. Ergebnis: alle 36 Stücke innerhalb von
  0,06 BPM, die Tabelle stimmt (Test in `aist.test.ts`).
- **Phase:** Kammfilter beim Tabellentempo auf dem Kick-Band, wie bei den Demo-Songs.
- **Die Phase der Musikdatei gilt nicht für die Clips.** Geprüft gegen die kinematischen Beats
  (Minima der geglätteten mittleren Gelenkgeschwindigkeit, σ 3 und 5 Bilder, gefaltet auf den
  Beat, Kreismittel je Stück und Situation). Mit Phase 0 ballen sich die Mittel der 6 Stücke je
  Genre eng (R über die Stücke 0,81–0,97 bei Locking, LA-Hip-Hop, Waacking und Middle-Hip-Hop;
  Zufall läge bei etwa 0,35), Basic- und Freestyle-Clips liegen gleich. Mit der Phase der
  Musikdatei streuen sie breit; besser als vertauschte Phasen gleichen Tempos ist sie nur bei
  Locking und Waacking-Freestyle. 12 Stücke haben eine große Dateiphase (mLH0 610 ms, mMH2 420 ms, mJB2 310 ms),
  Vollband und Kick-Band messen dort dasselbe. Die Dateien sind dort also gegen die Clips
  versetzt; ein Messfehler ist es nicht. Folge: AIST++-Clips behalten `beatPhaseMs` 0.
- **Warum die Bewegung hier reicht:** In 13h-2 taugte sie nicht als Ersatz, weil jedes Genre
  mit eigenem Versatz auf den Beat tanzt. Hier wird keine Phase aus der Bewegung abgelesen,
  sondern geprüft, ob die 6 Stücke eines Genres (verschiedene Tempi, Basic und Freestyle)
  denselben Versatz zeigen. Das tun sie mit Phase 0, nicht mit der Dateiphase. Belegt ist damit
  ein gemeinsames Raster ab Clip-Zeit 0; der Stilversatz bleibt in den Clips.
- **Versatz der Bewegung zum Beat** (Stilmerkmal, kein Fehler): Bei Phase 0 liegen die
  Bewegungspausen bei Locking etwa 60 ms, LA-Hip-Hop und Waacking etwa 100 ms nach dem Beat,
  House und Jazz Ballet unsicher später, Middle-Hip-Hop etwa 160 ms davor. Die Haltepunkte
  (`holdTimes`) wählen innerhalb ihres Fensters ohnehin den Punkt der Pause.

### Ausgelieferte AIST-Auswahl (Etappe 13i)

<a id="aist-auswahl"></a>Aufruf:
`bun run build-motion-pack -- --ship eval-results/aist/*.posetrack.json`. Mit `--ship` müssen alle
Dateien lesbare AIST++-Spuren sein (Videoname beginnt mit `AIST++ `), sonst bricht das Skript ohne
Schreiben ab. Es baut das volle Paket wie oben, wählt mit `selectShippedClips`
(`src/lib/motionPack.ts`) aus und schreibt `src/data/motion-pack.json` kompakt; die Ausgabe nennt
Clipzahl, Clips je Eimer und Dateigröße.

- **Unverändert:** jeder Clip, der nicht aus AIST++ stammt (`source` beginnt nicht mit
  `video:AIST++ `), also die Demo-Clips.
- **Eimer:** AIST++-Clips mit `energy` ≥ `MIN_MOVE_ENERGY` (0,1; Ruheposen nutzt der Generator nie
  als Move) je Paar aus `sourceBpm` und `difficulty`, wie die Tempo- und Stufenfilter des
  Generators. Je Eimer höchstens `SHIP_CLIPS_PER_BUCKET` (12).
- **Auswahl im Eimer** (Farthest-Point, gierig auf der Ankerpose, Abstand `boneDistance`): zuerst
  der Clip mit der höchsten `playability`, dann `energy`, dann kleinster ID; danach jeweils der
  Clip mit dem größten Abstand zum nächsten schon gewählten, bei Gleichstand die kleinere ID.
  Clips ohne Ankerpose fallen weg.
- **Folgen** (seit 13j): Nach jedem so gewählten Startclip folgt die Auswahl der Quellfolge, bis
  die Kette `SHIP_CHAIN_CLIPS` (3) Clips hat oder der Eimer voll ist. Nächster Clip ist der
  häufigste beobachtete Nachfolger (Übergänge aller Stile summiert, bei Gleichstand die kleinere
  ID), der im selben Eimer liegt und noch nicht gewählt ist; gibt es keinen, endet die Kette. Der
  nächste Startclip ist wieder der fernste zu allen gewählten. Mit Kettenlänge 1 ist das genau
  die Auswahl aus 13i. Grund: Einzelclips per Farthest-Point ließen zwischen den 180 AIST++-Clips
  nur 8 Übergänge übrig, mit Ketten sind es 65. Stufe-1-Eimer haben kaum Nachfolger im eigenen
  Eimer (die Nachbarn sind meist Stufe 2) und bleiben fast wie vorher.
- **Aufräumen:** `mirrorOf` auf einen nicht behaltenen Clip entfällt, Übergänge bleiben nur
  zwischen behaltenen Clips (leere Zeilen und Stile entfallen). Reihenfolge wie im vollen Paket,
  deterministisch, Ergebnis gegen `MotionPackSchema` geprüft.

Stand 13i: 192 Clips (12 Demo, 180 AIST++ aus 15 Eimern zu je 12), 0,76 MB, im Build ein eigener
Chunk von 648 kB (149 kB gzip). Stand 13j: gleiche Clipzahl, 0,75 MB, 91 Übergangspaare statt 34 (65
zwischen AIST++-Clips statt 8). Seit Etappe 14e bauen auch die Demo-Songs aus dem ganzen Paket
(siehe [Demo-Pipeline](#demo-pipeline)); `withoutAistClips` nutzt nur noch der Aktualitätstest des
Pakets.

## Generator

Erzeugt die Choreografie für Songs ohne eigene (`autoChoreo` in `src/data/demo.ts`, seit Etappe
13f-1) aus dem Motion-Paket. Reine Funktionen in `src/lib/generator/`, deterministisch: Zufall
nur über `randomFromString(seed)` (`src/lib/random.ts`, FNV-1a + mulberry32), Seed ist die
Song-ID. Gleicher Song, gleiche Choreo. Ausnahme „Choreografie neu erzeugen“ (13f-2,
`regenerateSong` in `src/lib/library/regenerate.ts`): neuer zufälliger Seed bei jedem Aufruf,
nicht gespeichert (die erzeugte Choreo wird gespeichert); Länge aus dem letzten Frame bzw. Move
der bisherigen Choreo, Choreo-ID, Farben und `offsetMs` bleiben. Drei austauschbare Stufen:

```ts
planStructure(input) → Plan                          // plan.ts
selectMoves(plan, pack, input, random) → ClipRef[]   // select.ts
realizeFrames(plan, clips, pack) → { frames, moves } // realize.ts
generateChoreo(input, pack) = alle drei              // generate.ts
```

Eingabe `GenerationInput`: `bpm`, `beatPhaseMs` (Zeit eines Beats), `durationMs`, optional
`energy` (Kurve mit `hopMs` und `values`, z. B. die Onset-Hüllkurve von `analyzeAudio`), `style`
(vorerst immer `party`, das Paket hat nur diesen Stil), `difficulty` (1–3), `seed`. `realizeFrames` geht auch ohne die ersten
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
`(BASE_TRANSITION_WEIGHT + OBSERVED_TRANSITION_WEIGHT · Anzahl im Paket) · Energiepassung ·
Spiegelbonus · Stufenbonus · playability`. Ein einmal beobachteter Übergang zählt damit 21-mal so
viel wie ein unbeobachteter (`OBSERVED_TRANSITION_WEIGHT` = 20 seit 13j, vorher 1).
Energiepassung als Gauß-Glocke um die Zielenergie (σ = `ENERGY_SIGMA` 0,25); der
Spiegelpartner des vorigen Clips zählt `MIRROR_BONUS` (4) mal, aber nicht zurück (kein L R L);
Clips genau der gewählten Schwierigkeit zählen `LEVEL_BONUS` (2) mal. Kein Clip folgt direkt auf
sich selbst, auch nicht über Phrasengrenzen und Wiederholungen: Der erste Slot meidet den letzten
Clip jeder schon gewählten Vorgängerphrase, der letzte Slot den ersten Clip jeder schon gewählten
Nachfolgerphrase (auch der eigenen). Endet ein Vorkommen früher (weniger Slots als die Folge des
Schlüssels, z. B. eine 4-Beat-Phrase im Demo-Aufbau), gilt das für den Slot, auf dem es endet
(seit 14b). Bleibt bei sehr kleinen Paketen nichts übrig, werden die
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
bis zum Anker; der letzte bis zum Songende. Beginnt der nächste Clip, bevor der vorige seinen
letzten Key erreicht (bei AIST++-Clips mit `anchorBeat` 1–3 häufig) oder weniger als ½ Beat
danach, steigt er später ein:
`MIN_BLEND_BEATS` (½ Beat) nach diesem Key, höchstens auf seinem Anker, in seiner eigenen Pose an
dieser Stelle (seine Keyframes davor entfallen). Auch diese kürzere Blende läuft mit Smoothstep, so
wird der Einstieg nie eine gerade Linie, und bei streng steigenden Move-Beats (wie sie Generator
und Demo-Folgen liefern) geht kein Anker verloren (14f). Frames liegen
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

| Kennzahl    | Bedeutung                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| Moves/min   | (Moves − 1) pro Minute zwischen erstem und letztem Move                                                                    |
| Messbar     | Mittel je Move: Anteil der 8 Gliedmaßenwinkel, die sicher messbar sind (`measurableAngles`)                                |
| Schritt °   | mittlerer Winkelabstand aufeinanderfolgender Moves                                                                         |
| Wiederh.    | Anteil aufeinanderfolgender Moves mit praktisch gleicher Pose (alle Winkel unter 5° Abstand)                               |
| Abdeckung   | Anteil der Paket-Clips (ohne Ruheposen), die mindestens einmal vorkommen                                                   |
| max/p95 °/s | höchste bzw. 95.-Perzentil-Winkelgeschwindigkeit einer Gliedmaße, `frameAt` alle 20 ms; mit `pose3d` nur messbare Winkel   |
| Quote sim   | Sternquote (0–1, seit N2 ohne Combo) des simulierten Spielers (`simulatedAngles`, 30 Bilder/s, 10° Rauschen, 10 % Ausfall) |

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

## Demo-Manifest

Seit Etappe 14a-1 beschreibt je ein Manifest einen ausgelieferten Demo-Song:
`src/data/demos/<slug>.manifest.json`, von Hand geschrieben und gegen `DemoManifestSchema`
(`src/lib/demoManifest.ts`) geprüft. Es wird nicht in der Bibliothek gespeichert, hat deshalb eine
eigene Version (`1`) und keine Migration.

| Feld          | Bedeutung                                                                           |
| ------------- | ----------------------------------------------------------------------------------- |
| `id`          | Song-ID `demo-<slug>`                                                               |
| `title`       | Titel                                                                               |
| `artist`      | Künstlerzeile, „DanceBeat Original“                                                 |
| `audio`       | Dateiname in `public/demo-audio/` (nur `A–Z a–z 0–9 _ -`, Endung `.mp3`)            |
| `palette`     | Index in `SONG_PALETTES` (`src/theme.ts`); keine Hex-Werte im Manifest              |
| `difficulty`  | 1–3                                                                                 |
| `bpm`         | gemessenes Tempo (30–300, Messung in 0,01-Schritten)                                |
| `beatPhaseMs` | Zeit von Beat 0, kleiner als ein Beat (Beat des Rasters, nicht gemessener Downbeat) |
| `durationMs`  | gemessene Länge der Audiodatei                                                      |
| `sections`    | Abschnitte `{ kind, beats }` in Reihenfolge ab Beat 0                               |
| `phrases`     | je Abschnittstyp `"auto"` oder eine feste Folge von Clip-IDs                        |
| `gold`        | Gold Moves als `{ section, beat }` (Index in `sections`, Beat im Abschnitt)         |
| `moveNames`   | optional: Anzeigename je Clip-ID                                                    |

- **Abschnittstypen:** `intro`, `verse`, `prechorus`, `chorus`, `bridge`, `outro`.
- **Längen in Beats, Vielfaches von 4** (ein Takt), nicht in 8er-Zählzeiten: Die KI-Songs halten
  die 8er-Phrasierung nicht ein, Abschnittsgrenzen fallen auch auf Beat 4 mod 8.
- **Phrasen:** Jeder vorkommende Abschnittstyp braucht einen Eintrag. `"auto"` heißt: der
  Generator wählt mit dem Seed des Songs ([Demo-Pipeline](#demo-pipeline)). Clip-IDs müssen im Motion-Paket stehen
  (`unknownClipIds`); solange das Paket nur die `demo:*`-Clips hat, stehen alle Phrasen auf `"auto"`.
- **Prüfungen:** Intro nur als erster, Outro nur als letzter Abschnitt; Gold-Abschnitt und -Beat liegen in den Abschnitten, nicht in Intro oder Outro,
  ohne Dubletten; `beatPhaseMs` + Summe der
  Beats · 60000 / `bpm` ≤ `durationMs`; Beat-Phase kleiner als ein Beat. Unbekannte Felder sind Fehler (`.strict()`).
- **Beat 0** ist ein Beat des gemessenen Rasters, kein gemessener Takt-Anfang; die
  Abschnittslängen sind auf demselben Raster geschätzt.

**Messung:** `bun run measure-audio public/demo-audio/*.mp3` (`scripts/measure-audio.ts`, Logik
in `scripts/measureAudio.ts`) braucht `ffmpeg` im PATH (Systemwerkzeug, keine
Projektabhängigkeit). Tempo: Grobschätzung und `refineBpm` wie in der App, dann ein Kammfilter
über den ganzen Song (±0,5 BPM in 0,01-Schritten; ein Onset zählt zum Hüllkurven-Schritt
`floor(t / hop)`, wie `onsetEnvelope` ihn bildet). Phase: derselbe Kammfilter bei festem Tempo
auf dem Kick-Band (Tiefpass 120 Hz), weil das volle Band in manchen Songs auf die Hi-Hat-Offbeats
einrastet. Dazu gibt das Skript die Länge und eine Tabelle der Energie (RMS voll und Kick-Band)
je 4 Beats aus; daraus werden die Abschnitte geschätzt und danach per Gehör geprüft.

### Demo-Pipeline

Seit Etappe 14b baut `bun run build-demo src/data/demos/*.manifest.json` (`scripts/build-demo.ts`,
Logik rein in `src/lib/demoBuild.ts`) aus jedem Manifest die Choreografie
`src/data/demos/<slug>.choreo.json`. Das JSON ist kompakt, wird mit `ChoreographySchema` geprüft
und ist von Prettier ausgenommen. Option `--pack=path` (Standard `src/data/motion-pack.json`);
genutzt wird das ganze Paket, AIST++-Clips eingeschlossen (seit Etappe 14e, vorher nur die
Demo-Clips).
Deterministisch: Seed ist die Song-ID; ein Test vergleicht die eingecheckten Dateien mit einem
frischen Build. Nach jeder Änderung an Manifest, Paket oder Generator neu bauen.

```ts
planFromManifest(manifest) → Plan                 // ersetzt planStructure
buildDemoClips(manifest, pack, plan?) → ClipRef[] // selectMoves, feste Folgen ersetzen "auto"
buildDemoChoreo(manifest, pack) → Choreography    // realizeFrames, ohne Moves im Intro
```

- **Phrasen:** Jeder Abschnitt außer dem Outro wird ab seinem Anfang in Phrasen zu 8 Beats
  geteilt (die letzte darf 4 Beats haben). Schlüssel `<kind>-<A|B>` nach dem Muster A A B A
  (Index der Phrase im Abschnitt). Jedes Vorkommen eines Typs wiederholt also dieselben Phrasen,
  längere Refrains führen das Muster weiter. Moves sind bis zum Abschnittsende gleich, Posen bis
  zum Einstieg des folgenden Clips: Er beginnt `anchorBeat` (bei AIST++ 1–3 Beats) vor seinem
  Move, davor liegt die Überblendung von `BLEND_BEATS`. Die letzten bis zu 4 Beats eines
  Abschnitts hängen also davon ab, was danach kommt.
- **Dichte:** `stepBeats` mit Schwierigkeit und fester Energie je Typ (`MANIFEST_ENERGY`): Intro
  0,2, Strophe 0,3, Pre-Chorus 0,5, Refrain 0,6, Bridge 0,4. Der Refrain bleibt unter ⅔, wird
  bei Schwierigkeit 2 also nicht verdichtet (alle 2 Beats). Bei Schwierigkeit 3 haben Pre-Chorus,
  Refrain und Bridge einen Move pro Beat, solange er mindestens 400 ms dauert.
- **Intro:** Nur die letzten `INTRO_MOTION_BEATS` (8) Beats tanzen, davor steht die Ruhepose.
  Die Moves dieser Clips werden entfernt (keine Wertung im Intro).
- **Gold:** genau die Positionen aus dem Manifest. Liegt eine nicht auf einem Move-Beat, bricht
  der Build ab. Die Schlusspose ist kein Gold Move.
- **Schlusspose:** am Anfang des Outros (das Schema erlaubt das Outro nur als letzten Abschnitt), gehalten bis zum Songende (`selectMoves`: symmetrischer
  Clip). Ohne Outro ersetzt sie den letzten Slot.
- **Feste Clip-Folgen:** ersetzen die Auswahl. Pro Abschnittsvorkommen bekommen die Slots die IDs
  der Reihe nach, zyklisch, jedes Vorkommen beginnt mit der ersten ID. Ein festes Outro schließt
  mit der ersten ID. Abbruch bei unbekannter ID, Ruhepose (Energie unter `MIN_MOVE_ENERGY`),
  Clip schwerer als der Song, Clip länger als ein Slot (außer Schlusspose) oder mehr als ±12 %
  Tempounterschied (`sourceBpm`). `"auto"`-Phrasen wählt `selectMoves` mit denselben Regeln wie in der
  App. Die Ausschlüsse an Phrasengrenzen kennen die festen Folgen nicht: An der Grenze
  zwischen fester Folge und `"auto"` kann ein Clip direkt auf sich selbst folgen.
- **Choreo-Felder:** `id` ist eine aus der Song-ID abgeleitete UUID (v4-Form), die Farben kommen
  aus `SONG_PALETTES[palette]`, `offsetMs` ist 0 und `createdAt`/`updatedAt` sind 0 (setzt erst
  der Seed).
- **Seed (14a-2):** `seedDemos` (`src/data/demo.ts`) lädt die Choreografie per `import()`, prüft
  sie mit `ChoreographySchema` und setzt `createdAt` = `updatedAt` = jetzt. Titel, Interpret, BPM,
  Schwierigkeit und Audiodatei kommen aus dem Manifest; die Song-ID ist `demoSongId(<id>)`, eine
  feste UUID, weil `demo-<slug>` keine ist.

**Stand 14b** (Paket nur mit `demo:*`-Clips, alle Phrasen `"auto"`):

| Song                   | Schwierigkeit | Moves | Gold | Größe   |
| ---------------------- | ------------- | ----- | ---- | ------- |
| Gold in My Pocket      | 2             | 140   | 2    | 1,40 MB |
| Gold on the Glass      | 2             | 111   | 2    | 1,21 MB |
| Lemonade Skies         | 1             | 102   | 2    | 1,09 MB |
| Rise Until The Morning | 3             | 319   | 2    | 1,60 MB |

Stand 14e (mit AIST++-Clips). Vorher, nur mit Demo-Clips, waren es 0,64–0,87 MB und 1,65 MB für
Rise Until The Morning. AIST++-Clips haben mehr Keyframes und wiederholen sich kaum, deshalb
wächst gzip stärker als die Rohgröße: 171–281 kB je JSON statt 24–119 kB (im Build 136–228 kB
gzip je Chunk). Stand 13j: 1,16–1,59 MB, gzip 191–252 kB je JSON. Das Skript
warnt über 2 MB, der Test hält jede Datei unter 2 MB. Die Schwierigkeit ist seit 14c-2 festgelegt
(siehe unten).

**Spielbarkeit (14c-2):** `bun run eval-demos` (`scripts/eval-demos.ts`, Logik
`scripts/evalDemos.ts`) baut jedes Manifest mit Schwierigkeit 1, 2 und 3 (Überschreibung, das
Manifest bleibt unverändert) und wertet jeden Build mit dem simulierten Spieler je Seed aus.
Ausgabe: Tabelle mit den Spalten des Messplatzes, `*` markiert die Stufe des Manifests; nicht
baubare Stufen (feste Clips schwerer als die Stufe) stehen mit Grund unter der Tabelle. Alle
Läufe als JSON in `eval-results/eval-demos.json`. Optionen: `--seeds` (Standard 20), `--noise`,
`--miss`, `--out`, `--pack`.

Ergebnis (20 Seeds; Moves/min und p95 sind je Stufe fest):

| Song                   | Stufe | Moves/min (1 / 2 / 3) | p95 °/s (1 / 2 / 3) | Sterne bei 10° / 30° / 60° |
| ---------------------- | ----- | --------------------- | ------------------- | -------------------------- |
| Lemonade Skies         | 1     | 45 / 45 / 90          | 273 / 288 / 350     | 5 / 5 / 3                  |
| Gold on the Glass      | 2     | 50 / 50 / 100         | 372 / 348 / 348     | 5 / 5 / 3                  |
| Gold in My Pocket      | 2     | 54 / 54 / 109         | 382 / 301 / 382     | 5 / 5 / 3                  |
| Rise Until The Morning | 3     | 61 / 61 / 121         | 417 / 288 / 438     | 5 / 5 / 3                  |

- **Sterne trennen die Songs nicht:** In 14c-2 gab es überall 5 Sterne, auch bei 60° Rauschen,
  weil die Sternquote die Combo mitzählte (Befund N2). Seit N2 messen die Sterne nur die
  Genauigkeit ([scoring.md](scoring.md#sterne-und-rang)); die Sterne-Spalte ist danach neu
  gemessen (10 Seeds, 10 % Ausfall, Sterne der Manifest-Stufe). Sie trennen jetzt das Können des
  simulierten Spielers, aber nicht die Songs: Sein Rauschen hängt nicht von der Bewegung ab, jeder
  Song und jede Stufe ergibt bei gleichem Rauschen dieselben Sterne.
- **Regel stattdessen:** Messbar trennt nur Stufe 3 (doppelte Dichte). Stufe 1 und 2 sind bei
  gleicher Energie gleich dicht (`BASE_STEP_BEATS`, die höchste `MANIFEST_ENERGY` 0,6 liegt unter
  `HIGH_ENERGY`); sie unterscheiden sich nur in der Clip-Auswahl. Die Zuordnung 1 oder 2 folgt
  deshalb dem Song selbst: Lemonade Skies ist am langsamsten (111 BPM, 45 Moves/min) und bleibt
  1, die beiden Gold-Songs (120–122 BPM, 50–54 Moves/min) bleiben 2, Rise Until The Morning
  (128 BPM, 121 Moves/min auf Stufe 3) bleibt 3. Die Manifeste bleiben unverändert.
- Bei 10° Rauschen ergeben alle Seeds denselben Score (alles PERFECT); die Seeds wirken erst ab
  etwa 30° Rauschen.
  Das Paket hat keine Clips der Stufe 3, Stufe 3 heißt also nur doppelte Dichte. Die
  Clip-Schwierigkeit hängt nicht am Tempo: Rise Until The Morning ist auf Stufe 1 schneller (p95 417) als auf Stufe 2 (288).
- Nicht headless prüfbar: wie gut die Kamera die Clips erkennt und ob sich die Stufen am Gerät
  richtig anfühlen.

## Video-Import

`choreoFromPoseTrack` (`src/lib/videoChoreo.ts`) baut aus einer Pose-Spur eines Videos eine
Choreografie im Format v2:

1. Zeitbereich zuschneiden; der Anfang des Bereichs wird 0.
   1b. **Kurze Lücken füllen** (`fillShortGaps`, Etappe 8i-4): Liegen zwei Proben, die die
   Person sehen, höchstens `SHORT_GAP_MS` = 150 ms auseinander, bekommen die Proben dazwischen
   die lineare Mischung beider Posen (Weltpunkte ebenso). Danach gilt dasselbe je Gelenk: Ein
   Punkt mit `visibility < 0.5` zwischen zwei sichtbaren, höchstens 150 ms entfernten Proben
   wird linear ergänzt und bekommt die niedrigere Sichtbarkeit der beiden. Längere Lücken
   bleiben. 150 ms = bis zu zwei verpasste Proben im 50-ms-Raster; Messung siehe
   [Lücken](#lücken-etappe-8i-4).
2. Glätten (One-Euro, vorwärts und rückwärts; Standard `minCutoff` 2 Hz, `beta` 40, `dCutoff`
   1 Hz). Punkte mit `visibility < 0.5` laufen nie durch den Filter und bleiben unsichtbar; nach
   einer Lücke über `SHORT_GAP_MS` beginnt der Filter des Punkts neu (vorher 250 ms). Begründung
   der Werte: siehe [Standardwerte](#standardwerte-aus-der-messung-etappe-8g-5).
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
   5b. **Lange Lücken** ohne Person (über 150 ms, Etappe 8i-4): Der Coach gleitet nicht mehr
   über die Lücke. Standard „Halten“ (`longGap: "hold"`): eine Kopie des letzten Frames vor der
   Lücke, ein Frame-Abstand (100 ms) vor der ersten Pose danach, mit `lowVisibility`. Der Coach
   steht still und geht in diesen 100 ms in die neue Pose. Alternative `"hide"`: ein Frame in
   der Mitte der Lücke mit Sichtbarkeit 0 an allen Punkten, der Coach verschwindet. Kein
   Formatwechsel, nur zusätzliche Frames.
6. Moves nach `movePlacement` (Etappe 8g-4c). Ein Kandidat entfällt, wenn der Frame dort
   fehlt, `lowVisibility` hat oder weniger als 4 Arm- und Beinwinkel trägt, und (seit 8i-4)
   wenn die Pose, die der Scorer dort per `frameAt` liest, nicht verlässlich ist
   (`poseUsableAt`: ein Nachbar-Frame mit `lowVisibility` oder zu wenige Winkel). So landet kein
   Move in oder am Rand einer langen Lücke.
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
- `maxGapMs` hatte keine Wirkung (keine längeren Lücken in den Videos) und blieb 250. Seit
  Etappe 8i-4 ist es `SHORT_GAP_MS` = 150 ms und gilt auch für das Füllen kurzer Lücken.
- Haltepunkte (`"holds"`) sind jetzt Standard: gleicher Holdout-Fehler wie `"grid"`, aber
  ruhigere Zielposen an den Moves (`moveMotionDegPerS` 98 statt 107 °/s bei BTS, 116 statt
  155 °/s beim TikTok) und bei BTS mehr brauchbare Moves (33 statt 31 von 36).
- Kein Formatwechsel: Gespeicherte Choreografien bleiben unverändert, die Werte gelten für neue
  Importe. Dev-Rohdaten ohne `movePlacement` (vor 8g-4c) werden weiter mit `"grid"` gerechnet.
- Zwei Videos sind eine kleine Basis; mit weiteren Videos (Party-Klassiker, Zumba) erneut
  prüfen. Ob sich Haltepunkte im Spiel besser anfühlen, bleibt ein Gerätetest.

### Lücken (Etappe 8i-4)

Gemessen mit `bun run eval-video` (10 Seeds) an BTS und TikTok, frisch extrahiert im Browser
(Modell „full“), dazu je ein Zuschnitt auf die oberen 72 % des Bildes (Füße draußen; die
Referenz kommt aus dem Zuschnitt). Werte: Moves / Quote Selbsttest / Trennschärfe (Quote
„selbst“ − Quote „fremd“). Die Zeilen 100–300 ms sind mit „Ausblenden“ gemessen.

| Grenze für kurze Lücken         | BTS            | TikTok         | BTS-Zuschnitt  | TikTok-Zuschnitt |
| ------------------------------- | -------------- | -------------- | -------------- | ---------------- |
| ohne Füllen (vor 8i-4, gleiten) | 32/0,926/0,489 | 17/1,000/0,418 | 26/0,745/0,243 | 18/0,973/0,541   |
| 100 ms                          | 30/0,915/0,496 | 17/0,999/0,480 | 17/0,874/0,469 | 18/0,997/0,665   |
| **150 ms (Standard)**           | 30/0,915/0,491 | 17/0,999/0,484 | 18/0,857/0,451 | 18/0,995/0,673   |
| 200 ms                          | 34/0,885/0,420 | 18/0,994/0,619 | 24/0,872/0,440 | 18/0,997/0,752   |
| 300 ms                          | 36/0,889/0,390 | 18/0,999/0,577 | 28/0,834/0,393 | 18/0,997/0,749   |

- 100 und 150 ms sind nirgends schlechter als vorher. Ab 200 ms errät die Gerade bei BTS
  (schnelle Armbewegungen) zu viele Gelenke falsch: mehr Moves, aber niedrigere Trennschärfe.
  Die Wirkung kommt fast ganz vom Füllen einzelner Gelenke, das Füllen ganzer Posen ändert wenig.
- Beim BTS-Zuschnitt fallen 8 Moves an Lückenrändern weg; das waren die X-Urteile (9 % → 0 %).
- „Halten“ und „Ausblenden“ ergeben dieselben Werte (mit „Halten“ 18/0,857/0,451 bzw.
  18/0,995/0,685 in den Zuschnitten), Gleiten ist beim BTS-Zuschnitt schlechter (21 Moves,
  Trennschärfe 0,313). Gewählt nach dem Aussehen: Im Bildvergleich an einer echten 600-ms-Lücke
  bleibt der Coach beim Halten sichtbar; Ausblenden lässt ihn schon ab dem letzten Frame vor der
  Lücke verschwinden und würde bei jeder Lücke knapp über 150 ms blinken.

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
