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
  `Audioposition − globale Latenz − song.syncOffsetMs − choreo.offsetMs` (`gameTimeMs` in
  `src/lib/audio/clock.ts`). `startOffsetMs` ist ein Sprung der Audioposition und steckt darin.
- **Verzögerung der Pose-Erkennung (neu):** `usePoseTracking` meldet je Bild das Alter
  `frameAgeMs`: vom Aufnahmezeitpunkt (`captureTime` aus den Video-Frame-Metadaten, wenn der
  Browser einen plausiblen Wert unter 300 ms liefert) oder sonst vom Beginn der Erkennung bis zum
  Ergebnis. Das Spiel legt die Winkel unter `timeMs() − frameAgeMs × playbackRate` ab.
  **Warum so:** Die Inferenz dauert auf dem Handy 20–40 ms und schwankt; ohne Abzug würde jede
  Pose zu spät einsortiert und die Schwankung käme als Zittern in die Wertung. Die Basis bleibt die
  Audiouhr; abgezogen wird nur eine Dauer, die auf derselben monotonen Uhr gemessen ist wie die
  Bildzeitstempel. Werte außerhalb 0–500 ms gelten als 0. Was davor liegt (Kamera bis
  Bildübergabe, Bildschirm, Lautsprecher), bleibt im globalen Latenz-Offset (Kalibrierung in
  Etappe 5).
- Countdown und Pausen-Countdown laufen über `setTimeout`; das ist keine Bewertung.

## Start-Offset und Seek

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

`sample` nimmt optional eine Funktion `intensityRating`, die statt der Winkel ein Urteil liefert
(geplant für den Bewegungsmodus mit DeviceMotion, Etappe 6).

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
- Bei `playbackRate ≠ 1` wird der globale Latenz-Offset nicht mit der Rate skaliert (N7); das
  Bildalter schon.
