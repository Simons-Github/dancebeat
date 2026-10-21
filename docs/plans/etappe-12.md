# Plan Etappe 12: Coach als Silhouette und Piktogramme mit Pfeilen

Ziel: Coach und Piktogramme wirken wie ein Tänzer statt wie eine Strichfigur. Gilt für alle
Songs (Demos, eigene Songs, Video-Import), hängt von keiner Lizenz- oder Datenfrage ab und
ändert weder Format noch Bewertung.

Herkunft: Teil C des früheren Plans „Neue Demo-Songs“ (damals 12e und 12f). Die Mocap-Pipeline
steckt jetzt in [Etappe 13](etappe-13.md), Musik und Demos in [Etappe 14](etappe-14.md).

## Entscheidungen

- Weiterhin Canvas, keine DOM- oder SVG-Elemente pro Frame.
- Eigene Gestaltung, keine Original-Assets von Just Dance.
- Eingabe bleiben 2D-Landmarks. Der Zeichner bekommt aber eine schmale Signatur
  (`drawFigure(ctx, landmarks, style)`), damit Etappe 15 ihn hinter `CoachRenderer` stellen kann,
  ohne die Aufrufer erneut umzubauen.
- Farben, Stärken, Glow und Größen nur in `src/theme.ts`.
- Kein Formatwechsel, keine neue Abhängigkeit, keine neue Einstellung.

## 12a Coach als Silhouette

Heute: Strichfigur (`drawStickFigure`, `drawCoach` in `src/lib/game/draw.ts`). Neu:

- Gefüllter Körper: Rumpf als abgerundetes Viereck zwischen Schultern und Hüften, Gliedmaßen als
  dicke Kapseln (Oberarm dicker als Unterarm), Kopf als Kreis, Hände und Füße als kleine Formen.
- Füllung als Verlauf in der Songfarbe, heller Rand und weicher Glow (Kontrast zum Kamerabild).
- Größer und deutlicher: Größe als Konstante, Prüfung in Hoch- und Querformat, dass Score, Combo
  und Piktoleiste frei bleiben.
- Fehlende Landmarks (`visibility < 0.5`): betroffene Glieder werden ausgelassen, nicht an 0/0
  gezeichnet.
- Leistung: Pfade pro Frame neu, aber ohne Schatten-Blur pro Glied (Glow einmal pro Figur über
  ein Offscreen-Canvas oder `shadowBlur` nur auf dem Umriss); am Gerät FPS prüfen.
- Gilt auch für den Coach im Editor und in der Vorschau, wenn sie denselben Zeichner nutzen.
- Tests: Zeichner mit Canvas-Mock (Aufrufe für alle sichtbaren Glieder, übersprungene Glieder
  bei fehlenden Landmarks), Spielscreen-Test unverändert grün.

## 12b Piktogramme mit Bewegungspfeilen

- Piktogramm-Figur im selben Silhouetten-Stil wie der Coach (`src/lib/game/pikto.ts`,
  vorhandener Cache `createMoveFigureCache` bleibt).
- **Pfeile für alle deutlichen Bewegungen**, nicht nur weite Handbewegungen: Weg von Händen,
  Füßen und Hüfte zwischen vorigem Move und diesem Move; ab einer Mindeststrecke ein gebogener
  Pfeil in Songfarbe (Bogen aus der Mitte der Bahn).
- Höchstens zwei Pfeile pro Piktogramm (die längsten Wege), damit es lesbar bleibt.
- Tests: Pfeilauswahl (Mindeststrecke, höchstens zwei, Reihenfolge), Cache wird bei gleichen
  Frames nicht neu gebaut.

## 12c Prüfung

- Nach jeder Teiletappe: `bun run typecheck`, `test`, `lint`, `build`.
- Playwright (projektlokaler Server, Flags vorher per `ps` prüfen): Spiel mit `?sim=1`, Editor
  und Vorschau in 390×844 und 844×390, je Snapshot und Screenshot; Konsole ohne eigene Fehler.
  Screenshots danach löschen.
- **Nur am Gerät prüfbar** (im Bericht so benennen, nicht als getestet ausgeben):
  - FPS mit dem Silhouetten-Coach auf iPhone 11 und einem Android-Mittelklassegerät, mit Kamera
    und mit Tanzvideo.
  - Lesbarkeit von Coach und Pfeilen auf Armlänge und aus 2–3 m Abstand.

## Reihenfolge und Commits

| Schritt | Inhalt                  | Hängt ab von | Modell |
| ------- | ----------------------- | ------------ | ------ |
| 12a     | Coach-Silhouette        | –            | Sonnet |
| 12b     | Piktogramme mit Pfeilen | 12a (Stil)   | Sonnet |
| 12c     | Playwright, Gerätetest  | 12a, 12b     | –      |

Ein Commit pro Teiletappe.

## Risiken

- **Leistung:** Verläufe und Glow kosten auf älteren Geräten Bildrate, neben Kamera und
  MediaPipe. Gegenmittel: Glow einmal pro Figur, notfalls ohne Glow auf schwachen Geräten.
- **Lesbarkeit:** Zu viele oder zu große Pfeile überladen die Piktoleiste. Deshalb höchstens
  zwei und eine Mindeststrecke.
