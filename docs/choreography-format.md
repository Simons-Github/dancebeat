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
| `bpm`                    | 30–300        | Tempo                                                                |
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

## Video-Import

`choreoFromPoseTrack` (`src/lib/videoChoreo.ts`) baut aus einer Pose-Spur eines Videos eine
Choreografie im Format v1:

1. Zeitbereich zuschneiden; der Anfang des Bereichs wird 0.
2. Glätten (One-Euro, vorwärts und rückwärts). Punkte mit `visibility < 0.5` laufen nie durch den
   Filter und bleiben unsichtbar; nach einer Lücke beginnt der Filter des Punkts neu.
3. Winkel über `computeAngles(…, { aspect })` aus den Rohkoordinaten. Gespeichert werden die
   Landmarks im quadratischen Raum: mit `s = max(aspect, 1)` gilt
   `x' = 0.5 + (x − 0.5) · aspect / s` und `y' = 0.5 + (y − 0.5) / s`. Die längere Bildseite
   füllt also 0..1, die kürzere liegt mittig.
4. Spiegeln (`mirrorChoreo`) ist Standard, weil ein Video den Tänzer ungespiegelt zeigt (siehe
   [Spiegeln](#spiegeln)). Bereits gespiegelte Aufnahmen (Selfie) mit `mirror: false`.
5. Frames etwa alle 100 ms. Koordinaten auf 4 Stellen gerundet, Winkel auf 1 Stelle. Die
   Visibility wird auf 2 Stellen **abgerundet**, damit kein unsicherer Punkt über die Schwelle
   rutscht. Ab 0.99 entfällt sie (`[x, y]` = voll sichtbar). `lowVisibility` steht, wenn nicht
   beide Schultern und beide Hüften sichtbar sind. Drei Minuten ergeben etwa 1,3 MB JSON.
6. Moves alle `beatsPerMove` Beats (Standard 2) ab `beatOffsetMs`. Ein Rasterpunkt entfällt,
   wenn der Frame dort fehlt, `lowVisibility` hat oder weniger als 4 Arm- und Beinwinkel trägt.
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
- BPM kommt aus dem Formular. Kein Formatwechsel, keine neue Version.
- Mehrere Personen im Video (Etappe 8f): Die Analyse kennt bis zu 3 Personen je Probe;
  `choreoFromPoseTrack` bekommt nur die gewählte Zielperson (`trackTarget`, siehe
  [architecture.md](architecture.md#zielperson-etappe-8f)). Am Format ändert sich nichts.
- `P` kann „Takt erkennen“ setzen (Etappe 8e): erster Beat ab `start`, geschätzt aus der
  Onset-Hüllkurve der Musikdatei oder der Tonspur des Videos (`estimateBeatPhaseMs`, siehe
  [architecture.md](architecture.md#bpm-schätzung-und-beat-phase)). Jeder Beat ist als `P`
  gleichwertig, der Wert ab `start` ist nur leichter zu lesen.

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
