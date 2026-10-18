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

1. `usePoseTracking` öffnet die Frontkamera (`getUserMedia`, nur Wunschgröße ideal 1280×720; scheitert eine Größe, ein zweiter Versuch
   mit `{ facingMode: "user" }` ohne Größe) und
   erzeugt über die Schnittstelle `PoseEstimator` (Standard: MediaPipe Pose Landmarker „lite“,
   VIDEO-Modus, GPU mit CPU-Fallback).
2. Eine Schleife auf `requestVideoFrameCallback` (Fallback rAF mit Überspringen gleicher Bilder)
   ruft `detect` auf und legt das Ergebnis als `PoseFrame` (Landmarks normiert auf 0..1 je Achse,
   plus Seitenverhältnis `aspect` des Videos) in einer Ref ab. Zusätzlich wird der Callback
   `onFrame` aufgerufen; Overlays zeichnen darin direkt auf ein Canvas. Kein `setState` pro Frame.
3. `computeAngles(landmarks, { aspect })` berechnet die Gelenkwinkel. Das Seitenverhältnis
   gleicht aus, dass x auf die Bildbreite und y auf die Bildhöhe normiert ist.
4. Im Spiel reicht der `onFrame`-Callback die Winkel samt Bildalter (`frameAgeMs`) an den
   `GameController`; dessen `tick()` (einmal pro Animationsframe) ruft höchstens alle 100 ms
   Spielzeit `useScoring.sample(t, angles)` mit der Spielzeit **des Bildes** auf und vergleicht mit
   den Soll-Winkeln der Choreografie. Details: [scoring.md](scoring.md).
5. Die UI liest Score, Combo, Sterne und das letzte Urteil (React-State ändert sich nur pro
   bewertetem Move).

Läuft die Erkennung nicht mehr (Hintergrund, Sperre, Anruf), reagiert der Hook so: bei
`visibilitychange` (sichtbar) wird `video.play()` erneut aufgerufen; endet die Kamera-Spur
(`track.onended` oder `readyState "ended"`), startet er intern neu (höchstens 3 Versuche, nach
10 s ungestörtem Lauf wieder frei, danach Fehler „Die Kamera wurde unterbrochen“ mit „Erneut starten“, Typ `interrupted`). Wirft `detect` 10-mal in Folge,
wird der Estimator geschlossen und mit CPU neu gestartet (Parameter `delegate`); scheitert auch
das, kommt der Modellfehler. `lastFrameAtRef` hält den Zeitpunkt des letzten Frames fest.

Der Hook räumt bei Unmount, Kamerawechsel oder Deaktivieren auf: Kamera-Tracks werden gestoppt,
der Landmarker geschlossen, auch wenn ein asynchroner Schritt erst nach dem Aufräumen fertig wird.

### AudioSource → Spielzeit

`createSource(song, { element })` liefert einen Adapter mit gemeinsamer Schnittstelle
`AudioSource` (`type` als Union der Quellarten, `load`, `play`, `pause`, `seek`, `getTimeMs`,
`setVolume`, `onEnded`, `destroy`):

| Quelle    | Umsetzung                              | Zeitbasis                                    |
| --------- | -------------------------------------- | -------------------------------------------- |
| `local`   | `HTMLAudioElement` mit Blob aus der DB | `currentTime`, interpoliert                  |
| `url`     | `HTMLAudioElement` mit Nutzer-URL      | `currentTime`, interpoliert                  |
| `youtube` | YouTube-IFrame-Player                  | `getCurrentTime()` alle 500 ms, interpoliert |
| `spotify` | Spotify Web Playback SDK (PKCE)        | Player-State `position`, interpoliert        |

Jeder Adapter nutzt eine `SmoothClock`: zwischen den Abfragen wird per `performance.now()`
fortgeschrieben, Abweichungen werden weich angeglichen (große Sprünge hart übernommen).

`useAudioClock` ist die einzige Spielzeit:
`timeMs = getTimeMs() − globale Latenz − song.syncOffsetMs − choreo.offsetMs` (reine Funktion
`gameTimeMs` in `src/lib/audio/clock.ts`). Positive Offsets verschieben die Choreografie also nach
hinten (sie kommt später). `timeMs` behält seine Identität (Offsets über Refs), damit Schleifen
nicht neu starten. Der Hook verwirft späte Ladeergebnisse eines vorherigen Songs, setzt `ended`
und `error` beim Songwechsel zurück und zerstört die Quelle beim Verlassen.

**Datei- und URL-Quelle:** Laden gilt bei `loadedmetadata` oder `canplay` als fertig, spätestens
nach 5 s (`LOAD_TIMEOUT_MS`), weil iOS ohne Geste oft gar nicht vorlädt; dann lädt `play()`. Ein
echter Fehler bricht ab.

### Audio-Entsperrung (iOS)

Der Spielstart nach dem Countdown ist keine Nutzergeste. Deshalb ruft die Aufstellhilfe im Tipp
auf „Kamera starten“ (und „Los geht's“) synchron `unlockAudio()` auf
(`src/lib/audio/unlock.ts`): Ein gemeinsames `HTMLAudioElement` spielt eine 50-ms-Stille-WAV
(Data-URI) an und pausiert, der gemeinsame `AudioContext` bekommt `resume()` und einen leeren
Puffer. WebKit hebt die Sperre pro Element auf; das Spiel übergibt genau dieses Element an
`createSource` (`claimSharedElement`), und `destroy()` leert es nur (`src` entfernen), statt es
wegzuwerfen. Die Soundeffekte (`src/lib/sfx.ts`) nutzen denselben `AudioContext`. Lehnt der
Browser `play()` trotzdem ab (z. B. nach Neuladen auf `/play`), zeigt das Spiel „Zum Starten
tippen“ und ruft `play()` in diesem Tipp auf. Ob das auf iOS reicht, zeigt nur der Gerätetest.

### Spielablauf

```
preparing ──(Audio geladen, Kamera bereit, Seite sichtbar)──▶ countdown (Vorlauf 2 s, 3-2-1)
countdown ──▶ playing ──(Audio-Ende oder letzter Move + 2,25 s)──▶ ended → /result/$songId
countdown/playing ──(Pause-Knopf, Escape, visibilitychange, Kamera weg)──▶ paused
paused ──Weiter──▶ countdown (3-2-1, ohne Vorlauf) · Neustart ──▶ countdown mit Vorlauf
play() abgelehnt ──▶ blocked ──Tipp──▶ playing · Abbrechen im Countdown ──▶ /setup/$songId
```

- `GameController` (`src/lib/game/controller.ts`) hält diesen Ablauf ohne React; er bekommt
  Audio (`play`/`pause`/`seek`), die Uhr (`timeMs`) und die Wertung über Schnittstellen und ist
  mit Fake-Uhr testbar.
- `GameScreen` (`src/components/play/GameScreen.tsx`) verbindet `useAudioClock`,
  `usePoseTracking`, `useScoring` und den Controller. Eine einzige rAF-Schleife ruft `tick()` und
  zeichnet Piktoleiste, Coach und Beat-Puls auf Canvas bzw. per Style; das Skelett zeichnet der
  Erkennungs-Callback. Kein `setState` pro Frame.
- Die Kamera startet in der Spielroute neu (Erlaubnis liegt vor, Modell kommt aus dem
  HTTP-Cache); der Vorlauf von 2 s deckt das ab. Die Aufstellhilfe wechselt nach dem Einrasten von
  selbst ins Spiel. Nach „Abbrechen“ ist der Auto-Start für diesen Song aus, bis „Los geht's“
  getippt wird (`src/lib/game/session.ts`).
- Endstand für `/result/$songId` liegt im Speicher (`setLastResult`/`getLastResult`), nicht
  persistent; Highscores folgen in Etappe 4.
- Auf `/play/…` blendet `AppShell` Kopfzeile und Dekor-Hintergrund aus.
- Piktogramme (`src/lib/game/pikto.ts`): reine Funktionen für Positionen (`piktoLayout`),
  Blitzplan (höchstens 3 pro Sekunde), Strichfiguren aus Landmarks (`stickFigure`) und die feste
  Coach-Ansicht (`coachView`). Gezeichnet wird in `src/lib/game/draw.ts`.
- **Simulationsmodus** (nur Dev-Server): `/play/<id>?sim=1&noise=<Grad>&miss=<0..1>` ersetzt die
  Kamera durch `simulatedAngles` (Winkel der Choreografie plus Rauschen). Alle Stellen stehen
  hinter `import.meta.env.DEV`; im Produktions-Build ist der Code nicht enthalten (geprüft per
  Suche im Build, Positiv-Kontrolle mit `NODE_ENV=development`).

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

| Was                            | Von                                   | Wann                                     |
| ------------------------------ | ------------------------------------- | ---------------------------------------- |
| MediaPipe-WASM-Laufzeit        | cdn.jsdelivr.net                      | Aufstellhilfe (Start der Pose-Erkennung) |
| Pose-Modell (`.task`)          | storage.googleapis.com                | Aufstellhilfe (Start der Pose-Erkennung) |
| YouTube-IFrame-API, Video      | youtube.com                           | YouTube-Song laden                       |
| Spotify-SDK, Login, Wiedergabe | sdk.scdn.co, accounts/api.spotify.com | Spotify-Song laden                       |
| Audio-URL                      | vom Nutzer eingegebene Adresse        | URL-Song laden                           |

Die ersten beiden Abrufe gehen bei jedem Start der Kamera raus (kein Service Worker, mindestens
zur Cache-Prüfung), nicht nur beim ersten Mal. Die WASM-URL entsteht aus der Konstante
`TASKS_VISION_VERSION` (`src/lib/mediapipe.ts`); `@mediapipe/tasks-vision` ist in `package.json`
exakt auf `1.1.1` festgelegt und ein Test prüft, dass beides übereinstimmt.

Die ersten beiden Abrufe sind im Aufstellhilfe-Screen als Datenschutzhinweis benannt
(`src/components/setup/PrivacyNote.tsx`; W12). Ziel (Etappe 7): WASM und Modell nach `public/`
verlegen, dann entfallen sie und der Hinweis wird angepasst.

**Schrift:** Fredoka (OFL-Lizenz) kommt aus dem Paket `@fontsource/fredoka` und wird mit dem Build
selbst ausgeliefert (`latin`-Schnitte 400, 500, 700 in `src/styles.css`). Es gibt keine Anfrage an
Google Fonts oder ein anderes CDN.

## Pose-Erkennung

- `src/lib/poseEstimator.ts`: Schnittstelle `PoseEstimator` (`init`, `detect`, `close`). `init`
  liefert das tatsächlich genutzte Delegate (GPU/CPU); `close` ist jederzeit erlaubt, auch während
  `init` noch lädt. Landmarks folgen der 33-Punkte-Topologie von MediaPipe.
- `src/lib/mediapipePoseEstimator.ts`: Standardimplementierung (Modell `lite` für Live).
  `src/lib/mediapipe.ts` erzeugt den Landmarker (`lite`, `full` oder `heavy`) und meldet das Delegate.
- Eine zweite Implementierung (MoveNet) entfällt: MediaPipe läuft auf dem Handy flüssig. Die
  Schnittstelle bleibt bestehen.
- Winkel hängen nicht von Körpergröße oder Abstand zur Kamera ab.
- Licht-Check (`src/lib/brightness.ts`): alle 2 s wird das Video auf 16×12 Pixel verkleinert und
  die Helligkeit gemessen (Warnung unter 45 von 255, Freigabe über 55), nur lokal.
- Körper-Check (`src/lib/bodyTracker.ts`): Schultern, Hüften, Knie und Knöchel müssen mit
  visibility ≥ 0.5 eine Sekunde lang gesehen werden. Ausfälle bis 200 ms unterbrechen nicht
  (schwache Landmarks zählen weiter als fehlend), längere Ausfälle oder eine Bildpause über 600 ms
  setzen zurück. Die Anzeige (Statuszeilen, Hinweis) wechselt erst nach 300 ms stabilem Zustand
  (`createStatusSmoother`). `ready` gilt nur bei Abstand „passt“ und Mitte; Hinweis und Freigabe widersprechen sich nie. „Los geht's“ rastet ein: einmal erreicht, bleibt es gültig, bis sich
  Status oder Kamera ändern. Ein Heartbeat (250 ms) setzt die Anzeige zurück, wenn länger als
  500 ms kein Frame kam; die Freigabe bleibt. Liefert außerdem Abstand (Schulter-Knöchel-Höhe
  0.4 bis 0.85 der Bildhöhe) und Hinweistexte.
- Fehler der Kamera: `src/lib/cameraErrors.ts` ordnet `getUserMedia`-Fehler deutschen Meldungen zu.
  Eine veraltete gespeicherte Kamera-ID (`OverconstrainedError` mit `constraint === "deviceId"`) fällt auf die Standardkamera
  zurück und löscht die gespeicherte ID.
- Diagnose (`src/lib/frameStats.ts`): Bildrate der Erkennung (letzte Sekunde), geglättete
  Inferenzzeit und Delegate; das Diagnosefeld liest sie zweimal pro Sekunde aus einer Ref.
- Aufstellhilfe: Das Bild wird nur per CSS gespiegelt, die Erkennung bekommt das Rohbild. Das
  Overlay-Canvas liegt im selben gespiegelten Container und hat die Pixelgröße des Videos; der
  Container übernimmt dessen Seitenverhältnis (gesetzt über `loadedmetadata` und `resize`, auch beim
  Drehen), damit nichts zugeschnitten oder verzerrt wird. Der Zielrahmen wird in einer Box mit
  festem Seitenverhältnis 1:2 (Höhe 85 % des Bildes, zentriert) gezeichnet; bei Kamerawechsel und
  Fehler wird das Canvas geleert. `FrameInfo` trägt `videoWidth` und `videoHeight` sowie `frameAgeMs` (Alter des Bildes
  beim Callback, aus `captureTime` der Video-Frame-Metadaten oder ab Beginn der Erkennung; siehe
  [scoring.md](scoring.md#zeitbasis)).

## Messwerte

Aus dem Diagnosefeld der Aufstellhilfe (Zahnrad-Symbol), Erkennung mit Modell „lite“. Ziel:
mehr als 25 FPS. Werte trägt der Nutzer nach.

| Gerät | Browser | FPS   | Inferenzzeit (ms) | Delegate |
| ----- | ------- | ----- | ----------------- | -------- |
| _TBD_ | _TBD_   | _TBD_ | _TBD_             | _TBD_    |

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

Routen der App: `/` (Bibliothek), `/setup/$songId` (Aufstellhilfe), `/play/$songId` (Spiel,
Vollbild), `/result/$songId` (Ergebnis, Platzhalter bis Etappe 4), `/settings`.

## Build und Werkzeuge

- Pfad-Alias `@` → `src/` (tsconfig `paths`, in Vite über `resolve.tsconfigPaths`).
- `tsconfig.json` beschränkt globale Typen über `types`; neue `@types`-Pakete dort eintragen.
- `bunfig.toml` setzt eine 24-Stunden-Schutzfrist für neue Paketversionen.
- Statisches Hosting braucht einen SPA-Fallback auf `index.html` für Deep Links
  (`vite preview` macht das bereits).
