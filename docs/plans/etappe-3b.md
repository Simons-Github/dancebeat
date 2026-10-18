# Etappe 3b: Online-Quellen (URL und YouTube)

**Status:** Schritte 1 (`ed6efbc`), 2 (`f61f0db`), 3 (`2c3e8aa`, `5470c2e`), 4 (`1cca5c5`) und 6
(`17a4dd5`) umgesetzt, Schritt 7 (Doku) mit dem Doku-Commit. Schritt 5 umgesetzt (vor dem
Gerätetest, für alle Ausgänge: Autoplay, Knopf, Tipp aufs Video). Gerätetest (Abschnitt 6) offen.

## Kontext

Etappe 3a (Gameplay mit lokaler Datei) ist umgesetzt (Commit `fd573c0`). Offen sind die Befunde
für Online-Quellen: W5 (YouTube-Uhr läuft vor), W7 (YouTube-Player unsichtbar 2×2 px), W9 (kein
`onError` nach dem Laden), W10 (URL-Quelle auf iOS) und der Fallback „Online-Quelle lädt nicht“
(docs/roadmap.md:136-143, Tabelle docs/roadmap.md:241-246). Freigabe für 3b liegt vor (Antwort
im Planungsgespräch). Entschieden: Testsongs per Dev-Parameter, YouTube über
`youtube-nocookie.com`.

---

## 1. Ziel und Abgrenzung

**Dazu gehört**

- W5: YouTube-Uhr läuft nur im Zustand PLAYING; BUFFERING, PAUSED, CUED, ENDED halten sie an.
  `play()` löst erst bei PLAYING auf.
- W7: sichtbarer YouTube-Player, mindestens 200 × 200 px, an der Stelle des Coaches; `seek` im
  Pausenzustand startet nicht; ungenutztes Feld `poll` entfernen.
- W9: `onError` in `AudioSource`; Fehler während des Spiels stoppen das Spiel mit Meldung.
- W10 / URL-Quelle: Uhr hält bei `waiting`, `defaultPlaybackRate` mitsetzen; iOS am Gerät.
- „Blocked“ bei YouTube erkennen (Autoplay ohne Geste) und im Tipp neu starten, inkl. direktem
  Tipp aufs Video.
- Fallback: Online-Quelle lädt nicht → Meldung, zurück zur Bibliothek (Anzeige existiert, wird
  um Laufzeitfehler erweitert).
- Externe Abrufe in der UI benennen (YouTube, Audio-URL) und Doku-Tabelle anpassen.
- Dev-only: Testsongs per Query-Parameter anlegen, damit 3b ohne „Song hinzufügen“ testbar ist.

**Ausdrücklich nicht**

- Spotify (Etappe 10). `SpotifySource` bekommt nur das neue `onError` formal.
- Dialog „Song hinzufügen“, Warnsymbol `lowPrecision`, Sync-Test (Etappe 5).
- `playbackRate` für YouTube (siehe Abschnitt 9).
- Ergebnis-Screen, Highscores (Etappe 4).

---

## 2. Ist-Zustand

**Abweichungen Roadmap ↔ Code (zuerst)**

1. Es gibt keinen Weg, URL- oder YouTube-Songs anzulegen. Das Schema kennt sie
   (`src/lib/schema.ts:67-72`), aber `seedDemos` legt nur `local` an (`src/data/demo.ts:205`),
   der Import übernimmt keine Quelle (`ExportedSongSchema`, `src/lib/schema.ts:91-98`) und
   „Song hinzufügen“ kommt erst in Etappe 5. → Entscheidung D1.
2. „URL-Quelle: `playbackRate`“ (docs/roadmap.md:142) ist im Code schon erledigt: `createSource`
   übergibt `song.playbackRate` (`src/lib/audio/sources.ts:442`), gesetzt in
   `sources.ts:73-74` und nach dem Laden erneut in `sources.ts:112`. Rest: nur
   `defaultPlaybackRate` (siehe Schritt 2).
3. „Player in der Coach-Ecke, ≥ 200 px“ (docs/roadmap.md:140, docs/design.md:38-39): die
   Coach-Ecke ist kleiner als 200 px. `size-[min(38vw,28dvh)]` bzw. landscape
   `min(26vw,42dvh)` (`src/components/play/GameScreen.tsx:396`) ergibt 148 px bei 390×844 und
   164 px bei 844×390. → Die Box für YouTube braucht `max(200px, …)` (Schritt 4).

**Audio-Schicht** (`src/lib/audio/sources.ts`)

- `AudioSource` ohne `onError` (`sources.ts:6-17`); `SourceOptions` nur `element` (`:19-25`).
- `SmoothClock` (`:28-48`): weiche Angleichung, hart bei > 400 ms oder `!playing`.
- `ElementSource` (`:57-162`): Ladefehler nur während `load()` (`:94-103`); nach dem Laden
  kein Fehlerhandler. Resync alle 250 ms mit `!el.paused` (`:119-122`): bei `waiting`
  (Puffern) ist `paused` false, die Uhr läuft weiter und springt danach zurück.
- `loadYT` (`:173-184`): abgelehntes `ytReady` bleibt gecacht (jeder weitere Versuch scheitert
  bis zum Neuladen), kein Timeout, falls das Skript lädt, aber `onYouTubeIframeAPIReady` nie kommt.
- `YouTubeSource` (`:191-288`):
  - Host 2×2 px, `opacity:0.01`, außerhalb des Bildes an `document.body` (`:200-207`) → W7.
  - `play()` ruft `playVideo()` und synchronisiert sofort hart mit `playing=true` (`:247-251`)
    → Uhr läuft, obwohl das Video noch puffert (W5). Kein Erkennen von Autoplay-Sperre.
  - `seek()` setzt immer `playing=true` (`:265-268`) → Uhr läuft im Pausenzustand.
  - `onStateChange` wertet nur ENDED aus (`:240-242`).
  - Feld `poll` ungenutzt (`:196`, nur in `clearInterval`).
  - Kein `destroyed`-Schutz: `destroy()` während `load()` erzeugt danach trotzdem einen Player.
- `SpotifySource` (`:338-425`): außerhalb des Umfangs.

**Hook** `src/hooks/useAudioClock.ts`: Fehler nur aus `load()` (`:69-73`); Quelle wird im Effekt
erzeugt (`:51`), Optionen über `latest`-Ref (`:32-33`), Test-Seam `create` (`:19`).

**Controller** `src/lib/game/controller.ts`

- `play()` (`:172-190`): Ablehnung → `blocked`; Ergebnis mit veraltetem Token → `audio.pause()`,
  wenn Phase ≠ playing (`:181-184`).
- `tap()` (`:193-196`) prüft nicht, ob schon ein `play()` läuft. Zwei Tipps auf dieselbe
  ausstehende Wiedergabe: Das erste Ergebnis hat einen veralteten Token, Phase ist noch
  `blocked` → `audio.pause()` stoppt die gerade gestartete Musik. Heute harmlos (Element-`play()`
  löst schnell auf), mit YouTube (Warten auf PLAYING) real.

**Spielscreen** `src/components/play/GameScreen.tsx`

- `useAudioClock` mit `element: claimSharedElement` (`:82-87`); Controller-Audio (`:139-143`).
- Fehler-Overlay nur für `audio.state === "error"` mit Titel „konnte nicht geladen werden“ und
  „Zur Bibliothek“ (`:284-289`).
- Coach-Canvas (`:392-397`); der Loop zeichnet nur, wenn `coachRef.current` gesetzt ist (`:232`).
- `BlockedOverlay` deckt den ganzen Screen ab (`Layer`, `src/components/play/Overlays.tsx:19-28`,
  `:77-89`).
- Simulationsmodus `?sim=1` ersetzt nur die Kamera, nicht das Audio
  (`src/routes/play/$songId.tsx:21`, `GameScreen.tsx:109`) → Playwright kann Audioquellen ohne
  Kamera prüfen.

**Datenschutzhinweis** `src/components/setup/PrivacyNote.tsx:4-15` nennt nur jsDelivr/Google.
Verwendet in `src/components/SetupScreen.tsx:190` und `:284`. docs/architecture.md (Abschnitt
„Externe Abrufe“) führt `youtube.com` und „Audio-URL“, die UI nennt sie nirgends.

**Tests**: `src/test/audioClock.test.tsx` mit `fakeSource` (`:42-58`, braucht künftig
`onError`); `src/test/gameController.test.ts`; `src/test/game-screen.test.tsx`. Kein Test für
`YouTubeSource`. `loadYT` überspringt das Skript, wenn `window.YT.Player` existiert
(`sources.ts:175`) → mit einem Fake-`window.YT` testbar.

**Playwright-Konfiguration** `.claude/playwright-mcp.json`: `allowedOrigins` ohne YouTube →
echter YouTube-Abruf scheitert dort absichtlich (gut für den Fallback-Test).

---

## 3. Entscheidungen

**D1 Testsongs: Dev-Parameter** (vom Nutzer gewählt). `/?devsong=youtube:<ID-oder-Link>`,
`/?devsong=url:<Adresse>`, `/?devsong=clear`; optional `&bpm=<30..300>` (Standard 120) und
`&len=<Sekunden>` (Standard 180). Zwei feste UUID-Slots (einer je Typ), überschreibbar, damit
sich ohne Lösch-UI nichts ansammelt. Speichern über `useSongLibrary().save` / `remove`
(→ `SongRepository`), Choreo über `autoChoreo` (`src/data/demo.ts`). Hinter
`import.meta.env.DEV` wie der Simulationsmodus (`src/routes/play/$songId.tsx:21`). Keine
Video-IDs oder URLs im Repo: der Nutzer gibt sie zur Laufzeit ein.
Alternativen: Tabs aus Etappe 5 vorziehen (zu viel Umfang), nur Unit-Tests (kein Gerätetest).

**D2 YouTube-Start und Autoplay-Sperre.** `play()` ruft `playVideo()` und wartet auf PLAYING.

- Nach `YT_PLAY_TIMEOUT_MS = 4000` noch UNSTARTED (-1) oder CUED (5) → `pauseVideo()`, Ablehnung
  → Controller `blocked`.
- Steht der Player dann auf BUFFERING (3), wird weiter gewartet, bis `YT_BUFFER_TIMEOUT_MS =
15000`; danach Ablehnung mit „YouTube-Video lädt nicht. Prüfe Link und Verbindung.“
- Ein `play()` nach einer Ablehnung (Tipp im `blocked`-Zustand) wartet ohne Sperr-Timeout,
  damit auch ein direkter Tipp aufs Video zum Erfolg führt (das Overlay lässt das Video frei,
  Schritt 5).
- Gleichzeitige `play()`-Aufrufe teilen sich ein Promise; `pause()`/`destroy()` lehnen ein
  ausstehendes ab.
  Alternative: neues Ereignis `onPlaying` in `AudioSource` → größere Schnittstellenänderung für
  alle Quellen. Abgelehnt, weil das ausstehende Promise denselben Zweck erfüllt.
  Die Werte 4000/15000 sind **Annahmen**, am Gerät abzustimmen.

**D3 YouTube-Uhr (W5).** `onStateChange` steuert die `SmoothClock`: PLAYING → hart auf
`getCurrentTime()`, `playing=true`; BUFFERING/PAUSED/CUED/ENDED → hart, `playing=false`.
Der 500-ms-Resync nimmt `playing` aus dem letzten Zustand. Damit beginnt die Spielzeit erst mit
hörbarem Ton, und Puffern hält Spielzeit und Wertung an (der Scorer arbeitet nur auf der
Spielzeit).

**D4 Seek vor dem ersten Start.** Ist der Player noch UNSTARTED/CUED, merkt sich `seek` die
Position (`pendingSeekMs`) und die Uhr ohne zu laufen; `play()` ruft erst `seekTo(…, true)`, dann
`playVideo()`. Danach (PAUSED) direkt `seekTo`, Uhr `playing=false`. **Annahme:** `seekTo` auf
einem nie gestarteten Video startet die Wiedergabe (deshalb das Merken); extern prüfen.

**D5 Player-Platz (W7).** Bei YouTube-Songs ersetzt ein Host-`div` das Coach-Canvas (so steht es
in docs/design.md:38-39). Größe `size-[max(200px,min(38vw,28dvh))]`, landscape
`size-[max(200px,min(26vw,42dvh))]`, unten links, nicht im gespiegelten Container. Der Host kommt
als `container` über `SourceOptions`; der Player füllt ihn (`width/height "100%"`). Ohne
`container` (Tests) bleibt das bisherige versteckte Verhalten. `pointer-events: none`, außer in
Phase `blocked`.
Platzrechnung landscape 844×390: 390 − 2·12 (safe-pad) − 48 (Pause-Knopf, HUD-Höhe **Annahme**
≤ 48) − 12 − 64 (Piktoleiste `landscape:h-16`) − 12 ≈ 230 px ≥ 200 px.

**D6 Host `youtube-nocookie.com`** (vom Nutzer gewählt): Player-Option
`host: "https://www.youtube-nocookie.com"` (in `@types/youtube` vorhanden). Das Skript
`iframe_api` kommt weiter von `www.youtube.com`. Beides wird in UI und Doku benannt.

**D7 Laufzeitfehler (W9).** `AudioSource.onError(cb: (message: string) => void)`. `useAudioClock`
setzt dann `error` und `state = "error"` und merkt sich, ob schon gespielt wurde. Der Spielscreen
ruft bei `error` `controller.cancel()` und zeigt „Die Musik ist abgebrochen“ (nach Start) bzw.
wie bisher „konnte nicht geladen werden“, jeweils mit „Zur Bibliothek“.

---

## 4. Schritte

Reihenfolge: 1, 2, 3, 4, 6, 7, Gerätetest, dann 5 (siehe Schritt 5). Festgelegt für die offenen
Fragen aus Abschnitt 8: Timeouts 4 s / 15 s, nur „Zur Bibliothek“ (kein „Erneut versuchen“),
Hinweis „Wir sehen dich nicht“ unverändert.

Jeder Commit endet mit `bun run typecheck`, `bun run test`, `bun run lint`, `bun run build`, alle
vier sauber. Danach `bun run format` (nur geänderte Dateien prüfen).

### Schritt 1: Dev-Testsongs

- **Dateien:** neu `src/data/devSongs.ts`; `src/routes/index.tsx`; neu `src/test/devSongs.test.ts`.
- **Änderung:** `parseDevSong(search)` liefert `{ kind: "youtube", videoId } | { kind: "url",
url } | { kind: "clear" } | null`; YouTube über `parseYouTubeId` (`src/lib/audio/sources.ts:186`),
  URL nur `http:`/`https:` per `new URL`, `bpm` auf 30..300 begrenzt, `len` auf 10..600 s.
  `buildDevSong(spec, now)` baut einen `Song` mit fester UUID je Typ (`DEV_SONG_IDS`), Titel
  „Dev: YouTube“ bzw. „Dev: URL“, Künstler „Testsong“, `autoChoreo(title, bpm, len·1000, Farben)`,
  und prüft mit `SongSchema.parse`. In `Index` (Muster: `useSearch({ strict: false })` wie
  `src/routes/play/$songId.tsx:16`) wertet ein Effekt nur bei `import.meta.env.DEV` aus, ruft
  `save` bzw. für `clear` `remove` beider Slots und ersetzt danach die URL durch `/`
  (`navigate({ to: "/", replace: true })`).
- **Akzeptanz:** Tests für Parser (gültig, ungültige ID, `javascript:`-URL abgelehnt, Grenzen) und
  `buildDevSong` (Schema gültig, feste IDs). Im Dev-Server legt `/?devsong=youtube:dQw…`-artige
  ID eine Kachel „Dev: YouTube“ an, erneuter Aufruf überschreibt sie. `bun run build` und
  `grep -r "devsong" dist/` findet nichts.
- **Modell:** Sonnet (klares Muster, kleine Logik).
- **Commit:** `Etappe 3b: Dev-Testsongs für URL- und YouTube-Quellen`

### Schritt 2: `onError` und URL-Quelle (W9, W10)

- **Dateien:** `src/lib/audio/sources.ts`, `src/hooks/useAudioClock.ts`,
  `src/components/play/GameScreen.tsx`, `src/test/audioClock.test.tsx`, ggf.
  `src/test/game-screen.test.tsx`.
- **Änderung:** `AudioSource` bekommt `onError(cb)`. `ElementSource`: nach erfolgreichem `load()`
  einen Laufzeit-`onerror` setzen („Die Verbindung zur Musik ist abgebrochen.“ für `url`,
  Dekodiertext für `local`); Ereignisse `waiting` → `clock.sync(currentTime, false, true)`,
  `playing` → `clock.sync(currentTime, true, true)`; Resync-Intervall nimmt `playing` als
  `!el.paused && !waiting`. Neben `playbackRate` auch `defaultPlaybackRate` setzen. `destroy()`
  entfernt alle neuen Handler. `SpotifySource` speichert den Callback nur. `useAudioClock`
  registriert `onError` (verwirft späte Fehler bei `cancelled`) und setzt `error`/`state`; den
  Titel entscheidet der Spielscreen selbst über `startedRef.current`. Im `GameScreen` ein Effekt: `audio.state === "error"`
  → `controllerRef.current?.cancel()`; Titel „Die Musik ist abgebrochen“, wenn
  `startedRef.current`, sonst wie bisher (`GameScreen.tsx:284-289`).
- **Akzeptanz:** Tests: `onError` nach dem Laden setzt `state "error"`; später Fehler des alten
  Songs wird verworfen; `waiting` hält die Uhr an (`vi.spyOn(performance, "now")`), `playing`
  setzt sie fort; `destroy` entfernt Handler. Spielscreen-Test: Fehler während `playing` → Phase
  `preparing`, Overlay mit „Die Musik ist abgebrochen“, Audio pausiert. `fakeSource` um
  `onError: vi.fn()` ergänzt.
- **Modell:** Sonnet (Verdrahtung nach bestehendem Muster; Uhrlogik ist klein und getestet).
- **Commit:** `Etappe 3b: onError in AudioSource, URL-Uhr hält beim Puffern`

### Schritt 3: YouTube-Uhr, Start und Seek (W5, Teil W7)

- **Dateien:** `src/lib/audio/sources.ts`, neu `src/test/youtubeSource.test.ts`.
- **Änderung:** `loadYT`: bei `onerror` oder nach 15 s Timeout `ytReady = null`, Skript-Tag
  entfernen, ablehnen. `YouTubeSource`: Feld `poll` entfernen, `destroyed`-Flag (wie
  `ElementSource`, `sources.ts:63`, `:79`); Player mit `host: "https://www.youtube-nocookie.com"`.
  `onStateChange` setzt `this.ytState` und führt die Uhr nach D3; ENDED ruft weiter `endedCb`.
  `play()` nach D2 (Timeouts als exportierte Konstanten, geteiltes Promise, Flag `refusedOnce`
  für „ohne Sperr-Timeout warten“), `pendingSeekMs` nach D4. `seek()` nach dem ersten Start
  `seekTo(ms/1000, true)` und Uhr `playing=false`, solange nicht PLAYING. `onError`: Fehler nach
  `onReady` gehen an den `onError`-Callback (Texte wie `sources.ts:232-237`). Resync nutzt
  `api.PlayerState` statt des globalen `YT` (`sources.ts:256`).
- **Akzeptanz:** Tests mit Fake-`window.YT` (Player-Klasse, die `events` speichert und
  `getPlayerState`/`getCurrentTime` steuerbar macht), Fake-Timer und `performance.now`-Spy:
  (a) Uhr steht nach `play()` bis PLAYING, dann läuft sie; (b) BUFFERING mitten im Spiel hält
  sie an; (c) `play()` lehnt nach 4 s bei CUED ab und ruft `pauseVideo`; (d) bei BUFFERING wird
  weiter gewartet, Ablehnung erst nach 15 s; (e) zweites `play()` nach Ablehnung wartet ohne
  Timeout und löst bei PLAYING auf; (f) zwei parallele `play()` → ein `playVideo`, ein Promise;
  (g) `seek` vor dem Start ruft kein `seekTo`, `play` danach `seekTo` vor `playVideo`; (h)
  `seek` im PAUSED-Zustand lässt die Uhr stehen; (i) `destroy()` während `load()` erzeugt keinen
  Player; (j) `loadYT` nach Skriptfehler lädt beim nächsten Versuch neu; (k) Player-Option
  `host` gesetzt; (l) `onError` nach Ready ruft den Callback.
- **Modell:** Opus (Zustandsmaschine, Timing, Nebenläufigkeit von Promises).
- **Commit:** `Etappe 3b: YouTube-Uhr erst bei PLAYING, Autoplay-Sperre erkennen, Seek im Pausenzustand`

### Schritt 4: Sichtbarer YouTube-Player (W7)

- **Dateien:** `src/lib/audio/sources.ts`, `src/hooks/useAudioClock.ts`,
  `src/components/play/GameScreen.tsx`, `src/test/game-screen.test.tsx`,
  `src/test/youtubeSource.test.ts`.
- **Änderung:** `SourceOptions.container?: HTMLElement`; `createSource` reicht ihn an
  `YouTubeSource`, das seinen Host dort einhängt (`position:absolute; inset:0`), Player
  `width/height "100%"`; ohne Container wie bisher. `useAudioClock`-Option
  `container?: () => HTMLElement | null` (nur im Effekt aufgerufen, wie `element`). Im
  `GameScreen` bei `song.source.type === "youtube"` statt des Coach-Canvas ein `div ref={ytHostRef}`
  mit den Klassen aus D5, `rounded-2xl overflow-hidden`, `z-20`, `aria-label="YouTube-Video"`,
  `pointer-events-none`. Nichts im Spielscreen darf darüber liegen außer den Vollbild-Overlays
  (Pause, Fehler, Countdown).
- **Akzeptanz:** Test: YouTube-Song rendert den Host statt `role="img" aria-label="Coach"`;
  `create`-Seam bekommt den Container. Unit-Test: Host hängt im Container. Playwright-Screenshot
  (Abschnitt 5) zeigt die leere Box ≥ 200×200 in 390×844 und 844×390 ohne Überlappung mit
  Piktoleiste und HUD.
- **Modell:** Sonnet (Layout und Verdrahtung).
- **Commit:** `Etappe 3b: YouTube-Player sichtbar in der Coach-Ecke`

### Schritt 5: Blocked-Ablauf für YouTube und doppelter Tipp

- **Dateien:** `src/lib/game/controller.ts`, `src/components/play/Overlays.tsx`,
  `src/components/play/GameScreen.tsx`, `src/test/gameController.test.ts`,
  `src/test/game-screen.test.tsx`.
- **Planänderung nach Schritt 3:** Nach einer Ablehnung gibt es kein ausstehendes `play()` mehr.
  Ein Tipp direkt aufs Video (im Iframe, die Elternseite sieht ihn nicht) startet YouTube, aber der
  Controller bliebe in `blocked`, obwohl die Musik läuft. Deshalb bekommt `AudioSource` ein
  **optionales** `onExternalStart(cb)`: `YouTubeSource` ruft es, wenn PLAYING ohne ausstehendes
  `play()` eintritt (und setzt dabei `refusedOnce` zurück, `pendingSeekMs` wird schon verworfen).
  `useAudioClock` reicht es durch, der Controller geht in `blocked` bei diesem Signal nach `playing`
  (gleiche Schritte wie am Ende von `play()`). Reihenfolge im Plan: Schritt 5 erst nach dem
  Gerätetest von Schritt 3/4 (Reihenfolge 1, 2, 3, 4, 6, 7, Gerätetest, dann 5).
- **Änderung:** Controller: privates `playPending`; `tap()` tut nichts, solange ein `play()`
  aussteht. `onExternalStart` wie oben. `BlockedOverlay` bekommt `hint?: string`; bei YouTube:
  „Falls nichts passiert, tippe direkt auf das Video.“ Im `blocked`-Zustand liegt der YouTube-Host
  über der Ebene (`z-40`) und ist antippbar (`pointer-events-auto`); sonst `pointer-events-none`.
- **Akzeptanz:** Controller-Test: zwei `tap()` auf ein langsames `play()` → ein Aufruf, kein
  `pause()`, Phase `playing`. Pause während ausstehendem `play()` → Phase `paused`, späte Auflösung
  wird verworfen. `onExternalStart` in `blocked` → Phase `playing`; in anderen Phasen ignoriert.
  Source-Test: PLAYING ohne `play()` ruft `onExternalStart` genau einmal, PLAYING bei laufendem
  `play()` nicht. Screen-Test: Phase `blocked` mit YouTube-Song zeigt den Hinweis, Host hat
  `pointer-events-auto`.
- **Modell:** Opus (Schnittstelle, Controller-Zustände, Nebenläufigkeit).
- **Commit:** `Etappe 3b: Blocked-Ablauf für YouTube, doppelter Tipp startet nicht zweimal`

### Schritt 6: Externe Abrufe in der UI

- **Dateien:** `src/components/setup/PrivacyNote.tsx`, `src/components/SetupScreen.tsx`,
  `src/test/setup-screen.test.tsx`.
- **Änderung:** `PrivacyNote` bekommt `source?: SourceSpec` (Typ aus `src/lib/schema.ts`). YouTube:
  zweiter Satz „Die Musik kommt von YouTube (Skript von youtube.com, Video über
  youtube-nocookie.com); YouTube sieht dabei deine IP-Adresse.“ URL: „Die Musik wird von
  <Hostname> geladen; der Server sieht deine IP-Adresse.“ (Hostname per `new URL(url).host`).
  `SetupScreen` übergibt `song.source` an beiden Stellen (`:190`, `:284`).
- **Akzeptanz:** Tests: lokaler Song zeigt nur den bisherigen Satz; YouTube- und URL-Song zeigen
  den jeweiligen Zusatz mit Hostname.
- **Modell:** Sonnet.
- **Commit:** `Etappe 3b: Datenschutzhinweis nennt YouTube und Audio-URL`

### Schritt 7: Doku

- **Dateien:** `docs/architecture.md`, `docs/roadmap.md`, `docs/design.md`, `docs/plans/etappe-3b.md`.
- **Änderung:** architecture: `AudioSource` mit `onError`, `SourceOptions.container`, YouTube-
  Zeitbasis („nur bei PLAYING, Puffern hält an“), URL-Puffern, Abschnitt Dev-Testsongs neben dem
  Simulationsmodus, Tabelle „Externe Abrufe“: Zeile YouTube auf `www.youtube.com` (Skript) und
  `www.youtube-nocookie.com` (Player) und „wann: Aufstellhilfe-Hinweis, Laden im Spiel“. roadmap:
  3b-Abschnitt „umgesetzt, Gerätetest offen“, W5/W7/W9/W10 nach „Erledigt“ verschieben (W10 mit
  „iOS am Gerät“), Abweichung 2 (playbackRate) vermerken, Gerätecheckliste aus Abschnitt 6.
  design: Player-Box `max(200px, …)` erwähnen.
- **Akzeptanz:** Links funktionieren, `bun run format` ändert nichts mehr.
- **Modell:** Sonnet.
- **Commit:** `Doku: Etappe 3b umgesetzt, Gerätetest offen`

---

## 5. Tests

**Neu:** `src/test/devSongs.test.ts` (Schritt 1), `src/test/youtubeSource.test.ts` (Schritte 3, 4).
**Angepasst:** `src/test/audioClock.test.tsx` (`onError`, URL-Puffern, `fakeSource`),
`src/test/gameController.test.ts` (doppelter Tipp, Pause bei ausstehendem play),
`src/test/game-screen.test.tsx` (Laufzeitfehler, YouTube-Host, Blocked-Hinweis),
`src/test/setup-screen.test.tsx` (Datenschutzhinweis).

**Playwright** (headless, Fake-Kamera, projektlokaler Server `dancebeat-playwright`). Vorher
`bun run dev` und die Prüfung per `ps aux | grep -i playwright` laut CLAUDE.md. `allowedOrigins`
**nicht** um YouTube erweitern; damit wird gezielt der Fehlerweg geprüft.

1. `/?devsong=youtube:aaaaaaaaaaa` → Kachel „Dev: YouTube“. `/play/<YouTube-Slot-ID>?sim=1` →
   Overlay „Die Musik konnte nicht geladen werden“ mit „YouTube konnte nicht geladen werden …“,
   „Zur Bibliothek“ führt nach `/`. Vor dem Fehler Box-Größe per `browser_evaluate`
   (`getBoundingClientRect` des Elements `[aria-label="YouTube-Video"]`) ≥ 200×200; Screenshot
   in 390×844 und 844×390.
2. `/?devsong=url:http://localhost:5173/gibt-es-nicht.mp3` → `/play/<URL-Slot-ID>?sim=1` →
   Ladefehler-Meldung (Text der URL-Quelle). **Annahme:** Vite liefert für diesen Pfad kein
   gültiges Audio (404 oder HTML); Ergebnis protokollieren.
3. `/setup/<YouTube-Slot-ID>` und `/setup/<URL-Slot-ID>`: Datenschutzhinweis mit Zusatz, beide
   Formate per Snapshot. Kamera nur über die Fake-Kamera.
4. Nach jedem Schritt `browser_console_messages`; eigene Fehler/Warnungen beheben.
5. `/?devsong=clear` → Kacheln weg. Danach Screenshots und `.playwright-mcp/` löschen.
   Echte YouTube-Wiedergabe, URL-Erfolgsfall und iOS bleiben Gerätetests.

---

## 6. Prüfung auf echten Geräten (zum Abhaken)

Vorbereitung: `bun run dev:https`, am Handy `https://<LAN-IP>:5173/?devsong=youtube:<eigene
Video-ID>` bzw. `…?devsong=url:<eigene MP3-URL>&bpm=<BPM>`.

iPhone (Safari):

- [ ] YouTube: Aufstellhilfe → Einrasten → Countdown → Musik startet ohne Tipp **oder** „Zum
      Starten tippen“ erscheint; Knopf startet, sonst Tipp aufs Video startet. Notieren, welcher Weg.
- [ ] YouTube: Piktos laufen erst, wenn Ton hörbar ist (kein Vorlauf, W5).
- [ ] YouTube: Pause → Weiter, Neustart (Start-Offset), Display sperren → Pause, zurück → Weiter.
- [ ] YouTube: Player sichtbar unten links, ≥ 200 px, hoch und quer, nichts verdeckt ihn.
- [ ] YouTube: Flugmodus mitten im Song → Spiel hält an (Puffern) oder „Musik ist abgebrochen“.
- [ ] YouTube: FPS-Gefühl mit Video + Kamera (ruckelt die Erkennung?).
- [ ] URL: Laden ohne vorherige Geste (direkt `/play/…` neu laden) → „Zum Starten tippen“ wirkt.
- [ ] URL: Lautstärke ok, während die Kamera läuft (iOS-Audio-Session).
- [ ] URL: Netz weg → Uhr hält / Meldung „Die Musik ist abgebrochen“.
- [ ] Datenschutzhinweis in der Aufstellhilfe nennt YouTube bzw. den Host.

Desktop (Chrome, Safari):

- [ ] YouTube und URL einmal komplett durchspielen, Ende → Ergebnis-Platzhalter.
- [ ] Gesperrtes Video (Einbetten verboten) → verständliche Meldung, zurück zur Bibliothek.
- [ ] DevTools-Netzwerk: Player-Iframe kommt von `youtube-nocookie.com`.

---

## 7. Risiken und Gegenmaßnahmen

| Risiko                                                                                                                          | Gegenmaßnahme                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| iOS ignoriert `playVideo()` per postMessage auch im Tipp, weil die Geste nicht ins Iframe übergeht (**Annahme**, extern prüfen) | Fallback „tippe direkt aufs Video“ (Schritt 5); D2 wartet ohne Timeout nach Ablehnung                                          |
| Falsches „blocked“ bei langsamem Netz                                                                                           | BUFFERING verlängert das Warten (D2); Werte am Gerät abstimmen                                                                 |
| `seekTo` startet nie gestartete Videos (**Annahme**)                                                                            | `pendingSeekMs` (D4)                                                                                                           |
| Player-Box überlappt in Querformat HUD/Piktoleiste oder Hinweis „Wir sehen dich nicht“                                          | Platzrechnung D5, Screenshot 844×390; ggf. Hinweis rechts ausrichten                                                           |
| Overlays über dem Player könnten gegen YouTube-Regeln verstoßen (**Annahme**)                                                   | Im Spiel nichts über dem Player; Vollbild-Overlays nur bei Pause/Countdown/Fehler; extern prüfen                               |
| Video-Dekodierung + MediaPipe auf dem Handy zu langsam                                                                          | Gerätetest; ggf. später Qualität über `setPlaybackQuality` (veraltet?) – extern prüfen                                         |
| iOS-Audio-Session mit aktiver Kamera (leiser Ton)                                                                               | Gerätetest, betrifft schon 3a                                                                                                  |
| Uhr springt zurück, Scorer bekommt fallende Zeiten                                                                              | URL- und YouTube-Uhr halten beim Puffern an statt vorzulaufen; Scorer schützt bereits gegen ungültige Zeiten (docs/scoring.md) |
| Dev-Code landet im Produktions-Build                                                                                            | Nur hinter `import.meta.env.DEV`, Prüfung per `grep` im `dist/` (Schritt 1)                                                    |
| Persistierte Dev-Songs bleiben in der Bibliothek                                                                                | feste Slots, `?devsong=clear`                                                                                                  |
| Kein Datenformatwechsel nötig                                                                                                   | bestätigt: Schema bleibt v1, keine Migration                                                                                   |

---

## 8. Offene Fragen und extern zu verifizierende Fakten

An dich:

1. Reicht „Zur Bibliothek“ als einzige Aktion bei Laufzeitfehlern, oder zusätzlich „Erneut
   versuchen“ (lädt die Quelle neu)?
2. Timeouts 4 s (Sperre) und 15 s (Puffern) als Startwerte ok?
3. Soll der Hinweis „Wir sehen dich nicht“ bei YouTube-Songs nach rechts rücken, falls er im
   Querformat den Player berührt?

Extern zu verifizieren (nicht aus dem Gedächtnis übernommen):

- YouTube IFrame API: Mindestgröße 200 × 200 px und Regeln zu Overlays über dem Player (Nutzungs-
  bedingungen/Developer Policies, aktueller Stand).
- `host: "https://www.youtube-nocookie.com"` mit der IFrame API: funktioniert, welche Cookies /
  Speicher entstehen beim Abspielen, Skript weiterhin von `www.youtube.com`.
- Verhalten von `seekTo` auf UNSTARTED/CUED-Videos und im PAUSED-Zustand.
- iOS Safari: zählt `playVideo()` aus einem Tipp-Handler der Elternseite als Nutzergeste für das
  Iframe? Autoplay-Regeln für YouTube-Iframes ohne Stummschaltung.
- HTML-Spec / WebKit: setzt `load()` `playbackRate` auf `defaultPlaybackRate` zurück?
- iOS Safari: Feuern `waiting`/`playing` bei `HTMLAudioElement` zuverlässig beim Puffern?
- DSGVO-Einordnung des Hinweistexts (IP-Übertragung an YouTube) – ob der Wortlaut genügt.

---

## 9. Nicht im Umfang

- YouTube ignoriert `song.playbackRate` (`src/lib/audio/sources.ts:444`, Uhr-Rate fest 1);
  Controller rechnet trotzdem mit `song.playbackRate` (`GameScreen.tsx:148`). Erst relevant, wenn
  eine UI die Rate setzt (Etappe 5/8).
- Hinweis „Musik puffert …“ während BUFFERING/`waiting` (Spiel friert dann still ein).
- `playerVars.origin` für den YouTube-Player (Sicherheit der postMessage-Kommunikation), extern
  prüfen.
- Spotify-Fehler und -Uhr (W6, Etappe 10); `SpotifySource.play()` synchronisiert ebenfalls sofort
  mit `playing=true` (`sources.ts:398`), gleiches Muster wie W5.
- `loadYT` überschreibt `window.onYouTubeIframeAPIReady` global; unkritisch, solange nur eine
  Stelle lädt.
- Warnsymbol für `lowPrecision`-Quellen (Etappe 5).
