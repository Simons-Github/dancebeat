# DanceBeat – Spezifikation

Ursprüngliche Projektbeschreibung (Referenz, nicht zwingend der aktuelle Stand).

Baue eine mobile-first Web-App (PWA, Hoch- und Querformat) namens "DanceBeat": ein Tanzspiel im Stil von Just Dance, nur für eine Person, rein lokal und privat. Sprache der UI: Deutsch. Stack: React, TypeScript, Vite, Tailwind, shadcn/ui, Framer Motion. Kein Backend, keine Accounts, kein Mehrspieler, keine Ranglisten, keine Online-Funktionen.

ZIEL
Der Spieler stellt das Handy auf, tanzt vor der Frontkamera, und die App bewertet in Echtzeit, wie genau seine Bewegungen zur Referenz-Choreografie passen.

=== SCREENS ===

1. Onboarding / Aufstellhilfe: Kurze Erklärung, Kamera-Berechtigung anfordern, Live-Kamerabild mit Silhouetten-Rahmen. "Los geht's" wird erst aktiv, wenn Schultern, Hüften, Knie und Knöchel erkannt werden. Hinweis: Kamerabilder verlassen das Gerät nie.
2. Song-Bibliothek: Große Cover-Kacheln, ausgewählter Song wird vergrößert, Hintergrund wechselt weich auf die Songfarbe. Pro Song: Titel, Künstler, BPM, Schwierigkeit (1-3 Flammen), Highscore, Sterne. Funktionen: Song hinzufügen, löschen, umbenennen.
3. Gameplay (siehe unten).
4. Ergebnis: Score zählt hoch, Sterne poppen nacheinander auf, Rangbezeichnung (z. B. "SUPERSTAR"), Anzahl PERFECT/SUPER/GOOD/OK/X, längste Combo, Konfetti ab 5 Sternen, Buttons "Nochmal" und "Anderer Song". Highscore pro Song in localStorage.
5. Einstellungen: Kamera wählen, Lautstärke, globaler Latenz-Offset (Slider), Skelett-Overlay an/aus, Schwierigkeit, Kamera spiegeln.
6. "Tanz aus Video erstellen" (siehe Video-Import).

=== SONG-QUELLEN (lokal und online) ===
Jeder Song hat ein Feld "source" mit einem der folgenden Typen. Die Spiel-Logik arbeitet nur mit einer gemeinsamen Schnittstelle AudioSource:
interface AudioSource { load(): Promise<void>; play(): Promise<void>; pause(): void; seek(ms: number): void; getTimeMs(): number; setVolume(v: number): void; onEnded(cb): void; type: string }

Adapter:

1. "local": Audiodatei aus IndexedDB (HTMLAudioElement oder Web Audio, Zeit über audio.currentTime / AudioContext.currentTime).
2. "url": direkte Audio-URL (mp3/m4a), die der Nutzer selbst eingibt, geladen per HTMLAudioElement. Hinweis im UI: nur eigene oder private Quellen verwenden. CORS-Fehler verständlich melden.
3. "youtube": YouTube-IFrame-Player mit Video-ID oder Link, in einem kleinen oder versteckten Container eingebettet. Zeit über player.getCurrentTime(), pollend alle ~16 ms mit interpolierter Zeit (zwischen den Abfragen per performance.now() fortschreiben und alle 500 ms an die API-Zeit angleichen, um Sprünge zu glätten). Play muss durch eine Nutzer-Geste starten (Start-Button). Offset und Drift-Korrektur beachten.
4. "spotify": Spotify Web Playback SDK mit OAuth (PKCE, kein Client-Secret im Frontend). Hinweis im UI: Premium nötig. Fehler "account_error" und "autoplay_failed" verständlich behandeln. Player-Initialisierung innerhalb eines Klick-Handlers (iOS/Safari). Zeit aus den Player-Zustandsdaten (position, timestamp) plus lokale Interpolation.

Song hinzufügen: Dialog mit Tabs "Datei", "URL", "YouTube", "Spotify". Bei Online-Quellen manuelle Eingabe oder Import der BPM, da keine Audioanalyse möglich ist. Pro Song: Sync-Offset mit Vorschau, optionaler Start-Offset (Intro überspringen).

Kalibrierung: Ein "Sync-Test" pro Song, bei dem der Nutzer zum erkannten Beat tippt, die App berechnet den Offset und speichert ihn pro Song. Zeige ein Warnsymbol bei Quellen mit geringer Timing-Genauigkeit (YouTube, Spotify).

Fallback: Wenn die Online-Quelle nicht lädt, Meldung anzeigen und Song-Auswahl anbieten. Die Daten der Songs (Metadaten, Choreografie, Offsets) bleiben in IndexedDB. Zugangsdaten und Tokens nur im Speicher bzw. sessionStorage.

Optional (spätere Etappe): Cloud-Sync der Song-Bibliothek und Choreografien über einen noch offenen Anbieter, mit Login. Es werden dort nur Metadaten und Choreografie-JSON gespeichert, nie urheberrechtlich geschützte Audiodateien.

=== CHOREOGRAFIE-FORMAT (reine Daten) ===
{
"title": "...", "bpm": 120, "offsetMs": 0,
"accentColor": "#FF2E93", "secondaryColor": "#00E5FF",
"frames": [{ "timeMs": 0,
"landmarks": [[x,y] bis zu 33, optional mit visibility],
"angles": { "leftElbow":0, "rightElbow":0, "leftShoulder":0, "rightShoulder":0,
"leftHip":0, "rightHip":0, "leftKnee":0, "rightKnee":0, "torsoLean":0 } }],
"moves": [{ "timeMs": 1500, "label": "Arme hoch", "iconId": "arms-up", "gold": false }]
}

- Der Coach (Strichmännchen) wird aus Landmarks bzw. Winkeln flüssig interpoliert animiert.
- Piktogramme werden automatisch aus den Landmarks des jeweiligen Moves als Strichfiguren gezeichnet (SVG).

=== POSE-ERKENNUNG ===

- MediaPipe Pose Landmarker (@mediapipe/tasks-vision) im Browser, GPU-Delegate, ca. 30 FPS im Live-Modus. Alle Daten bleiben lokal.
- Berechne Gelenkwinkel: Ellbogen, Schulter, Hüfte, Knie links/rechts, Rumpfneigung. Normalisiere nach Körpergröße (Abstand zur Kamera egal).
- Landmarks mit visibility < 0.5 werden ignoriert, bewertet werden nur sichtbare Gelenke (Hinweis anzeigen, wenn Beine fehlen).

=== BEWERTUNG ===

- Kontinuierlich: Alle ~100 ms Vergleich der Spieler-Winkel mit den Soll-Winkeln im Zeitfenster ±250 ms um jeden Move, die beste Übereinstimmung zählt. Arme höher gewichtet als Beine.
- Durchschnittliche Abweichung: <15° PERFECT, <30° SUPER, <45° GOOD, <60° OK, sonst X. Punkte 1000/700/400/200/0. Combo-Multiplikator bis x4. Schwierigkeit verändert die Toleranz.
- Gold Moves zählen 5-fach, mit eigenem Feedback.
- 5 Sterne plus goldene Mega-Star-Stufe, Fortschrittsleiste für Sterne.

=== AUDIO UND TIMING ===

- audio.currentTime bzw. Web Audio API ist die einzige Zeitquelle. Berücksichtige globalen Latenz-Offset und Song-Offset. Kalibrierungsmodus: Spieler tippt zum Beat, App berechnet den Offset.

=== GAMEPLAY-SCREEN ===

- Gespiegeltes Vollbild-Kamerabild mit leichtem Farbfilter in Songfarbe (ca. 20 %) und Vignette. Halbtransparentes Skelett-Overlay des Spielers.
- Piktoleiste: stark abgerundete, halbtransparente weiße oder songfarbene Leiste am oberen Rand, kleines Dreieck als Zielmarke. Dicke, einfarbige Strichfiguren laufen von rechts zur Marke, blitzen dort weiß auf und verblassen. Körperfarbe = Songfarbe, Pfeile/Wackellinien in der Zweitfarbe.
- Gold Moves: Piktogramm komplett golden mit goldener Kontur und pulsierendem Glow, Partikel-Effekt um den Spieler, großer "GOLD MOVE"-Schriftzug, bei Erfolg "YEAH!" mit Sternenexplosion, bei Misserfolg rotes "X".
- Wertungs-Popups (PERFECT, SUPER, GOOD, OK, X): große animierte Schriftzüge, die aufsteigen und ausblenden.
- Oben Score, Combo und Sternleiste. Coach-Silhouette (einfarbig in Songfarbe mit Glow) in einer Ecke. Dezenter Beat-Puls am Rand.
- Countdown 3-2-1, Pause-Button, Haptik per navigator.vibrate bei PERFECT, Wake Lock API gegen Bildschirmabschaltung.
- Kein Scrollen im Gameplay.

=== VIDEO-IMPORT: "TANZ AUS VIDEO ERSTELLEN" ===

1. Videodatei auswählen (mp4/mov) mit Vorschau-Player.
2. Optionen: Zeitbereich (Start/Ende), Spiegeln-Schalter, bei mehreren Personen die Zielperson per Antippen auswählen.
3. Analyse: Das Video wird im Browser Frame für Frame (alle ~50 ms) durch MediaPipe Pose Landmarker (Modell "heavy", Bildmodus) geschickt. Fortschrittsbalken, Abbruch möglich.
4. Nachbearbeitung: Landmarks glätten (One-Euro-Filter oder gleitender Mittelwert), Winkel berechnen, Frames mit geringer Sichtbarkeit markieren.
5. Beat-Erkennung: BPM aus der separat geladenen Audiodatei schätzen (Onset-Detection per Web Audio), Moves auf Beats quantisieren. BPM manuell korrigierbar.
6. Editor: Timeline mit Strichmännchen-Vorschau, Keyframes löschen, Offset verschieben, Tempo 0.75x/1x/1.25x, Gold Moves manuell markieren (Vorschlag: 2-4 Moves mit größtem Bewegungsumfang).
7. Speichern nur als JSON in IndexedDB. Das Video wird nach der Analyse verworfen, außer der Nutzer wählt "Video behalten".

=== DESIGN: STIL VON JUST DANCE (nachempfunden, KEINE Originalassets, Logos, Fonts oder Charaktere) ===

- Bunt, energiegeladen, poppig, flache Formen mit weichen Verläufen. Nicht einfach dunkles Neon. Jeder Song hat eine eigene Akzentfarbe, die Hintergrundverlauf, Banner, Piktogramme und Effekte einfärbt.
- Große, fette, abgerundete Sans-Serif (Poppins ExtraBold, Baloo 2 oder Fredoka), Titel in Großbuchstaben mit leichter Schräglage.
- Abgerundete Karten, Pill-Buttons, Schlagschatten und Glow, federnde Animationen (Framer Motion Spring), alles reagiert leicht auf den Beat.
- Animierter Farbverlauf-Hintergrund mit treibenden Formen (Dreiecke, Kreise, Konfetti), im Menü wie im Ergebnis-Screen.
- Kurze, synthetisch erzeugte Soundeffekte für Menü-Klick, PERFECT und Gold Move.
- Mobile-first, große Touch-Flächen, Safe-Area-Insets beachten.
- Zentrale Theme-Datei src/theme.ts (Songfarben, Goldton, Fonts, Animationskonstanten).

=== TECHNISCHES ===

- Ordner: components, hooks, lib, data, routes (TanStack Router statt pages). Hooks: usePoseTracking, useAudioClock, useScoring, useSongLibrary (IndexedDB), useVideoAnalysis.
- Gute Fehlermeldungen: Kamera verweigert, Körper nicht sichtbar, schlechtes Licht, Audio nicht dekodierbar.
- PWA-Manifest und Service Worker, damit die App zum Homescreen hinzugefügt werden kann.

=== FALLBACK "BEWEGUNGSMODUS" ===

- Wenn keine Kamera erlaubt ist: Handy in der Hand halten. DeviceMotion (inkl. iOS-Berechtigungsabfrage) misst die Bewegungsintensität im Takt des Beats.
