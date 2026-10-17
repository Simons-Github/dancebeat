# Architektur

## Überblick

DanceBeat ist eine reine Client-SPA: `index.html` lädt `src/main.tsx`, das den TanStack Router
startet. Es gibt keinen Server und kein Prerendering; der Build in `dist/` ist statisch.

Die Fachlogik liegt als reines TypeScript in `src/lib/` und ist ohne React testbar. Hooks in
`src/hooks/` verbinden sie mit Kamera, Audio und Speicher. Routen in `src/routes/` bauen daraus
die Screens.

```
Screens (src/routes, src/components)
   │
Hooks (usePoseTracking, useAudioClock, useScoring, useSongLibrary)
   │
Logik (lib/pose, lib/scoring, lib/choreo, lib/beat, lib/audio, lib/library, lib/schema)
   │
Browser-APIs (getUserMedia, MediaPipe/WASM, HTMLAudioElement, IndexedDB, localStorage)
```

## Datenfluss

### Kamera → Pose → Winkel → Scoring → UI

1. `usePoseTracking` öffnet die Frontkamera (`getUserMedia`) und erzeugt einen MediaPipe Pose
   Landmarker (VIDEO-Modus, GPU mit CPU-Fallback).
2. Eine rAF-Schleife ruft `detectForVideo` auf und legt das Ergebnis als `PoseFrame`
   (Landmarks normiert auf 0..1 je Achse, plus Seitenverhältnis `aspect` des Videos) in einer Ref
   ab.
3. `computeAngles(landmarks, { aspect })` berechnet die Gelenkwinkel. Das Seitenverhältnis
   gleicht aus, dass x auf die Bildbreite und y auf die Bildhöhe normiert ist.
4. `useScoring.sample(t, angles)` wird regelmäßig (ca. alle 100 ms) mit der Spielzeit aufgerufen
   und vergleicht mit den Soll-Winkeln der Choreografie. Details: [scoring.md](scoring.md).
5. Die UI liest Score, Combo, Sterne und das letzte Urteil.

Der Hook räumt bei Unmount, Kamerawechsel oder Deaktivieren auf: Kamera-Tracks werden gestoppt,
der Landmarker geschlossen, auch wenn ein asynchroner Schritt erst nach dem Aufräumen fertig wird.

### AudioSource → Spielzeit

`createSource(song)` liefert einen Adapter mit gemeinsamer Schnittstelle `AudioSource`
(`load`, `play`, `pause`, `seek`, `getTimeMs`, `setVolume`, `onEnded`, `destroy`):

| Quelle    | Umsetzung                              | Zeitbasis                                    |
| --------- | -------------------------------------- | -------------------------------------------- |
| `local`   | `HTMLAudioElement` mit Blob aus der DB | `currentTime`, interpoliert                  |
| `url`     | `HTMLAudioElement` mit Nutzer-URL      | `currentTime`, interpoliert                  |
| `youtube` | YouTube-IFrame-Player                  | `getCurrentTime()` alle 500 ms, interpoliert |
| `spotify` | Spotify Web Playback SDK (PKCE)        | Player-State `position`, interpoliert        |

Jeder Adapter nutzt eine `SmoothClock`: zwischen den Abfragen wird per `performance.now()`
fortgeschrieben, Abweichungen werden weich angeglichen (große Sprünge hart übernommen).

`useAudioClock` ist die einzige Spielzeit:
`timeMs = getTimeMs() − globale Latenz − song.syncOffsetMs − choreo.offsetMs`.
Positive Offsets verschieben die Choreografie also nach hinten (sie kommt später).

## Speicher

| Was                             | Wo                                   | Zugriff                   |
| ------------------------------- | ------------------------------------ | ------------------------- |
| Songs inkl. Choreografie        | IndexedDB `dancebeat`, Store `songs` | `SongRepository`          |
| Audiodateien                    | IndexedDB, Store `blobs`             | `SongRepository.getAudio` |
| Einstellungen                   | `localStorage` `dancebeat.settings`  | `useSettings`             |
| Demo-Seeding-Marker             | `localStorage` `dancebeat.seeded`    | `seedDemos`               |
| Spotify-Token und PKCE-Verifier | `sessionStorage`                     | `lib/audio/sources.ts`    |

**SongRepository** (`src/lib/library/repository.ts`) ist die einzige Schnittstelle zur
Bibliothek: `list`, `get`, `save`, `delete`, `getAudio`, `export`, `import`. Vorerst gibt es nur
die IndexedDB-Implementierung; eine Server-Variante kann dieselbe Schnittstelle erfüllen.

- Gelesene Einträge werden mit zod geprüft; ungültige werden übersprungen (nicht gelöscht).
- `save` prüft vor dem Schreiben und setzt `updatedAt`. Song und Audio werden in einer
  Transaktion geschrieben, `delete` entfernt beides in einer Transaktion.
- Promises lösen erst nach `oncomplete` der Transaktion auf. `QuotaExceededError` wird zu
  `StorageFullError` mit deutscher Meldung.
- `src/lib/library/storage.ts`: `requestPersistentStorage()` (Safari löscht sonst Daten nicht
  installierter Seiten nach 7 Tagen ohne Nutzung) und `getStorageUsage()` für die Anzeige.

IndexedDB-Versionen:

| DB-Version | Änderung                                                                    |
| ---------- | --------------------------------------------------------------------------- |
| 1          | Stores `songs` (keyPath `id`) und `blobs`                                   |
| 2          | Migration der Songs auf Choreografie-Format v1 (UUIDs, Zeitstempel, Winkel) |

## Externe Abrufe

Kamerabilder verlassen das Gerät nie. Folgende Abrufe gehen trotzdem ins Netz und müssen in der
UI benannt werden (die Gegenstelle sieht dabei die IP-Adresse):

| Was                            | Von                                   | Wann                     |
| ------------------------------ | ------------------------------------- | ------------------------ |
| MediaPipe-WASM-Laufzeit        | cdn.jsdelivr.net                      | Start der Pose-Erkennung |
| Pose-Modell (`.task`)          | storage.googleapis.com                | Start der Pose-Erkennung |
| YouTube-IFrame-API, Video      | youtube.com                           | YouTube-Song laden       |
| Spotify-SDK, Login, Wiedergabe | sdk.scdn.co, accounts/api.spotify.com | Spotify-Song laden       |
| Audio-URL                      | vom Nutzer eingegebene Adresse        | URL-Song laden           |

Ziel (Etappe 7): WASM und Modell nach `public/` verlegen, dann entfallen die ersten beiden.
Die Schrift soll selbst gehostet werden, nicht über Google Fonts.

## Pose-Erkennung

- `src/lib/mediapipe.ts` erzeugt den Landmarker (Modell `lite`, `full` oder `heavy`).
- Geplant (Etappe 2): Kapselung hinter einer Schnittstelle, damit MediaPipe und MoveNet (TF.js)
  austauschbar sind, plus FPS-Anzeige zum Vergleich auf dem Gerät.
- Winkel hängen nicht von Körpergröße oder Abstand zur Kamera ab.
- Licht-Check: alle 2 s wird das Video auf 16×12 Pixel verkleinert und die Helligkeit gemessen,
  nur lokal.

## BPM-Schätzung

`src/lib/beat.ts`: Onset-Hüllkurve (10-ms-Schritte, max. 90 s) plus Autokorrelation über 70–180
BPM. Die Schleife summiert nur Terme, deren gerundete Indizes existieren;
`src/test/beat.test.ts` vergleicht das mit der früheren Implementierung auf synthetischen
Klick-Tracks. `quantize` rastet Zeiten auf Beats ein (für den Video-Import).

## Routing-Konventionen

Dateibasiert in `src/routes/`. Einzige Root-Hülle ist `__root.tsx` (`<Outlet />` darin
erhalten). Keine `src/pages/` und kein `app/layout.tsx` anlegen.

| Datei                    | URL                                            |
| ------------------------ | ---------------------------------------------- |
| `index.tsx`              | `/`                                            |
| `about.tsx`              | `/about`                                       |
| `users/index.tsx`        | `/users`                                       |
| `users/$id.tsx`          | `/users/:id` (dynamisch, bares `$`)            |
| `posts/{-$category}.tsx` | `/posts/:category?` (optionales Segment)       |
| `files/$.tsx`            | `/files/*` (Splat, Parameter `_splat`)         |
| `_layout.tsx`            | Layout-Route (rendert Kinder per `<Outlet />`) |

`src/routeTree.gen.ts` erzeugt das Vite-Plugin; nicht von Hand bearbeiten.

## Build und Werkzeuge

- Pfad-Alias `@` → `src/` (tsconfig `paths`, in Vite über `resolve.tsconfigPaths`).
- `tsconfig.json` beschränkt globale Typen über `types`; neue `@types`-Pakete dort eintragen.
- `bunfig.toml` setzt eine 24-Stunden-Schutzfrist für neue Paketversionen.
- Statisches Hosting braucht einen SPA-Fallback auf `index.html` für Deep Links
  (`vite preview` macht das bereits).
