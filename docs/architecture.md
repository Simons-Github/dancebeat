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

`createSource(song, { element, container })` liefert einen Adapter mit gemeinsamer Schnittstelle
`AudioSource` (`type` als Union der Quellarten, `load`, `play`, `pause`, `seek`, `getTimeMs`,
`setVolume`, `onEnded`, `onError`, `destroy`, optional `onExternalStart`). `onError` meldet
Fehler, die nach erfolgreichem `load()` auftreten (Verbindung weg, Dekodierfehler,
YouTube-Fehlercode). `onExternalStart` implementiert nur YouTube: Die Wiedergabe startete ohne
ausstehendes `play()` (direkter Tipp aufs Video). `SourceOptions.element`
ist das gemeinsame, per Geste entsperrte Audioelement (Datei/URL), `SourceOptions.container` das
Element, in dem der YouTube-Player angezeigt wird (ohne: unsichtbarer 2×2-px-Player außerhalb des
Bildschirms):

| Quelle    | Umsetzung                              | Zeitbasis                                  |
| --------- | -------------------------------------- | ------------------------------------------ |
| `local`   | `HTMLAudioElement` mit Blob aus der DB | `currentTime`, interpoliert                |
| `url`     | `HTMLAudioElement` mit Nutzer-URL      | `currentTime`, interpoliert                |
| `youtube` | YouTube-IFrame-Player                  | `getCurrentTime()`, nur bei PLAYING, s. u. |
| `spotify` | Spotify Web Playback SDK (PKCE)        | Player-State `position`, interpoliert      |

Jeder Adapter nutzt eine `SmoothClock`: zwischen den Abfragen wird per `performance.now()`
fortgeschrieben, Abweichungen werden weich angeglichen (große Sprünge hart übernommen).

**Datei und URL** (`ElementSource`): Beim Puffern (`waiting`) bleibt `paused` falsch, deshalb hält
die Uhr explizit an und läuft bei `playing` weiter; der 250-ms-Abgleich berücksichtigt das ebenfalls.
`defaultPlaybackRate` und `playbackRate` werden gesetzt (die Rate der URL-Quelle war schon vor 3b
umgesetzt). Ein Fehler des Elements nach dem Laden hält die Uhr an und löst `onError` aus
(URL: „Die Verbindung zur Musik ist abgebrochen.“).

**YouTube** (`YouTubeSource`, Host `www.youtube-nocookie.com`):

- Die Uhr läuft nur im Zustand PLAYING. BUFFERING, PAUSED, CUED und ENDED halten sie an; jede
  Zustandsänderung gleicht hart ab, im Spiel zusätzlich alle 500 ms (Resync).
- `play()` löst erst bei PLAYING auf. Ist der Player nach 4 s noch UNSTARTED oder CUED
  (`YT_PLAY_TIMEOUT_MS`), gilt der Start als blockiert (kein Tipp erreichte das Iframe); bei
  BUFFERING wird bis 15 s (`YT_BUFFER_TIMEOUT_MS`) gewartet. In beiden Fällen wird `play()`
  abgelehnt, der `GameController` zeigt dann `blocked` („Zum Starten tippen“). Nach einer Ablehnung
  wartet der nächste `play()`-Aufruf ohne Timeouts, bis ein erfolgreicher Start die Timeouts
  wieder scharf schaltet.
- `seek` vor dem ersten Start (UNSTARTED, CUED, ENDED) wird in `pendingSeekMs` gemerkt und von
  `play()` angewandt, weil `seekTo` ein nie gestartetes Video starten würde (Annahme, am Gerät
  prüfen). Im Pausenzustand (PAUSED) wird direkt gesprungen, ohne zu starten.
- Der Player ist im Spiel sichtbar: Er füllt die Coach-Ecke (Box mindestens 200 × 200 px, Vorgabe
  der YouTube-API; siehe [design.md](design.md)). Sonst `pointer-events-none`; im Zustand
  `blocked` liegt die Box über der Ebene (`z-40`) und ist antippbar, das Overlay zeigt „Falls
  nichts passiert, tippe direkt auf das Video.“ Meldet YouTube danach PLAYING ohne ausstehendes
  `play()`, ruft die Quelle `onExternalStart`, setzt `refusedOnce` zurück und startet den Resync.
  Ob der Tipp aufs Video auf iOS startet, zeigt nur der Gerätetest.
- Laden: IFrame-API-Skript mit Timeout 15 s (nicht zwischengespeichert, nächster Versuch lädt neu),
  danach `onReady` mit Timeout 15 s. Fehlercodes vor `onReady` lehnen `load()` ab, danach lösen sie
  `onError` aus („Dieses Video darf nicht eingebettet werden.“ bzw. „YouTube-Video nicht
  verfügbar.“).

**Laufzeitfehler im Spiel:** `useAudioClock` setzt bei `onError` den Zustand `error`; der
Spielscreen zeigt dann, wenn das Spiel schon gestartet war, das Overlay „Die Musik ist
abgebrochen“ (sonst „Die Musik konnte nicht geladen werden“) mit Rückweg zur Bibliothek.

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
play() abgelehnt ──▶ blocked ──Tipp (Knopf) oder Tipp aufs Video (onExternalStart)──▶ playing
Abbrechen im Countdown ──▶ /setup/$songId
```

- `GameController` (`src/lib/game/controller.ts`) hält diesen Ablauf ohne React; er bekommt
  Audio (`play`/`pause`/`seek`), die Uhr (`timeMs`) und die Wertung über Schnittstellen und ist
  mit Fake-Uhr testbar. Ein zweiter Tipp in `blocked` tut nichts, solange das `play()` des ersten
  aussteht; `externalStart()` wirkt nur in `blocked`.
- `GameScreen` (`src/components/play/GameScreen.tsx`) verbindet `useAudioClock`,
  `usePoseTracking`, `useScoring` und den Controller. Eine einzige rAF-Schleife ruft `tick()` und
  zeichnet Piktoleiste, Coach und Beat-Puls auf Canvas bzw. per Style; das Skelett zeichnet der
  Erkennungs-Callback. Kein `setState` pro Frame.
- Die Kamera startet in der Spielroute neu (Erlaubnis liegt vor, Modell kommt aus dem
  HTTP-Cache); der Vorlauf von 2 s deckt das ab. Die Aufstellhilfe wechselt nach dem Einrasten von
  selbst ins Spiel. Nach „Abbrechen“ ist der Auto-Start für diesen Song aus, bis „Los geht's“
  getippt wird (`src/lib/game/session.ts`).
- Endstand für `/result/$songId` liegt im Speicher (`setLastResult`/`getLastResult`). Vorher
  speichert `recordResult` (`src/lib/game/results.ts`) Highscore und Sterne über
  `SongRepository` im Song-Eintrag; beide steigen nur. Schlägt das Speichern fehl, gibt es eine
  Warnung und der Ergebnis-Screen öffnet trotzdem (ohne „Neuer Highscore!“). Nach einem Neuladen
  ist der Endstand weg; der Ergebnis-Screen zeigt dann „Kein Ergebnis“.
- Auf `/play/…` blendet `AppShell` Kopfzeile und Dekor-Hintergrund aus.
- Piktogramme (`src/lib/game/pikto.ts`): reine Funktionen für Positionen (`piktoLayout`),
  Blitzplan (höchstens 3 pro Sekunde), Strichfiguren aus Landmarks (`stickFigure`) und die feste
  Coach-Ansicht (`coachView`). Gezeichnet wird in `src/lib/game/draw.ts`.
- **Bewegungsmodus** (alle Builds): `/play/<id>?mode=motion` (`parsePlayMode` in
  `src/lib/motion.ts`). Die Aufstellhilfe startet ihn über „Ohne Kamera spielen“ (in der
  Startkarte und neben dem Kamera-Fehler); der Tipp ruft `unlockAudio()` und
  `requestMotionPermission()` synchron auf. Nach „granted“ wartet `probeMotionSensor()` bis zu
  1 s (`MOTION.probeTimeoutMs`) auf ein `devicemotion`-Event mit Messwerten; erst dann geht es
  ins Spiel, sonst „Dieses Gerät hat keinen Bewegungssensor.“ (Desktop und Android ohne Sensor
  melden „granted“ ohne Dialog). Im Spiel ist `usePoseTracking` aus (kein `getUserMedia`, kein
  Video, kein Skelett, keine Kamera-Pause, kein Skelett-Schalter im Pausenmenü). Datenfluss:
  `useDeviceMotion` (Listener auf `devicemotion` im Effekt, Callback-Ref, kein `setState`) →
  `MotionMeter.push(timeMs(), …)` mit der Spielzeit aus `useAudioClock`, nur in `playing` → der
  Controller bekommt die Dep `motion` (`motionScoring(meter, () => difficulty)`), schließt die
  Fenster allein über die Uhr und meldet `bodyMissing` ohne Sensordaten („Keine Bewegung erkannt
  – Handy in der Hand halten.“). Der Messpuffer wird bei Start und Neustart geleert (Countdown
  mit Vorlauf, die Spielzeit springt zurück); „Weiter“ behält ihn. In `blocked` fragt „Zum
  Starten tippen“ die Sensor-Berechtigung erneut an (iOS nach Neuladen). Bewertung:
  [scoring.md](scoring.md#bewegungsmodus). `?mode=motion` hat Vorrang vor `?sim=1`; die Route
  keyt `GameScreen` auf Song und Modus.
- **Simulationsmodus** (nur Dev-Server): `/play/<id>?sim=1&noise=<Grad>&miss=<0..1>` ersetzt die
  Kamera durch `simulatedAngles` (Winkel der Choreografie plus Rauschen). Alle Stellen stehen
  hinter `import.meta.env.DEV`; im Produktions-Build ist der Code nicht enthalten (geprüft per
  Suche im Build, Positiv-Kontrolle mit `NODE_ENV=development`).
- **Dev-Testsongs** (nur Dev-Server): Auf der Bibliotheksseite legt `/?devsong=youtube:<ID|Link>`
  bzw. `/?devsong=url:<Adresse>` einen Testsong mit automatischer Choreografie an, damit URL- und
  YouTube-Quelle ohne „Song hinzufügen“ (Etappe 5) testbar sind. Optional `bpm` (30–300, Standard 120) und `len` (Sekunden, 10–600, Standard 180). Es gibt feste Slots (einer je Quelle), ein
  erneuter Aufruf überschreibt; `/?devsong=clear` entfernt beide. Ungültige Werte ergeben eine
  Konsolenwarnung. Code in `src/data/devSongs.ts` und `src/routes/index.tsx` steckt hinter
  `import.meta.env.DEV`; im Produktions-Build nicht enthalten (geprüft per `grep` im `dist/`,
  Gegenprobe mit `NODE_ENV=development`).

## Speicher

| Was                              | Wo                                      | Zugriff                        |
| -------------------------------- | --------------------------------------- | ------------------------------ |
| Songs inkl. Choreografie         | IndexedDB `dancebeat`, Store `songs`    | `SongRepository`               |
| Audiodateien                     | IndexedDB, Store `blobs`                | `SongRepository.getAudio`      |
| Einstellungen                    | `localStorage` `dancebeat.settings`     | `useSettings`                  |
| Gelöschte Demo-Songs (IDs)       | `localStorage` `dancebeat.deletedDemos` | `seedDemos`, `markDemoDeleted` |
| Spotify-Token und PKCE-Verifier  | `sessionStorage`                        | `lib/audio/sources.ts`         |
| App-Hülle, MediaPipe-WASM/Modell | Cache Storage `dancebeat-*`             | Service Worker (`src/sw/`)     |

**SongRepository** (`src/lib/library/repository.ts`) ist die einzige Schnittstelle zur
Bibliothek: `list`, `get`, `save`, `delete`, `getAudio`, `export`, `import`. Vorerst gibt es nur
die IndexedDB-Implementierung; eine Server-Variante kann dieselbe Schnittstelle erfüllen.

- Gelesene Einträge werden mit zod geprüft; ungültige werden übersprungen (nicht gelöscht).
- `save` prüft vor dem Schreiben und setzt `updatedAt`. Song und Audio werden in einer
  Transaktion geschrieben, `delete` entfernt beides in einer Transaktion.
- Promises lösen erst nach `oncomplete` der Transaktion auf. `QuotaExceededError` wird zu
  `StorageFullError` mit deutscher Meldung.
- Einstellungen (`src/lib/settings.ts`) werden beim Lesen mit zod geprüft, pro Feld: ein
  ungültiger Wert fällt auf seinen Standard zurück, die übrigen bleiben erhalten. Lautstärke und
  Latenz-Ausgleich (±500 ms) werden begrenzt, unbekannte Schlüssel verworfen. Schreibfehler
  (Quota, privater Modus) werden abgefangen; die Oberfläche arbeitet dann mit dem Wert im
  Speicher weiter. `autoStart` (Standard an) steuert den Auto-Start der Aufstellhilfe,
  `haptics` (Standard an) die Vibration bei PERFECT und Gold. Einstellungen haben bewusst keine Version und keine Migration: jedes Feld fällt über zod
  `.catch` auf seinen Standard zurück, Formatänderungen ergänzen also nur Felder mit Standardwert.
  Das Schema liegt in `settings.ts` und nicht in `schema.ts`, weil es eine gerätelokale
  Vorliebe ist und keine Bibliotheksdaten.
- Demo-Songs (`src/data/demo.ts`): `seedDemos` legt jede Demo nur an, wenn sie in der Bibliothek
  fehlt und ihre ID nicht in `dancebeat.deletedDemos` steht. Vorhandene Einträge (Highscore,
  Umbenennung) werden nie überschrieben. Die Liste liegt bewusst in `localStorage` statt in
  einem eigenen IndexedDB-Store (keine neue DB-Version); geht sie verloren, kehren gelöschte
  Demos zurück.
- `src/lib/library/storage.ts`: `requestPersistentStorage()` (Safari löscht sonst Daten nicht
  installierter Seiten nach 7 Tagen ohne Nutzung) und `getStorageUsage()` für die Anzeige.

### Song hinzufügen und Choreografie exportieren

- `AddSongDialog` (Tabs Datei, URL, YouTube) baut den Song über die reine Funktion
  `buildNewSong` (`src/lib/library/newSong.ts`, endet mit `SongSchema.parse`) und speichert ihn
  über `useSongLibrary.save`. Lokale Songs bekommen eine frische `blobId`; das Repository legt die
  Datei in derselben Transaktion unter dieser ID ab.
- Datei: `analyzeAudio` (`src/lib/beat.ts`) dekodiert einmal und liefert BPM-Schätzung und
  Länge; nicht dekodierbare Dateien ergeben „Bitte MP3, M4A, WAV oder OGG verwenden“. URL und
  YouTube: BPM und Länge von Hand (Standard 120 BPM, 180 s), weil ein automatisches Auslesen
  schon beim Anlegen Netzabrufe auslösen würde. Länge 10–600 s; längere Dateien werden auf
  600 s begrenzt, die Choreografie deckt dann nur den Anfang ab.
- URL-Quellen nur `https:` (Ausnahme localhost), sonst blockiert der Browser sie auf der
  HTTPS-Seite als Mixed Content. YouTube-Links: `watch?v=`, `youtu.be`, `shorts`, `embed`,
  `youtube-nocookie.com` oder die blanke ID.
- Choreografie: automatisch (`autoChoreo`, Farbpaar zufällig aus `SONG_PALETTES`) oder Import
  einer Exportdatei (`parseChoreoFile`). Beim Import gelten BPM, Sync- und Start-Offset der Datei
  (die Moves sind darauf getimt); Titel, Künstler und Schwierigkeit kommen aus dem Formular und
  werden aus der Datei vorbelegt, solange der Nutzer sie nicht selbst geändert hat.
- Vor dem Speichern läuft `requestPersistentStorage()` (Ergebnis wird nicht abgewartet).
  `StorageFullError` erscheint mit eigener Meldung im Dialog.
- Export: „Choreografie exportieren“ in „Song bearbeiten“ lädt `<titel>.dancebeat.json` (ohne
  Audio, Quelle und Highscore) als Blob-URL herunter; die URL wird verzögert freigegeben
  (Safari bricht den Download sonst ab).

IndexedDB-Versionen:

| DB-Version | Änderung                                                                    |
| ---------- | --------------------------------------------------------------------------- |
| 1          | Stores `songs` (keyPath `id`) und `blobs`                                   |
| 2          | Migration der Songs auf Choreografie-Format v1 (UUIDs, Zeitstempel, Winkel) |

## Externe Abrufe

Kamerabilder verlassen das Gerät nie. Folgende Abrufe gehen trotzdem ins Netz und müssen in der
UI benannt werden (die Gegenstelle sieht dabei die IP-Adresse):

| Was                            | Von                                   | Wann                                      |
| ------------------------------ | ------------------------------------- | ----------------------------------------- |
| YouTube-IFrame-API (Skript)    | www.youtube.com                       | YouTube-Song im Spiel laden; in der       |
| YouTube-Player, Video          | www.youtube-nocookie.com              | Aufstellhilfe benannt                     |
| Spotify-SDK, Login, Wiedergabe | sdk.scdn.co, accounts/api.spotify.com | Spotify-Song laden                        |
| Audio-URL                      | vom Nutzer eingegebene Adresse        | in der Aufstellhilfe mit Hostname benannt |

Der Dialog „Song hinzufügen“ ruft selbst nichts ab, nennt aber schon beim Anlegen den Host der
Audio-URL bzw. youtube-nocookie.com als spätere Gegenstelle.

**Pose-Erkennung ohne externe Abrufe (Etappe 7b-1):** MediaPipe-WASM-Laufzeit und Pose-Modell
kommen von der eigenen Adresse der App (`<base>mediapipe/wasm/…`,
`<base>mediapipe/models/pose_landmarker_lite.task`, siehe `src/lib/mediapipe.ts`).

- WASM: `vite-plugins/mediapipeWasm.ts` liefert die Dateien im Dev-Server direkt aus
  `node_modules/@mediapipe/tasks-vision/wasm` aus und kopiert sie beim Build nach
  `dist/mediapipe/wasm/`. JS und WASM passen damit immer zur installierten Paketversion; die
  frühere Versionskonstante samt Test entfällt. Nicht im Repo.
- Modell: `scripts/fetch-models.ts` (`bun run fetch-models`, automatisch vor `dev`, `dev:https`,
  `build`, `build:dev`) lädt das lite-Modell einmalig von einer fest versionierten Google-URL nach
  `public/mediapipe/models/` (gitignored) und prüft SHA-256 (`scripts/models.ts`). Ohne Netz und
  ohne vorhandene Datei bricht der Build mit Meldung ab. „full“/„heavy“ (Etappe 8) müssen dort
  erst ergänzt werden.
- Das Hosting muss `.wasm` als `application/wasm` ausliefern (`vite preview` tut das).
- **Telemetrie gesperrt:** `@mediapipe/tasks-vision` 1.1.1 hat einen fest eingebauten Logger
  (kein Schalter in der API), der Nutzungsdaten (Task-Typ, Modus, OS-Klasse, Latenzen, Version;
  keine Bilder) alle 60 s und beim `close()` an `odml.pa.googleapis.com/v1/log` schickt.
  `vite-plugins/csp.ts` setzt deshalb in `index.html` eine CSP, die nur `connect-src`
  beschränkt: `'self' blob: data:` (Dev zusätzlich `ws: wss:` für HMR). Andere Direktiven bleiben
  bewusst offen (Audio-URLs über `<audio>`, YouTube-Skript und -Iframe). Der Logger scheitert
  und stoppt sich; Chrome meldet das als zwei Konsolenfehler („violates the following Content
  Security Policy directive“). Diese Fehler sind erwartet und gelten nicht als Fehler aus eigenem
  Code. Spotify (Etappe 10) braucht dann `accounts.spotify.com` und `api.spotify.com` in der
  Policy. Gilt nur für von Vite ausgelieferte `index.html` (dev, build, preview).

Alle Abrufe außer Spotify sind im Aufstellhilfe-Screen als Datenschutzhinweis benannt
(`src/components/setup/PrivacyNote.tsx`; W12): immer „Kamerabilder verlassen dein Gerät nie“
und dass die Erkennung vollständig auf dem Gerät läuft, bei YouTube-Songs zusätzlich YouTube
(Skript von youtube.com, Video über youtube-nocookie.com), bei URL-Songs der Hostname der
Adresse; beide mit dem Hinweis, dass die Gegenstelle die IP-Adresse sieht. Der Sync-Test
(`/sync/$songId`) startet keine Kamera; er nennt per `PrivacyNote camera={false}` nur den Abruf
der Songquelle (YouTube bzw. Host der Audio-URL, bei lokalen Dateien nichts). Spotify-Songs
lädt er nicht (folgt mit Etappe 10).

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
Klick-Tracks. `analyzeAudio` dekodiert die Datei einmal (Decoder für Tests austauschbar) und
liefert BPM (gerundet, 30–300) und Länge. `quantize` rastet Zeiten auf Beats ein (für den Video-Import).

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
Vollbild), `/result/$songId` (Ergebnis), `/sync/$songId` (Sync-Test pro Song, siehe
[scoring.md](scoring.md#sync-test-pro-song)), `/settings`.

## Service Worker und Offline-Betrieb

Eigener Service Worker (Etappe 7b-2), keine Bibliothek. Er ruft nichts außerhalb der eigenen
Adresse ab, deshalb gibt es keinen neuen Eintrag unter [Externe Abrufe](#externe-abrufe).

- **Quellen:** `src/sw/strategy.ts` (Zuordnung `classifyRequest`, Cache-Namen, reine
  Funktionen), `src/sw/handlers.ts` (`install`, `activate`, `handleFetch` mit übergebenen
  `caches`/`fetch`, in Vitest mit Fakes getestet), `src/sw/sw.ts` (Einstieg, WebWorker-Typen über
  `tsconfig.sw.json`; `bun run typecheck` prüft beide tsconfigs).
- **Build:** `vite-plugins/serviceWorker.ts` startet in `generateBundle` einen getrennten
  `vite.build()` (Lib-Modus, IIFE) und gibt `sw.js` ungehasht im Wurzelverzeichnis von `dist/`
  aus. Ein klassisches Skript ohne `import` läuft auch in älterem iOS Safari; der getrennte
  Modulgraph verhindert, dass App-Chunks in den Service Worker geraten. Der Build bricht ab, wenn
  die Ausgabe `import` enthält oder `index.html` fehlt.
- **Registrierung:** `registerServiceWorker()` (`src/lib/serviceWorker.ts`) aus `main.tsx`, nur bei
  `import.meta.env.PROD`, nach `load`, Fehler bleiben still. Im Dev-Server gibt es keinen Service
  Worker (HMR); `vite preview` hat einen.
- **Caches:**
  - `dancebeat-precache-<version>`: `index.html`, alle gehashten JS/CSS-Dateien (auch die
    Routen-Chunks), Schriften, Manifest, Favicon, Icons. Version = SHA-256 über Namen und
    Inhalte. Wird bei `install` vollständig geladen (`cache: "reload"`), danach cache-first.
  - `dancebeat-mediapipe-<hash>`: WASM und Modell, cache-first, beim ersten erfolgreichen Abruf
    gefüllt. So liegt nur die wirklich geladene WASM-Variante im Cache (ca. 13 MB plus 5,8 MB
    Modell). Der Name hängt am Inhalt von WASM und Modell, nicht an der App-Version: ein reines
    App-Update behält den Cache, ein MediaPipe-Update legt einen neuen an.
  - `activate` löscht alle `dancebeat-`-Caches außer den aktuellen.
- **Anfragen:** Jede Navigation (auch Deep Links) bekommt die `index.html` aus dem Precache des
  aktiven Service Workers, online wie offline (App-Shell). So passen Seite, Chunks und
  MediaPipe-Cache immer zur selben Version; ein Netz-Abruf mit veralteter Seite kann nicht
  entstehen, und schlechtes Netz verzögert den Start nicht. Nur wenn die Hülle fehlt (Cache
  geräumt), geht die Navigation ans Netz. Eine per Umleitung gespeicherte Hülle (Hosts, die
  `/index.html` auf `/` umleiten) wird neu verpackt, weil Browser umgeleitete Antworten für
  Navigationen ablehnen. Dateien, deren Pfadteil mit `.` beginnt, kommen nicht in den Precache. Am Service Worker
  vorbei: Nicht-GET, Range-Anfragen (Audio), fremde Adressen (YouTube, Audio-URLs), `blob:`,
  `data:`, URLs mit Query, nicht vorgecachte eigene Dateien.
- **Updates:** kein `skipWaiting`, damit nie mitten im Spiel Dateien wechseln. Ein neuer Service
  Worker übernimmt, sobald kein Tab der alten Version mehr offen ist. `clients.claim()` wirkt
  nur bei der Erstinstallation, damit schon die erste Sitzung WASM und Modell cacht. Einen Hinweis
  „Update verfügbar“ gibt es noch nicht.
- Die CSP (`connect-src`) bleibt unverändert: Der Service Worker ruft nur die eigene Adresse ab.

## Build und Werkzeuge

- Pfad-Alias `@` → `src/` (tsconfig `paths`, in Vite über `resolve.tsconfigPaths`).
- `tsconfig.json` beschränkt globale Typen über `types`; neue `@types`-Pakete dort eintragen.
- `bunfig.toml` setzt eine 24-Stunden-Schutzfrist für neue Paketversionen.
- PWA (Etappe 7a): `public/manifest.webmanifest` und `public/icons/` werden unverändert nach
  `dist/` kopiert. Farben im Manifest und `theme-color` in `index.html` sind Kopien von
  `APP_BACKGROUND` aus `theme.ts`; `src/test/manifest.test.ts` hält sie gleich. Service Worker
  siehe [unten](#service-worker-und-offline-betrieb).
- Gerätefunktionen: Wake Lock (`src/lib/wakeLock.ts`) und Vibration (`src/lib/haptics.ts`)
  prüfen die API und schlagen still fehl; beide nur aus Effekten heraus aufgerufen.
- Statisches Hosting braucht einen SPA-Fallback auf `index.html` für Deep Links
  (`vite preview` macht das bereits).
