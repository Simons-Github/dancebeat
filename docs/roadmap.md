# Roadmap

Kleine, einzeln testbare Etappen. Jede Etappe endet mit grünem typecheck, test, lint und build
und einem eigenen Commit. Befundkennungen (K…, W…, N…) siehe [Offene Befunde](#offene-befunde).

Status: ✅ erledigt · 🔜 als Nächstes · ⏳ geplant

## Übersicht

| Etappe                                       | Status                              | Empfohlenes Modell                                                    |
| -------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| 1. Navigation, Layout, Menü, Song-Bibliothek | ✅                                  | Sonnet                                                                |
| 2. Aufstellhilfe                             | ✅                                  | Sonnet                                                                |
| 3. Gameplay                                  | ✅ (Gerätetest offen)               | Opus                                                                  |
| 4. Ergebnis-Screen und Highscores            | ✅                                  | Sonnet                                                                |
| 5. Einstellungen, Sync-Test, Song hinzufügen | ✅ (Gerätetest offen)               | Sonnet für Formulare und Dialoge, Opus für Sync-Test und Kalibrierung |
| 6. Bewegungsmodus                            | ✅ (Gerätetest offen)               | Sonnet                                                                |
| 7. PWA und Gerätefunktionen                  | ✅ (Gerätetest offen)               | Sonnet                                                                |
| 8. Tanz aus Video erstellen                  | ⏳ (8a–8f, 8g-2–4d, 8h-1, 8h-2a ✅) | Opus                                                                  |
| 9. Typen und Lint                            | ✅                                  | –                                                                     |
| 10. Spotify                                  | ✅ (Gerätetest offen)               | Opus                                                                  |
| 11. Nice-to-have                             | ⏳                                  | je nach Punkt                                                         |
| 12. Coach und Piktogramme                    | ✅ (Gerätetest offen)               | Sonnet                                                                |
| 13. 3D-Kern und Choreo-Generator             | ⏳ (13a–13e-2, 13f-1, 13g ✅)       | Opus für Kern, Format, Generator und AIST++, Sonnet für den Rest      |
| 14. Neue Demo-Songs                          | ⏳                                  | Opus für den Songaufbau, Sonnet für den Rest                          |

## Erledigt: Grundlagen

✅ Umstieg auf reines Vite + TanStack Router (kein TanStack Start, normale `index.html`).
✅ K1 Seitenverhältnis in der Winkelberechnung · K2 Aufräumen von Kamera und Landmarker ·
K3 Mindestabdeckung beim Scoring.
✅ W1 vorzeichenbehaftete Winkel, kürzester Bogen · W2 `mirrorChoreo`.
✅ Choreografie-Format v1 mit zod, `SongRepository`, IndexedDB-Migration, Export/Import-Logik,
Speicher-Helfer (W11 teilweise), Repository-Tests mit `fake-indexeddb`.
✅ W4 (Etappe 2): kein `setState` pro Frame, Video-Frame-Callback, Kamera-Fehlerfälle.
✅ SDK-Typen, Lint sauber · Quick Fixes (URL ohne CORS-Zwang, Lautstärke live, W8 teilweise) ·
Combo-Regel (OK hält, X bricht).
✅ W3 (Etappe 3a): `seekTo` ohne Wertung, Soll-Winkel pro Move vorberechnet, Reset bei
Choreo-Wechsel. N4: Soundeffekte nutzen den beim Tippen entsperrten gemeinsamen `AudioContext`.
W9 teilweise: `type` als Union, Lade-Race beim Songwechsel, `ended`/`error` zurückgesetzt,
`visibilitychange` → Pause.
✅ N12 (Etappe 5): Aufstellhilfe im Querformat scrollt, Karte nicht mehr unter der Kopfzeile.
✅ N3 (Etappe 5b): Seed-Regel prüft die Bibliothek, gelöschte Demos bleiben weg.
✅ N7, N13, N15 (Etappe 11a): `effectivePlaybackRate(song)` (nur Datei und URL, sonst 1) für Spiel, Sync-Test und
Editor-Vorschau; die Latenz wird mit der Rate skaliert (`latency · rate`), der Beat-Puls begrenzt nach `bpm × rate`.
✅ W11 (Etappe 5a, 5c): Settings mit zod geprüft, Persistenz-Anfrage beim Anlegen, `StorageFullError`
verständlich angezeigt.
✅ N8, N9, N16 (Etappe 11b): `YT_LOAD_TIMEOUT_MS` statt fester Zahl; `PlayRefusedError` trennt
verweigerten Start (`blocked`) von echten Startfehlern (Fehler-Overlay über `onPlayError` und
`reportError`); `onExternalPause` meldet Pause direkt im YouTube-Player (Spiel → Pausemenü,
Sync-Test und Editor-Vorschau stoppen), `externalStart()` hält Musik außerhalb von `blocked` wieder
an; ein Start von außen wendet den gemerkten Seek (Start-Offset) an. Vorübergehende Startfehler
(YouTube vor `onReady`, keine Quelle) bleiben per Tipp nachholbar; das Spiel zeigt „Die Musik
startet nicht“. Gerätetest offen: (1) Meldet iOS beim Tipp aufs Video PAUSED? (2) Meldet YouTube
bei `seekTo` während der Wiedergabe kurz PAUSED (Editor „Ab Move“ könnte auf Stopp springen)?
(3) Enges Rennen: Wieder-Anhalten per `externalStart()` im Countdown gegen ein `play()`, das den
Kurzweg „schon PLAYING“ nimmt.
✅ N10 (Etappe 11c): YouTube spielt mit `song.playbackRate` (`effectivePlaybackRate` jetzt für
Datei, URL und YouTube, nur Spotify bleibt 1×). `YouTubeSource` setzt die Rate bei `onReady` und
erneut vor `playVideo()` und bei PLAYING, falls der Player eine andere meldet; die Uhr läuft im
gleichen Tempo. Bietet das Video die Rate nicht an (`getAvailablePlaybackRates`), scheitert das
Laden mit Hinweis; eine leere Liste gilt als unbekannt. Meldet der Player per
`onPlaybackRateChange` eine andere Rate, wird sie einmal neu gesetzt, danach bricht die Musik mit
demselben Hinweis ab (sonst liefe die Uhr bis ~0,3 s daneben); ein Tipp aufs Video startet dann
nicht mit 1×. Der Editor sperrt das Tempo nur noch bei Spotify. Achtung: YouTube-Songs mit schon
gespeichertem `playbackRate` (z. B. per Import) spielen jetzt in diesem Tempo, Werte außerhalb der
YouTube-Liste (z. B. 0,8) laden nicht mehr. Gerätetest offen: wendet YouTube die Rate auf iOS an,
meldet `getAvailablePlaybackRates` vor dem ersten Start die Liste (bei `[1]` scheitert jeder
YouTube-Song mit Tempo)?
✅ N14 (Etappe 11d): Der Editor baut Strichfiguren nicht mehr bei jeder Änderung neu.
`createMoveFigureCache` (`pikto.ts`) behält die Figur eines Moves, solange `frames` und die Zeiten
von Move und Vorgänger gleich bleiben; Gold umschalten zeichnet keine Karte neu.
✅ Lautstärke am iPhone (Etappe 11e): iOS ignoriert `media.volume`. Auf solchen Geräten laufen
Datei-Songs über ein zweites, per Web Audio geroutetes Element (`GainNode`), der Regler wirkt
über den Gain; URL-Songs bleiben ungeroutet (CORS), dafür ein Hinweis in den Einstellungen. Läuft
der `AudioContext` nach dem Start nicht, gilt der Start als blockiert („Zum Starten tippen“).
Gerätetest offen: Regler am iPhone mit Datei-Song hörbar? Übersteuerung weg? URL-Song nach einem
Datei-Song in derselben Sitzung noch hörbar? Rückkehr aus Hintergrund/Sperrbildschirm → „Zum
Starten tippen“ oder spielt? Sync-Test-Offset im Vergleich zu vorher?
Gerätetest 2026-10-20 (iPhone 11): Regler ohne Wirkung, Hinweis fehlte. Das Gerät liest
`volume` = 0,5 zurück, wendet es aber nicht an. **Nachgebessert:** Erkennung zusätzlich über den
User-Agent (iPhone/iPod/iPad, iPadOS über Touchpunkte). Gerätetest offen.
✅ Demo-Ton am iPhone (Etappe 11f): Die Demo-Synthese übersteuerte (Kick, Bass und Hi-Hat
zusammen über 1, hart geclippt), fast die ganze Energie lag im Tiefbass (Kick bis 40 Hz, Bass bei
49/55 Hz), den Handy-Lautsprecher nicht wiedergeben, und die 8-kHz-Rechteck-Hi-Hat erzeugte
Aliasing. Neue Mischung: Kick 180→55 Hz mit kurzem Anstieg, Bass eine Oktave höher durch Tiefpass
(1,2 kHz), Hi-Hat als hochpassgefiltertes Rauschen (6,5 kHz). `encodeWav` normiert auf
`DEMO_PEAK` (−6 dBFS), Clipping ist damit ausgeschlossen. Schon gespeicherte Demos bekommen über
`DEMO_AUDIO_VERSION` (Marker `dancebeat.demoAudioVersion`) einmalig neue Audiodaten; Songdaten
(Highscore, Sync-Offset, Änderungen) bleiben. Gerätetest 2026-10-20 (iPhone 11): Regler wirkt,
nicht mehr übersteuert, Bass aber zu stark. **Nachgebessert (Audio-Version 3):** Hochpass 150 Hz
auf der ganzen Mischung, Kick kürzer und höher (220→90 Hz, leiser), Bass zwei Oktaven über dem
Grundton. Gerätetest danach: am iPhone weiter dumpf und verrauscht, die Höhen fehlen (am MacBook
hörbar). Verdacht: iOS rechnet die 22,05-kHz-WAV auf dem Web-Audio-Weg schlecht um.
**Audio-Version 4:** Demos mit 48 kHz (ca. 5,8 MB pro Minute). Gerätetest offen: klingt die Demo
am iPhone klar, und klingt eine eigene MP3 im Spiel gleich gut wie außerhalb der App?
✅ W5, W9 (Rest) (Etappe 3b): YouTube-Uhr nur bei PLAYING, `onError` in `AudioSource`.
W7 (sichtbarer Player, Seek im Pausenzustand, Feld entfernt, Tipp aufs Video startet), iOS am
Gerät offen. W10: Code erledigt (Uhr hält bei `waiting`), iOS am Gerät offen.
✅ W12 (Etappe 2, 3b, 7b-1): externe Abrufe in der UI benannt; MediaPipe-WASM und Pose-Modell
kommen seit 7b-1 von der eigenen Adresse, der Hinweis nennt sie nicht mehr.
✅ N6, N11 (Etappe 11g): `useSongLibrary` liest die Bibliothek über TanStack Query (ein Eintrag
`SONGS_QUERY_KEY` für alle Screens). Seed und `list()` laufen einmal pro Seitenaufruf statt bei
jedem Screen-Wechsel; Schreiben lädt die Liste danach neu, ein Fehler dabei bleibt eine Warnung.
Der Highscore-Schreibzugriff am Spielende markiert die Liste als veraltet (sonst zeigte die
Bibliothek den alten Highscore).
Rückgabe des Hooks unverändert, keine Screen-Änderungen. `index.html` ist Prettier-konform. Kein
Gerätetest nötig.

## Etappen

### 1. Navigation, Layout, Menü, Song-Bibliothek ✅

- Routen unter `src/routes`: Bibliothek als Startseite, Aufstellhilfe, Einstellungen (kein eigenes Startmenü).
- Bibliothek mit den zwei Demo-Songs: große Cover-Kacheln, ausgewählter Song vergrößert,
  Hintergrund wechselt weich auf die Songfarbe. Pro Song Titel, Künstler, BPM, Schwierigkeit
  (1–3 Flammen), Highscore, Sterne.
- Theme aus `src/theme.ts`, ruhiger Hintergrund (statisch, eine langsame Drift der Formen), Safe Areas.
- Schrift Fredoka selbst hosten (Paket `@fontsource/fredoka` nur nach Freigabe).
- Test: Routen-Matching, Bibliothek rendert Demo-Songs.

Umgesetzt: Routen `/`, `/setup/$songId`, `/settings`, 404; Bibliothek mit Karussell, Banner und
„Song hinzufügen“-Platzhalter; Fredoka lokal. Die Bibliothek bleibt Startseite (kein eigenes
Startmenü). Platzhalter für Spiel und Ergebnis entfallen; die Screens kommen mit Etappe 3 und 4.
Löschen und Umbenennen wanderten nach Etappe 5. Außerdem: Kontrastkorrektur (dunkle Tönung,
Test in `src/test/contrast.test.ts`), zuletzt gewählter Song wird gemerkt, Highscore mit Pokal und
aria-label, Peek der nächsten Kachel im Hochformat, Dev-Server nur lokal außer `dev:https`.
Browser-Prüfung per Playwright (390x844 und 844x390) erledigt. **Offen:** Prüfung am Gerät.

### 2. Aufstellhilfe ✅

- Kurze Erklärung, Kamera-Berechtigung, Live-Bild mit Silhouetten-Rahmen und Pose-Overlay auf
  Canvas. „Los geht's“ erst aktiv, wenn Schultern, Hüften, Knie und Knöchel erkannt werden.
- Hinweise: Kamerabilder verlassen das Gerät nie; beim Start der Kamera werden Erkennungsmodell und
  Laufzeit von jsDelivr und Google geladen (IP-Adresse wird übertragen, keine Bilder) (W12).
- Fehlermeldungen: Kamera verweigert, keine Kamera, Kamera belegt, Körper nicht sichtbar,
  schlechtes Licht, Beine fehlen.
- **Pose-Schnittstelle:** Erkennung hinter einer Schnittstelle kapseln (umgesetzt; MoveNet
  entfällt nach dem Handy-Test).
  **FPS- und Inferenzzeit-Anzeige** zum Vergleich auf dem Handy.
- W4: kein `setState` pro Frame (Overlay per Callback auf Canvas), `requestVideoFrameCallback`
  statt 33-ms-Drossel, `NotReadableError`/`OverconstrainedError` (veraltete Kamera-ID →
  Standardkamera).

Umgesetzt: Route `/setup/$songId` (Erklärung, „Kamera starten“ per Tippen, gespiegeltes Bild mit
Zielrahmen und Skelett auf Canvas, Statuszeilen, Hinweise, Kamera-Auswahl, Diagnosefeld,
Datenschutzhinweis) und Platzhalter `/play/$songId`. `PoseEstimator`-Schnittstelle mit
MediaPipe-Implementierung („lite“); `usePoseTracking` neu auf Video-Frame-Callback und
`onFrame`; Körper-Check (1 s durchgehend, `src/lib/bodyTracker.ts`); Kamerafehler auf Deutsch
(`src/lib/cameraErrors.ts`). Vitest-Tests für Körper-Check, Fehlerzuordnung, Aufräumen, Hook und
Screen. Handy-Test bestanden: MediaPipe läuft flüssig, **MoveNet entfällt** (keine zweite
`PoseEstimator`-Implementierung, keine TF.js-Abhängigkeit). Messwerte stehen in
[architecture.md](architecture.md#messwerte) (vom Nutzer nachzutragen).

### 3. Gameplay ✅ (Gerätetest offen)

**3a Kern (Demo-Songs, lokale Audioquelle) – umgesetzt, Gerätetest offen.**

- Route `/play/$songId`: Vollbild ohne App-Kopf, Hoch- und Querformat, Safe Areas. Lädt den Song
  über `useSongLibrary`/`SongRepository` und das Audio über `createSource`.
- Audio-Entsperrung für iOS (`src/lib/audio/unlock.ts`): Der Tipp auf „Kamera starten“ (und
  „Los geht's“) spielt auf einem gemeinsamen Audioelement eine stille WAV an und weckt den
  gemeinsamen `AudioContext`. Der Song spielt später über genau dieses Element. Wird `play()`
  trotzdem abgelehnt: „Zum Starten tippen“.
- Auto-Start: Rastet die Aufstellhilfe ein, wechselt sie ins Spiel; dort laufen Vorlauf
  („Bereit machen!“, 2 s, deckt den Kamera-Neustart ab) und 3-2-1, zusammen ca. 5 s. „Abbrechen“
  führt zur Aufstellhilfe und setzt den Auto-Start für diesen Song aus, bis „Los geht's“ getippt
  wird (sonst Endlosschleife). Schalter folgt in Etappe 5.
- Ablauf ohne React in `GameController` (`src/lib/game/controller.ts`): Countdown, Spielen,
  Pause (Knopf, Escape, `visibilitychange`, Kameraverlust), Weiter mit 3-2-1, Neustart, Ende,
  „blocked“. Ende nach Audio-Ende oder letztem Move + 2,25 s; Weiterleitung zu `/result/$songId`
  (Platzhalter, Endstand aus `src/lib/game/session.ts`).
- Bewertung: `Scorer` (`src/lib/scorer.ts`) mit `seekTo`, vorberechneten Zielwinkeln und Schutz
  gegen ungültige Zeiten; Proben alle ≥ 100 ms Spielzeit; Winkel gehören zum Aufnahmezeitpunkt
  des Bildes (Details in [scoring.md](scoring.md)). Hinweis „Wir sehen dich nicht“ nach 2,5 s ohne
  Pose.
- Oberfläche: gespiegeltes Kamerabild mit Songfarbfilter (20 %) und Vignette, Skelett auf Canvas
  (abschaltbar im Pausenmenü), Piktoleiste (Canvas, 4 s Vorschau, Blitz an der Marke höchstens
  3-mal pro Sekunde, Gold golden mit Glow, Pfeile für weite Handbewegungen), Coach in der Ecke
  (Canvas, feste Ansicht, `frameAt`), HUD mit Score, Combo/Multiplikator, 5 Sternen plus
  Mega-Stern, Popups (Gold: „YEAH!“/„X“), Hinweis „Gold Move“, Beat-Puls am Rand (abschaltbar,
  aus bei `prefers-reduced-motion`, höchstens 3 Hz).
- Fehlerfälle: Song nicht gefunden, keine Moves, Audio nicht ladbar, Kamerafehler (mit erneutem
  Versuch), Kamera unterbrochen (Pause).
- Simulationsmodus nur im Dev-Server: `/play/<id>?sim=1&noise=10&miss=0.2` speist die Winkel der
  Choreografie mit Rauschen (Grad) und Ausfallquote (0–1) ein, ohne Kamera. Steckt hinter
  `import.meta.env.DEV` und ist im Produktions-Build nachweislich nicht enthalten.
- Tests: Controller (Countdown, Abbruch, Pause, Wiederaufnahme, blocked, Neustart, Ende,
  Bildalter), Scorer mit simuliertem Spieler (perfekt, Rauschen, Totalausfall, Combo, Gold,
  `seekTo`), Piktoleiste, Coach, Beat-Puls, Offsets, `useAudioClock`, Entsperrung, Spielscreen
  auf Routenebene inkl. Aufräumen.
- **Offen:** Playwright-Prüfung mit Screenshots (abgebrochen: es lief der globale statt des
  projektlokalen Playwright-MCP-Servers) und der Gerätetest (Checkliste unten).

Gerätetest 3a (Handy):

1. Aufstellhilfe → einrasten → Spiel startet von selbst, Countdown hörbar (Beeps), Musik startet
   nach „1“ ohne zusätzlichen Tipp (iOS: Entsperrung wirkt?).
2. Piktogramme treffen die Marke im Takt; falls nicht, Latenz notieren (globaler Offset kommt in
   Etappe 5).
3. Abbrechen im Countdown → Aufstellhilfe ohne erneuten Auto-Start; „Los geht's“ startet.
4. Pause, Weiter, Neustart, Beenden; App in den Hintergrund / Display sperren → Pause.
5. Aus dem Bild gehen → Hinweis „Wir sehen dich nicht“.
6. Ende → Ergebnis-Platzhalter mit Score, Sternen, Verteilung, längster Combo.
7. Hoch- und Querformat, Notch/Safe Areas, Lesbarkeit bei hellem Hintergrund.

**3b Online-Quellen – alle Schritte umgesetzt, Gerätetest offen.** Plan:
[plans/etappe-3b.md](plans/etappe-3b.md); Details zu Uhr und Quellen in
[architecture.md](architecture.md#audiosource--spielzeit).

- W5: YouTube-Uhr läuft nur bei PLAYING; `play()` löst erst dann auf; Autoplay-Sperre wird nach
  4 s ohne PLAYING erkannt (auch bei BUFFERING, siehe Gerätetest-Befunde unten) und als
  `blocked` gezeigt.
- W7: sichtbarer YouTube-Player in der Coach-Ecke (≥ 200 × 200 px, `youtube-nocookie.com`);
  `seek` vor dem Start wird gemerkt, im Pausenzustand springt es ohne zu starten; ungenutztes
  Feld entfernt. Im Zustand `blocked` ist das Video antippbar (Hinweis im Overlay), ein Start im
  Video meldet die Quelle über `onExternalStart`; ein doppelter Tipp startet nicht zweimal.
- W9 / W10: `onError` in `AudioSource` (Laufzeitfehler → Overlay „Die Musik ist abgebrochen“);
  URL-/Datei-Uhr hält bei `waiting`. `playbackRate` der URL-Quelle war schon vor 3b umgesetzt.
- Datenschutzhinweis der Aufstellhilfe nennt YouTube bzw. den Hostname der Audio-URL.
- Dev-Testsongs: `/?devsong=youtube:<ID>` bzw. `url:<Adresse>` (nur Dev-Server).
- **Offen:** Gerätetest.

Gerätetest 3b (Handy: `bun run dev:https`, `?devsong=youtube:<ID>` bzw.
`?devsong=url:<MP3-URL>&bpm=<BPM>`):

- iPhone: YouTube startet ohne Tipp oder mit „Zum Starten tippen“ (notieren, welcher Weg);
  Piktos laufen erst bei hörbarem Ton; Pause/Weiter/Neustart, Display sperren; Player unten links
  ≥ 200 px in Hoch- und Querformat; Flugmodus mitten im Song; FPS mit Video plus Kamera.
- iPhone, URL: Laden ohne vorherige Geste (`/play/…` neu laden); Lautstärke bei laufender Kamera;
  Netz weg → Uhr hält bzw. „Die Musik ist abgebrochen“; Datenschutzhinweis nennt YouTube/Host.
- Desktop: beide Quellen komplett durchspielen; Video mit gesperrtem Einbetten → verständliche
  Meldung; im Netzwerk-Tab kommt das Iframe von `youtube-nocookie.com`.

Gerätetest-Befunde 3b (iPhone, 2026-10-19):

- YouTube nach Reload von `/play/…`: Countdown blieb bei „1“ stehen, Tippen half nicht. Ursache:
  iOS meldet den verweigerten Start als BUFFERING, die Erkennung wartete dann bis 15 s; der Knopf
  im Overlay erreicht das Iframe auf iOS nicht. **Behoben:** Ablehnung nach 4 s auch bei
  BUFFERING, im Zustand `blocked` liegt das Video groß in der Mitte mit „Tippe auf das Video, um
  zu starten.“ Gerätetest offen.
- Ein Video zeigte am iPhone „Dieses Video ist nicht verfügbar“, am MacBook lief es. Ein zweites
  Video lief am iPhone; vermutlich sperrt der Rechteinhaber die Einbettung auf Mobilgeräten. Kein
  App-Fehler.
- Musik am iPhone übersteuert bzw. viel zu laut (lokale Datei und URL). Ursache: iOS ignoriert
  `HTMLMediaElement.volume`, die Musik lief immer mit 100 %, nur die Effekte folgten dem Regler.
  **Behoben in 11e** für lokale Dateien (Gain über Web Audio); bei URL und YouTube gelten die
  Lautstärketasten. Gerätetest nach 11e (2026-10-20): Demo weiterhin übersteuert, Regler ohne
  Wirkung. Ursache der Übersteuerung war die Demo-Synthese, **behoben in 11f**; Regler-Wirkung
  noch offen.

### 4. Ergebnis-Screen und Highscores ✅

- Score zählt hoch, Sterne nacheinander, Rangtitel, Zähler je Urteil, längste Combo, Konfetti ab
  5 Sternen, „Nochmal“ und „Anderer Song“.
- Highscore und Sterne pro Song im Song-Eintrag speichern (über `SongRepository`; die
  ursprüngliche Beschreibung nannte localStorage).

Umgesetzt:

- `recordResult` (`src/lib/game/results.ts`) speichert Highscore und Sterne beim Spielende über
  `SongRepository`. Beide Werte steigen nur. Das Format bleibt unverändert.
- Fehlt der Song (Dev-Song), schlägt das Speichern fehl oder hängt es länger als 2 s, öffnet der
  Ergebnis-Screen trotzdem, ohne „Neuer Highscore!“.
- Neuer `ResultScreen`:
  - Score zählt per Motion-Value hoch, ohne `setState` pro Frame.
  - Sterne poppen nacheinander, Megastar als großer goldener Stern.
  - Rangtitel, Urteile mit Farbmarke, längste Combo, „Neuer Highscore!“.
  - Konfetti ab 5 Sternen, ohne neue Abhängigkeit.
  - `prefers-reduced-motion` zeigt den Endstand sofort.
  - Im Querformat zwei Spalten. Fokus auf dem Titel.
- Konstanten `RESULT` und `CONFETTI` in `src/theme.ts`.
- Tests für Ergebnislogik (mit `fake-indexeddb`), Ergebnis-Screen und das Speichern im Spielscreen.
- Playwright (Simulationsmodus, 390×844 und 844×390): Megastar-Lauf, Highscore erscheint in der
  Bibliothek, Konsole sauber.
- **Offen:** Gerätetest (Animationen, Konfetti-Leistung, Lesbarkeit). Nach einem Neuladen ist der
  Endstand weg und der Screen zeigt „Kein Ergebnis“; das ist so gewollt.

### 5. Einstellungen, Sync-Test, Kalibrierung, „Song hinzufügen“ ✅

**5a Einstellungen – umgesetzt, Gerätetest offen.**

- `/settings` (`SettingsScreen`): Schwierigkeit, „Automatisch starten“, Lautstärke,
  Latenz-Ausgleich (±500 ms, Schritt 10, „Zurücksetzen“), Skelett, Beat-Puls, Kamerabild
  spiegeln, belegter Speicher (`getStorageUsage`). Slider schreiben beim Loslassen.
- Neue Einstellung `autoStart`; die Aufstellhilfe startet nur bei `autoStart` und scharfem Auto-Start.
- Settings werden beim Lesen pro Feld mit zod geprüft; Schreibfehler werden abgefangen.
- Kamerawahl bleibt in der Aufstellhilfe: Gerätenamen gibt es erst nach der Kamera-Berechtigung.
  In den Einstellungen nur „Gespeicherte Kamera vergessen“.
- Playwright (390×844 und 844×390): Werte bleiben nach Neuladen, kaputte Werte im localStorage
  fallen auf Standard zurück, Seite scrollt, Konsole sauber.
- **Offen:** Gerätetest (Slider-Bedienung per Touch, Lesbarkeit, Safe Areas).

**5b Songs bearbeiten und löschen – umgesetzt, Gerätetest offen.**

- Stift-Knopf im Banner öffnet „Song bearbeiten“ (`EditSongDialog`): Titel und Künstler ändern
  (`choreo.title` zieht mit), „Song löschen“ mit Bestätigung (Highscore und Audio werden
  entfernt). Fehler wie `StorageFullError` stehen im Dialog; während des Schreibens lässt er sich
  nicht schließen.
- Seed-Regel (N3): `seedDemos` legt jede Demo nur an, wenn sie in der Bibliothek fehlt und nicht
  in `dancebeat.deletedDemos` steht. Vorhandene Demos (mit Highscore) werden nie überschrieben;
  nach gelöschter IndexedDB kommen sie zurück. Der Marker `dancebeat.seeded` entfällt.
  Gelöschte Demos werden vor dem Löschen vermerkt und vor dem Speichern erneut geprüft.
  Bekannte Grenze: wird localStorage geleert, kommen gelöschte Demos zurück.
- Playwright (390×844 und 844×390): Umbenennen und Löschen bleiben nach Neuladen, ohne Vermerk
  wird die fehlende Demo neu angelegt, Konsole sauber.
- **Offen:** Gerätetest (Touch, Tastatur über dem Dialog auf iOS). `lastSongId` zeigt nach dem
  Löschen ggf. ins Leere (harmlos, Auswahl fällt auf den ersten Song); bei leerer Bibliothek
  bleiben die Farben des letzten Songs.

**5c Song hinzufügen, Export und Import – umgesetzt, Gerätetest offen.**

- „Song hinzufügen“ (`AddSongDialog`) mit Tabs Datei, URL, YouTube. Datei: BPM-Schätzung und
  Länge per `analyzeAudio`, BPM korrigierbar; nicht dekodierbare Dateien → „Bitte MP3, M4A, WAV
  oder OGG verwenden“. URL (nur https, Hinweis „nur eigene oder private Quellen“, Host wird
  genannt) und YouTube (Link oder ID): BPM und Länge von Hand.
- Choreografie automatisch (`autoChoreo`) oder aus einer Exportdatei importiert. Der neue Song
  wird danach ausgewählt.
- „Choreografie exportieren“ im Dialog „Song bearbeiten“ (JSON ohne Audio).
- W11 Rest: `requestPersistentStorage()` vor dem Speichern, `StorageFullError` mit eigener
  Meldung im Dialog. Logik in `src/lib/library/newSong.ts`, Details in
  [architecture.md](architecture.md#song-hinzufügen-und-choreografie-exportieren).
- Playwright (390×844 und 844×390): kaputte Datei → Meldung, WAV-Klicktrack → 120 BPM und 20 s
  erkannt, Song angelegt, ausgewählt und im Simulationsmodus bis zum Ergebnis gespielt, Export,
  Re-Import, Konsole sauber.
- **Offen:** Gerätetest: echte MP3/M4A auf iOS (Dekodieren, BPM-Treffer), Dateiauswahl, Download
  der JSON-Datei in Safari und als installierte PWA, große Dateien und Speicherquote,
  `navigator.storage.persist()`.

**5d Teil 1 Sync-Test – umgesetzt, Gerätetest offen.**

- Route `/sync/$songId` (`SyncTestScreen`), erreichbar über „Sync-Test“ im Dialog „Song
  bearbeiten“, der auch den aktuellen Sync-Offset zeigt. Start spielt ab `startOffsetMs`, Taps auf
  die Fläche oder per Leertaste, Live-Abweichung je Tap, Vorschlag mit Streuung und Hinweis bei
  ungleichmäßigen Taps; „Speichern“, „Nochmal“, „Auf 0 zurücksetzen“, „Abbrechen“.
  Warnsymbol bei YouTube, Abruf der Songquelle (YouTube, Audio-URL) benannt. Spotify: Hinweis
  „Sync-Test für Spotify folgt mit Etappe 10“, keine Quelle. Tap-Zeit ohne Event-Verzögerung
  (`tapAudioMs`).
- Berechnung `computeSyncOffset` in `src/lib/sync.ts` (zyklisch, Median, Ausreißer, MAD), Details
  und Vorzeichen in [scoring.md](scoring.md#sync-test-pro-song). Kein Formatwechsel:
  `syncOffsetMs` gab es schon.
- Playwright (390×844 und 844×390): 12 Taps per Leertaste, Vorschlag, Konsole sauber.
- **Offen:** Gerätetest (Tap-Latenz von Touch und Bildschirm, iOS-Start im Tipp, YouTube-Start
  im Tipp, Bluetooth-Kopfhörer).

**5d Teil 2 Feinjustierung und Start-Offset – umgesetzt, Gerätetest offen.**

- Sync-Test, Karte „Feinjustierung“: Arbeitswert (startet beim gespeicherten Offset), Knöpfe
  −10, −1, +1, +10 ms (±1000 ms), „Vorschlag übernehmen“ in der Ergebnis-Karte setzt den
  Arbeitswert. Ein Speichern-Knopf schreibt den Arbeitswert; „Auf 0 zurücksetzen“ bleibt.
  Live-Abweichung rechnet mit dem Arbeitswert.
- Vorschau: Beat-Licht in der Songfarbe, Zeit aus `getTimeMs()` mit dem Arbeitswert, eigene
  rAF-Schleife ohne React-Render pro Frame, höchstens 3 Hz (`beatFlashDivisor`), bei reduzierter
  Bewegung nur Deckkraft. Details in [scoring.md](scoring.md#sync-test-pro-song).
- Dialog „Song bearbeiten“: Feld „Start ab (Sekunden)“ (0–600 s, Komma oder Punkt). Titel,
  Künstler und Start-Offset werden zusammen gespeichert (`useSongLibrary().updateDetails`, ersetzt
  `rename`). Kein Formatwechsel: `startOffsetMs` gab es schon.
- **Offen:** Gerätetest: ob das Licht am Gerät mit dem gehörten Beat übereinstimmt (Bluetooth,
  iOS), Bedienung der Knöpfe per Touch, Dezimaltastatur auf iOS.
- Playwright (390×844 und 844×390): Vorschlag übernehmen, ±10 ms, Speichern; „Start ab“ 2,5 s
  und Offset bleiben nach Neuladen, Dialog scrollt im Querformat, Konsole sauber.

**N12 Aufstellhilfe im Querformat – umgesetzt, Gerätetest offen.**

- Vor dem Kamerastart scrollt `main`; die Karte wird per `my-auto` nur zentriert, solange sie
  passt (kein `justify-center`, das den Kopf unter die Kopfzeile schob). Überschrift im
  Querformat kleiner.
- Mit Kamera schrumpft und scrollt die Seitenkarte in beiden Formaten; im Hochformat behält das
  Video mindestens 35dvh.
- Playwright mit Fake-Kamera (390×844 und 844×390, mit Diagnose): „Kamera starten“, „Los
  geht's“, „Zurück“ und Diagnose erreichbar, Konsole sauber (nur MediaPipe-interne Warnungen).
- **Offen:** Gerätetest (Notch, Adressleiste, iOS-Scrollen). Kosmetisch: Der Schatten der Karte
  wird beim Scrollen am Rand abgeschnitten.

Start-Offset im Dialog „Song hinzufügen“ entfällt: einstellbar über „Song bearbeiten“.

### 6. Bewegungsmodus ✅ (Gerätetest offen)

- Wenn keine Kamera erlaubt ist: Handy in der Hand halten. DeviceMotion (inkl.
  iOS-Berechtigungsabfrage) misst die Bewegungsintensität im Takt; Bewertung über
  `intensityRating` in `useScoring`.

**Umgesetzt:**

- Logik: `src/lib/motion.ts` (`MotionMeter`, `judgeIntensity`, `requestMotionPermission`,
  `parsePlayMode`), Dep `motion` im `GameController`, dritter Parameter von `Scorer.sample`.
  Schwellen und Grenzen in [scoring.md](scoring.md#bewegungsmodus).
- Aufstellhilfe: Knopf „Ohne Kamera spielen“ mit kurzem Hinweis in der Startkarte und neben dem
  Kamera-Fehler. Abgelehnt: „Bewegungssensor nicht erlaubt …“, kein Sensor: „Dieses Gerät hat
  keinen Bewegungssensor.“ (auch, wenn nach „granted“ binnen 1 s keine Messung kommt).
- Spiel mit `?mode=motion`: keine Kamera, kein Video, kein Skelett; Hinweis „Keine Bewegung
  erkannt – Handy in der Hand halten.“; dezentes Badge „Bewegungsmodus“; Pausenmenü ohne
  Skelett-Schalter. Messungen mit Spielzeit aus `useAudioClock`, Puffer-Reset bei Start und
  Neustart (nicht bei Weiter). Highscore wie im Kameramodus.
- Tests: Spielscreen (kein `getUserMedia`, synthetische `devicemotion`-Events ergeben Urteile,
  ohne Events Hinweis und X), Aufstellhilfe (Knopf, Navigation, Ablehnung, kein Sensor),
  `useDeviceMotion`.
- Nur am Gerät prüfbar: echte Sensorwerte, iOS-Dialog, Gefühl der Schwellen.

**Gerätetest 6 (offen):**

- [ ] iOS: Berechtigungsdialog erscheint beim Tipp auf „Ohne Kamera spielen“, Ablehnung zeigt
      die Meldung.
- [ ] iOS: `/play/<id>?mode=motion` neu laden → „Zum Starten tippen“ fragt erneut, danach kommen
      Messungen an (sonst Hinweis „Keine Bewegung erkannt“).
- [ ] Gerät ohne Sensor bzw. Desktop: nach etwa 1 s Meldung „Dieses Gerät hat keinen
      Bewegungssensor.“, auf echten Handys startet das Spiel ohne spürbare Wartezeit.
- [ ] Android ohne `acceleration` (nur `accelerationIncludingGravity`): Hochpass-Ersatz liefert
      sinnvolle Werte, kein Ausschlag beim Start.
- [ ] Schwellen: fühlt sich PERFECT verdient an, wird Stillhalten zu X, Gold spürbar schwerer;
      je Schwierigkeit.
- [ ] Bildschirmsperre: seit 7a hält ein Wake Lock das Display an (siehe Gerätetest 7a);
      sperrt es trotzdem, pausiert das Spiel über `visibilitychange`.

### 7. PWA und Gerätefunktionen ✅ (Gerätetest offen)

**7a Wake Lock, Haptik, Manifest – umgesetzt, Gerätetest offen.**

- Wake Lock (`src/lib/wakeLock.ts`, `useWakeLock`): Display bleibt an im Vorlauf, Countdown,
  Spiel und bei „blocked“, nicht in der Pause und nicht auf Fehlerbildschirmen (wer weggeht, soll
  keinen leeren Akku vorfinden); im Sync-Test beim Starten und Abspielen. Eine Anfrage, die während
  des Wartens erneut gewünscht wurde (wieder sichtbar), wird danach einmal wiederholt. Nach `visibilitychange` → sichtbar wird neu angefordert; fehlende API oder Ablehnung
  bleiben still. Wichtig vor allem im Bewegungsmodus (ohne Kamera sperrt das Handy sonst).
- Haptik (`src/lib/haptics.ts`): 30 ms bei PERFECT, Muster 40-40-80 ms bei getroffenem Gold Move,
  einmal pro Urteil. Einstellung „Vibration“ (`haptics`, Standard an) im Abschnitt „Spiel“;
  iOS Safari kennt `navigator.vibrate` nicht (Hinweis im Schalter).
- Web-App-Manifest `public/manifest.webmanifest` (`standalone`, beliebige Ausrichtung), Icons in
  `public/icons/` aus dem eigenen Favicon-Motiv (SVG, PNG 192/512, maskierbar 512, Apple 180;
  `icon-maskable.svg` ist nur die Quelle des PNG). `index.html`: Manifest, `theme-color`,
  Apple-Metas. Hintergrund- und Themenfarbe `APP_BACKGROUND` in `theme.ts` (Hex-Näherung von
  `--background`); `manifest.test.ts` prüft Manifest und `index.html` dagegen.
- Ohne Service Worker: Android-Chrome bietet die Installation an, offline läuft die App noch nicht.

**Gerätetest 7a (offen):**

- [ ] Bewegungsmodus und Kameramodus: Display bleibt einen ganzen Song lang an, auch nach
      App-Wechsel und Rückkehr; nach dem Ergebnis-Screen sperrt es wieder normal.
- [ ] Android: Vibration bei PERFECT und Gold spürbar, nicht störend; Schalter „Vibration“ aus →
      keine Vibration.
- [ ] Android: „App installieren“ erscheint, Icon (maskiert) und Name stimmen, Start ohne
      Browserleiste. iOS: „Zum Home-Bildschirm“, Icon, Statusleiste über dem Inhalt lesbar,
      Safe Areas.

**7b-1 MediaPipe lokal – umgesetzt, Gerätetest offen.** WASM-Laufzeit und lite-Modell kommen
von der eigenen Adresse der App statt von jsDelivr und Google (Details:
[architecture.md](architecture.md#externe-abrufe)). WASM per Vite-Plugin aus `node_modules`, Modell
per Download-Skript mit SHA-256-Prüfung (gitignored, läuft vor `dev` und `build`). Der
Datenschutzhinweis der Aufstellhilfe nennt keine MediaPipe-Abrufe mehr (W12 erledigt), die
Fehlermeldung beim Modell-Ladefehler verweist auf die Verbindung zur App. Die eingebaute
MediaPipe-Telemetrie an `odml.pa.googleapis.com` sperrt eine CSP (`connect-src`), siehe
architecture.md. Nur die tatsächlich geladenen WASM-Varianten (SIMD, ohne SIMD) werden
ausgeliefert; der Build bricht ab, wenn das Modell fehlt. Modell-Typ auf „lite“ eingeengt.
Playwright (nur localhost erlaubt, Fake-Kamera): WASM und Modell kommen mit 200 von localhost,
die Erkennung läuft (Statuszeilen werden ausgewertet), keine Abrufe an fremde Hosts; nach
dem Verlassen der Aufstellhilfe blockiert die CSP den Telemetrie-Abruf (Konsolenmeldung, kein
Netzwerkabruf). Eine echte Pose liefert das Testbild nicht.

Gerätetest 7b-1 (offen):

- [ ] iPhone und Android: Aufstellhilfe startet die Erkennung wie bisher (GPU, sonst CPU),
      Ladezeit beim ersten Start notieren; im Netzwerk-Tab keine fremden Hosts.
- [ ] iOS Safari: CSP-Meta greift (Telemetrie blockiert), HMR über `dev:https` funktioniert.

**7b-2 Service Worker – umgesetzt, Gerätetest offen.** Eigener Service Worker ohne neue
Abhängigkeit (Entscheidung gegen `vite-plugin-pwa`). Details:
[architecture.md](architecture.md#service-worker-und-offline-betrieb).

- `src/sw/` (Strategie und Handler als reine, getestete Funktionen, `sw.ts` als Einstieg);
  `vite-plugins/serviceWorker.ts` baut daraus beim Build ein eigenständiges `sw.js` (IIFE, keine
  Imports) und fügt Precache-Liste und Versionen ein. Registrierung nur im Produktions-Build
  (`src/lib/serviceWorker.ts`), im Dev-Server kein Service Worker.
- App-Hülle im Precache; WASM und Modell im Laufzeit-Cache beim ersten Laden (nur die
  tatsächlich geladene WASM-Variante). Jede Navigation bekommt die `index.html` aus dem
  Precache (App-Shell), damit Seite und Caches immer zur selben Version gehören. Fremde Adressen (YouTube, Audio-URLs), Range-Anfragen und Nicht-GET laufen am
  Service Worker vorbei. Kein `skipWaiting`: ein Update greift erst, wenn alle Tabs der App
  geschlossen sind.
- Playwright (`bun run preview`, 390×844 und 844×390): Service Worker aktiv, 60 Dateien im
  Precache; nach der Aufstellhilfe liegen nur `vision_wasm_internal.*` und das lite-Modell im
  Laufzeit-Cache; offline starten Bibliothek, Deep Link `/setup/…` und `/settings`, die
  Erkennung läuft, alle Antworten aus dem Service Worker, keine fehlgeschlagenen Abrufe,
  Konsole ohne Fehler (nur MediaPipe-interne Warnungen).
- Kein Hinweis „Update verfügbar“ in der Oberfläche (bei Bedarf später).

Gerätetest 7b-2 (offen):

- [ ] Android-Chrome und iOS (Safari und Home-Bildschirm-App): einmal online die Aufstellhilfe
      öffnen, dann Flugmodus → App startet, Aufstellhilfe erkennt, ein Demo-Song lässt sich
      spielen (Kamera- und Bewegungsmodus).
- [ ] iOS: Cache von etwa 20 MB wird angenommen und bleibt nach Tagen ohne Nutzung erhalten
      (installierte PWA).
- [ ] Update: neuen Build ausliefern, alle Tabs schließen, neu öffnen → neue Version, alte
      Caches weg (DevTools → Application → Cache Storage).

### 8. „Tanz aus Video erstellen“ mit Editor ⏳ (8a, 8b, 8c, 8d-1, 8d-2a, 8d-2b, 8e, 8f, 8g-2, 8g-3, 8g-4a, 8g-4b, 8g-4c, 8g-4d, 8h-1, 8h-2a umgesetzt)

Aufteilung:

- **8a Pose-Spur → Choreografie (Logik) – umgesetzt.** `src/lib/videoChoreo.ts`:
  - `choreoFromPoseTrack` übernimmt Zuschnitt, Glättung (One-Euro, vorwärts und rückwärts),
    Winkel mit `aspect`, den quadratischen Raum, Spiegeln, Frames alle ~100 ms mit
    `lowVisibility`, Moves auf dem Beat-Raster und den Gold-Vorschlag (`suggestGoldMoves`).
  - Kein Formatwechsel. Tests mit synthetischen `figure()`-Spuren in
    `src/test/videoChoreo.test.ts`.
  - Details: [choreography-format.md](choreography-format.md#video-import).
  - Offen: Filterparameter und Schwellen an echten Videos prüfen (mit 8b).
  - Die Beat-Phase wird nicht geschätzt, sie kommt als Parameter (`beatOffsetMs`).
- **8b Analyse – umgesetzt, Gerätetest offen.** `analyzeVideo` (`src/lib/videoAnalysis.ts`)
  setzt das pausierte Video Schritt für Schritt (alle 50 ms) und erkennt nach jedem Seek die
  Pose; `useVideoAnalysis` liefert Zustand, Fortschritt, Abbruch und räumt den Estimator auf.
  Modell: vorerst „lite“, per Option wählbar; „full“ oder „heavy“ erst, wenn lite an echten
  Videos nicht reicht. Details: [architecture.md](architecture.md#video-analyse-etappe-8b).
  - Tests mit Fake-Video und Fake-Estimator (Raster, Bereich, Zeitstempel, Abbruch,
    Seek-Timeout, Bild-Callback, Fortschritt, Hook-Zustände, Aufräumen) und ein Durchlauf bis
    `choreoFromPoseTrack`.
  - Keine Oberfläche: Playwright-Prüfung mit echtem Video kommt mit 8c.
  - **Offen (Gerät):** liefert Safari/iOS nach einem Seek den Bild-Callback, reichen 120 ms
    Rückfall, Dauer und Speicher bei langen Videos.
- **8c Import-Dialog – umgesetzt, Gerätetest offen.** Option „Aus Video“ in „Song
  hinzufügen“ (`VideoChoreoPanel`, Logik in `src/lib/library/videoImport.ts`): Datei,
  Vorschau, Start/Ende mit „Ab hier“/„Bis hier“, Selfie-Schalter, Beat-Phase, Analyse mit
  Fortschritt und Abbruch, Zusammenfassung (Moves, Gold Moves, Erkennungsquote). Annahme
  Videozeit = Audiozeit; Bereichsstart wird `startOffsetMs` und geht in `offsetMs` ein. Details:
  [architecture.md](architecture.md#video-import-im-dialog-etappe-8c).
  - Tests: Offset- und Phasenrechnung, Bereichsprüfung, `buildNewSong` mit Video, Dialogablauf
    mit Fake-Estimator (Speichern, veraltete Analyse, Abbruch, Fehler, Freigabe der Objekt-URL).
  - Playwright (390×844 und 844×390, erzeugtes Testvideo ohne Person, echtes MediaPipe von
    localhost): Vorschau, Bereich vorbelegt, Analyse läuft durch und meldet „Im Video wurde zu
    selten eine Person erkannt.“, Abbrechen zeigt „Analyse abgebrochen.“, Dialog scrollt im
    Querformat, Konsole nur mit den erwarteten CSP-/MediaPipe-Meldungen. Erfolgspfad mit echtem
    Tanzvideo offen (Gerätetest).
  - Nicht enthalten: „Video behalten“; Zielperson kam mit 8f, Editor mit 8d.
  - **Gerätetest 8c (offen):**
    - [ ] Echtes MP4 und MOV auf iPhone (Safari) und Android (Chrome) wählen, Vorschau läuft
    - [ ] Dauer der Analyse für einen Abschnitt von 1–3 Minuten notieren
    - [ ] Vorschau bleibt während der Analyse sichtbar (Hoch- und Querformat, auch beim Scrollen)
    - [ ] Nach dem Import spielt der Song synchron: Moves treffen die Musik, Sync-Test plausibel
    - [ ] Bildschirm bleibt während der Analyse an (Wake Lock)
- **8d-1 Editor-Grundfunktionen – umgesetzt, Gerätetest offen.** Route `/edit/$songId`, Einstieg
  „Choreografie bearbeiten“ im Dialog „Song bearbeiten“. Details:
  [architecture.md](architecture.md#choreografie-editor-etappe-8d-1).
  - Arbeitskopie mit „Speichern“ (danach zurück zur Bibliothek), „Verwerfen“ mit Rückfrage;
    jedes Verlassen mit Änderungen (auch Browser-/Android-Zurück) fragt nach, Neuladen warnt.
  - Timeline mit Strichfiguren (Canvas), Zeit in Musikzeit, Gold-Markierung; Auswahl per Tippen.
  - Gold Move umschalten, Move löschen (mindestens 2 bleiben), Gold-Vorschlag für die ganze
    Choreografie.
  - Offset ±1 Beat, ±100 ms, ±10 ms (höchstens ±10 s um den gespeicherten Wert, kein Move vor
    Musikzeit 0); Tempo 0,75× /
    1× / 1,25× (1× entfernt `playbackRate`), bei Spotify gesperrt mit
    Hinweis.
  - Logik in `src/lib/choreoEditor.ts`; Tests `choreoEditor.test.ts`,
    `choreo-editor-screen.test.tsx`, Link im Bibliothekstest. Kein Formatwechsel.
  - Playwright (390×844 und 844×390): Einstieg über „Song bearbeiten“, Gold, +100 ms und 1,25×
    gespeichert und nach Neuladen in IndexedDB, Rückfrage bei „Zurück“ und Browser-Zurück, Spiel im
    Simulationsmodus mit dem bearbeiteten Song, Konsole sauber.
  - **Gerätetest 8d-1 (offen):**
    - [ ] Hoch- und Querformat am Handy: Timeline wischbar, Knöpfe erreichbar, Safe Areas
    - [ ] Strichfiguren scharf (devicePixelRatio) und gut erkennbar, Gold sichtbar
    - [ ] Nach Offset- und Tempoänderung spielt der Song im Spiel wie erwartet
- **8d-2a Move-Zeiten und Einfügen – umgesetzt, Gerätetest offen.** In der Karte „Move N“:
  Gruppe „Zeit“ mit −1 Beat, −½ Beat, +½ Beat, +1 Beat und „Move danach einfügen“ (Auswahl
  folgt dem neuen Move). Regeln: sortiert, mindestens 300 ms Abstand, innerhalb der Frames mit
  brauchbarer Zielpose (wie beim Import), nicht vor Musikzeit 0; sonst gesperrt mit Hinweis.
  Einfügen in der Mitte zum nächsten Move, gerastet auf das Beat-Raster der Choreografie-Zeit
  (k · Beatlänge), nach dem letzten Move zwei Beats später. Details:
  [choreography-format.md](choreography-format.md#editor).
  - Logik `shiftMove`, `insertMoveAfter` (mit `canShiftMove`, `canInsertAfter`) in
    `src/lib/choreoEditor.ts`; Tests in `choreoEditor.test.ts` und
    `choreo-editor-screen.test.tsx`. Kein Formatwechsel.
  - Playwright (390×844 und 844×390, beide Demos): ±½ Beat verschiebt Moves, Knöpfe sperren am
    Nachbar-Move mit Hinweis, Einfügen landet auf dem Beat (auch bei 124 BPM) und wird ausgewählt,
    Speichern und Neuladen behalten Moves und Zeiten, kein waagerechtes Scrollen, Konsole sauber.
  - **Gerätetest 8d-2a (offen):**
    - [ ] Zeit-Knöpfe und Einfügen im Hoch- und Querformat erreichbar, Hinweis lesbar
    - [ ] Verschobene und eingefügte Moves treffen im Spiel die Musik
- **8d-2b Abspielen mit Audio-Vorschau – umgesetzt, Gerätetest offen.** Karte „Vorschau“ unter
  der Timeline: „Abspielen“/„Stopp“, „Ab Move N abspielen“ (zwei Beats vor dem gewählten Move,
  mit Latenz und Sync-Offset wie im Spiel), Musikzeit-Anzeige, Schalter „Klick bei jedem Move“
  (Gold Moves klingen anders; Klick auf der Audioposition, Markierung auf der Spielzeit). Der aktuelle Move leuchtet in der Timeline und wird
  hineingescrollt. Änderungen wirken während der Wiedergabe sofort; ein Tempo-Wechsel stoppt und
  baut die Quelle neu. Datei, URL und YouTube (sichtbarer Player, Hinweis bei blockiertem Start);
  Spotify gesperrt (Etappe 10). Stopp bei verborgener Seite, Songende und Verlassen; Wake Lock.
  Details: [architecture.md](architecture.md#choreografie-editor-etappe-8d-1).
  - Logik `previewStartAudioMs`, `currentMoveIndex`, `dueMoves`, `scrollIntoBoxDelta` in
    `src/lib/editorPreview.ts`; Tests `editorPreview.test.ts` und
    `choreo-editor-screen.test.tsx` (Fake-Quelle, Fake-rAF). Kein Formatwechsel.
  - Bekannte Grenze: Klick und Markierung laufen in der rAF-Schleife und kommen bis etwa einen
    Frame (~16 ms) nach der Move-Zeit; bei Schritten über 250 ms Spielzeit (Seek, Ruckler) fällt
    der Klick aus.
  - **Gerätetest 8d-2b (offen):**
    - [ ] Klick hörbar und sitzt auf der Musik (Beat bzw. Move-Zeit), auch mit Latenz und
          Sync-Offset ≠ 0; Markierung entspricht der Pikto-Zeit im Spiel
    - [ ] Start auf iOS mit Datei, URL und YouTube (direkt im Tipp, Hinweis bei Blockade)
    - [ ] Tempo-Wechsel: Wiedergabe stoppt, neues Tempo hörbar, Klicks passen weiter
    - [ ] Display sperren oder App wechseln → Wiedergabe stoppt
    - [ ] Lautstärke aus den Einstellungen gilt für Musik und Klick

- **8e Takt erkennen im Video-Import – umgesetzt, Gerätetest offen.** Knopf „Takt erkennen“
  unter „Beat-Phase (ms)“: Phase aus der Musikdatei (Tab Datei) oder aus der Tonspur des Videos
  (bis 250 MB und 15 Minuten), aus dem Video auch die BPM (nur ohne Musikdatei und wenn BPM nicht von Hand
  geändert). Die Phase folgt BPM und Bereich, bis man sie selbst eintippt. Details:
  [architecture.md](architecture.md#bpm-schätzung-und-beat-phase).
  - Logik `onsetEnvelope`, `estimateBeatPhaseMs` in `src/lib/beat.ts` (10-s-Fenster ab
    Bereichsstart, frühe Beats stärker gewichtet); `analyzeAudio` liefert die Hüllkurve mit.
    Tests `beat.test.ts` (Raster bei 90–140 BPM, gerundete BPM, Off-Beats, Stille) und
    `video-beat-detect.test.tsx` (beide Quellen, BPM-Übernahme, Fehler, veraltetes Ergebnis).
    Kein Formatwechsel.
  - Grenze: Die BPM-Schätzung war ganzzahlig und lag oft 1–2 daneben; dann drifteten die Moves
    über den Song, die Phase saß nur am Abschnittsanfang. Seit 8g-4a auf 0,1 BPM verfeinert
    (siehe dort); bei Musik ohne klare Schläge trotzdem prüfen.
  - Nicht enthalten: „Video behalten“ (gebrochene BPM kam mit 8g-4a).
  - **Gerätetest 8e (offen):**
    - [ ] iPhone (Safari) und Android (Chrome): Tonspur aus MP4 und MOV wird gelesen, Dauer
          und Speicher bei einem 100–250-MB-Video
    - [ ] Mit echtem Song: Moves des importierten Tanzes treffen die Musik ohne Handkorrektur,
          Sync-Test zeigt nur kleine Abweichung
- **8f Zielperson wählen – umgesetzt, Gerätetest offen.** Die Video-Analyse erkennt bis zu 3
  Personen je Probe. Bei mehreren zeigt der Import „Mehrere Personen erkannt“: Standbild mit
  nummerierten Skeletten zum Antippen, Knöpfe „Person 1 … N“, „Aktuelles Bild“ für ein Bild an
  der Vorschauposition. Die Wahl rechnet ohne neue Analyse neu; `trackTarget` folgt der Person
  über die Rumpfmitte mit wachsender Sprunggrenze (Startwerte 0,12 + 0,6 × s, höchstens 0,5
  Bildhöhen) und setzt nie eine andere Person ein. Mit einer Person bleibt alles wie vorher.
  Details: [architecture.md](architecture.md#zielperson-etappe-8f).
  - Logik in `src/lib/targetPerson.ts`; Tests `targetPerson.test.ts` (wechselnde
    Modell-Reihenfolge, Kreuzen, Verdeckung, Wiederfinden, eine Person unverändert,
    Vorauswahl, Antippen), `videoAnalysis.test.ts`, `mediapipePoseEstimator.test.ts`,
    `video-choreo-panel.test.tsx` (Auswahl ohne neue Analyse, keine Auswahl bei einer Person).
    Kein Formatwechsel.
  - Nicht enthalten: „Video behalten“, Bewegungsmodell für das Kreuzen auf gleicher Höhe.
  - **Gerätetest 8f (offen):**
    - [ ] Echtes Video mit 2 Tänzern: Auswahl erscheint, Standbild zeigt Bild und Skelette
          deckungsgleich (auch Safari nach dem Seek), Antippen wählt die richtige Person
    - [ ] Tracking über Kreuzungen und kurze Verdeckungen: die Choreografie bleibt bei der
          gewählten Person (im Editor oder Spiel prüfen)
    - [ ] Dauer der Analyse mit `numPoses` 3 gegenüber vorher (1) für denselben Abschnitt
- **8g Qualität mit echten Tanzvideos – 8g-2, 8g-3 und 8g-5 umgesetzt.** Ziel: aus YouTube-Videos (lokal per
  yt-dlp als MP4) zuverlässig gute Choreografien für Party-Klassiker, K-Pop Mirrored, Zumba und
  TikTok-Trends. Erst messen, dann gezielt verbessern.
  - **8g-1 Testset (offen, kein Code):** 4 Referenzvideos lokal außerhalb des Repos (fester
    Party-Klassiker, K-Pop Dance Practice Mirrored, Zumba mit ganzer Figur, TikTok im
    Hochformat), je mit bekannter BPM, Seitenverhältnis, Länge und Personenzahl.
  - **8g-2 Diagnose im Dev-Modus – umgesetzt.** Kennzahlen (`trackMetrics`) und
    „Rohdaten exportieren“ (`*.posetrack.json`) im Video-Import, nur bei
    `import.meta.env.DEV`. Details:
    [architecture.md](architecture.md#diagnose-im-dev-modus-etappe-8g-2). Tests
    `videoChoreo.test.ts` (Kennzahlen), `poseTrackFile.test.ts` (Format, gleiche Moves wie der
    Dialog), `video-choreo-panel.test.tsx` (Diagnose und Export). Kein Formatwechsel.
  - **8g-3 Tuning-Skript – umgesetzt.** `bun run tune-video <dateien>` probiert One-Euro-
    Parameter und `maxGapMs` (wahlweise `beatsPerMove`) und ordnet nach Holdout-Fehler, je Video
    und gemittelt. Details:
    [architecture.md](architecture.md#tuning-skript-etappe-8g-3). Tests `tuning.test.ts`,
    Holdout in `videoChoreo.test.ts`. Lauf mit echten Rohdaten: siehe 8g-5.
  - **8g-4a Bruchteil-BPM – umgesetzt.** `refineBpm` (`src/lib/beat.ts`) verfeinert die
    ganzzahlige Schätzung auf 0,1 BPM: Kandidaten ±3 BPM in 0,02er-Schritten, phasenkohärenter
    Kammfilter über die ersten 300 s der Hüllkurve; echte ganzzahlige Tempi bleiben exakt.
    `analyzeAudio` liefert die verfeinerte BPM, das Formular nimmt Kommazahlen an (`step="any"`, gerundet auf 0,1),
    die Kachel zeigt „123,4 BPM“ (`formatBpm`). Gemessen auf einem Klick-Track mit 123,4 BPM
    über 180 s: Abstand des letzten Beats zum echten Raster 0 ms verfeinert, 2064 ms mit der
    bisherigen ganzzahligen Schätzung (122), 585 ms selbst mit der besten ganzen Zahl (123).
    Laufzeit für 5 min Hüllkurve in Node ~30–70 ms (mit ±3 BPM). Tests `beat.test.ts` (ganzzahlige und
    gebrochene Tempi, Drift, Off-Beats und Rauschen, Stille), `newSong.test.ts`. Kein
    Formatwechsel (Schema erlaubt Bruchteile). Liegt das Plateau am Rand des Suchbereichs, bleibt
    die grobe BPM. **Offen:** Prüfung mit echten Songs; Gerätetest: BPM-Feld am iPhone mit
    deutscher Tastatur (Komma) liefert den Wert und nicht „BPM muss zwischen 30 und 300 liegen“.
  - **8g-4b Modellwahl – umgesetzt, Gerätetest offen.** Im Video-Import wählt „Modell“
    zwischen „Schnell“ (`pose_landmarker_lite`, Standard) und „Genau“ (`pose_landmarker_full`,
    ca. 9 MB, von der eigenen Adresse, fest versionierte URL und SHA-256 in `scripts/models.ts`,
    `SHIPPED_MODELS` in `src/lib/mediapipe.ts`, Service-Worker-Cache wie „lite“). Live-Tracking
    bleibt „lite“. Ein Modellwechsel nach der Analyse macht das Ergebnis veraltet wie eine
    Bereichsänderung; die Zusammenfassung nennt das Modell. Dev-Rohdaten enthalten `model`
    (optional, alte Exporte bleiben lesbar), Dateiname `…-full.posetrack.json`, das Tuning-Skript
    zeigt das Modell. Details:
    [architecture.md](architecture.md#modellwahl-schnell--genau-etappe-8g-4b). Tests
    `video-choreo-panel.test.tsx` (Standard „Schnell“, „Genau“ an die Fabrik, Wechsel macht
    ungültig, Export), `useVideoAnalysis.test.tsx`, `poseTrackFile.test.ts` (Feld `model`, alte
    Datei ohne Feld), `mediapipe.test.ts` (Abgleich mit `scripts/models.ts`), `tuning.test.ts`.
    Kein Formatwechsel.
    - Playwright (390×844 und 844×390, erzeugtes Testvideo ohne Person): Schalter sichtbar,
      „Schnell“ vorgewählt; mit „Genau“ lädt `pose_landmarker_full.task` (200, localhost), die
      Analyse läuft durch und meldet „zu selten eine Person erkannt“; Konsole nur mit den
      erwarteten CSP-/MediaPipe-Meldungen.
    - **Gerätetest 8g-4b (offen):**
      - [ ] Analysedauer „Schnell“ gegenüber „Genau“ für denselben 1-min-Abschnitt am iPhone
            und an Android (Dev-Diagnose „Analyse … s“)
      - [ ] Speicher und Abstürze mit „Genau“ (langer Abschnitt, mehrere Personen)
      - [ ] Erkennungsquote und Holdout-Fehler im Vergleich (Rohdaten beider Modelle exportieren)
  - **8g-4c Haltepunkt-Moves – umgesetzt, Gerätetest offen.** Im Video-Import wählt „Moves“
    zwischen „Fester Takt“ (Standard, alle 2 Beats) und „Haltepunkte“ (`movePlacement: "holds"`
    in `choreoFromPoseTrack`): je Fenster von 2 Beats der Beat mit der ruhigsten Pose
    (`poseMotionAt`, ±¼ Beat), mindestens max(300 ms, 1 Beat) Abstand, höchstens ein Move je Fenster,
    etwa so viele wie beim festen Takt. Die Wahl rechnet ohne neue Analyse neu. Neue Kennzahl `moveMotionDegPerS` (Diagnose,
    Spalte „Bew. °/s“ und `--placement=grid,holds` im Tuning-Skript), Dev-Rohdaten mit
    optionalem `movePlacement`. Details:
    [architecture.md](architecture.md#haltepunkt-moves-etappe-8g-4c),
    [choreography-format.md](choreography-format.md#video-import). Tests `videoChoreo.test.ts`
    (Haltepunkte statt Raster, Anzahl, Mindestabstand bei 240 BPM, Beat-Phase 600 und −400 ms, Randbeats, Standard unverändert,
    Kennzahl), `tuning.test.ts`, `poseTrackFile.test.ts`, `video-choreo-panel.test.tsx`. Kein
    Formatwechsel. Seit 8g-5 sind Haltepunkte Standard.
    - **Gerätetest 8g-4c (offen):**
      - [ ] Fühlen sich Moves mit „Haltepunkte“ im Spiel besser an als mit „Fester Takt“
            (gleiches Video, gleicher Abschnitt)?
  - **8g-5 Standardwerte aus der Messung – umgesetzt.** Zwei echte Videos (BTS Dance Practice,
    TikTok-Tanz, Modell „full“) mit `bun run tune-video`: One-Euro jetzt `minCutoff` 2,
    `beta` 40 statt 1 / 10 (Holdout-Fehler im Mittel 10,11° statt 10,41°; die alten Werte
    waren beim TikTok-Tanz schlechter als keine Glättung), Haltepunkte statt fester Takt als
    Standard (`DEFAULT_MOVE_PLACEMENT`, ruhigere Zielposen, bei BTS 33 statt 31 Moves). Alte
    Dev-Rohdaten ohne `movePlacement` rechnen weiter mit „grid“. `*.posetrack.json` in
    `.gitignore`. Details:
    [choreography-format.md](choreography-format.md#standardwerte-aus-der-messung-etappe-8g-5).
    Kein Formatwechsel.
    - **Offen:** weitere Videos (Party-Klassiker, Zumba) messen; Gerätetest 8g-4c
      (Spielgefühl mit Haltepunkte).
  - **8g-4d Selfie-Schalter bei Mirrored-Videos – umgesetzt.** `looksMirrored`
    (`src/lib/library/videoImport.ts`) erkennt gespiegelte Videos am Dateinamen („Mirrored“,
    „mirror“, „gespiegelt“ und „spiegelverkehrt“ als ganze Wörter, auch neben `_` und Ziffern
    und in camelCase, „거울“; „ungespiegelt“ und „nicht gespiegelt“ zählen nicht).
    Jede neue Datei belegt „Video ist gespiegelt“ danach vor (wie der Zeitbereich startet die
    Wahl je Datei neu); der Hinweis unter dem Schalter nennt den Grund, bis der Schalter
    angetippt wird, und erklärt immer, wann er gehört. Tests `videoImport.test.ts` (Treffer,
    „Mirrorball“ und Ähnliches kein Treffer), `video-choreo-panel.test.tsx` (Vorbelegung, Grund
    entfällt nach Antippen, neue Datei setzt neu). Kein Formatwechsel.
    - Playwright (390×844 und 844×390, erzeugtes Testvideo „Dance Practice (Mirrored).mp4“):
      Schalter eingeschaltet mit Grund im Hinweis, nach Antippen aus und nur der allgemeine
      Hinweis; Konsole ohne Fehler und Warnungen.
    - **Gerätetest 8g-4d (offen):**
      - [ ] Behält der Dateiname am iPhone und an Android den Titel (Auswahl aus „Dateien“
            bzw. Downloads)? Aus der Fotomediathek kommt meist `IMG_….MOV`, dann bleibt nur
            der Hinweis.
  - **8g-4 weitere Verbesserungen, nur nach Messung (offen):** Standard bleibt „lite“, bis die
    Messungen aus 8g-4b vorliegen; „heavy“ nur, wenn „full“ nicht reicht.

- **8h „Video behalten“ – 8h-1 und 8h-2a umgesetzt.**
  - **8h-1 Musik aus dem Tanzvideo – umgesetzt, Gerätetest offen.** Schalter „Musik aus dem
    Tanzvideo“ im Tab Datei, sobald „Aus Video“ gewählt ist (an, wenn noch keine Audiodatei
    gewählt war). Dann ist die Videodatei die Audiodatei des Songs (`local`-Blob, kein
    Formatwechsel); Video und Musik sind exakt synchron, ein yt-dlp-MP4 reicht. Der Dialog
    liest BPM, Länge und Hüllkurve aus dem Video, erst wenn der Tab Datei aktiv ist; „Takt
    erkennen“ nutzt die Hüllkurve ohne zweites Dekodieren. Höchstens 250 MB, der Hinweis nennt
    den belegten Speicher. Details:
    [architecture.md](architecture.md#musik-aus-dem-tanzvideo-etappe-8h-1). Tests
    `video-beat-detect.test.tsx` (Vorbelegung, Speichern mit dem Video als Blob, zu groß,
    unlesbarer Ton, nur im Tab Datei, Ausschalten). Playwright (390×844 und 844×390, erzeugtes
    Testvideo mit Klicks bei 120 BPM): Schalter vorgewählt, Ton gelesen, BPM 120 erkannt, Hinweise
    zum Speichern, `<audio>` spielt den Ton der MP4; Konsole nur mit den erwarteten CSP-Meldungen.
    - **Gerätetest 8h-1 (offen):**
      - [ ] iPhone (Safari) und Android (Chrome): Song mit MP4 und MOV als Musik spielt im
            Spiel, Sync-Test und Editor-Vorschau ab; Moves treffen die Musik ohne Korrektur
      - [ ] Speicher: 100–250-MB-Video speichern, Bibliothek bleibt bedienbar, Anzeige in den
            Einstellungen stimmt
  - **8h-2a Tanzvideo im Spiel zeigen – umgesetzt, Gerätetest offen.** Ist die Musik ein
    Tanzvideo (`local`-Blob mit Typ `video/*`), läuft es stumm im Platz des Coachs, ohne
    Formatwechsel. Zielzeit Spielzeit + `choreo.offsetMs` (folgt der Choreografie, nicht dem
    Ton), Korrektur per Seek erst ab 150 ms Abweichung, gedrosselt; außerhalb von „playing“
    pausiert und auf der Zielzeit. Nicht gespiegelt, bei Fehler zurück zum Coach. Einstellung
    „Tanzvideo zeigen“ (Standard an) in den Einstellungen und im Pausenmenü. Details:
    [architecture.md](architecture.md#tanzvideo-im-spiel-etappe-8h-2a). Tests
    `videoSync.test.ts`, `game-screen.test.tsx`, `settings.test.ts`.
    - Playwright (390×844 und 844×390, erzeugtes 20-s-Testvideo 640×360 mit Klicks, Song über
      Tab Datei mit dem MP4 als Audiodatei, `?sim=1`): Video unten links statt des Coachs
      (ca. 250×140 bzw. 292×164 px), läuft 1 s pro s ohne Sprünge, steht in der Pause,
      Schalter im Pausenmenü bringt den Coach zurück und speichert `danceVideo: false`;
      Konsole ohne Fehler und Warnungen. Das Dev-Abzeichen „SIMULATION“ überdeckt im Hochformat
      den rechten Rand des Videos (nur Dev).
    - **Gerätetest 8h-2a (offen):**
      - [ ] iPhone (Safari) und Android (Chrome): Video läuft flüssig neben der Musik aus
            demselben Blob, startet mit dem Countdown-Ende, steht in der Pause
      - [ ] Sichtbare Abweichung oder Sprünge (Seeks) zwischen Video, Coach-Timing und Musik,
            auch bei Tempo 0.75× / 1.25×; kein wiederholtes Ruckeln durch Nachspringen
      - [ ] Akku und Wärme bei einem ganzen Song mit Kamera und Video
  - **8h-2b (offen):** Video getrennt speichern, wenn die Musik eine eigene Datei ist (braucht
    ein Feld am Song, also Formatwechsel); Video in Editor-Vorschau und Sync-Test; Option für
    ein größeres Video-Layout.

Ursprüngliche Schritte:

1. Videodatei (mp4/mov) wählen, Vorschau-Player.
2. Optionen: Zeitbereich, Spiegeln (`mirrorChoreo`), bei mehreren Personen Zielperson antippen.
3. Analyse im Browser alle ~50 ms mit MediaPipe (Modell „heavy“, Bildmodus), Fortschritt,
   Abbruch. Seitenverhältnis des Videos an `computeAngles` übergeben.
4. Nachbearbeitung: Landmarks glätten (One-Euro-Filter oder gleitender Mittelwert), Winkel
   berechnen, Frames mit geringer Sichtbarkeit markieren (`lowVisibility`).
5. Beat-Erkennung aus separat geladener Audiodatei, Moves auf Beats quantisieren (`quantize`),
   BPM manuell korrigierbar.
6. Editor: Timeline mit Strichfigur-Vorschau, Keyframes löschen, Offset verschieben, Tempo
   0.75×/1×/1.25×, Gold Moves markieren (Vorschlag: 2–4 Moves mit größtem Bewegungsumfang).
7. Speichern nur als JSON über `SongRepository`; Video wird verworfen, außer „Video behalten“.

- Hook `useVideoAnalysis`.

### 9. Typen und Lint ✅

Bereits mit den Grundlagen erledigt (SDK-Typen, Lint 0 Funde).

### 10. Spotify (zuletzt) ✅ (Gerätetest mit echtem Konto offen)

- Vorher am Handy prüfen, ob das Web Playback SDK mobil überhaupt läuft (offen, Gerätetest; vor
  10b klären, sonst Spotify auf Desktop-Browser beschränken).

**10a Spotify-Verbindung ✅** (Gerätetest mit echtem Spotify-Konto offen)

- `src/lib/audio/spotifyAuth.ts`: PKCE mit `state`, Redirect nur über HTTPS oder
  `http://127.0.0.1`/`[::1]`, nie `localhost`; Verifier und `state` nach dem Tausch immer
  gelöscht; Token-Satz nur in `sessionStorage`, Erneuerung per Refresh-Token 60 s vor Ablauf,
  sonst verständliche Meldung (Teil von W6: Token-Ablauf).
- Route `/spotify-callback`, Abschnitt „Spotify“ in den Einstellungen (Client-ID, Redirect-URI,
  Hinweis „Premium nötig“, benannte Hosts, Status, Verbinden/Trennen).
- CSP `connect-src` um `accounts.spotify.com` und `api.spotify.com` erweitert.
- Details: [architecture.md](architecture.md#spotify-anmeldung-etappe-10a).

**10b-1 SpotifySource gehärtet ✅** (W6-Rest; Gerätetest mit echtem Konto offen)

- `startOffsetMs` über `position_ms` im play-Aufruf; Fortsetzen nach Pause per `resume()` statt
  Neustart; `play()` löst erst bei Wiedergabe auf, Ablehnung (`autoplay_failed`, 8 s ohne
  Wiedergabe) als `PlayRefusedError`.
- SDK-Laden mit Timeout und `onerror` (nicht zwischengespeichert), `ready` mit Timeout, `connect()`
  mit `false`; Fehler nach dem Laden (`account_error`, `playback_error`, `not_ready` …) über
  `onError`; `destroy()` während des Ladens still; Pause/Start von außen; Lautstärke vor `load()`.
- Tests `src/test/spotifySource.test.ts`. Details:
  [architecture.md](architecture.md#audiosource--spielzeit).
- **Gerätetest 10b-1 (offen, mit 10b-2):**
  - [ ] Start mit Intro-Sprung beginnt an der richtigen Stelle, Pause/Weiter setzt fort
  - [ ] Ende-Erkennung (`previous_tracks`) greift; 8-s-Ablehnung passt zur echten Startdauer
  - [ ] Pause in der Spotify-App am Handy öffnet das Pausemenü
  - [ ] Erster Start direkt nach `ready`: kommt von der Web API ein 404 „Device not found“
        (bekanntes SDK-Rennen)? Falls ja, einmal verzögert wiederholen
  - [ ] Reihenfolge `autoplay_failed` und Player-Zustand auf iOS (stumme Wiedergabe)

**10b-2 Spotify im Spiel ✅** (Gerätetest mit echtem Konto offen)

- `useAudioClock` lädt Spotify wie die anderen Quellen im Effekt. Abweichung vom Plan „`load()`
  im Klick-Handler“: Das SDK braucht die Geste nur für `activateElement()`, und das ruft
  `play()` auf. Lehnt der Browser den Start nach dem Countdown ab (iOS), holt der Tipp auf „Zum
  Starten tippen“ ihn im Tipp nach. Die Quelle existiert in der Aufstellhilfe noch nicht, ein
  Laden dort hätte einen geteilten Player über Routen gebraucht.
- Tab „Spotify“ in „Song hinzufügen“ (`parseSpotifyTrackUri` in `newSong.ts`, ersetzt das
  ungenutzte `parseSpotifyUri`), Hinweis bei fehlender Verbindung. Datenschutzhinweis in der
  Aufstellhilfe nennt sdk.scdn.co, accounts.spotify.com und api.spotify.com.
- Fehler beim Laden oder Abspielen eines Spotify-Songs: Overlay mit „Zu den Einstellungen“
  (dort verbinden bzw. neu verbinden) und „Zur Bibliothek“.
- **Gerätetest 10b-2 (offen):**
  - [ ] Desktop-Chrome mit Premium: Song anlegen, Aufstellhilfe, Spiel startet nach dem
        Countdown, Piktos passen zur Musik, Pause/Weiter/Neustart, Ende → Ergebnis
  - [ ] iPhone/Android: läuft das SDK überhaupt (sonst Spotify auf Desktop beschränken)? Start
        nach „Zum Starten tippen“
  - [ ] Konsole: keine CSP-Verstöße durch das SDK (die Policy regelt nur `connect-src`)
  - [ ] Ohne Verbindung bzw. mit abgelaufener Anmeldung: Overlay mit „Zu den Einstellungen“

**10c Sync-Test und Editor-Vorschau mit Spotify ✅** (Gerätetest offen)

- Sync-Test und Karte „Vorschau“ im Editor erzeugen auch für Spotify eine Quelle über
  `useAudioClock`; Start (`seek` und `play()`) läuft im Tipp. Hinweis „Zeitmessung ungenauer“
  im Sync-Test wie bei YouTube; Tempo bleibt für Spotify gesperrt (1×).
- Lade- oder Startfehler bei Spotify: Meldung plus „Zu den Einstellungen“.
- Einstellungen: Hinweis „folgt in einer späteren Etappe“ entfernt.
- **Gerätetest 10c (offen):**
  - [ ] Sync-Test mit Spotify: Taps ergeben einen plausiblen Offset (Streuung notieren)
  - [ ] Editor: „Ab Move N abspielen“ springt an die richtige Stelle, Klick passt zur Musik
  - [ ] Stopp und erneuter Start setzen fort bzw. springen korrekt
- **Gerätetest-Befund 10c (Desktop, 2026-10-20):** Verbinden, Song anlegen und Sync-Test liefen.
  Danach startete der Song weder im Spiel noch erneut im Sync-Test („Spotify konnte den Song
  nicht starten.“); nach „Neu verbinden“ (lädt die Seite neu) ging es genau einmal. Ursache:
  Jeder Screen legte einen eigenen Player an und trennte ihn beim Verlassen; ein neuer Player in
  derselben Seite ließ sich nicht mehr starten. **Behoben:** ein geteilter Player pro
  Seitenaufruf, Fehlermeldung mit HTTP-Status. Gerätetest offen:
  - [ ] Sync-Test → Spiel → Sync-Test → Editor-Vorschau ohne Neuladen: jedes Mal startet der Song
  - [ ] Beim Wechsel des Screens hört die Musik des vorigen Screens auf

### 11. Nice-to-have ⏳

Siehe N-Befunde unten. Optional später: Cloud-Sync der Bibliothek über einen noch offenen
Anbieter mit Login; dort nur Metadaten und Choreografie-JSON, nie Audiodateien.

### 12. Coach und Piktogramme ✅ (Gerätetest offen)

Coach als gefüllte, leuchtende Silhouette; Piktogramme im selben Stil mit Bewegungspfeilen.
Gilt für alle Songs, ohne Format- oder Bewertungswechsel, von nichts abhängig. Plan:
[plans/etappe-12.md](plans/etappe-12.md).

**12a Coach als Silhouette – umgesetzt, Gerätetest offen.** `drawCoach` zeichnet über das neue
`drawFigure` (`src/lib/game/draw.ts`) eine gefüllte Figur: Rumpf als abgerundetes Viereck, Gliedmaßen
als Kapseln (Oberarm/Oberschenkel dicker), Kopf, Hände, Füße; Verlauf von hellerer Songfarbe (oben)
zur Songfarbe, heller Rand und ein Glow pro Frame (Rand-Ebene auf Offscreen-Canvas, ein
`shadowBlur`). Landmarks mit `visibility < 0.5` lassen nur die betroffenen Teile weg. Maße, Rand,
Glow und Größe (Hoch 44vw/32dvh, Quer 30vw/48dvh) stehen als `COACH` in `src/theme.ts`. Tests:
`src/test/draw.test.ts`. Offen am Gerät: Bildrate (iPhone 11, Android Mittelklasse, mit Kamera und
Pose-Tracking), Lesbarkeit in 2 bis 3 m Abstand, Freiraum zu Score, Combo, Piktoleiste und
YouTube-Box in Hoch- und Querformat.

**12b Piktogramme mit Pfeilen – umgesetzt, Gerätetest offen.** `moveFigure` (`pikto.ts`, ersetzt
`stickFigure`) liefert die Landmarks im Einheitsraum (Höhe 1, zentriert, Rand `PIKTO.pad` = 0,07
für Kapselbreiten und Kopf; Sichtbarkeit bleibt erhalten). `selectArrows` wählt aus Händen,
Knöcheln und Hüftmitte die Wege zwischen vorigem und diesem Move: ab `PIKTO.arrowMinDist` (0,15
Figurhöhen), höchstens `PIKTO.maxArrows` (2, längste zuerst), quadratische Kurve mit
`PIKTO.arrowBend` (0,25 der Länge) vom Rumpf weg, Enden um `PIKTO.arrowTrim` (0,04) gekürzt;
unsichere Landmarks in einer der beiden Posen werden übersprungen. Gezeichnet über `drawFigure`
(Rand, Füllung in Songfarbe) mit Pfeilen in der Zweitfarbe mit dunkler Kontur und Pfeilspitze;
Gold mit breiterem, durchscheinendem Halo statt `shadowBlur` (kein Blur im Pikto-Pfad). Maße als
`PIKTO_FIGURE` in `src/theme.ts`. `createMoveFigureCache` unverändert. Tests: `pikto.test.ts`
(Einheitsbox, Pfeilauswahl, Biegung), `draw.test.ts` (Silhouetten, Bögen, kein Blur). Offen am
Gerät: Lesbarkeit der Pfeile auf Armlänge und aus 2 bis 3 m, Bildrate mit bis zu fünf Piktogrammen
in der Leiste.

**12c Prüfung – erledigt.** typecheck, test (1045), lint und build sauber. Playwright (projektlokaler
Server, Flags per `ps` geprüft) mit `?sim=1` in 390×844 und 844×390: Coach-Silhouette und
Piktogramme mit Pfeilen sichtbar, Score, Combo und Piktoleiste frei, Konsole ohne Fehler und
Warnungen. **Nur am Gerät prüfbar, nicht getestet:** FPS auf iPhone 11 und Android Mittelklasse,
Lesbarkeit aus 2 bis 3 m. Editor und Vorschau in Playwright nicht geprüft.

### 13. 3D-Kern und Choreo-Generator ⏳

Bewegung intern als `Skeleton3D` (Knochenrichtungen), 2D abgeleitet; Pose-Spur v2 und
Choreografie v2 mit optionalem `pose3d`; Motion-Paket aus Demo-Posen, Video-Import und AIST++
(Konverter in 13h); Generator mit Phrasen, Wiederholungen und Spiegelpaaren statt `autoChoreo`;
Messplatz. Kein 3D-Coach und keine 3D-Bewertung (Ausblick Etappen 15 und 16). Plan:
[plans/etappe-13.md](plans/etappe-13.md).

**13a Skeleton-Kern – umgesetzt.** Reine Logik in `src/lib/skeleton/`, kein Formatwechsel, Spiel,
Bewertung und UI unverändert: `Skeleton3D` mit Wurzel (Position, Gier) und 12 Knochenrichtungen,
`BONE_LENGTHS` passend zu `figure()`, Vektor-Helfer mit slerp (Gegenrichtung über die Vorderseite),
`fromLandmarks3d` (MediaPipe-Weltpunkte, unsichere Gelenke ohne Knochen), `project` (frontal
orthografisch, Hüfte bei y = 0,58, optionale Zusatzgier für Seitenansicht), `interpolate` und
`mirror3d`. Abweichung vom Plan: Die Projektion von `mirror3d` ist `mirrorLandmarks` der
Projektion mit x → 1 − x (gleiche Winkel wie `mirrorChoreo`), weil eine reine Umbenennung die
Figur von hinten zeigen würde. Konvention: [choreography-format.md](choreography-format.md#skeleton3d).
Tests: `src/test/skeleton.test.ts`.

**13b Demo-Posen über Skeleton3D – umgesetzt.** `figure3d(p)` (`src/lib/pose.ts`) liefert die
Strichfigur als flaches `Skeleton3D` (z = 0, Gier 0, `dy` als tiefere Wurzel); `figure()` ist
jetzt `project(figure3d(p))`. Die Posentabelle heißt `DEMO_POSES` und ist exportiert (erste
Quelle des Motion-Pakets in 13e); `build` und `autoChoreo` sind äußerlich gleich. Einzige
Abweichung: Die Nase liegt mit fester Halslänge statt „0,09 über den Schultern plus
Neigungsversatz“, bei den Demo-Posen (Neigung höchstens 10°) unter 0,002 verschoben; alle
anderen Gelenke und alle Winkel sind gleich. Tests: `src/test/figure3d.test.ts` (gegen eine
eingefrorene Kopie des alten `figure()`).

**13c Pose-Spur v2 mit Weltpunkten – umgesetzt.** Der Video-Import schreibt die
MediaPipe-Weltpunkte (Meter, Ursprung Hüftmitte) der Zielperson mit: `Landmark3dSchema` in
`src/lib/schema.ts` (`Landmark3d` jetzt aus `types.ts`, der Skeleton-Kern re-exportiert ihn),
`analyzeVideo` legt je Probe `worlds` parallel zu `poses` ab, `trackTarget` übernimmt die
Weltpunkte der gewählten Pose (1:1- und Mehrpersonen-Weg) als `PoseTrack.samples[].world`, und
`smoothTrack` glättet sie mit denselben One-Euro-Werten vorwärts und rückwärts (gleiche Regeln
für Lücken und unsichere Punkte; die 2D-Ausgabe ist bitgleich wie vorher). Der Rohdaten-Export
ist jetzt `dancebeat-pose-track` v2 mit optionalem `world` (auf 4 Nachkommastellen gerundet);
v1-Dateien bleiben lesbar, `world` in v1 wird abgelehnt. Choreografie und Live-Spiel unverändert.
Abweichung vom Plan: `detect` und `detectAll` bleiben wie sie sind (das Live-Spiel nutzt
`detect`, Weltpunkte erst ab Etappe 16); neu ist die optionale Methode `detectAllWorld`, die
`{ landmarks, world }` je Person liefert, und die Weltpunkte stehen parallel als `worlds` statt
in den Posen. Tests: Schema v1/v2, Glättung der Weltpunkte, Analyse mit Fake-Estimator,
`trackTarget` mit Weltpunkten, MediaPipe-Estimator. **Gerätetest offen:** ob das Auslesen der
Weltpunkte den Import messbar verlangsamt, und der Speicher: Der Import hält die Weltpunkte für
bis zu 3 Personen je Probe, die `MultiPoseTrack` braucht also etwa doppelt so viel Speicher.

**13d Choreografie v2 mit pose3d – umgesetzt.** `CHOREO_VERSION` ist 2: `FrameSchema` hat
optional `pose3d` (`Skeleton3DSchema`, Knochen aus `BONE_IDS`, Komponenten −1..1, unbekannte
Knochen abgelehnt). `Skeleton3D.bones` erlaubt jetzt ausdrücklich `undefined` je Knochen, damit
der zod-Typ und der Skeleton-Typ unter `exactOptionalPropertyTypes` gegenseitig zuweisbar sind
(Prüfung zur Compile-Zeit in `schema.ts`). `migrateChoreo` ist eine Schrittkette 0 → 1 → 2
(1 → 2 setzt nur die Version), IndexedDB `DB_VERSION` 3 mit demselben Upgrade-Durchlauf.
Exportdateien v1 bleiben lesbar, Export schreibt v2. `frameAt` interpoliert `pose3d` über
`interpolate`, `mirrorChoreo` spiegelt es mit `mirror3d`, `choreoFromPoseTrack` behält `world`
beim Zuschneiden und baut `pose3d` per `fromLandmarks3d` aus derselben geglätteten Probe
(Positionen und Knochen auf 3 Stellen, Gier auf 0,1°). `lerpAngle`/`angleDiff` liegen jetzt in
`src/lib/angle.ts` (von `pose.ts` re-exportiert), damit `pose.ts` `interpolate` ohne
Importzyklus nutzen kann. Größe einer synthetischen 3-Minuten-Choreo (1800 Frames, 33
Landmarks): `pose3d` an jedem Frame +57,8 %, mit 2 Stellen +51,3 %, ausgedünnt
+29,0 % (1,37 → 1,77 MB). Abweichung vom Plan: Wie dort als Ausweg vorgesehen, trägt nur etwa
jeder zweite Frame `pose3d` (nach der Beat-Phasen-Verschiebung ausgedünnt; erster und letzter
Frame behalten ihn, ebenso ein Frame, dessen Vorgänger keinen hat oder dessen Nachfolger keinen
Kandidaten hat). `frameAt` überbrückt höchstens einen Frame ohne `pose3d` (statt nur zwischen
zwei direkten Nachbarn zu interpolieren); auf einem Frame mit `pose3d` gibt es dessen Pose
unverändert zurück. Lücken in der 3D-Pose bleiben nur dort, wo das Video keine brauchbaren
Weltpunkte oder keine Körperachse lieferte. Mit echten Videos (Sichtbarkeit an vielen Punkten) dürfte der Anteil eher
kleiner sein, gemessen ist das nicht. Tests: `src/test/choreoV2.test.ts` (Schema mit und ohne
`pose3d`, Migration 1 → 2, `frameAt` mit gemischten Frames, Spiegeln, Import einer v1-Datei,
Video-Import mit und ohne Weltpunkte, Größe), IndexedDB-Upgrade von Version 2 in
`repository.test.ts`.

**13e-1 Motion-Paket (Startpaket) – umgesetzt.** `MotionClipSchema` und `MotionPackSchema`
(`MOTION_PACK_VERSION` 1) in `src/lib/schema.ts`, Typen in `types.ts`; reine Logik in
`src/lib/motionPack.ts` (Abstand als größter Knochenwinkel, `playability`, `energy`,
`difficulty`, vier Filter mit Begründung, Leader-Clustering mit Medoid, Spiegelpaare,
Übergangszählung, `buildMotionPack`, `loadMotionPack` per dynamischem `import()`, noch ohne
Aufrufer). `scripts/build-motion-pack.ts` (`bun run build-motion-pack`) schreibt
`src/data/motion-pack.json` aus `DEMO_POSES` und den neu exportierten `DEMO_SEQUENCES`: 12 Clips
(alle Demo-Posen inkl. `neutral`, keine verworfen), Spiegelpaare genau `left-up`/`right-up`,
`disco-l`/`disco-r`, `kick-l`/`kick-r`, Übergänge im Stil `party` aus den Demo-Songs. Schwellen
als benannte Konstanten, siehe [choreography-format.md](choreography-format.md#motion-paket).
Nach dem Gegenlesen verschärft: Bodenarbeit erkennt Liegen (Rumpf über 45° geneigt), Sitzen
(Knie nicht mindestens 0,1 m unter dem Becken) und Knien (Becken unter 0,55 Beinlängen über dem
Knöchel); der Posenabstand und die Geschwindigkeitsprüfung berücksichtigen die Gier; gruppiert
wird nur bei gleicher Länge und gleichen Stilen, und das Schema verlangt, dass Übergänge nur
Clips ihres Stils verbinden. Das Demo-Paket bleibt dabei unverändert.
Spiel, Bewertung und UI unverändert. Abweichungen vom Plan: 13e ist geteilt, Pose-Spuren aus dem
Video-Import als Quelle (Segmentierung an Haltepunkten) folgen in **13e-2** (siehe unten); das
Startpaket hat 12 statt 13 Posen (`DEMO_POSES` hat 12); `iconId` ist zusätzlich im Clip, damit
die Piktogramm-ID der Demo-Moves erhalten bleibt; Keyframe-Beats steigen streng (sonst wäre die
Winkelgeschwindigkeit undefiniert). Tests: `src/test/motionPack.test.ts` (Schema, jeder Filter
einzeln, Gruppierung, Spiegelpaare, Übergänge, Aktualität der JSON-Datei, Laden).

**13e-2 Video-Spuren als Quelle des Motion-Pakets – umgesetzt, Messung mit echter v2-Spur
offen.** `videoMotionSource` (`src/lib/motionPackVideo.ts`, nur vom Skript genutzt, nicht im
App-Bundle) importiert eine Dev-Rohdatei (`*.posetrack.json`) wie die App mit Haltepunkt-Moves
und schneidet je zwei aufeinanderfolgende Haltepunkte einen Clip: Länge = Beat-Abstand (1–4,
sonst verworfen), Anker auf dem eigenen Haltepunkt (`anchorBeat = beats`), Keyframes alle ¼ Beat
aus `frameAt(…).pose3d`, `sourceBpm` aus der Datei, ID `video:<slug>:<n>`, Quelle
`video:<Videoname>`, kein `iconId`; ohne 3D-Pose an Start oder Anker verworfen. Die Sequenz je
Video liefert die Übergänge. Neuer Filter `checkComplete` (alle 12 Knochen an jedem Keyframe);
`groupClips` wählt den Gruppenvertreter nur unter den Clips der frühesten Quelle, Demo-Clips mit
Piktogramm bleiben also Vertreter. `bun run build-motion-pack -- a.posetrack.json …` schreibt nach
`eval-results/motion-pack.video.json` und verweigert `src/data/motion-pack.json` (Rechte an fremden
Choreografien ungeklärt); `bun run eval-choreo --pack=…` misst das Ergebnis. Das ausgelieferte
Paket ist unverändert. Details: [choreography-format.md](choreography-format.md#motion-paket).
Tests: `src/test/motionPackVideo.test.ts` (unabhängig vom Code geschrieben: Clipform, Anker =
gehaltene Pose, Spiegelung, Ablehnungen, v1-Datei, Slug, `checkComplete`, Vorrang beim
Gruppieren, Demo- plus Videoquelle, Determinismus). **Befund:** Die beiden vorhandenen
Rohdateien (BTS, TikTok) sind v1 ohne Weltpunkte, liefern also keine Clips. Eine synthetische
v2-Kopie (Weltpunkte aus den 2D-Punkten) zerlegte BTS in 31 Clips, die alle an `checkComplete`
scheiterten, weil die Beine oft unsicher sind (6–11 von 12 Knochen). **Offen:** neue v2-Exporte
messen; falls die Beine regelmäßig fehlen, über fehlende Beinknochen entscheiden (z. B. aus der
Nachbarpose ergänzen oder Clips nur mit Armbewegung zulassen). Ob Video-Clips ausgeliefert
werden, entscheidet der Nutzer (Lizenzfrage wie 14-0).

**13g-0, 13f-1, 13g Generator und Messplatz – umgesetzt, Gerätetest offen.** Neue Songs mit
automatischer Choreografie bekommen sie vom Generator (`src/lib/generator/`) statt von der festen
Posenfolge. Reine Funktionen `planStructure` → `selectMoves` → `realizeFrames`, deterministisch
über den Seed (Song-ID, `src/lib/random.ts`). Aufbau: Intro ohne Moves, Phrasen zu 8 Beats im
Muster A A B A, Gruppen abwechselnd Strophe und Refrain (jeder Refrain identisch, Gold am Ende
jeder Refrain-B-Phrase), Dichte aus Schwierigkeit und Energie, Schlusspose. Auswahl:
gewichtete Markov-Kette über die Übergänge des Motion-Pakets mit Energiepassung,
Spiegelpaar-Bonus und Stufenbonus, ohne direkt wiederholten Clip. Frames: Keyframe-Zeitleiste mit
1 Beat Smoothstep-Überblendung, `pose3d` an jedem Frame, Landmarks per `project`, Winkel per
`computeAngles`. `autoChoreo(title, bpm, durationMs, colors, pack, opts)` nimmt das Paket
entgegen; „Song hinzufügen“ lädt es erst beim Speichern (`loadMotionPack`) und reicht Song-ID,
Schwierigkeit und bei Audiodateien Onset-Hüllkurve und Beat-Phase durch, Dev-Songs nutzen
Schwierigkeit 1. Die Demo-Songs sind unverändert. Details:
[choreography-format.md](choreography-format.md#generator).
Der Messplatz (`bun run eval-choreo`, `src/lib/generator/metrics.ts`) vergleicht mit der alten
Choreo, die als `legacyAutoChoreo` nur noch Basislinie ist (13g-0); Zahlen in
[choreography-format.md](choreography-format.md#messplatz). Er fand Geschwindigkeitsspitzen bis
2400°/s: Bei 180° Unterarmdrehung (z. B. „Locker“ → „Muskeln“) lief slerp je Knochen durch die
Blickachse. **Behoben** im Skeleton-Kern: `interpolate` führt Unterarm und Unterschenkel relativ
zum Elternknochen (`rotateBetween`), seitdem liegt der Generator bei allen Tempi unter der alten
Choreo (max 525–813°/s statt 599–991°/s, nach der `frameAt`-Korrektur unten 355–549°/s). Das betrifft auch `frameAt` für `pose3d` aus dem
Video-Import (nur gespeichert, nicht angezeigt) und das Motion-Paket (unverändert).
Rundungshelfer liegen jetzt gemeinsam in `src/lib/precision.ts`. Aus dem abschließenden
Review: `frameAt` interpoliert Frames mit höchstens 150 ms Abstand linear statt mit Smoothstep
(sonst ruckelte der Coach bei Generator- und Video-Choreos mit 10–20 Hz; Demo-Songs unverändert,
Gerätetest offen), `rotateBetween` nutzt die Antipoden-Schwelle von `slerp` und normiert seine
Eingaben, die Energiekurve überspringt nicht-endliche Werte. Abweichungen vom Plan: Refrain
als Wiederholung ganzer Gruppen (der Plan nannte nur A A B A), Gold nur am Ende der Refrain-B-Phrasen statt jeder
B-Phrase (sonst ~11 Gold-Moves in 3 Minuten), Mindestabstand zweier Moves `MIN_STEP_MS` (400 ms)
statt `MIN_MOVE_GAP_MS`, Schwierigkeit 2 verdichtet nur mit gemessener Energiekurve. Der
simulierte Spieler kann Varianten bei 10° Rauschen nicht unterscheiden (alle Moves PERFECT);
dafür gibt es `--noise` und `--miss`. Tests: `src/test/generator.test.ts` (unabhängig vom Code geschrieben; fand den latenten Fehler, dass Clips mit Anker > 0 Endmarge und Abstand verletzen
konnten, behoben: der Anker liegt auf dem Slot-Beat), `choreoMetrics.test.ts`, neue Fälle in
`skeleton.test.ts`, `newSong.test.ts`, `devSongs.test.ts`. Playwright (projektlokaler Server,
Flags per `ps` geprüft, 390×844 und 844×390): „Song hinzufügen“ (URL, Stufe 3, 128 BPM, 60 s)
legt eine Choreo mit 95 Moves an, `pose3d` an allen 503 Frames, Konsole ohne Fehler. Das Spiel
mit `?sim=1` konnte im Browser nicht geprüft werden (keine abspielbare Testdatei).
13f-2 (Knopf „neu erzeugen“, Stil und Schwierigkeit)
wartet auf Entscheidung 13-0.6; 13h bleibt offen. **Nur am Gerät prüfbar, nicht
getestet:** ob sich die Choreos besser anfühlen als die alte Posenfolge, ob dichte Stufe-3-Phrasen
(bis 2 Moves/s) mitzumachen sind, ob die Beat-Phase aus der Audiodatei die Moves hörbar auf den
Takt legt.

### 14. Neue Demo-Songs ⏳

Zwei bis drei Demos mit eigener Musik; Songaufbau per Manifest über den Generator aus 13
(fester Plan, Refrain identisch, Gold Moves am Höhepunkt); Credits. Braucht die Lizenzklärung
14-0 und die Etappen 12 und 13. Plan: [plans/etappe-14.md](plans/etappe-14.md).

## Offene Befunde

Aus dem Gegenlesen; erledigte stehen oben unter „Erledigt“.

| ID  | Befund                                                                 | Etappe |
| --- | ---------------------------------------------------------------------- | ------ |
| W6  | Spotify: Code erledigt (10a, 10b), Gerätetest mit echtem Konto offen   | 10b    |
| W7  | YouTube: Tipp aufs Video umgesetzt, iOS am Gerät offen                 | 3b     |
| W10 | iOS: Laden vor Nutzergeste (Code erledigt, URL-Quelle am Gerät prüfen) | 3b     |
| W13 | Kamera-Rückfall: Continuity-Kamera am Mac prüfen (Fehler, Hänger)      | 2      |
| N1  | `normalizeLandmarks` ungenutzt, prüft Sichtbarkeit nicht               | 11     |
| N2  | Sternquote kann über 100 % liegen; Stufen am Gerät abstimmen           | 11     |
