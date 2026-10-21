# Design

Stil von Just Dance **nachempfunden**: keine Original-Assets, Logos, Fonts, Charaktere oder
Piktogramme. Alle Farben, Fonts und Animationskonstanten stehen in `src/theme.ts`.

## Grundstil

- Bunt, energiegeladen, poppig: flache Formen mit weichen Verläufen, nicht einfach dunkles Neon.
- Jeder Song hat eine Akzentfarbe (`accentColor`), die Hintergrundverlauf, Banner, Piktogramme
  und Effekte einfärbt, und eine Zweitfarbe (`secondaryColor`) für Pfeile und Wackellinien.
  Paletten: `SONG_PALETTES` in `src/theme.ts`; Goldtöne `GOLD`, `GOLD_DEEP`.
- Schrift: große, fette, abgerundete Sans-Serif (Fredoka; Alternativen Baloo 2, Poppins
  ExtraBold). Titel in Großbuchstaben mit leichter Schräglage. Die Schrift wird selbst gehostet,
  nicht von Google Fonts geladen.
- Abgerundete Karten, Pill-Buttons, Schlagschatten und Glow.
- Federnde Animationen (Framer Motion Spring, `SPRING`, `SPRING_SOFT`); alles reagiert leicht auf
  den Beat.
- Animierter Farbverlauf-Hintergrund mit treibenden Formen (Dreiecke, Kreise, Konfetti) im Menü
  und im Ergebnis-Screen.
- Kurze, synthetisch erzeugte Soundeffekte (`src/lib/sfx.ts`): Menü-Klick, PERFECT, Gold Move,
  Countdown-Beep.
- Mobile-first, Hoch- und Querformat, große Touch-Flächen, Safe-Area-Insets beachten.

## Gameplay-Screen

- Gespiegeltes Vollbild-Kamerabild mit leichtem Farbfilter in Songfarbe (ca. 20 %) und Vignette.
  Halbtransparentes Skelett-Overlay des Spielers (abschaltbar).
- **Piktoleiste:** stark abgerundete, halbtransparente weiße oder songfarbene Leiste am oberen
  Rand mit kleinem Dreieck als Zielmarke. Gefüllte Silhouetten (wie der Coach, mit dunklem Rand)
  laufen von rechts zur Marke, blitzen dort weiß auf und verblassen. Körper in Songfarbe, gebogene
  Bewegungspfeile (höchstens zwei, vom Rumpf weg) in der Zweitfarbe mit dunkler Kontur. Piktogramme
  werden automatisch aus den Landmarks des Moves gezeichnet.
- **Gold Moves:** Piktogramm komplett golden mit goldenem Rand und Halo (breitere, durchscheinende Silhouette dahinter),
  Partikel-Effekt um den Spieler, großer Schriftzug „GOLD MOVE“; bei Erfolg „YEAH!“ mit
  Sternenexplosion, bei Misserfolg rotes „X“.
- **Wertungs-Popups** (PERFECT, SUPER, GOOD, OK, X): große animierte Schriftzüge, die aufsteigen
  und ausblenden. Farben: `RATING_COLORS`.
- Oben Score, Combo und Sternleiste mit Fortschritt. Coach-Silhouette (gefüllt, Verlauf in Songfarbe, heller Rand,
  Glow; Maße in `COACH`) in der linken unteren Ecke, flüssig aus Landmarks bzw. Winkeln interpoliert. Bei YouTube-Songs sitzt
  dort der sichtbare YouTube-Player (Box `max(200px, …)` in der rechten unteren Ecke, also mindestens 200 × 200 px, Vorgabe der YouTube-API).
- Dezenter Beat-Puls am Rand. Countdown 3-2-1, Pause-Button. Kein Scrollen.

## Ergebnis-Screen

Score zählt hoch, Sterne poppen nacheinander auf (Megastar als großer goldener Stern), Rangtitel,
Anzahl PERFECT/SUPER/GOOD/OK/X in `RATING_COLORS`, längste Combo, goldenes „Neuer Highscore!“
nach dem Hochzählen, Konfetti ab 5 Sternen, Buttons „Nochmal“ und „Anderer Song“. Zeiten und
Konfetti: `RESULT` und `CONFETTI` in `src/theme.ts`. Bei `prefers-reduced-motion` steht der
Endstand sofort da, ohne Konfetti. Im Querformat zwei Spalten. Hintergrund in der Songfarbe (vom
Spiel übernommen).
