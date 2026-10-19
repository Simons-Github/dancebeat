# Roadmap

Kleine, einzeln testbare Etappen. Jede Etappe endet mit grünem typecheck, test, lint und build
und einem eigenen Commit. Befundkennungen (K…, W…, N…) siehe [Offene Befunde](#offene-befunde).

Status: ✅ erledigt · 🔜 als Nächstes · ⏳ geplant

## Übersicht

| Etappe                                       | Status                     | Empfohlenes Modell                                                    |
| -------------------------------------------- | -------------------------- | --------------------------------------------------------------------- |
| 1. Navigation, Layout, Menü, Song-Bibliothek | ✅                         | Sonnet                                                                |
| 2. Aufstellhilfe                             | ✅                         | Sonnet                                                                |
| 3. Gameplay                                  | 🔜 (3a, 3b ohne Schritt 5) | Opus                                                                  |
| 4. Ergebnis-Screen und Highscores            | ✅                         | Sonnet                                                                |
| 5. Einstellungen, Sync-Test, Song hinzufügen | 🔜 (5a, 5b)                | Sonnet für Formulare und Dialoge, Opus für Sync-Test und Kalibrierung |
| 6. Bewegungsmodus                            | ⏳                         | Sonnet                                                                |
| 7. PWA und Gerätefunktionen                  | ⏳                         | Sonnet                                                                |
| 8. Tanz aus Video erstellen                  | ⏳                         | Opus                                                                  |
| 9. Typen und Lint                            | ✅                         | –                                                                     |
| 10. Spotify                                  | ⏳                         | Opus                                                                  |
| 11. Nice-to-have                             | ⏳                         | je nach Punkt                                                         |

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
✅ N3 (Etappe 5b): Seed-Regel prüft die Bibliothek, gelöschte Demos bleiben weg.
✅ W5, W9 (Rest) (Etappe 3b): YouTube-Uhr nur bei PLAYING, `onError` in `AudioSource`.
W7 (sichtbarer Player, Seek im Pausenzustand, Feld entfernt, Tipp aufs Video startet), iOS am
Gerät offen. W10: Code erledigt (Uhr hält bei `waiting`), iOS am Gerät offen.

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

### 3. Gameplay 🔜 (3a umgesetzt, 3b umgesetzt bis auf Schritt 5)

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
  4 s (UNSTARTED/CUED) bzw. 15 s (BUFFERING) erkannt und als `blocked` gezeigt.
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

### 5. Einstellungen, Sync-Test, Kalibrierung, „Song hinzufügen“ 🔜 (5a, 5b umgesetzt)

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

**Noch offen in Etappe 5:**

- Sync-Test pro Song: zum Beat tippen, Offset berechnen und speichern. Warnsymbol bei Quellen mit
  geringer Timing-Genauigkeit (YouTube, Spotify).
- Dialog „Song hinzufügen“ mit Tabs Datei, URL, YouTube (Spotify erst mit Etappe 10). Datei: BPM
  per Analyse (`estimateBpm`) mit manueller Korrektur; Online-Quellen: BPM manuell. Pro Song
  Sync-Offset mit Vorschau und optionaler Start-Offset. Hinweis bei URL: nur eigene oder private
  Quellen.
- Choreografie exportieren und importieren (JSON-Datei, ohne Audio).
- W11 Rest: `requestPersistentStorage()` beim ersten Speichern, Anzeige des belegten Speichers
  (`getStorageUsage`), `StorageFullError` verständlich anzeigen. Settings beim Lesen mit zod
  prüfen.
- Fehlermeldung bei nicht dekodierbarer Audiodatei („Bitte MP3, M4A, WAV oder OGG verwenden“).

### 6. Bewegungsmodus ⏳

- Wenn keine Kamera erlaubt ist: Handy in der Hand halten. DeviceMotion (inkl.
  iOS-Berechtigungsabfrage) misst die Bewegungsintensität im Takt; Bewertung über
  `intensityRating` in `useScoring`.

### 7. PWA und Gerätefunktionen ⏳

- Web-App-Manifest, Service Worker (Offline, Homescreen), Wake Lock, Haptik
  (`navigator.vibrate` bei PERFECT).
- MediaPipe-WASM und Pose-Modell lokal in `public/`, damit nach der Installation keine externen
  Abrufe mehr nötig sind (W12: Hinweistext dann anpassen).

### 8. „Tanz aus Video erstellen“ mit Editor ⏳

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

### 10. Spotify (zuletzt) ⏳

- Vorher am Handy prüfen, ob das Web Playback SDK mobil überhaupt läuft.
- W6: `startOffsetMs` über `position_ms` im play-Aufruf; Timeout und `onerror` beim Laden des
  SDK; Fehler nach dem Laden (`autoplay_failed`, `account_error`) melden; Token-Ablauf nach 1 h
  verständlich behandeln.
- Route `/spotify-callback`. Redirect nur über HTTPS oder `http://127.0.0.1`, nie `localhost`.
  Verifier nach dem Tausch löschen. Hinweis „Premium nötig“. Player-Initialisierung im
  Klick-Handler (iOS/Safari).

### 11. Nice-to-have ⏳

Siehe N-Befunde unten. Optional später: Cloud-Sync der Bibliothek über einen noch offenen
Anbieter mit Login; dort nur Metadaten und Choreografie-JSON, nie Audiodateien.

## Offene Befunde

Aus dem Gegenlesen; erledigte stehen oben unter „Erledigt“.

| ID  | Befund                                                                                                                           | Etappe |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| W6  | Spotify: Start-Offset, SDK-Ladefehler, Fehler nach Laden, Token-Ablauf                                                           | 10     |
| W7  | YouTube: Tipp aufs Video umgesetzt, iOS am Gerät offen                                                                           | 3b     |
| W10 | iOS: Laden vor Nutzergeste (Code erledigt, URL-Quelle am Gerät prüfen)                                                           | 3b     |
| W11 | Teilweise: Settings-Validierung erledigt (5a); Persistenz-Anfrage und `StorageFullError`-Anzeige offen                           | 5      |
| W12 | Externe Abrufe in der UI benennen (Aufstellhilfe erledigt, Hinweis in 7)                                                         | 7      |
| N1  | `normalizeLandmarks` ungenutzt, prüft Sichtbarkeit nicht                                                                         | 11     |
| N2  | Sternquote kann über 100 % liegen; Stufen am Gerät abstimmen                                                                     | 11     |
| N6  | `@tanstack/react-query` bisher ungenutzt                                                                                         | 11     |
| N7  | Bei `playbackRate ≠ 1` wird die Latenz nicht mit der Rate skaliert (Bildalter schon)                                             | 11     |
| N8  | `YouTubeSource.load`: Timeout 15000 als feste Zahl statt Konstante                                                               | 11     |
| N9  | „YouTube-Video lädt nicht“ erscheint nie: der Controller zeigt jede Ablehnung von `play()` als `blocked`                         | 11     |
| N10 | YouTube ignoriert `song.playbackRate`                                                                                            | 11     |
| N11 | `index.html` ist nicht Prettier-konform (`bun run format` ändert sie jedes Mal)                                                  | 11     |
| N12 | Aufstellhilfe im Querformat (844×390): Karte oben unter der Kopfzeile, Knöpfe unten abgeschnitten, kein Scrollen (seit Etappe 2) | 5      |
