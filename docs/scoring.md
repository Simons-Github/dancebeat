# Bewertung

Code: `src/lib/scoring.ts` (reine Funktionen), `src/lib/scorer.ts` (Klasse `Scorer`, der Ablauf
ohne React), `src/hooks/useScoring.ts` (React-Anbindung) und `src/lib/game/controller.ts`
(Bewertungsschleife im Spiel).
Abweichungen von der ursprünglichen Beschreibung sind mit **Abweichung** markiert.

## Ablauf

1. Die Spielschleife (`GameController.tick`, einmal pro Animationsframe) ruft
   `sample(t, angles)` auf, sobald seit der letzten Probe mindestens **100 ms Spielzeit** vergangen
   sind und ein neues Kamerabild vorliegt.
2. `t` ist die Spielzeit **des Bildes**, nicht der Ankunft des Erkennungsergebnisses (siehe
   [Zeitbasis](#zeitbasis)).
3. Für jeden Move, dessen Fenster `t` enthält (**±250 ms** um `move.timeMs`), wird die
   Abweichung zu den Soll-Winkeln berechnet. Pro Move zählt die **beste** (kleinste) Abweichung.
   Die Soll-Winkel werden einmal pro Move vorberechnet (`frameAt` zum Zeitpunkt `move.timeMs`).
4. Ist das Fenster vorbei, wird der Move bewertet: Punkte, Combo, Zähler, letztes Urteil.
5. Gab es im Fenster keine bewertbare Pose, ist das Urteil **X**. Kommen gar keine Kamerabilder
   mehr (über 400 ms), schließt die Uhr die Fenster trotzdem (`sample(t − 400, null)`), damit die
   Wertung nicht hängt.
6. Sieht die Kamera 2,5 s lang keine Schultern bzw. Arme, zeigt das Spiel „Wir sehen dich nicht.
   Stell dich wieder ganz ins Bild.“ Die Moves in dieser Zeit sind trotzdem X.

React rendert nur, wenn ein Move bewertet wurde (etwa einmal pro Move), nie pro Probe.

## Zeitbasis

- Spielzeit kommt nur aus `useAudioClock().timeMs()`:
  `Audioposition − globale Latenz · Rate − song.syncOffsetMs − choreo.offsetMs` (`gameTimeMs` in
  `src/lib/audio/clock.ts`). `startOffsetMs` ist ein Sprung der Audioposition und steckt darin. „Rate“ ist die effektive
  Wiedergaberate (`effectivePlaybackRate`, YouTube/Spotify immer 1): die Latenz ist Wandzeit und
  entspricht bei Rate r `Latenz · r` ms Audio.
- **Verzögerung der Pose-Erkennung (neu):** `usePoseTracking` meldet je Bild das Alter
  `frameAgeMs`: vom Aufnahmezeitpunkt (`captureTime` aus den Video-Frame-Metadaten, wenn der
  Browser einen plausiblen Wert unter 300 ms liefert) oder sonst vom Beginn der Erkennung bis zum
  Ergebnis. Das Spiel legt die Winkel unter `timeMs() − frameAgeMs × Rate` (effektive Rate) ab.
  **Warum so:** Die Inferenz dauert auf dem Handy 20–40 ms und schwankt; ohne Abzug würde jede
  Pose zu spät einsortiert und die Schwankung käme als Zittern in die Wertung. Die Basis bleibt die
  Audiouhr; abgezogen wird nur eine Dauer, die auf derselben monotonen Uhr gemessen ist wie die
  Bildzeitstempel. Werte außerhalb 0–500 ms gelten als 0. Was davor liegt (Kamera bis
  Bildübergabe, Bildschirm, Lautsprecher), bleibt im globalen Latenz-Offset (Kalibrierung in
  Etappe 5).
- Countdown und Pausen-Countdown laufen über `setTimeout`; das ist keine Bewertung.

## Sync-Test pro Song

Route `/sync/$songId` (`SyncTestScreen`, erreichbar über „Sync-Test“ im Dialog „Song
bearbeiten“). Der Song läuft ab `startOffsetMs`; der Spieler tippt im Takt auf die Fläche oder
drückt die Leertaste. Jeder Tipp speichert `AudioSource.getTimeMs()`, abzüglich des Alters des Eingabe-Events
(`performance.now() − event.timeStamp`, mal effektive Rate, YouTube/Spotify: 1; Werte außerhalb 0–200 ms gelten als 0,
`tapAudioMs`, wie `frameGameTimeMs`); nur Taps bei laufender Musik
zählen. Die Berechnung steckt in `computeSyncOffset` (`src/lib/sync.ts`):

1. Die ersten 2 Taps fallen weg (`SYNC_DISCARD_TAPS`, Einschwingen). Danach braucht es mindestens
   8 Taps (`SYNC_MIN_TAPS`), sonst gibt es keinen Vorschlag.
2. Je Tap: Rest `r = tap − Latenz · Rate − choreo.offsetMs` modulo Beatlänge `60000 / bpm`, gewickelt
   nach (−Beat/2, +Beat/2].
3. Die Reste sind zyklisch (ein Tipp knapp vor und einer knapp nach dem Beat liegen nah
   beieinander). Deshalb: zyklischer Mittelwert als Zentrum, Reste um das Zentrum neu wickeln,
   dann Median.
4. Ausreißer weiter als max(60 ms, 3 × MAD) vom Median fallen weg (`SYNC_OUTLIER_FLOOR_MS`).
5. Vorschlag = Zentrum + Median, gewickelt und auf ganze ms gerundet. Streuung = Median der absoluten Abweichung (MAD) der verbleibenden Taps. Über 45 ms (`SYNC_MAX_SPREAD_MS`) zeigt der Screen
   „Ungleichmäßig, nochmal versuchen.“

**Vorzeichen:** `Spielzeit = Audio − Latenz · Rate − syncOffsetMs − choreo.offsetMs`. Mit
`syncOffsetMs = Vorschlag` liegt die Spielzeit im Moment, in dem der Spieler den Beat hört und
tippt, auf dem Raster `k · Beatlänge`. Positiv heißt: der Spieler hört den Beat später, als die
Audioposition sagt; die Choreografie rückt nach hinten. Der Wert ist nur bis auf einen ganzen
Beat bestimmt (Bereich ±Beat/2). Die globale Latenz bleibt davon getrennt: der Sync-Offset misst
nur, was nach Abzug der Latenz pro Song übrig bleibt.

**Annahme:** Die Moves liegen auf dem Beatraster `k · 60000 / bpm + choreo.offsetMs` (so legt
`autoChoreo` sie an). Importierte Choreografien, deren Moves neben diesem Raster liegen, deckt der
Sync-Test nicht ab. **Nur am Gerät prüfbar:** Die Verzögerung vor dem Eingabe-Event
(Touch-Hardware, Abtastrate des Displays) steckt weiter in den Taps und damit im Vorschlag.

**Feinjustierung:** Der Screen arbeitet mit einem Arbeitswert, der mit dem gespeicherten
`syncOffsetMs` beginnt. „Vorschlag übernehmen“ setzt ihn auf den Vorschlag, die Knöpfe −10, −1, +1
und +10 ms verschieben ihn (`nudgeSyncOffset`: ganze ms, begrenzt auf ±1000 ms,
`SYNC_MANUAL_MAX_MS`). Die Live-Liste zeigt je Tap die Abweichung vom Raster mit dem
**Arbeitswert** (`beatDeviationMs`).

**Vorschau (Beat-Licht):** Solange die Musik läuft, blinkt ein runder Punkt in der Songfarbe. Die
Zeit kommt aus `AudioSource.getTimeMs()`, umgerechnet mit `gameTimeMs` (Latenz, Arbeitswert,
`choreo.offsetMs`); das Licht leuchtet also dann, wenn die Choreografie mit diesem Offset einen
Beat sieht. Helligkeit `beatFlashLevel`: 1 genau auf dem Beat, linear aus über
`SYNC_PREVIEW.decayMs` (`src/theme.ts`). Höchstens 3 Blitze pro Sekunde (`MAX_PULSE_HZ`, wie der
Beat-Puls im Spiel): bei schnellen Songs blinkt nur jeder n-te Beat (`beatFlashDivisor`). Die
Schleife läuft per `requestAnimationFrame` und schreibt `style` direkt, ohne React-Render pro
Frame. Bei `prefers-reduced-motion` ändert sich nur die Deckkraft, ohne Skalierung.

„Speichern“ schreibt den Arbeitswert über `useSongLibrary().save` (`SongRepository`) und kehrt zur
Bibliothek zurück; ohne Änderung ist der Knopf gesperrt. „Auf 0 zurücksetzen“ setzt den
Arbeitswert auf 0 und speichert sofort. Bei YouTube und Spotify (`isLowPrecision`) warnt der
Screen, dass die Zeitmessung ungenauer ist. **Nur am Gerät prüfbar:** ob das Licht mit dem
gehörten Beat übereinstimmt (Bluetooth-Kopfhörer, iOS).

## Start-Offset und Seek

`startOffsetMs` stellt der Spieler im Dialog „Song bearbeiten“ ein: Feld „Start ab (Sekunden)“,
Komma oder Punkt, höchstens eine Nachkommastelle in der Anzeige, 0–600 s
(`parseStartOffsetSeconds`, `formatStartOffsetSeconds`, `START_OFFSET_MAX_MS`). Leer heißt 0.
Ungültige Eingaben sperren „Speichern“. Titel, Künstler und Start-Offset gehen in einem Schreibvorgang
über `useSongLibrary().updateDetails` an das `SongRepository`; ein unverändertes Feld behält den
exakten gespeicherten Wert.

- `seekTo(t)` setzt den Zeiger ohne Wertung auf den ersten Move, dessen Fenster bei `t` noch offen
  ist. Übersprungene Moves zählen nicht, auch nicht im Referenzmaximum der Sterne.
- Der Spielstart (und Neustart) springt im Audio auf `startOffsetMs`, setzt die Wertung zurück
  und ruft `seekTo(timeMs())` auf. Ein Intro mit Moves wird also übersprungen, ohne X.
- Seek geht nur vorwärts; ein Neustart nutzt `reset()`. Eine neue Choreografie oder
  Schwierigkeit erzeugt einen neuen `Scorer` (entspricht `reset`).
- Ungültige Zeiten (`NaN`, `Infinity`) werden ignoriert, damit eine kaputte Uhr nie den ganzen
  Song auf einmal wertet.

## Abweichung

Gewichteter Mittelwert der absoluten Winkeldifferenzen über den kürzesten Bogen:

| Gelenke                    | Gewicht |
| -------------------------- | ------- |
| Ellbogen, Schultern (Arme) | 2       |
| Hüften, Knie (Beine)       | 1       |
| Rumpfneigung               | 0,5     |

- Verglichen werden nur Winkel, die im Ziel **und** beim Spieler vorhanden sind. Fehlende Winkel
  werden übersprungen, nie als 0 gewertet. Landmarks mit `visibility < 0.5` zählen als fehlend.
- **Mindestabdeckung (Abweichung, neu):** Die sichtbaren Winkel müssen mindestens **50 %** des
  Zielgewichts ausmachen, und mindestens ein Armwinkel muss dabei sein. Sonst ist die Pose nicht
  bewertbar (→ X). Beispiel: Beine außerhalb des Bildes, Arme sichtbar → wird bewertet; nur
  Rumpf sichtbar → X.
- **Abweichung:** Die ursprüngliche Beschreibung nannte nur „Arme höher gewichtet“. Die konkreten
  Gewichte 2/1/0,5 legt der Code fest.

## Urteil

Die Abweichung wird durch den Toleranzfaktor der Schwierigkeit geteilt und dann eingestuft:

| Abweichung (bei „normal“) | Urteil  | Punkte |
| ------------------------- | ------- | ------ |
| < 15°                     | PERFECT | 1000   |
| < 30°                     | SUPER   | 700    |
| < 45°                     | GOOD    | 400    |
| < 60°                     | OK      | 200    |
| sonst                     | X       | 0      |

| Schwierigkeit | Toleranzfaktor | Wirkung                        |
| ------------- | -------------- | ------------------------------ |
| leicht        | 1,3            | Schwellen ca. 30 % großzügiger |
| normal        | 1,0            |                                |
| schwer        | 0,8            | Schwellen 20 % strenger        |

## Punkte, Combo, Gold

- Punkte je Move = Grundpunkte × Combo-Multiplikator × Gold-Faktor.
- **Combo-Multiplikator:** `min(4, 1 + ⌊Combo / 5⌋)`, also x2 ab 5, x3 ab 10, x4 ab 15. Es zählt
  die Combo _vor_ dem aktuellen Move.
- **Combo-Regel (Abweichung, festgelegt):** PERFECT, SUPER und GOOD erhöhen die Combo um 1.
  **OK hält die Combo** (keine Erhöhung). **Nur X bricht sie ab.** Konstanten `COMBO_HOLD` und
  `COMBO_BREAK`, Funktion `nextCombo`.
- **Gold Moves** zählen 5-fach (`GOLD_FACTOR`), auch im Referenzmaximum.

## Sterne und Rang

- Referenzmaximum = alle gespielten Moves PERFECT bei Multiplikator x2 (realistisch erreichbar),
  Gold 5-fach. **Per `seekTo` übersprungene Moves zählen nicht für die Sterne:** weder im
  Score noch im Referenzmaximum, sie werden also weder belohnt noch bestraft.
- Quote = Score / Referenzmaximum. Sterne bei 15 / 30 / 45 / 60 / 75 %; **Megastar** ab 95 %.
- Da lange Combos x3 oder x4 erreichen, kann die Quote über 100 % liegen. Das ist gewollt, aber
  noch zu prüfen, ob die Sternstufen sich gut anfühlen.
- Rangtitel: 0 Sterne „NOCH ÜBEN“, dann „ANFÄNGER“, „GROOVER“, „TÄNZER“, „PROFI“,
  „SUPERSTAR“; Megastar „MEGASTAR“.

## Bewegungsmodus

Spielen ohne Kamera: Das Handy liegt in der Hand, DeviceMotion misst die Bewegungsintensität um
jeden Move. Logik in `src/lib/motion.ts`, Konstanten in `MOTION`.

- **Messgröße:** Betrag der linearen Beschleunigung (`event.acceleration`, m/s², ohne
  Schwerkraft). Fehlt sie, Ersatz aus `accelerationIncludingGravity` mit Hochpass: Die Schwerkraft
  wird per Tiefpass geschätzt (`gravityAlpha` 0,8) und abgezogen. Messungen mit fehlender Achse
  werden verworfen.
- **Zeitstempel:** Jede Messung bekommt beim Eintreffen die Spielzeit (`useAudioClock`), nie
  `event.timeStamp`, und nur während `playing`. Springt die Spielzeit zurück (Start, Neustart),
  leert der Aufrufer den Puffer (`MotionMeter.reset()`); „Weiter“ spult nicht zurück, Messungen
  von vor der Pause zählen also im selben Fenster weiter. Der Puffer hält höchstens 600 Messungen.
- **Fenster:** wie im Winkelmodus `move.timeMs ± MOVE_WINDOW_MS` (250 ms). Wert = Mittelwert des
  Betrags im Fenster. Weniger als `MOTION.minSamples` (3) Messungen → kein Wert → X; fehlende Daten
  zählen nie als 0.
- **Urteil** (`judgeIntensity`), Schwellen in m/s², mal Faktor je Schwierigkeit (leicht 0,7,
  normal 1, schwer 1,4), Gold-Moves zusätzlich × 1,25. Startwerte, am Gerät abzustimmen.

| Urteil  | normal                   | leicht   | schwer   |
| ------- | ------------------------ | -------- | -------- |
| PERFECT | ≥ 6                      | ≥ 4,2    | ≥ 8,4    |
| SUPER   | ≥ 4                      | ≥ 2,8    | ≥ 5,6    |
| GOOD    | ≥ 2,5                    | ≥ 1,75   | ≥ 3,5    |
| OK      | ≥ 1,2                    | ≥ 0,84   | ≥ 1,68   |
| X       | darunter, oder kein Wert | darunter | darunter |

- **Ablauf:** `Scorer.sample(t, null, intensityRating)` ersetzt den Winkelvergleich; die Funktion
  bekommt Move und Fenster (`fromMs`, `toMs`). Der `GameController` mit `motion`-Abhängigkeit wertet
  nur über die Uhr (höchstens alle `sampleMs`, kein Stall-Pfad); der Hinweis erscheint, wenn
  `bodyMissingMs` lang keine Sensormessung kam. Punkte, Combo, Gold und Sterne wie im Kameramodus.
- **Grenze:** Dauerhaftes Schütteln wird belohnt. Geprüft wird nur, ob um die Moves herum genug
  Bewegung ist, nicht welche Bewegung und nicht, ob sie im Takt liegt.
- **Highscore:** wird wie im Kameramodus gespeichert (gleicher Song, gleiches Feld, kein
  Formatwechsel). Ein Bewegungsmodus-Ergebnis kann also einen Kamera-Highscore überschreiben.

## Simulierter Spieler

`src/lib/game/simulatedPlayer.ts` liefert die Winkel der Choreografie zur Zeit `t` mit
normalverteiltem Rauschen (`noiseDeg` = Standardabweichung in Grad) und einer Ausfallquote
(`missRate`, Anteil der Bilder ohne Pose). Mit festem Seed (`seededRandom`) reproduzierbar. Genutzt
in den Tests und im Dev-Simulationsmodus (`/play/<id>?sim=1&noise=10&miss=0.2`, nur mit dem
Dev-Server, im Produktions-Build nicht enthalten).

Richtwerte aus den Tests: 0° Rauschen → alles PERFECT; 25° → gemischte Urteile, kein X;
Ausfallquote 1 → alles X und der Hinweis „Wir sehen dich nicht“.

## Bekannte offene Punkte

- Die Kamera-Pipeline vor der Erkennung (Aufnahme bis Bildübergabe) ist nur ausgeglichen, wenn der
  Browser `captureTime` liefert; sonst steckt sie im globalen Latenz-Offset (Etappe 5).
