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
`setVolume`, `onEnded`, `onError`, `destroy`, optional `onExternalStart` und `onExternalPause`).
`onError` meldet Fehler, die nach erfolgreichem `load()` auftreten (Verbindung weg,
Dekodierfehler, YouTube-Fehlercode). `onExternalStart` und `onExternalPause` implementieren YouTube
und Spotify: Die Wiedergabe startete ohne ausstehendes `play()` bzw. wurde direkt im Player
angehalten (Tipp aufs Video, andere Spotify-App); die Uhr läuft bzw. steht dann schon. `SourceOptions.element`
ist das gemeinsame, per Geste entsperrte Audioelement (Datei/URL), `SourceOptions.container` das
Element, in dem der YouTube-Player angezeigt wird (ohne: unsichtbarer 2×2-px-Player außerhalb des
Bildschirms):

| Quelle    | Umsetzung                              | Zeitbasis                                  |
| --------- | -------------------------------------- | ------------------------------------------ |
| `local`   | `HTMLAudioElement` mit Blob aus der DB | `currentTime`, interpoliert                |
| `url`     | `HTMLAudioElement` mit Nutzer-URL      | `currentTime`, interpoliert                |
| `youtube` | YouTube-IFrame-Player                  | `getCurrentTime()`, nur bei PLAYING, s. u. |
| `spotify` | Spotify Web Playback SDK (PKCE)        | Player-State `position`, interpoliert      |

**Startfehler:** `play()` unterscheidet zwei Arten von Ablehnung. `PlayRefusedError`
(`src/lib/audio/errors.ts`, auch aus `sources.ts` exportiert) heißt: Der Start wurde ohne
Nutzergeste verweigert, ein Tipp kann ihn nachholen. Datei/URL werfen ihn bei `NotAllowedError`
und `AbortError` von `el.play()`, YouTube nach `YT_PLAY_TIMEOUT_MS`. Vorübergehende Zustände
zählen ebenfalls als verweigert: YouTube-`play()` vor `onReady` und der Spielscreen ohne Quelle. Jede andere Ablehnung ist ein
echter Fehler mit Meldung (Datei/URL z. B. `NotSupportedError`, weil iOS oft erst in `play()`
lädt: dieselbe Meldung wie ein Ladefehler; Spotify: „Spotify konnte den Song nicht starten.“).
Der `GameController` geht nur bei `PlayRefusedError` nach `blocked`; sonst zurück nach
`preparing` und ruft `onPlayError`. Der Spielscreen reicht das an `useAudioClock().reportError`
weiter, das denselben Zustand `error` setzt wie ein Laufzeitfehler (Overlay mit Meldung).
Sync-Test und Editor-Vorschau zeigen nur bei `PlayRefusedError` „Tippe …“, sonst die Meldung.

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
- `play()` löst erst bei PLAYING auf. Ist der Player nach 4 s (`YT_PLAY_TIMEOUT_MS`) nicht im
  Zustand PLAYING, gilt der Start als blockiert (kein Tipp erreichte das Iframe): `play()` wird
  abgelehnt, der `GameController` zeigt `blocked`. Das gilt auch für BUFFERING, weil iOS einen
  verweigerten Start oft als dauerhaftes BUFFERING meldet (Gerätetest 3b: Countdown blieb nach
  einem Reload bei „1“ stehen). Bei BUFFERING wird das Video nicht angehalten; startet es doch
  noch, kommt das als Start von außen an und das Spiel verlässt `blocked` von selbst. Nach einer
  Ablehnung wartet der nächste `play()`-Aufruf ohne Timeout, bis ein erfolgreicher Start den
  Timeout wieder scharf schaltet.
- `seek` vor dem ersten Start (UNSTARTED, CUED, ENDED) wird in `pendingSeekMs` gemerkt und von
  `play()` angewandt, weil `seekTo` ein nie gestartetes Video starten würde (Annahme, am Gerät
  prüfen). Im Pausenzustand (PAUSED) wird direkt gesprungen, ohne zu starten.
- Der Player ist im Spiel sichtbar: Er füllt die Coach-Ecke (Box mindestens 200 × 200 px, Vorgabe
  der YouTube-API; siehe [design.md](design.md)). Sonst `pointer-events-none`; im Zustand
  `blocked` liegt die Box groß in der Bildmitte über der Ebene (`fixed`, `z-40`, goldener Rand) und
  ist antippbar, das Overlay zeigt „Tippe auf das Video, um zu starten.“ und darunter den Knopf
  „Zum Starten tippen“ (Desktop, Tastatur). iOS reicht einen Tipp auf der Seite nicht ins Iframe
  weiter, dort startet nur der Tipp aufs Video. Meldet YouTube danach PLAYING ohne ausstehendes
  `play()`, ruft die Quelle `onExternalStart`, setzt `refusedOnce` zurück und startet den Resync. Ein gemerkter Seek (`pendingSeekMs`, z. B.
  der Start-Offset aus `start()` im Countdown) wird dabei per `seekTo` angewandt, damit der
  Intro-Sprung nicht verloren geht.
  Ob der Tipp aufs Video auf iOS startet, zeigt nur der Gerätetest.
- Pause von außen: Meldet YouTube PAUSED, während die Wiedergabe aktiv ist und kein `play()`
  aussteht (Tipp aufs Video hält an), ruft die Quelle einmal `onExternalPause` und stoppt den
  Resync. Nicht bei BUFFERING oder ENDED und nicht nach eigenem `pause()` (das setzt `active`
  vorher zurück). Das Spiel öffnet dann das Pausemenü (`pause("user")`), Sync-Test und
  Editor-Vorschau stoppen wie mit „Stopp“. Ob iOS beim Tipp PAUSED meldet, zeigt nur der
  Gerätetest.
- Laden: IFrame-API-Skript mit Timeout 15 s (`YT_SCRIPT_TIMEOUT_MS`, nicht zwischengespeichert,
  nächster Versuch lädt neu), danach `onReady` mit Timeout 15 s (`YT_LOAD_TIMEOUT_MS`). Fehlercodes vor `onReady` lehnen `load()` ab, danach lösen sie
  `onError` aus („Dieses Video darf nicht eingebettet werden.“ bzw. „YouTube-Video nicht
  verfügbar.“).

**Spotify** (`SpotifySource`, Web Playback SDK; Anmeldung siehe
[Spotify-Anmeldung](#spotify-anmeldung-etappe-10a); Etappe 10b-1, im Spiel seit 10b-2):

- Laden: Token prüfen (`getSpotifyToken`), SDK-Skript `sdk.scdn.co` mit Timeout 15 s
  (`SPOTIFY_SCRIPT_TIMEOUT_MS`) und `onerror`, Fehlschlag nicht zwischengespeichert. Danach
  `ready` mit Timeout 15 s (`SPOTIFY_READY_TIMEOUT_MS`); `connect()` mit `false`, `account_error`,
  `authentication_error`, `initialization_error` oder `playback_error` vor `ready` lehnen `load()`
  ab, danach lösen sie `onError` aus, ebenso `not_ready` („Die Verbindung zu Spotify ist
  abgebrochen.“). `destroy()` während des Ladens beendet `load()` still.
- Ein Player pro Seitenaufruf (`SharedSpotifyPlayer`): Spiel, Sync-Test und Editor-Vorschau
  teilen ihn. `load()` übernimmt ihn (`acquire`), Ereignisse gehen nur an die aktuelle Quelle;
  `destroy()` hält nur die eigene Wiedergabe an (und nur, solange kein anderer Screen den Player
  übernommen hat) und gibt ihn zurück (`release`), trennt ihn aber nie. Grund (Gerätetest 10c):
  Ein zweiter `Spotify.Player`, der nach `disconnect()` in derselben Seite entstand, ließ sich über
  die Web API nicht mehr starten; nur der erste Screen nach einem Neuladen spielte. Scheitert das
  Verbinden, wird der Player verworfen und der nächste Screen versucht es neu.
- Lehnt die Web API den Start ab, nennt die Meldung den HTTP-Status („Spotify konnte den Song
  nicht starten (HTTP 404).“): 401 Anmeldung, 403 Premium oder Einschränkung, 404 Gerät unbekannt.
- Erster Start: `PUT /v1/me/player/play?device_id=…` mit `uris` und `position_ms`; ein `seek` vor
  dem Start (Start-Offset) wird gemerkt und so mitgeschickt. Spätere Starts nach einer Pause
  setzen per `seek` und `resume()` fort, statt den Song neu zu starten. Ein `seek`, das während
  eines Starts kommt, wird nach der Bestätigung nachgeholt. Ein abgelehnter Start behält den
  gemerkten Seek für den nächsten Versuch.
- `play()` ruft im Tipp `activateElement()` auf (iOS) und löst erst beim ersten Player-Zustand mit
  `paused: false` auf; bis dahin steht die Uhr. `autoplay_failed` oder keine Wiedergabe nach 8 s
  (`SPOTIFY_PLAY_TIMEOUT_MS`, Annahme, am Gerät abstimmen) ergeben `PlayRefusedError`.
  Antwortet die Web API mit einem Fehler: „Spotify konnte den Song nicht starten.“, ohne Netz:
  „Spotify ist nicht erreichbar. Bist du online?“. Kommt die Antwort eines abgebrochenen Starts
  später doch noch, wird nur angehalten, wenn kein neuerer Start offen ist oder läuft.
- Uhr: jeder Player-Zustand gleicht hart ab (`position` plus Wandzeit seit `timestamp`, deshalb
  dort `Date.now()`), beim Spielen alle 500 ms zusätzlich über `getCurrentState()`.
- Ende: Zustand pausiert bei Position 0 mit dem Song in `previous_tracks` (Annahme, am Gerät
  prüfen) löst `onEnded` einmal aus; danach startet `play()` wieder per Web API.
- Pause und Start von außen (andere Spotify-App, Wiedergabe auf ein anderes Gerät verschoben:
  Zustand `null`, `autoplay_failed` mitten in der Wiedergabe): `onExternalPause` bzw.
  `onExternalStart`, wie bei YouTube. Nach Zustand `null` oder einer Wiederverbindung
  (`not_ready`, dann erneut `ready`, evtl. mit neuer `device_id`) startet das nächste `play()` den
  Song wieder per Web API ab der aktuellen Position, weil `resume()` dort ins Leere liefe.
- Ungewollte Wiedergabe wird sofort wieder angehalten, die Uhr bleibt stehen: ein Start, den die
  Web API angenommen hat, der aber vor dem ersten Zustand abgebrochen wurde (Pause, Neustart),
  und stumme Wiedergabe nach `autoplay_failed` bis zum nächsten `play()` im Tipp.
- `play()` ohne laufendes oder erfolgreiches `load()` bzw. nach `not_ready`: echter Fehler
  („Spotify-Player ist nicht bereit.“), kein `PlayRefusedError`, damit das Spiel nicht in einer
  Tipp-Schleife hängt. Nur während `load()` läuft, gilt es als verweigert.
- Die Lautstärke aus `setVolume` vor `load()` wird als Startlautstärke des Players übernommen.
- Tests: `src/test/spotifySource.test.ts` (Fake-SDK, Fake-`fetch`).

**Laufzeitfehler im Spiel:** `useAudioClock` setzt bei `onError` den Zustand `error`; der
Spielscreen zeigt dann, wenn das Spiel schon gestartet war, das Overlay „Die Musik ist
abgebrochen“ (sonst „Die Musik konnte nicht geladen werden“) mit Rückweg zur Bibliothek.

`useAudioClock` ist die einzige Spielzeit:
`timeMs = getTimeMs() − globale Latenz · Rate − song.syncOffsetMs − choreo.offsetMs` (reine Funktion
`gameTimeMs` in `src/lib/audio/clock.ts`). Positive Offsets verschieben die Choreografie also nach
hinten (sie kommt später). Die Rate ist `effectivePlaybackRate(song)` (`src/lib/audio/rate.ts`):
`song.playbackRate ?? 1` für Datei, URL und YouTube, Spotify immer 1. Die Latenz ist Wandzeit und
wird damit in Audiozeit umgerechnet. Bei Songs mit Rate ≠ 1, deren `syncOffsetMs` vorher gemessen
wurde, verschiebt sich die Choreografie um `Latenz · (r − 1)`: klein, bei Bedarf den Sync-Test
wiederholen. `timeMs` behält seine Identität (Offsets über Refs), damit Schleifen
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

**Lautstärke auf iOS:** iOS Safari ignoriert `HTMLMediaElement.volume`. `mediaVolumeIgnored()`
prüft einmal beim ersten Aufruf: iPhone/iPod/iPad laut User-Agent (iPadOS: Mac-UA mit
Touchpunkten) oder ein Wert, der sich nicht zurücklesen lässt. Das Zurücklesen allein reicht
nicht: Ein iPhone 11 meldete 0,5 und spielte trotzdem mit voller Lautstärke (Gerätetest
2026-10-20). Auf solchen Geräten
gibt `claimSharedElement("local")` ein zweites gemeinsames Element zurück, das einmalig über
`createMediaElementSource → GainNode → destination` am gemeinsamen `AudioContext` hängt;
`setVolume` setzt dann den Gain (`musicGainFor`). `unlockAudio()` entsperrt beide Elemente in
derselben Geste. URL-Songs bleiben ungeroutet: Eine fremde URL ohne CORS-Header gäbe über
`MediaElementSource` nur Stille aus (die URL-Quelle verlangt bewusst kein CORS), und das Routing
lässt sich nicht rückgängig machen. Dort und bei YouTube gelten die Lautstärketasten; die
Einstellungen sagen das. Beim gerouteten Element ruft `play()` synchron `ctx.resume()` auf;
läuft der Kontext nach dem Start nicht binnen `CONTEXT_RESUME_TIMEOUT_MS` (500 ms), pausiert die
Quelle und wirft `PlayRefusedError` (Zustand `blocked`, „Zum Starten tippen“), statt die Uhr in
Stille laufen zu lassen. Über Web Audio kann sich die Ausgabelatenz leicht ändern: Sync-Test auf
dem iPhone neu messen.

### Spielablauf

```
preparing ──(Audio geladen, Kamera bereit, Seite sichtbar)──▶ countdown (Vorlauf 2 s, 3-2-1)
countdown ──▶ playing ──(Audio-Ende oder letzter Move + 2,25 s)──▶ ended → /result/$songId
countdown/playing ──(Pause-Knopf, Escape, visibilitychange, Kamera weg)──▶ paused
paused ──Weiter──▶ countdown (3-2-1, ohne Vorlauf) · Neustart ──▶ countdown mit Vorlauf
play() verweigert (PlayRefusedError) ──▶ blocked ──Tipp (Knopf) oder Tipp aufs Video──▶ playing
play() mit anderem Fehler ──▶ preparing + onPlayError (Fehler-Overlay)
playing ──Pause direkt im YouTube-Player (onExternalPause)──▶ paused
Abbrechen im Countdown ──▶ /setup/$songId
```

- `GameController` (`src/lib/game/controller.ts`) hält diesen Ablauf ohne React; er bekommt
  Audio (`play`/`pause`/`seek`), die Uhr (`timeMs`) und die Wertung über Schnittstellen und ist
  mit Fake-Uhr testbar. Ein zweiter Tipp in `blocked` tut nichts, solange das `play()` des ersten
  aussteht. `externalStart()` startet in `blocked` das Spiel; in `preparing`, `countdown` und
  `paused` lief die Musik am Spiel vorbei an und wird wieder angehalten (der Spielzustand gilt,
  das spätere `play()` des Countdowns startet normal); in `playing` und `ended` tut es nichts.
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
  Blitzplan (höchstens 3 pro Sekunde), Piktogramm-Figuren aus Landmarks (`moveFigure`: Landmarks im
  Einheitsraum der Höhe 1 mit Rand `PIKTO.pad`, Sichtbarkeit bleibt erhalten) mit Bewegungspfeilen
  (`selectArrows`) und die feste Coach-Ansicht (`coachView`). Pfeile: Weg von Händen, Knöcheln und
  Hüftmitte zwischen vorigem und diesem Move; ab `PIKTO.arrowMinDist` (0,15 Figurhöhen), höchstens
  `PIKTO.maxArrows` (2, die längsten), als quadratische Kurve vom Rumpf weg gebogen. Gezeichnet wird
  in `src/lib/game/draw.ts` mit `drawFigure` (gleiche Silhouette wie der Coach, Maße in
  `PIKTO_FIGURE`): Rand, Füllung, Pfeile mit dunkler Kontur; Gold mit zusätzlicher breiterer,
  durchscheinender Halo-Silhouette statt `shadowBlur`.
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

| Was                              | Wo                                          | Zugriff                        |
| -------------------------------- | ------------------------------------------- | ------------------------------ |
| Songs inkl. Choreografie         | IndexedDB `dancebeat`, Store `songs`        | `SongRepository`               |
| Audiodateien (auch Tanzvideos)   | IndexedDB, Store `blobs`                    | `SongRepository.getAudio`      |
| Einstellungen                    | `localStorage` `dancebeat.settings`         | `useSettings`                  |
| Gelöschte Demo-Songs (IDs)       | `localStorage` `dancebeat.deletedDemos`     | `seedDemos`, `markDemoDeleted` |
| Version der Demo-Audiodaten      | `localStorage` `dancebeat.demoAudioVersion` | `seedDemos`                    |
| Spotify-Token und PKCE-Verifier  | `sessionStorage`                            | `lib/audio/spotifyAuth.ts`     |
| App-Hülle, MediaPipe-WASM/Modell | Cache Storage `dancebeat-*`                 | Service Worker (`src/sw/`)     |

**SongRepository** (`src/lib/library/repository.ts`) ist die einzige Schnittstelle zur
Bibliothek: `list`, `get`, `save`, `delete`, `getAudio`, `export`, `import`. Vorerst gibt es nur
die IndexedDB-Implementierung; eine Server-Variante kann dieselbe Schnittstelle erfüllen.

**useSongLibrary** (`src/hooks/useSongLibrary.ts`) hält die Song-Liste im TanStack-Query-Cache
unter `SONGS_QUERY_KEY` (`["songs"]`); alle Screens teilen diesen Eintrag. Die Abfrage (Demos
seeden, dann `list()`) läuft einmal pro Seitenaufruf: `staleTime` und `gcTime` unendlich, kein
Neuladen bei Fokus, Reconnect oder Mount, kein Retry. Ein Neuladen mitten im Spiel würde den
Screens neue Song-Objekte geben und Effekte neu auslösen. `save`, `remove` und `updateDetails`
laden die Liste nach dem Schreiben neu und lösen erst auf, wenn die Screens die neue Liste haben;
scheitert nur das Neuladen, bleibt es eine Warnung („Reloading the library failed“), kein
Schreibfehler. Schreibt Code am Hook vorbei (Highscore am Spielende in `GameScreen`), markiert er
den Eintrag per `invalidateQueries` mit `refetchType: "none"` als veraltet; der nächste Mount lädt
neu. Änderungen aus einem anderen Tab erscheinen erst nach einem Neuladen der Seite.
Schlägt das erste `list()` fehl, bleibt `loading` gesetzt; der nächste Screen-Mount versucht es
erneut. Für einen Server ist die Abfragefunktion `loadSongs` die einzige Stelle zum Tauschen.

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
  Demos zurück. Ändert sich die Synthese hörbar, wird `DEMO_AUDIO_VERSION` erhöht: der nächste
  Seed ersetzt bei vorhandenen Demos einmalig nur das Audio (`save` mit dem unveränderten
  gespeicherten Song), danach steht die Version in `localStorage` `dancebeat.demoAudioVersion`.
- `src/lib/library/storage.ts`: `requestPersistentStorage()` (Safari löscht sonst Daten nicht
  installierter Seiten nach 7 Tagen ohne Nutzung) und `getStorageUsage()` für die Anzeige.

### Song hinzufügen und Choreografie exportieren

- `AddSongDialog` (Tabs Datei, URL, YouTube, Spotify) baut den Song über die reine Funktion
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
- Choreografie: automatisch (`autoChoreo`, Farbpaar zufällig aus `SONG_PALETTES`), Import
  einer Exportdatei (`parseChoreoFile`) oder aus einem Tanzvideo (siehe
  [Video-Import im Dialog](#video-import-im-dialog-etappe-8c)). Beim Import gelten BPM, Sync- und Start-Offset der Datei
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
| 3          | Migration der Songs auf Choreografie-Format v2 (optional `pose3d`)          |

## Externe Abrufe

Kamerabilder verlassen das Gerät nie. Folgende Abrufe gehen trotzdem ins Netz und müssen in der
UI benannt werden (die Gegenstelle sieht dabei die IP-Adresse):

| Was                            | Von                                   | Wann                                      |
| ------------------------------ | ------------------------------------- | ----------------------------------------- |
| YouTube-IFrame-API (Skript)    | www.youtube.com                       | YouTube-Song im Spiel laden; in der       |
| YouTube-Player, Video          | www.youtube-nocookie.com              | Aufstellhilfe benannt                     |
| Spotify-SDK, Login, Wiedergabe | sdk.scdn.co, accounts/api.spotify.com | Spotify-Song laden                        |
| Audio-URL                      | vom Nutzer eingegebene Adresse        | in der Aufstellhilfe mit Hostname benannt |

Sync-Test und Choreografie-Editor (Karte „Vorschau“, Etappe 8d-2b) laden dieselben Quellen
(YouTube-Skript und -Player, Audio-URL) beim Öffnen und nennen sie dort ebenfalls.

Der Dialog „Song hinzufügen“ ruft selbst nichts ab, nennt aber schon beim Anlegen den Host der
Audio-URL bzw. youtube-nocookie.com als spätere Gegenstelle, im Tab Spotify sdk.scdn.co,
accounts.spotify.com und api.spotify.com. Der Spotify-Link wird mit `parseSpotifyTrackUri`
(`newSong.ts`) zur URI `spotify:track:<ID>`: nur Songs (open.spotify.com bzw.
play.spotify.com `/track/…`, auch mit `/intl-xx/`, oder die URI selbst), keine Alben, Playlists
oder nackten IDs. Fehlt die Spotify-Verbindung (`spotifyStatus()`), zeigt der Tab einen Hinweis;
anlegen geht trotzdem. BPM und Länge wie bei URL und YouTube von Hand.

**Pose-Erkennung ohne externe Abrufe (Etappe 7b-1):** MediaPipe-WASM-Laufzeit und Pose-Modell
kommen von der eigenen Adresse der App (`<base>mediapipe/wasm/…`,
`<base>mediapipe/models/pose_landmarker_<lite|full>.task`, siehe `src/lib/mediapipe.ts`).

- WASM: `vite-plugins/mediapipeWasm.ts` liefert die Dateien im Dev-Server direkt aus
  `node_modules/@mediapipe/tasks-vision/wasm` aus und kopiert sie beim Build nach
  `dist/mediapipe/wasm/`. JS und WASM passen damit immer zur installierten Paketversion; die
  frühere Versionskonstante samt Test entfällt. Nicht im Repo.
- Modell: `scripts/fetch-models.ts` (`bun run fetch-models`, automatisch vor `dev`, `dev:https`,
  `build`, `build:dev`) lädt die Modelle „lite“ (5,8 MB) und „full“ (9 MB, nur für „Genau“ im
  Video-Import, Etappe 8g-4b) einmalig von fest versionierten Google-URLs nach
  `public/mediapipe/models/` (gitignored) und prüft SHA-256 (`scripts/models.ts`). Ohne Netz und
  ohne vorhandene Datei bricht der Build mit Meldung ab. „heavy“ müsste dort und in
  `SHIPPED_MODELS` erst ergänzt werden.
- Das Hosting muss `.wasm` als `application/wasm` ausliefern (`vite preview` tut das).
- **Telemetrie gesperrt:** `@mediapipe/tasks-vision` 1.1.1 hat einen fest eingebauten Logger
  (kein Schalter in der API), der Nutzungsdaten (Task-Typ, Modus, OS-Klasse, Latenzen, Version;
  keine Bilder) alle 60 s und beim `close()` an `odml.pa.googleapis.com/v1/log` schickt.
  `vite-plugins/csp.ts` setzt deshalb in `index.html` eine CSP; `connect-src` erlaubt nur
  `'self' blob: data:`, `https://accounts.spotify.com` (Token-Tausch, Etappe 10a) und
  `https://api.spotify.com` (Play-Aufruf), Dev zusätzlich `ws: wss:` für HMR. Der Logger
  scheitert und stoppt sich; Chrome meldet das als zwei Konsolenfehler („violates the following
  Content Security Policy directive“). Diese Fehler sind erwartet und gelten nicht als Fehler aus
  eigenem Code. Gilt nur für von Vite ausgelieferte `index.html` (dev, build, preview).
- **Vollständige CSP (Security-Audit, Oktober 2026):** Die Skripte von YouTube und Spotify laufen
  im Origin der App, also neben Kamera, IndexedDB und Spotify-Token. Die Policy begrenzt deshalb
  alle Kanäle, über die sie oder ein eingeschleustes Skript etwas laden oder senden könnten:
  `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'` (MediaPipe-WASM) plus
  `www.youtube.com` und `sdk.scdn.co` (Dev zusätzlich `'unsafe-inline'` für die
  React-Refresh-Präambel); `frame-src` nur `www.youtube-nocookie.com` und `sdk.scdn.co`;
  `img-src 'self' blob: data:`; `font-src 'self' data:`; `style-src 'self' 'unsafe-inline'`
  (Inline-Styles von Framer Motion und Radix); `media-src 'self' blob: data: https:` plus
  `http://localhost:*` und `http://127.0.0.1:*` (wie `validateAudioUrl`; `[::1]` lässt sich in
  CSP nicht ausdrücken); `worker-src 'self' blob:`; `object-src 'none'`; `base-uri 'self'`;
  `form-action 'self'`.
  Grenzen: `media-src` bleibt für https offen (Audio-URLs), Navigationen lassen sich per CSP
  nicht sperren, und ein erlaubtes Skript kann immer mit seinem eigenen Host sprechen. Die CSP
  schützt also vor Abflüssen an Dritte, nicht vor YouTube oder Spotify selbst. Als Meta-Tag
  wirken `frame-ancestors` und Reporting nicht; die müsste beim Hosting ein HTTP-Header setzen.
  Jeder neue fremde Host braucht einen Eintrag dort und in `src/test/csp.test.ts`.

### Spotify-Anmeldung (Etappe 10a)

`src/lib/audio/spotifyAuth.ts`, Authorization Code mit PKCE, ohne Client-Secret und ohne Backend.
Die Client-ID trägt der Nutzer in den Einstellungen ein (Abschnitt „Spotify“, `settings.spotifyClientId`,
32 Hex-Zeichen); dort stehen auch die einzutragende Redirect-URI (`<origin><BASE_URL>spotify-callback`),
der Hinweis „Premium nötig“, die angesprochenen Hosts und der Status.

- Redirect nur über HTTPS oder `http://127.0.0.1` / `http://[::1]`, nie `localhost`
  (`checkRedirectOrigin`; Spotify lehnt `localhost` ab). Sonst ist „Verbinden“ gesperrt und ein
  Hinweis erscheint. Für den Desktop-Test die App also über `http://127.0.0.1:5173` öffnen.
- `spotifyLogin` legt Verifier und `state` in `sessionStorage` ab und springt zu
  `accounts.spotify.com/authorize`. `/spotify-callback` (`SpotifyCallbackScreen`) ruft einmal
  `spotifyExchange` auf: Verifier und `state` werden vorher gelöscht (Erfolg oder nicht),
  `state` muss passen; danach ersetzt die Route sich durch `/settings` (Code bleibt nicht in der
  Historie). Fehler (abgelehnt, falscher `state`, Tausch gescheitert) zeigt die Route mit Link
  zu den Einstellungen.
- Token-Satz `{accessToken, refreshToken?, expiresAt, clientId}` liegt unter
  `dancebeat.spotify.token` nur in `sessionStorage` (endet mit dem Tab). `getSpotifyToken()`
  erneuert ihn 60 s vor Ablauf per `refresh_token` (gleichzeitige Aufrufe teilen eine Anfrage).
  Scheitert das, wird der Token gelöscht und die Meldung „Die Spotify-Anmeldung ist abgelaufen.
  Bitte in den Einstellungen neu verbinden.“ geworfen. `spotifyStatus()`: `disconnected`,
  `connected`, `expired`.
- `SpotifySource` holt den Token nur noch über `getSpotifyToken()` (auch im `getOAuthToken`
  des SDK). Abspielen im Spiel seit 10b-2, im Sync-Test und in der Editor-Vorschau seit 10c.
  Schlägt Laden oder Start eines Spotify-Songs fehl, zeigen alle drei zusätzlich „Zu den
  Einstellungen“ (dort verbinden bzw. neu verbinden).

Alle Abrufe sind im Aufstellhilfe-Screen als Datenschutzhinweis benannt
(`src/components/setup/PrivacyNote.tsx`; W12): immer „Kamerabilder verlassen dein Gerät nie“
und dass die Erkennung vollständig auf dem Gerät läuft, bei YouTube-Songs zusätzlich YouTube
(Skript von youtube.com, Video über youtube-nocookie.com), bei URL-Songs der Hostname der
Adresse, bei Spotify-Songs Spotify (Skript von sdk.scdn.co, accounts.spotify.com,
api.spotify.com); jeweils mit dem Hinweis, dass die Gegenstelle die IP-Adresse sieht. Der Sync-Test
(`/sync/$songId`) startet keine Kamera; er nennt per `PrivacyNote camera={false}` nur den Abruf
der Songquelle (YouTube, Host der Audio-URL bzw. Spotify, bei lokalen Dateien nichts). Ebenso
die Vorschau im Choreografie-Editor (`/edit/$songId`, Etappe 8d-2b).

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
  Die gespeicherte Kamera ist ein Wunsch, keine Bedingung: Startet sie nicht (abgesteckt, eine
  Continuity-Kamera, die macOS noch listet, die aber nicht erreichbar ist, belegt), fällt die App
  auf die Standardkamera zurück und zeigt einen Hinweis. Nur Berechtigungsfehler
  (`isPermissionError`) lösen keinen Rückfall aus. Die gespeicherte ID bleibt erhalten, damit
  ein kurzer Aussetzer die Wahl nicht kostet; gelöscht wird sie erst, wenn die Kamera auch in
  `enumerateDevices` fehlt. Die Kamera-Auswahl wird auch angeboten, wenn gar keine Kamera
  startet; dieselbe Kamera erneut zu wählen startet einen neuen Versuch.
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

## Video-Import

`src/lib/videoChoreo.ts` (Etappe 8a, reine Logik ohne React): `choreoFromPoseTrack` macht aus
einer rohen Pose-Spur (`PoseTrack`: Seitenverhältnis plus Proben `{ timeMs, landmarks | null }`,
Landmarks pro Achse normiert wie MediaPipe sie liefert) eine geprüfte `Choreography`. Seit
Etappe 13c trägt jede Probe optional auch `world` (`Landmark3d[] | null`: MediaPipe-Weltpunkte
derselben Person in Metern, Ursprung Hüftmitte, y nach unten, z von der Kamera weg; Schema
`Landmark3dSchema` in `schema.ts`). Fehlt das Feld, hat die Analyse keine Weltpunkte geliefert.
`landmarks` und `angles` der Choreografie entstehen weiter nur aus den 2D-Landmarks; seit 13d
bekommt etwa jeder zweite Frame aus den Weltpunkten zusätzlich `pose3d`. Die
Pose-Spur entsteht aus der Analyse (`useVideoAnalysis`, siehe unten) und der Wahl der
Zielperson (`trackTarget`, siehe [Zielperson](#zielperson-etappe-8f)). Ablauf und Konventionen:
[choreography-format.md](choreography-format.md#video-import).

- Glättung: One-Euro-Filter je Koordinate, vorwärts und rückwärts gerechnet und gemittelt. Die
  Analyse läuft offline; ein einseitiger Filter würde die Referenzposen hinter den Beat
  verschieben. Werte `minCutoff` 2 Hz, `beta` 40, `dCutoff` 1 Hz (seit 8g-5, gemessen an echten
  Videos; vorher 1 / 10), Neustart nach Lücken über 250 ms. Messung:
  [choreography-format.md](choreography-format.md#standardwerte-aus-der-messung-etappe-8g-5).
  Weltpunkte (x, y, z) laufen seit 13c durch denselben Filter mit denselben Werten und Regeln
  (unsichere Punkte unverändert, Neustart nach Lücken und Proben ohne `world`); die 2D-Werte
  bleiben dabei unverändert.
- `suggestGoldMoves` ist eigenständig exportiert, damit der Editor (8d-1, `suggestGold`)
  den Vorschlag wiederverwendet.
- Fehlermeldungen sind deutsch, weil der Import-Dialog sie direkt zeigt.

### Video-Analyse (Etappe 8b)

`src/lib/videoAnalysis.ts` (`analyzeVideo`, ohne React) erzeugt die `PoseTrack` aus einem
geladenen, pausierten `<video>`; `src/hooks/useVideoAnalysis.ts` kapselt Zustand und Aufräumen.

- Schrittweise statt Abspielen: Das Video wird alle `intervalMs` (Standard 50 ms) per
  `currentTime` gesetzt, nach `seeked` läuft `detect`. So hängt das Ergebnis nicht von der
  Rechenleistung ab, und kein Bild wird übersprungen. Die Probenzeit ist die Videozeit; den
  Zuschnitt auf den Zeitbereich übernimmt `choreoFromPoseTrack`.
- Safari zeigt nach `seeked` mitunter noch das alte Bild. Gibt es `requestVideoFrameCallback`,
  wird zusätzlich auf den Bild-Callback gewartet, höchstens 120 ms nach `seeked`
  (`FRAME_FALLBACK_MS`). Ein verspätetes Bild des vorigen Seeks zählt nicht: `mediaTime` muss
  höchstens `max(intervalMs/2, 40 ms)` vom Ziel abweichen. Jeder Seek hat ein Timeout (Standard
  5 s); Listener, Timer und Callbacks werden auf jedem Weg entfernt.
- Für versteckte oder nicht eingehängte Videos feuert der Bild-Callback nie; jeder Schritt kostet
  dann 120 ms. Der Import-Dialog (8c) muss das Video sichtbar im DOM halten.
- Zeitstempel für `detect` steigen streng, auch wenn ein Estimator mehrere Analysen nacheinander
  macht (der nächste Lauf wird hinter den letzten Zeitstempel verschoben). Der Hook nimmt ohnehin
  pro Lauf einen neuen Estimator.
- Abbruch über `AbortSignal` (`AbortError`), Fehler als `VideoAnalysisError` mit `code`
  (`no-metadata`, `seek-timeout`, `video-error`, `empty-range`). Fortschritt höchstens alle
  250 ms; der Hook setzt nur dann State, nie pro Bild.
- Modell: Standard „lite“ (Entscheidung 8b); über die Option `model` wählbar, seit 8g-4b auch
  „full“ (siehe [Modellwahl](#modellwahl-schnell--genau-etappe-8g-4b)).
- Ein Lauf überschreibt nie den Zustand eines neueren; Abbruch, Neustart und Unmount schließen
  den Estimator sofort.

### Video-Import im Dialog (Etappe 8c)

„Song hinzufügen“ hat als dritte Choreografie-Option „Aus Video“. Die Musik kommt weiter aus
den Quell-Tabs (Datei, URL, YouTube, Spotify) oder, im Tab Datei, aus dem Tanzvideo selbst
(siehe [Musik aus dem Tanzvideo](#musik-aus-dem-tanzvideo-etappe-8h-1)).

- **Zeitannahme:** Videozeit = Audiozeit. Video und Musik sind dieselbe Aufnahme bzw. derselbe
  Song ab Sekunde 0. Der Sync-Test gleicht nur Abweichungen bis zu einem halben Beat aus
  (`wrapToBeat` rechnet modulo Beatlänge); ist das Video um einen ganzen Beat oder mehr
  verschoben, passt der Takt, aber die Moves liegen trotzdem falsch.
- Der erste Move kann weniger als einen Beat nach dem Musikstart liegen (Bereichsstart plus
  Phase). Das ist vorerst so akzeptiert; der Editor (8d) kann ihn entfernen.
- `VideoChoreoPanel` (`src/components/add-song/`) hält Datei, Vorschau, Zeitbereich, Spiegeln,
  Beat-Phase und die Analyse (`useVideoAnalysis`) selbst und meldet nur das fertige Ergebnis
  (`VideoImportResult` oder `null`) an den Dialog. Speichern geht erst mit Ergebnis.
- Reine Logik in `src/lib/library/videoImport.ts`: `validateVideoRange` (Start < Ende,
  mindestens 2 s, höchstens 10 min, nicht hinter dem Videoende), `parseBeatPhaseMs` und
  `buildVideoChoreo` (ruft `choreoFromPoseTrack`, verschiebt `offsetMs` um den Bereichsstart,
  liefert `startOffsetMs` und Statistik: Moves, Gold Moves, Anteil der Proben mit Person).
  `buildNewSong` übernimmt BPM und Offsets der Choreografie, vergibt neue IDs, setzt Titel und
  das Farbpaar aus dem Formular.
- Vorschau: `<video playsInline muted controls>` aus einer Objekt-URL; sie wird bei neuer Datei,
  beim Wechsel der Option und beim Schließen des Dialogs freigegeben. Das Video wird nicht
  gespeichert. Die Vorschau muss während der Analyse sichtbar bleiben (Bild-Callback, siehe 8b):
  Beim Start wird sie ins Bild gescrollt, solange die Analyse läuft, klebt sie (`sticky`) oben im
  scrollenden Dialog, auf höchstens 35 dvh verkleinert (Querformat), mit Fortschritt und
  „Abbrechen“ direkt darunter. Ihre Bedienelemente sind dann ausgeblendet. Grenze: `sticky` wirkt
  nur innerhalb des Panels; scrollt man ganz nach unten zu Titel und Künstler, kann die Vorschau
  oben herauslaufen.
- Start und Ende in Sekunden (Komma oder Punkt, `parseVideoSeconds`, geprüft gegen die
  Videolänge), „Ab hier“ / „Bis hier“ übernehmen die Vorschauzeit. Standard ist das ganze Video,
  bei längeren Videos die ersten 10 Minuten; der Abschnitt selbst darf höchstens 10 Minuten
  lang sein, auch weiter hinten im Video. Eine Bereichsänderung nach der
  Analyse macht das Ergebnis ungültig (Hinweis, neu analysieren). BPM, Beat-Phase und Spiegeln
  rechnen dagegen nur aus der vorhandenen Pose-Spur neu.
- Die Länge des Songs entfällt im Video-Modus (sie ergibt sich aus dem Bereich), BPM bleibt
  Pflicht.
- Während Laden und Analyse hält `useWakeLock` den Bildschirm an. Schließen des Dialogs hängt
  das Panel aus; der Hook bricht die Analyse dabei ab und schließt das Modell.
- „Takt erkennen“ (Etappe 8e) setzt die Beat-Phase. Quelle ist die Hüllkurve der Musikdatei,
  wenn der Tab Datei aktiv und analysiert ist (`musicBeat`, ohne erneutes Dekodieren), sonst die
  Tonspur des Videos (`analyzeAudio` auf der Videodatei, höchstens 250 MB und 15 Minuten, weil Datei und
  dekodierte Samples ganz in den Speicher müssen). Aus dem Video kommt auch eine BPM-Schätzung;
  der Dialog übernimmt sie nur ohne Musikdatei und solange BPM nicht von Hand geändert wurde
  („Geschätzt, bitte prüfen.“). Die erkannte Phase ist abgeleitet: Sie folgt BPM und Bereich,
  bis man das Feld selbst ändert. Lässt sie sich gerade nicht berechnen (Musikdatei weg, BPM oder
  Bereich ungültig), bleibt das Feld leer mit Hinweis, statt still auf einen alten Wert
  zurückzufallen. Die Phase darf bis zu 1 h betragen (`BEAT_PHASE_MAX_MS`), weil sie hinter dem
  Bereichsstart liegt. Den BPM-Rückruf liest der Dialog mit dem aktuellen Tab (Ref), nicht dem beim
  Klick. Fehler (zu groß, Ton nicht lesbar, kein Takt) melden sich mit
  dem Hinweis, die Phase von Hand einzutragen. Ein neues Video verwirft ein laufendes oder
  fertiges Ergebnis aus dem alten.
- Datenschutz: Das Panel nennt, dass das Video auf dem Gerät bleibt und die Erkennung ohne
  externe Abrufe läuft (Modell von der eigenen Adresse, siehe [Externe Abrufe](#externe-abrufe)).

### Musik aus dem Tanzvideo (Etappe 8h-1)

Im Tab Datei erscheint mit „Aus Video“ der Schalter „Musik aus dem Tanzvideo“. Ist er an, ist
die Videodatei zugleich die Audiodatei des Songs: Ein MP4 (etwa per yt-dlp) reicht, und
Videozeit = Audiozeit gilt exakt statt nur angenommen.

- Kein Formatwechsel: Die Quelle bleibt `local` mit `blobId`; im Store `blobs` liegt das ganze
  Video. `ElementSource` spielt es über `new Audio()` ab, Browser spielen den Ton von MP4 und MOV
  so ab (iOS am Gerät prüfen). Der Hinweis nennt die Größe, die das Video in der Bibliothek
  belegt; ein volles Kontingent meldet `StorageFullError` wie bei Audiodateien.
- Vorbelegung: an, wenn beim Wechsel auf „Aus Video“ noch keine Audiodatei gewählt ist, sonst
  aus. Ist er an, verschwindet das Feld „Audiodatei“; die gewählte Audiodatei bleibt im
  Hintergrund und kommt beim Ausschalten zurück.
- Der Dialog analysiert das Video wie eine Audiodatei (`analyzeAudio`: BPM, Länge, Hüllkurve).
  Die Hüllkurve geht als `musicBeat` an das Panel, „Takt erkennen“ dekodiert also nicht noch
  einmal und nennt „dem Ton des Videos“ als Quelle (Prop `musicFromVideo`). Das Panel meldet die
  gewählte Datei über `onVideoFile`.
- Gelesen wird das Video erst, wenn der Tab Datei aktiv ist (`syncMusic`): bei URL, YouTube oder
  Spotify ist sein Ton nicht die Musik, und das Dekodieren kostet Zeit und Speicher. Analysiert
  wird nur, wenn sich die Musikdatei wirklich ändert (`analyzedMusic`); eine neuere Analyse
  gewinnt über eine langsamere ältere (`analysisToken`).
- Grenze wie bei „Takt erkennen“: höchstens 250 MB (`VIDEO_BEAT_MAX_BYTES`), weil Datei und
  dekodierte Samples ganz in den Speicher müssen. Größere oder nicht lesbare Videos melden sich
  mit dem Hinweis, die Musik als Audiodatei zu wählen. Die Länge prüft der Dialog nicht (er
  liest das Video, bevor die Vorschau sie kennt); ein sehr langes, stark komprimiertes Video kann
  wie eine sehr lange Audiodatei viel Speicher brauchen.
- Nach dem Ausschalten ist das Dateifeld leer (es wird neu eingehängt); die zuvor gewählte
  Audiodatei gilt weiter und steht als „Musik: <Name>“ darunter.
- Das Video im Spiel als Vorlage zeigen: siehe
  [Tanzvideo im Spiel](#tanzvideo-im-spiel-etappe-8h-2a).

### Tanzvideo im Spiel (Etappe 8h-2a)

Ist die Musik eines Songs ein Tanzvideo (8h-1), zeigt das Spiel das Video stumm im Platz des
Coachs statt der Strichfigur.

- **Erkennung ohne Formatwechsel:** nur bei Quelle `local`; der Spielscreen lädt den Blob über
  `songRepository.getAudio(blobId)` und zeigt ihn, wenn `blob.type` mit `video/` beginnt
  (IndexedDB behält den Typ). Kein neues Feld am Song, keine Version. Eine Audiodatei
  (`audio/*`) behält den Coach.
- Eigenes `<video muted playsInline preload="auto">` mit eigener Objekt-URL, die beim Verlassen
  des Spiels und beim Songwechsel freigegeben wird. Die Musik läuft weiter über das gemeinsame
  Audio-Element; das Video hat keinen Ton. State ändert sich nur beim Laden und bei einem
  Fehler, nie pro Frame.
- **Zielzeit:** `Videozeit = Spielzeit + choreo.offsetMs` (`videoTargetMs`, nie negativ). Das
  Video folgt der Choreografie, nicht der Audioposition: Gezeigt werden soll die Bewegung, die
  gerade bewertet wird, wie beim Coach. Latenz und `syncOffsetMs` verschieben die Choreografie
  gegen die Musik; das Video wandert mit. Bei Video-Importen ist `choreo.offsetMs`
  Bereichsstart plus Beat-Phase, das Video steht also an der analysierten Stelle. Die
  Wiedergaberate ist `effectivePlaybackRate(song)`.
- **Nachführen** (`videoSyncStep`, `src/lib/game/videoSync.ts`, reine Logik) in der
  vorhandenen rAF-Schleife über Refs: In der Phase „playing“ läuft das Video von selbst und
  wird nur bei mehr als 150 ms Abweichung (`VIDEO_SYNC_TOLERANCE_MS`) per Seek korrigiert. In
  allen anderen Phasen (Vorbereitung, Countdown, Pause, blocked, Ende) ist es pausiert und steht
  auf der Zielzeit, ebenfalls mit Seek nur über der Toleranz. Seeks werden gedrosselt: keiner,
  solange einer läuft (`video.seeking`), und frühestens 500 ms nach dem letzten
  (`VIDEO_SEEK_COOLDOWN_MS`, gemessen am rAF-Zeitstempel, der nur drosselt und nie Spielzeit
  ist). Am Videoende (`video.ended`, auch bei unbekannter Länge) wird nie `play()` gerufen, es
  würde zurückspulen; vor dem Videostart (Ziel 0) wartet es auf dem ersten Bild.
- **Seek-Vorlauf:** Ein Handy braucht nach einem Seek oft länger als die Toleranz zum
  Dekodieren und landet sonst jedes Mal hinter dem Ziel (Ruckeln alle 500 ms). Die Schleife misst
  deshalb die Dauer des letzten Seeks (vom Setzen von `currentTime` bis `seeking` wieder aus ist,
  rAF-Zeitstempel) und zielt während „playing“ um diese Dauer voraus (`seekLeadMs`, höchstens
  1000 ms, `MAX_SEEK_LEAD_MS`; außerhalb von „playing“ 0).
- **play() mit Rückhalt:** kein zweiter Aufruf, solange ein `play()`-Promise offen ist; nach
  einer Ablehnung frühestens nach 2 s erneut (`VIDEO_PLAY_RETRY_MS`), bei einem Phasenwechsel
  sofort. Bis dahin steht das Standbild. `playbackRate` und `defaultPlaybackRate` folgen der
  Rate.
- **Nicht gespiegelt:** `mirrorChoreo` tauscht nur links und rechts in den Daten; der Coach
  entspricht dem Originalbild, das Video also auch. Gespiegelt wird nur das Kamerabild.
- **Layout:** Kasten unten links für Querformat-Videos, `object-contain` auf dunklem Grund,
  `rounded-2xl`; Hochformat `w-[min(64vw,50dvh)] h-[min(36vw,28dvh)]`, Querformat
  `w-[min(40vw,75dvh)] h-[min(23vw,42dvh)]` (so hoch wie der Coach, breiter). Hochkant-Videos
  erscheinen darin schmal.
- **Fallback:** Fehler-Ereignis des Videos (Codec, defekte Datei) → wieder der Coach, einmalig.
  Lädt der Blob nicht, bleibt es beim Coach.
- **Einstellung** „Tanzvideo zeigen“ (`danceVideo`, Standard an; alte gespeicherte Einstellungen
  bleiben gültig) in den Einstellungen unter Anzeige und im Pausenmenü; dort nur, wenn der Song
  ein Video hat. Aus: Coach wie bisher.

### Modellwahl Schnell / Genau (Etappe 8g-4b)

Über der Schaltfläche „Video analysieren“ wählt man das Pose-Modell: „Schnell“ = MediaPipe
`pose_landmarker_lite` (Standard, wie bisher), „Genau“ = `pose_landmarker_full`. Die
Live-Erkennung der Kamera bleibt immer bei „lite“.

- Das Panel gibt die Wahl als `model` an `useVideoAnalysis().start` weiter, der Hook an die
  Schätzer-Fabrik. Während der Analyse ist die Wahl gesperrt; sie wird nicht gespeichert und
  steht beim nächsten Öffnen wieder auf „Schnell“.
- Das Modell gehört wie der Zeitbereich zur Analyse: Das Panel merkt sich beim Start Bereich
  und Modell; weicht die aktuelle Wahl ab, ist das Ergebnis veraltet („Das Modell hat sich
  geändert. Bitte das Video neu analysieren.“) und Speichern gesperrt. Zurück auf das
  analysierte Modell gilt das Ergebnis wieder, ohne neue Analyse.
- Die Zusammenfassung nennt das benutzte Modell („Modell: Genau.“).
- „full“ (ca. 9 MB) kommt wie „lite“ von der eigenen Adresse (`scripts/models.ts`, fest
  versionierte URL und SHA-256, kein neuer externer Abruf) und landet erst beim ersten Laden im
  MediaPipe-Cache des Service Workers. Hinweis im Panel: „Beim ersten Mal werden ca. 9 MB
  geladen.“
- Die Dev-Rohdaten (`*.posetrack.json`) enthalten das Modell (Feld `model`, optional; ältere
  Exporte ohne Feld bleiben lesbar und stammen von „lite“), der Dateiname bekommt die Endung
  `-lite`/`-full`, das Tuning-Skript nennt das Modell in der Überschrift je Video. So lassen sich
  „lite“ und „full“ am selben Abschnitt vergleichen.
- Standard bleibt „lite“, bis Messungen am Gerät (Dauer, Speicher, Erkennungsquote) etwas
  anderes nahelegen.

### Haltepunkt-Moves (Etappe 8g-4c)

Unter „Modell“ wählt „Moves“ die Platzierung (`movePlacement` in `VideoChoreoOptions` und
`VideoImportOptions`): „Fester Takt“ (`"grid"`, alle 2 Beats) oder „Haltepunkte“
(`"holds"`, Standard seit 8g-5 über `DEFAULT_MOVE_PLACEMENT`, je Fenster von 2 Beats der Beat, an dem die Pose am ruhigsten ist; Regeln in
[choreography-format.md](choreography-format.md#video-import)). Höchstens ein Move je
Fenster, etwa so viele wie beim festen Takt.

- Die Wahl rechnet nur aus der vorhandenen Analyse neu, wie Spiegeln und Zielperson; sie macht
  das Ergebnis nicht veraltet. Während der Analyse ist sie gesperrt, gespeichert wird sie
  nicht. Die Zusammenfassung nennt sie („Moves: Haltepunkte.“).
- Kennzahl `moveMotionDegPerS` in `trackMetrics`: mittlere Bewegung an den Moves in °/s
  (`poseMotionAt`, ±¼ Beat). Niedriger = Moves auf klareren, gehaltenen Posen. Die Dev-Diagnose
  zeigt sie als „Bewegung an den Moves“.
- Dev-Rohdaten enthalten `movePlacement` (optional, alte Exporte ohne Feld = „grid“),
  `importOptions` gibt es weiter.
- Standard ist seit 8g-5 „Haltepunkte“ (Messung:
  [choreography-format.md](choreography-format.md#standardwerte-aus-der-messung-etappe-8g-5));
  der Dialog startet damit, „Fester Takt“ bleibt wählbar.

### Zielperson (Etappe 8f)

Tanzen mehrere Personen im Video, wählt man nach der Analyse, wessen Bewegungen übernommen
werden. Logik in `src/lib/targetPerson.ts` (ohne React).

- Die Video-Analyse erkennt bis zu 3 Personen je Probe (`VIDEO_MAX_POSES`, MediaPipe
  `numPoses`; `PoseEstimator.detectAll`). `analyzeVideo` liefert eine `MultiPoseTrack`
  (`{ timeMs, poses }` je Probe, `poses` leer = niemand erkannt). Das Live-Spiel bleibt bei
  einer Person.
- Weltpunkte (Etappe 13c): Hat der Estimator `detectAllWorld` (MediaPipe), nimmt `analyzeVideo`
  diese Methode und legt je Probe zusätzlich `worlds` ab, parallel zu `poses` (gleicher Index =
  gleiche Person, `null` wenn MediaPipe für diese Person keine liefert). Sonst `detectAll`, sonst
  `detect`; dann fehlt `worlds`. Die Personenwahl rechnet nur mit den 2D-Posen; `trackTarget`
  übernimmt die Weltpunkte der gewählten Pose als `world` in die `PoseTrack`. Das Live-Spiel
  (`detect` in `usePoseTracking`) bekommt keine Weltpunkte, erst ab Etappe 16.
- `trackTarget` macht daraus die `PoseTrack` für `choreoFromPoseTrack`: Ab der gewählten Probe
  vorwärts und rückwärts nimmt es je Probe die Pose, deren Rumpfmitte (Mittel der sichtbaren
  Schultern und Hüften, in Bildhöhen, x mit dem Seitenverhältnis) der letzten bekannten Mitte
  am nächsten liegt, aber nur innerhalb einer Sprunggrenze. Die Grenze wächst mit der Zeit,
  seit die Person zuletzt gesehen wurde: `0,12 + 0,6 × Sekunden`, höchstens `0,5` Bildhöhen
  (Startwerte, am Gerät prüfen). Sonst bleibt die Probe leer; eine andere Person wird nie
  eingesetzt. Die Reihenfolge, in der MediaPipe die Personen meldet, spielt keine Rolle.
- Es zählen nur Personen mit sichtbarem Rumpf (mindestens eine Schulter oder Hüfte). Mehrere
  Personen gelten erst, wenn mindestens 5 Proben und mindestens 5 % der Proben mit Pose zwei
  oder mehr solche Personen haben (`MIN_MULTI_SAMPLES`, `MIN_MULTI_RATIO`, Startwerte). Eine
  einzelne Fehlerkennung schaltet also nicht um.
- Vorauswahl (`defaultTarget`): die erste Probe, mit der 3 aufeinanderfolgende Proben mit den
  meisten Personen beginnen (gezählt wird das Minimum der drei, eine einmalige Zusatzerkennung
  zählt nicht), ersatzweise die erste Probe mit zwei Personen; dort die größte Person (längere
  Seite des Rahmens um die sichtbaren Punkte).
- Oberfläche: Nach der Analyse und nur bei mehr als einer Person zeigt `VideoChoreoPanel`
  „Mehrere Personen erkannt“ mit einem Standbild (Canvas: Vorschaubild der Probe, alle
  Skelette nummeriert von links nach rechts, die Gewählte gold, die anderen gedimmt), Antippen
  wählt (`pickPoseAt`). Dazu Knöpfe „Person 1 … N“ (`aria-pressed`). „Aktuelles Bild“ zeigt die
  Probe an der Vorschauposition, etwa wo die Personen gut getrennt stehen. Die Wahl rechnet nur
  aus der vorhandenen Analyse neu, wie BPM und Spiegeln; eine neue Analyse beginnt wieder mit
  der Vorauswahl. Die Zusammenfassung nennt „Person k von N“.
- Das Standbild wird einmal je Probe gegriffen: Die Vorschau springt kurz zur Probe und danach
  an die vorige Stelle zurück, damit „Ab hier“/„Bis hier“ keine fremde Position lesen. Hat man
  inzwischen selbst gespult, gilt das Bild nicht und die eigene Position bleibt.
- Ohne Mehrpersonen-Modus ist das Ergebnis genau wie vor 8f (erste Pose oder
  `null`, ohne Sprunggrenze), und es erscheint keine Auswahl.
- Grenzen: Ohne Bewegungsmodell kann der Abgleich beim Kreuzen auf gleicher Höhe oder nach einer
  längeren Verdeckung neben einer anderen Person (näher als 0,5 Bildhöhen) die Person
  wechseln. Die Nummern gelten je Standbild; nach „Aktuelles Bild“ können sie anders lauten. Die
  Analyse mit `numPoses` 3 kann länger dauern als mit 1.

### Diagnose im Dev-Modus (Etappe 8g-2)

Nur hinter `import.meta.env.DEV` zeigt `VideoChoreoPanel` unter der Zusammenfassung den Kasten
„Diagnose (nur Dev-Modus)“ (`VideoImportDiagnostics`), damit der Import an echten Videos messbar
wird:

- Kennzahlen aus `trackMetrics` (`src/lib/videoChoreo.ts`), mit denselben Optionen wie der
  Import: Erkennungsquote, Moves gegenüber Rasterpunkten, Zittern roh und geglättet (mittlere
  Änderung der Winkeländerung von Probe zu Probe in Grad; echte Bewegung ist glatt und trägt
  wenig bei, Erkennungsrauschen überwiegt), Holdout-Fehler (siehe unten), BPM und Beat-Phase
  sowie die Dauer der Analyse (Uhrzeit, keine Spielzeit).
- Holdout-Fehler: Jede zweite Probe wird weggelassen, der Rest geglättet, und die weggelassenen
  Rohwinkel werden aus den Nachbarn vorhergesagt (mittlerer Fehler in Grad). Das Rauschen der
  Rohwerte trägt bei jeder Filtereinstellung etwa gleich viel bei; deshalb liegt die Einstellung
  mit dem kleinsten Wert nahe an der echten Bewegung, ohne dass es eine Wahrheit braucht. Zu
  wenig Glättung behält das Rauschen, zu viel schneidet echte Bewegung ab. Auf synthetischen
  Spuren lag die so gewählte Einstellung höchstens etwa 0,6° über der wirklich besten. Eine
  einfachere Summe aus Zittern und Abweichung vom Rohwert wurde verworfen: Sie bevorzugte
  starke Glättung auch bei schnellen Moves.
- „Rohdaten exportieren“ lädt `*.posetrack.json` herunter (`src/lib/poseTrackFile.ts`, Format
  `dancebeat-pose-track` v2, mit zod geprüft): die Spur der Zielperson und die Einstellungen
  des Dialogs (BPM, Beat-Phase in Videozeit, Bereich, Spiegeln, Dateiname, seit 8g-4b optional
  das Pose-Modell, seit 8g-4c optional die Move-Platzierung). Version 2 (13c) ergänzt je Probe
  optional `world` (Weltpunkte, auf 4 Nachkommastellen gerundet, also 0,1 mm); v1-Dateien
  bleiben lesbar, dürfen aber kein `world` enthalten. Die Datei enthält
  nur Landmarks, keine Bilder, und gehört nicht zur Bibliothek. `importOptions` rechnet sie in
  dieselben Optionen um, die `buildVideoChoreo` an `choreoFromPoseTrack` gibt. So lässt sich
  das Feintuning ohne neuen MediaPipe-Lauf wiederholen.

### Tuning-Skript (Etappe 8g-3)

`bun run tune-video <a.posetrack.json> [b.posetrack.json …]` (`scripts/tune-video-choreo.ts`,
Logik in `scripts/tuning.ts`) rechnet für jede Datei ein Raster aus One-Euro-`minCutoff`
(Standard 0,5/1/2/4/8), `beta` (2/10/20/40/80) und `maxGapMs` (150/250/400) durch und gibt je Video
eine Tabelle nach Holdout-Fehler aus (Zittern, Moves je Rasterpunkte, Parameter; die aktuellen
Standardwerte sind markiert). Bei mehreren Dateien folgt die mittlere Wertung über alle Videos;
Einstellungen, die an einem Video scheitern, fallen dort heraus. Raster per Komma-Liste
änderbar: `--min-cutoff`, `--beta`, `--max-gap`, `--beats-per-move`, `--placement` (`grid`,
`holds`; Standard `holds`), dazu `--top` (Zeilen je Tabelle, Standard 10). Die Spalte „Bew. °/s“
zeigt `moveMotionDegPerS`; die Platzierung ändert den Holdout-Fehler nicht und wird über diese
Spalte verglichen. Laufzeit etwa 2 s je
Minute Video beim Standardraster. Neue Standardwerte vor dem Übernehmen im Spiel gegenprüfen.

## Choreografie-Editor (Etappe 8d-1)

Route `/edit/$songId` (`src/routes/edit/$songId.tsx`, gleicher Aufbau wie der Sync-Test), Einstieg
über „Choreografie bearbeiten“ im Dialog „Song bearbeiten“. `ChoreoEditorScreen`
(`src/components/editor/`) arbeitet auf einer lokalen Arbeitskopie des Songs; die Bibliothek
ändert sich erst mit „Speichern“ (`save` aus `useSongLibrary`, also `SongRepository`).
Nach dem Speichern geht es zurück zur Bibliothek. „Verwerfen“ setzt die Kopie nach einer Rückfrage
zurück. Wer mit ungespeicherten Änderungen geht (Knopf „Zurück“, Browser- oder Android-Zurück,
Links), bekommt dieselbe Rückfrage (`useBlocker` von TanStack Router), beim Neuladen warnt der
Browser (`beforeunload`).

- Reine Logik in `src/lib/choreoEditor.ts` (unveränderlich, ohne React): `deleteMove`
  (mindestens `MIN_MOVES` = 2), `toggleGold`, `suggestGold` (nutzt `suggestGoldMoves`),
  `shiftOffset` (ganze ms, ±10 s um den gespeicherten Wert, kein Move vor Musikzeit 0), `beatLengthMs`, `setTempo` (1× entfernt
  `playbackRate`), `supportsTempo` (Datei, URL und YouTube), `isEdited` (Speichern/Verwerfen nur bei Änderungen), `prepareSave`.
- Etappe 8d-2a: `shiftMove`/`canShiftMove` (Move um ½ oder 1 Beat verschieben) und
  `insertMoveAfter`/`canInsertAfter` (Move nach dem gewählten einfügen, liefert den neuen Index),
  geprüft über eine gemeinsame Hilfsfunktion: sortiert, `MIN_MOVE_GAP_MS` (300 ms,
  Spielbarkeit; überlappende Bewertungsfenster sind unkritisch) zu beiden Nachbarn, innerhalb der Frames mit brauchbarer Zielpose
  (`poseUsableAt` aus `videoChoreo.ts`, gleiche Regel wie der Import, Lookup per `frameAt` wie im
  Scorer), nicht vor Musikzeit 0; Zeiten auf 0,1 ms gerundet. Eingefügt wird in der Mitte, gerastet
  auf k · Beatlänge in Choreografie-Zeit. Ungültiges wird abgelehnt (gleiches Objekt); der Screen
  sperrt die Knöpfe und nennt die Gründe. Die Pose eines Moves wird aus den Frames interpoliert,
  neue Pose-Daten sind nicht nötig. `isEdited` vergleicht auch `label` und `iconId`.
- Timeline: waagerecht scrollende Move-Karten mit Piktogramm (Silhouette und Pfeile) der Referenzpose
  (Figuren aus `createMoveFigureCache`, unveränderte Moves behalten ihre Figur, sodass nur geänderte
  Karten neu zeichnen; `drawMoveFigure` auf Canvas, gezeichnet nur bei Änderung, kein rAF), Zeit in
  Musikzeit (`move.timeMs + offsetMs`, ohne Latenz und Sync-Offset), Gold-Markierung.
- Der Offset verschiebt die Moves gegen die Musik; die Geräteverzögerung bleibt Sache des
  Sync-Tests (`syncOffsetMs`). Spotify ignoriert das Tempo; der Editor sperrt die Tempo-Knöpfe dort und
  nennt den Grund. YouTube setzt die Rate per `setPlaybackRate` (N10); bietet das Video sie nicht
  an, scheitert das Laden mit Hinweis statt still mit 1× zu spielen. Bestätigt der Player per
  `onPlaybackRateChange` eine andere Rate, setzt die Quelle sie einmal neu und meldet sonst einen
  Laufzeitfehler (`onError`); ein Tipp aufs Video startet danach nicht mehr.
- Keine Kamera. Kein Formatwechsel (siehe
  [choreography-format.md](choreography-format.md#editor)).
- Etappe 8d-2b, Karte „Vorschau“ (`src/components/editor/EditorPreview.tsx`, unter der Timeline):
  „Abspielen“ (ab `startOffsetMs`, wie der Sync-Test) bzw. „Stopp“, „Ab Move N abspielen“ (zwei
  Beats vor dem gewählten Move, umgerechnet mit `audioTimeMs` und denselben Offsets wie im Spiel,
  nie vor `startOffsetMs`; während der Wiedergabe nur ein Seek), Anzeige „Musikzeit“ und Schalter
  „Klick bei jedem Move“ (an, nicht gespeichert). Quelle über `useAudioClock` mit dem geteilten
  Audio-Element; `seek` und `play()` laufen synchron im Tipp (iOS, YouTube). YouTube zeigt den
  Player sichtbar (mindestens 200 × 200 px) und meldet einen blockierten Start („Tippe direkt auf
  das Video“, `onExternalStart`). Spotify spielt seit Etappe 10c wie im Spiel; `play()` läuft
  im Tipp, damit `activateElement()` die Geste bekommt.
  - Eine rAF-Schleife liest Moves und Offsets der Arbeitskopie über Refs; Änderungen (Offset,
    Verschieben, Einfügen, Löschen, Gold) wirken also sofort ohne Neustart. Pure Logik in
    `src/lib/editorPreview.ts`: `previewStartAudioMs`, `currentMoveIndex`, `dueMoves`,
    `tickTimeMs`, `scrollIntoBoxDelta`.
  - Zwei Zeitachsen: Die Markierung folgt der Spielzeit (`timeMs()` aus `useAudioClock`, mit
    Latenz, `syncOffsetMs` und `choreo.offsetMs`), wie die Piktogramme im Spiel. Der Klick ist
    selbst Audio und hat dieselbe Ausgabeverzögerung wie die Musik; er folgt deshalb der
    Audioposition minus `choreo.offsetMs` (`tickTimeMs` = Spielzeit + Latenz · Rate + Sync-Offset) und
    sitzt direkt auf der Musik.
  - Klick: `dueMoves` liefert die Moves mit `prev < timeMs ≤ jetzt`. Nach Start oder Seek beginnt
    das Intervall knapp vor dem Ziel (`SEEK_TICK_EPSILON_MS`), ein Move genau am Startpunkt klickt
    also. Nach einer Offset-Änderung, bei einem Rücksprung oder einem Schritt über
    `TICK_MAX_GAP_MS` (250 ms) klickt nichts, damit übersprungene Moves keine Klicksalve auslösen.
    Normaler Move `sfx.click`, Gold Move `sfx.beep(true)`; `resumeSfx()` im Start-Tipp weckt den
    AudioContext. Der Klick kommt im nächsten Frame nach der Move-Zeit (bis etwa ein Frame
    später). Der Schalter „Klick bei jedem Move“ liegt im Editor und übersteht den Tempo-Wechsel.
  - Aktueller Move: Der Editor bekommt den Index per `onNow` nur bei Änderung (kein setState pro
    Frame), markiert die Karte (`aria-current`, Songfarbe mit Glow, getrennt von Auswahl und Gold)
    und scrollt die Timeline waagerecht nach (`scrollBy`, bei `prefers-reduced-motion` ohne
    Animation).
  - Angezeigte Zeit: Spielzeit plus `choreo.offsetMs`, also dieselbe Musikzeit wie bei den Move-Karten
    (ohne Latenz und Sync-Offset). Klickt ein Move, steht dort seine Zeit. Geschrieben per
    `textContent`, nicht über React.
  - Start: Solange `play()` aussteht, zeigt die Karte „Stopp“ (ein später erfülltes `play()`
    wird wieder pausiert); bei YouTube bleibt nach einer Ablehnung der Hinweis „Tippe direkt auf
    das Video“ beim nächsten Versuch stehen.
  - Tempo: `playbackRate` wird beim Anlegen der Quelle festgelegt. Der Editor rendert die Vorschau
    mit `key` = Tempo, ein Tempo-Wechsel stoppt also und baut die Quelle mit dem neuen Tempo neu.
  - Stopp bei `visibilitychange` (verborgen), am Songende (`onEnded`) und beim Verlassen (der Hook
    zerstört die Quelle). Wake Lock während der Wiedergabe.
  - Externe Abrufe: Die Quelle lädt beim Öffnen des Editors; die Karte nennt sie per
    `PrivacyNote camera={false}` (Host der Audio-URL bzw. YouTube/youtube-nocookie.com).

## Messwerte

Aus dem Diagnosefeld der Aufstellhilfe (Zahnrad-Symbol), Erkennung mit Modell „lite“. Ziel:
mehr als 25 FPS. Werte trägt der Nutzer nach.

| Gerät | Browser | FPS   | Inferenzzeit (ms) | Delegate |
| ----- | ------- | ----- | ----------------- | -------- |
| _TBD_ | _TBD_   | _TBD_ | _TBD_             | _TBD_    |

## BPM-Schätzung und Beat-Phase

`src/lib/beat.ts`: `onsetEnvelope` liefert den positiven Energiefluss in Schritten von ganzen
Samples (≈ 10 ms, `hopMs` exakt, sonst driftet die Zeitachse bei 22 050 Hz um 2,3 ms pro Sekunde).
BPM: Autokorrelation der ersten 90 s über 70–180 BPM. Die Schleife summiert nur Terme, deren
gerundete Indizes existieren; `src/test/beat.test.ts` vergleicht das mit der früheren
Implementierung auf synthetischen Klick-Tracks. `analyzeAudio` dekodiert die Datei einmal
(Decoder für Tests austauschbar) und liefert BPM (auf 0,1 verfeinert, 30–300), Länge und die
Hüllkurve der ganzen Datei (100 Werte pro Sekunde). `quantize` rastet Zeiten auf Beats ein.

Verfeinerung (Etappe 8g-4a): Die Autokorrelation liefert nur ganze BPM und liegt auf Klick-Tracks
bei hohen Tempi bis knapp 2 BPM zu tief (ganzzahlige Lags, 10 ms statt `hopMs` angenommen).
`refineBpm(env, grob)` probiert `grob ± 3` BPM in Schritten von 0,02 und bewertet jeden Kandidaten
mit einem phasenkohärenten Kammfilter über die ersten 300 s der Hüllkurve (exaktes `hopMs`, jede
Phase in Hüllkurvenschritten, Mittelwert des Onsets auf dem Raster, Nachbarschritte halb
gewichtet, beste Phase zählt). Über eine lange Strecke läuft ein leicht falsches Tempo vom Raster
weg, deshalb ist das Maximum scharf. Sieger ist die Mitte des Plateaus der Kandidaten innerhalb
von 2 % des besten Werts, auf 0,1 gerundet; liegt die nächste ganze Zahl ebenfalls innerhalb der
2 %, gewinnt sie, damit echte ganzzahlige Tempi exakt bleiben. Bei kurzen Ausschnitten (ca. 20 s)
ist das Maximum flach, dort rastet z. B. 127,9 auf 128 ein. Stille, ungültige Eingabe, ein
Maximum ohne Kontrast (bester Wert unter dem 1,5-Fachen des Medians aller Kandidaten; abseits des
Tempos liegen Klick-Tracks bei 2,5–3,6 × dem mittleren Onset, am Tempo bei 10–50 ×) oder ein
Plateau am Rand des Suchbereichs (grobe Schätzung mehr als 3 BPM daneben): die grobe BPM, also
das Verhalten vor 8g-4a. Das
BPM-Feld im Formular nimmt beliebige Kommawerte an (`step="any"`, sonst blockiert der Browser das
Absenden mit eigener Meldung) und rundet auf 0,1. Laufzeit bei 5 min Hüllkurve in Node unter 0,1 s. Messung (Klick-Track 123,4 BPM,
180 s): letzter Beat 0 ms neben dem echten Raster statt 2064 ms mit der groben Schätzung 122
und 585 ms mit der besten ganzen Zahl 123.

`estimateBeatPhaseMs(env, bpm, fromMs)` (Etappe 8e) probiert jede Phase in Hüllkurvenschritten
und summiert den Onset auf dem Beat-Raster (Kammfilter, Nachbarschritte halb gewichtet). Es
schaut nur 10 s ab `fromMs` an und gewichtet frühe Beats stärker, weil auch die verfeinerte BPM
nicht exakt ist (0,1 BPM daneben driftet bei 128 BPM um ~8 ms in 10 s, eine misslungene
Verfeinerung mit 1 BPM daneben um ~80 ms); so bleibt die Phase am Abschnittsanfang in den Tests
unter 50 ms. Ergebnis: erster Beat ab `fromMs` (ganze ms) oder `null` (Stille,
weniger als zwei Beats im Fenster). Die Feinabstimmung bleibt dem Sync-Test überlassen.

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
[scoring.md](scoring.md#sync-test-pro-song)), `/edit/$songId` (Choreografie-Editor, siehe
[oben](#choreografie-editor-etappe-8d-1)), `/settings`, `/spotify-callback` (Rücksprung der
Spotify-Anmeldung, siehe [Spotify-Anmeldung](#spotify-anmeldung-etappe-10a)).

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
    Modell „lite“, plus 9 MB „full“ erst nach einer Analyse mit „Genau“). Der Name hängt am Inhalt
    aller Dateien unter `mediapipe/` (WASM und Modelle), nicht an der App-Version: ein reines
    App-Update behält den Cache, ein MediaPipe-Update oder ein neues Modell legt einen neuen an.
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
- **Vercel:** Projekt `cool-joule/dancebeat`, Produktion unter
  `https://dancebeat.berger-labs.com` (CNAME bei Porkbun auf den Vercel-Wert aus
  `vercel domains verify`; Nameserver bleiben bei Porkbun, die Hauptdomain `berger-labs.com` ist
  davon unabhängig). Push auf `main` deployt automatisch in Produktion, andere Branches als
  Preview. Spotify-Redirect-URI: `https://dancebeat.berger-labs.com/spotify-callback`.
  IndexedDB, Einstellungen und Service Worker gelten pro Origin; die `vercel.app`-Adresse hat
  eine eigene, getrennte Bibliothek. `vercel.json` setzt Install (`bun install --frozen-lockfile`), Build
  (`bun run build`, lädt die Modelle auf dem Build-Server per `prebuild`) und Ausgabe `dist/`.
  Rewrite aller unbekannten Pfade auf `index.html` (vorhandene Dateien haben Vorrang).
  Header: `Content-Security-Policy: frame-ancestors 'none'` (geht als Meta-Tag nicht; mehrere
  Policies gelten gemeinsam, die Meta-CSP bleibt maßgeblich), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `no-cache` für `index.html`, `sw.js` und das Manifest, `immutable` für
  `/assets/`, `application/wasm` für `.wasm`. `.vercelignore` hält bei `vercel deploy`
  `Rohdaten/`, Pose-Spuren, Medien, Modelle und `dist/` vom Upload fern. Vercel sieht als Hoster
  die Seitenabrufe (IP-Adresse), keine Kamera- oder Bibliotheksdaten. Die Vercel-Toolbar auf
  Preview-Deployments blockiert die CSP (`vercel.live`); sie lässt sich in den
  Projekteinstellungen abschalten.
