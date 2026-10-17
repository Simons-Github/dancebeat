# Bewertung

Code: `src/lib/scoring.ts` (reine Funktionen) und `src/hooks/useScoring.ts` (Ablauf).
Abweichungen von der ursprünglichen Beschreibung sind mit **Abweichung** markiert.

## Ablauf

1. Der Spielscreen ruft etwa alle 100 ms `sample(t, angles)` mit der Spielzeit `t` auf.
2. Für jeden Move, dessen Fenster `t` enthält (**±250 ms** um `move.timeMs`), wird die
   Abweichung zu den Soll-Winkeln berechnet. Pro Move zählt die **beste** (kleinste) Abweichung.
3. Ist das Fenster vorbei, wird der Move bewertet: Punkte, Combo, Zähler, letztes Urteil.
4. Gab es im Fenster keine bewertbare Pose, ist das Urteil **X**.

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

- Referenzmaximum = alle Moves PERFECT bei Multiplikator x2 (realistisch erreichbar), Gold
  5-fach.
- Quote = Score / Referenzmaximum. Sterne bei 15 / 30 / 45 / 60 / 75 %; **Megastar** ab 95 %.
- Da lange Combos x3 oder x4 erreichen, kann die Quote über 100 % liegen. Das ist gewollt, aber
  noch zu prüfen, ob die Sternstufen sich gut anfühlen.
- Rangtitel: 0 Sterne „NOCH ÜBEN“, dann „ANFÄNGER“, „GROOVER“, „TÄNZER“, „PROFI“,
  „SUPERSTAR“; Megastar „MEGASTAR“.

## Bewegungsmodus

`sample` nimmt optional eine Funktion `intensityRating`, die statt der Winkel ein Urteil liefert
(geplant für den Bewegungsmodus mit DeviceMotion, Etappe 6).

## Bekannte offene Punkte

- Start mit `startOffsetMs` (Intro überspringen) oder Seek: Moves vor der Startzeit werden beim
  ersten Aufruf als X gewertet. Geplant: `seekTo(t)` ohne Wertung (Etappe 3).
- Soll-Winkel werden pro Aufruf neu interpoliert; Vorberechnung pro Move geplant (Etappe 3).
- Die Latenz der Pose-Erkennung selbst wird nicht ausgeglichen; sie steckt im globalen
  Latenz-Offset.
