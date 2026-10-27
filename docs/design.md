# Design

Stil von Just Dance **nachempfunden**: keine Original-Assets, Logos, Fonts, Charaktere oder
Piktogramme. Alle Farben, Fonts und Animationskonstanten stehen in `src/theme.ts`.

## Grundstil

Y2K: Nacht, Chrom, Liquid Glass, Glitzer und Funkelsterne. Die Songfarbe färbt Glow, Mosaik-Stern
und die Chrom-Tönung.

- **Farben:** Grund ist die Nacht `APP_BACKGROUND` (`--night`) mit feinem Glitzer und zwei Glows
  aus den oberen Ecken in Akzent- und Zweitfarbe (`GLOW`). Paletten: `SONG_PALETTES`; Papier
  `PAPER` für Text; Chrom `CHROME` (hell, dunkles Horizontband, hell, mit `tint` Songfarbe);
  Goldtöne `GOLD`, `GOLD_DEEP`.
- **Chrom** (`chrome-text`, `chrome-glow`): Logo, Seitentitel, Dialogtitel, der Titel des
  gewählten Songs und die Punktzahl im Ergebnis. Der Verlauf wiederholt sich pro Zeile. Chrom ist
  immer große Schrift, weil das dunkle Band auf der Nacht nur etwa 3:1 erreicht.
- **Liquid Glass** (`glass`): Kacheln, Panels, Nebenbuttons. Durchscheinende Nacht
  (`SCRIM.glass`) mit Unschärfe, heller Oberkante, feinem Rand und Glow in Songfarbe.
- **Buttons:** Hauptbutton Chrom (`chrome-fill`, Text in Nacht), Nebenbuttons Glas. Pills, die
  beim Drücken leicht schrumpfen (`btn-pill`). Aktiver Tab ebenfalls Chrom.
- **Schrift:** Bricolage Grotesque (variabel, selbst gehostet über
  `@fontsource-variable/bricolage-grotesque`). Eine Familie, zwei Rollen über die Breitenachse:
  Titel `font-title` (800, 75 % Breite, Satzschreibung), Fließtext normal breit; Buttons 750 bei
  87,5 % Breite. Das Logo ist zusätzlich schräg gestellt.
- **Hintergrund** (`BG_SHAPES`): ein großer fünfzackiger Mosaik-Stern aus Quadraten in Songfarbe
  oben links, zum Rand hin aufgelöst, mit dunklerem Innenstern; dazu einige vierzackige
  Funkelsterne (`Sparkle`). Alles als Gruppe sehr langsam treibend, frei vom Songtitel.
- **Bewegung:** Federnde Animationen (`SPRING`, `SPRING_SOFT`) als Antwort auf Eingaben, z. B. der
  Titelwechsel. Einzige Daueranimation: ein Funkelstern am Songtitel glitzert langsam
  (`animate-twinkle`, aus bei `prefers-reduced-motion`).
- Kurze, synthetisch erzeugte Soundeffekte (`src/lib/sfx.ts`): Menü-Klick, PERFECT, Gold Move,
  Countdown-Beep.
- Mobile-first, Hoch- und Querformat, große Touch-Flächen, Safe-Area-Insets beachten.

## Cover und Icons

- **Cover** (`SongCover`): eine glänzende Song-Disc, leicht gekippt auf dem dunklen Kachelgrund
  und mit Glow in der Songfarbe. Oben ein heller, satter Bereich in den Songfarben mit einem von
  drei Mustern (Streifen, Strahlen, Sterne; fest pro Song-ID) und dem Titel als Sticker-Logo,
  unten ein dunkles Label-Band, das an die Nacht anknüpft; Mittelloch mit Chromring,
  Regenbogenschimmer (`DISC_SHEEN`). Die Disc setzt sich bewusst vom Hintergrund ab, statt ihn zu
  wiederholen. Cover und Kachel setzen `--song` / `--song-2` auf die eigenen Songfarben, so glüht
  jede Kachel in ihrer Farbe.
- **Icons** (`Y2KIcons.tsx`): Sterne in Chrom (`ChromeStar`, beim Megastar in Gold), Flammen mit
  Verlauf und weißglühendem Kern (`HotFlame`, `FLAME_GRADIENT`); aus: schwache Umrisse
  (`ICON_OFF`). Tempo als kleine Glas-Pille, Pokal mit Glow.

## Menü

Hochformat: Logo und Einstellungen oben, Kachel-Karussell in der Mitte, unten der Titelblock
(Chromtitel mit Funkelstern, Künstler), „Los geht's“ und darunter „Song hinzufügen“ und
„Bearbeiten“ im Daumenbereich. Querformat: Karussell links (am Rand weich ausgeblendet),
Titelblock und Buttons rechts (Breite und Titelgröße wachsen mit dem Fenster).

Das Karussell ist ein Größen-Container: Die Kacheln (`TILE_BOX` in `SongTile.tsx`) sind so hoch,
wie es Platz hat, höchstens 28rem und nie breiter als etwa 70 % des Karussells. Schmale Kacheln
(unter 12rem, kleines Querformat) zeigen nur Titel, Tempo und Schwierigkeit. Ändert sich die
Fenstergröße, wird die gewählte Kachel wieder mittig gezeigt. Der Glow der gewählten Kachel muss
in den Innenabstand des Karussells passen, sonst schneidet ihn der Scrollbereich ab.

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
