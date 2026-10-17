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
optional `playbackRate` (0.5–2), `choreo`, `highscore`, `stars` (0–5), `createdAt`, `updatedAt`.

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
