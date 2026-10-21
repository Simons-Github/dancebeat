# Choreografie-Format

Aktuelle Version: **1**. Maßgeblich ist das zod-Schema in `src/lib/schema.ts`; dieses Dokument
beschreibt Bedeutung und Konventionen.

## Felder

### Choreografie

| Feld                     | Typ           | Bedeutung                                                            |
| ------------------------ | ------------- | -------------------------------------------------------------------- |
| `version`                | `1`           | Formatversion                                                        |
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

### Move

| Feld     | Typ        | Bedeutung                                     |
| -------- | ---------- | --------------------------------------------- |
| `timeMs` | ≥ 0        | Zielzeitpunkt; bewertet wird im Fenster darum |
| `label`  | Text, ≤ 60 | Anzeigename, z. B. „Arme hoch“                |
| `iconId` | Text, ≤ 60 | Piktogramm-Kennung                            |
| `gold`   | bool       | Gold Move (5-fache Punkte)                    |

Die Soll-Winkel eines Moves werden aus den Frames zum Zeitpunkt `timeMs` interpoliert
(`frameAt`, Winkel über den kürzesten Bogen).

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

Interne 3D-Darstellung einer Pose (`src/lib/skeleton/`, seit Etappe 13a). Noch **nicht Teil des
gespeicherten Formats**; Choreografien bleiben v1. 2D (`landmarks`, `angles`) wird daraus
abgeleitet und bleibt die Grundlage für Bewertung und Anzeige.

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
  Knochen auf einer Seite, fehlt er im Ergebnis.
- **Spiegeln** (`mirror3d`): links und rechts tauschen, x spiegeln, Gier umkehren. Die Winkel
  entsprechen `mirrorAngles` wie bei `mirrorChoreo`; anders als dort wird die Figur auch auf dem
  Bildschirm gespiegelt (x → 1 − x), damit die bewegte Seite im Spiegelraum richtig liegt.
  Zweimal angewendet ergibt sich das Original.

## Video-Import

`choreoFromPoseTrack` (`src/lib/videoChoreo.ts`) baut aus einer Pose-Spur eines Videos eine
Choreografie im Format v1:

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
  "version": 1,
  "exportedAt": 1760000000000,
  "song": {
    "title": "…",
    "artist": "…",
    "bpm": 120,
    "difficulty": 2,
    "syncOffsetMs": 0,
    "startOffsetMs": 0
  },
  "choreo": { "version": 1, "id": "…", "…": "…" }
}
```

Quelle, Highscore und Sterne werden nicht exportiert. Beim Import wird die Datei geprüft (inkl.
Sortierung), ältere Choreografie-Versionen werden migriert, und Song und Choreografie bekommen
neue UUIDs. Ein Import überschreibt also nie einen vorhandenen Eintrag.

## Versionen und Migration

| Version | Änderung                                                                    |
| ------- | --------------------------------------------------------------------------- |
| 0       | ohne `version`-Feld; Winkel ohne Vorzeichen (Innenwinkel 0–180°), freie IDs |
| 1       | `version`, UUIDs, `createdAt`/`updatedAt`, vorzeichenbehaftete Winkel       |

Migration 0 → 1 (`src/lib/library/migrations.ts`): Winkel werden aus den Landmarks neu
berechnet; Frames ohne Landmarks verlieren ihre Winkel (nicht verfügbar statt falsch). Nicht-UUID-IDs
werden ersetzt. Die IndexedDB-Version 2 führt diese Migration beim Öffnen aus.

Bei einer Formatänderung: Version erhöhen, Migrationsschritt ergänzen, IndexedDB-Version erhöhen,
Tests und diese Tabelle aktualisieren.
