# Roadmap

Kleine, einzeln testbare Etappen. Jede Etappe endet mit grünem typecheck, test, lint und build
und einem eigenen Commit. Befundkennungen (K…, W…, N…) siehe [Offene Befunde](#offene-befunde).

Status: ✅ erledigt · 🔜 als Nächstes · ⏳ geplant

## Übersicht

| Etappe                                       | Status | Empfohlenes Modell                                                    |
| -------------------------------------------- | ------ | --------------------------------------------------------------------- |
| 1. Navigation, Layout, Menü, Song-Bibliothek | 🔜     | Sonnet                                                                |
| 2. Aufstellhilfe                             | ⏳     | Sonnet                                                                |
| 3. Gameplay                                  | ⏳     | Opus                                                                  |
| 4. Ergebnis-Screen und Highscores            | ⏳     | Sonnet                                                                |
| 5. Einstellungen, Sync-Test, Song hinzufügen | ⏳     | Sonnet für Formulare und Dialoge, Opus für Sync-Test und Kalibrierung |
| 6. Bewegungsmodus                            | ⏳     | Sonnet                                                                |
| 7. PWA und Gerätefunktionen                  | ⏳     | Sonnet                                                                |
| 8. Tanz aus Video erstellen                  | ⏳     | Opus                                                                  |
| 9. Typen und Lint                            | ✅     | –                                                                     |
| 10. Spotify                                  | ⏳     | Opus                                                                  |
| 11. Nice-to-have                             | ⏳     | je nach Punkt                                                         |

## Erledigt: Grundlagen

✅ Umstieg auf reines Vite + TanStack Router (kein TanStack Start, normale `index.html`).
✅ K1 Seitenverhältnis in der Winkelberechnung · K2 Aufräumen von Kamera und Landmarker ·
K3 Mindestabdeckung beim Scoring.
✅ W1 vorzeichenbehaftete Winkel, kürzester Bogen · W2 `mirrorChoreo`.
✅ Choreografie-Format v1 mit zod, `SongRepository`, IndexedDB-Migration, Export/Import-Logik,
Speicher-Helfer (W11 teilweise), Repository-Tests mit `fake-indexeddb`.
✅ SDK-Typen, Lint sauber · Quick Fixes (URL ohne CORS-Zwang, Lautstärke live, W8 teilweise) ·
Combo-Regel (OK hält, X bricht).

## Etappen

### 1. Navigation, Layout, Menü, Song-Bibliothek 🔜

- Routen unter `src/routes`: Startmenü, Bibliothek, Platzhalter für Spiel, Ergebnis, Einstellungen.
- Bibliothek mit den zwei Demo-Songs: große Cover-Kacheln, ausgewählter Song vergrößert,
  Hintergrund wechselt weich auf die Songfarbe. Pro Song Titel, Künstler, BPM, Schwierigkeit
  (1–3 Flammen), Highscore, Sterne. Löschen und Umbenennen (über `SongRepository`).
- Theme aus `src/theme.ts`, animierter Hintergrund, Safe Areas.
- Schrift Fredoka selbst hosten (Paket `@fontsource/fredoka` nur nach Freigabe).
- Test: Routen-Matching, Bibliothek rendert Demo-Songs.

### 2. Aufstellhilfe ⏳

- Kurze Erklärung, Kamera-Berechtigung, Live-Bild mit Silhouetten-Rahmen und Pose-Overlay auf
  Canvas. „Los geht's“ erst aktiv, wenn Schultern, Hüften, Knie und Knöchel erkannt werden.
- Hinweise: Kamerabilder verlassen das Gerät nie; beim ersten Start werden Erkennungsmodell und
  Laufzeit von jsDelivr und Google geladen (IP-Adresse wird übertragen, keine Bilder) (W12).
- Fehlermeldungen: Kamera verweigert, keine Kamera, Kamera belegt, Körper nicht sichtbar,
  schlechtes Licht, Beine fehlen.
- **Pose-Schnittstelle:** Erkennung hinter einer Schnittstelle kapseln, damit MediaPipe Pose
  Landmarker und MoveNet (TF.js) austauschbar sind (MoveNet nur nach Freigabe der Abhängigkeit).
  **FPS- und Inferenzzeit-Anzeige** zum Vergleich auf dem Handy.
- W4: kein `setState` pro Frame (Overlay per Callback auf Canvas), `requestVideoFrameCallback`
  statt 33-ms-Drossel, `NotReadableError`/`OverconstrainedError` (veraltete Kamera-ID →
  Standardkamera).

### 3. Gameplay ⏳

- Audio-Clock, Countdown 3-2-1, Piktoleiste, Coach-Strichfigur (Canvas), Score/Combo/Sterne,
  Wertungs-Popups, Gold-Move-Effekte, Pause. Bewertung alle ~100 ms. Design: [design.md](design.md).
- Start nur per Nutzergeste (Start-Button), nötig für YouTube und iOS.
- Fallback: Online-Quelle lädt nicht → Meldung und zurück zur Song-Auswahl.
- W3: `seekTo(t)` ohne Wertung (Intro überspringen, Pause), Soll-Winkel pro Move vorberechnen,
  `reset` bei Choreo-Wechsel.
- W5: Uhr bei YouTube erst bei PLAYING hart synchronisieren, bei BUFFERING/Pause anhalten.
- W7: YouTube-Player sichtbar, mindestens 200 × 200 px, in der Coach-Ecke; `seek` im Pausenzustand
  korrekt; ungenutztes Feld entfernen; iOS-Wiedergabe am Gerät prüfen.
- W9: `onError` in der AudioSource-Schnittstelle, `type` als Union, Doppelung `lowPrecision`
  auflösen; Lade-Race beim Song-Wechsel; `ended`/`error` zurücksetzen; `visibilitychange` →
  Pause.
- W10: iOS lädt Audio erst nach Geste: `loadedmetadata` plus Timeout, Start im Klick-Handler.
- Test: Scoring-Ablauf mit simulierter Zeit (inkl. Seek), Piktoleisten-Positionen.

### 4. Ergebnis-Screen und Highscores ⏳

- Score zählt hoch, Sterne nacheinander, Rangtitel, Zähler je Urteil, längste Combo, Konfetti ab
  5 Sternen, „Nochmal“ und „Anderer Song“.
- Highscore und Sterne pro Song im Song-Eintrag speichern (über `SongRepository`; die
  ursprüngliche Beschreibung nannte localStorage).

### 5. Einstellungen, Sync-Test, Kalibrierung, „Song hinzufügen“ ⏳

- Einstellungen: Kamera wählen, Lautstärke, globaler Latenz-Offset (Slider), Skelett an/aus,
  Schwierigkeit, Kamera spiegeln (nur Anzeige).
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

| ID  | Befund                                                                    | Etappe |
| --- | ------------------------------------------------------------------------- | ------ |
| W3  | Seek/Intro wertet frühere Moves als X; Soll-Winkel pro Aufruf neu         | 3      |
| W4  | `setState` pro Frame, effektiv ~20 FPS, fehlende Kamera-Fehlerfälle       | 2      |
| W5  | YouTube/Spotify-Uhr läuft beim Start vor                                  | 3      |
| W6  | Spotify: Start-Offset, SDK-Ladefehler, Fehler nach Laden, Token-Ablauf    | 10     |
| W7  | YouTube: sichtbarer Player ≥ 200 px, `seek` im Pausenzustand, iOS         | 3      |
| W9  | AudioSource ohne `onError`, Lade-Race, kein `visibilitychange`            | 3      |
| W10 | iOS: `canplay` vor Nutzergeste                                            | 3      |
| W11 | Persistenz anfragen, Speicheranzeige, Settings-Validierung                | 5      |
| W12 | Externe Abrufe in der UI benennen                                         | 2, 7   |
| N1  | `normalizeLandmarks` ungenutzt, prüft Sichtbarkeit nicht                  | 11     |
| N2  | Sternquote kann über 100 % liegen; Stufen am Gerät abstimmen              | 11     |
| N3  | `seedDemos` vertraut nur dem localStorage-Marker                          | 11     |
| N4  | `AudioContext` der Soundeffekte wird nicht per `resume()` entsperrt (iOS) | 11     |
| N6  | `@tanstack/react-query` bisher ungenutzt                                  | 11     |
| N7  | Bei `playbackRate ≠ 1` wird die Latenz nicht mit der Rate skaliert        | 11     |
