# DanceBeat

Tanzspiel im Stil von Just Dance für eine Person, als PWA fürs Handy. Der Spieler tanzt vor der
Frontkamera; Pose-Erkennung und Bewertung laufen vollständig im Browser. Kein Backend, keine
Accounts, kein Mehrspieler.

**Warum so:** privat und lokal. Kamerabilder verlassen das Gerät nie, die Song-Bibliothek liegt
in IndexedDB. Die Datenschicht ist trotzdem so geschnitten, dass später ein Server angebunden
werden kann, ohne Screens umzubauen.

Sprache: UI Deutsch, Code und Kommentare Englisch, Doku Deutsch.

Paketmanager: **bun**. Skripte stehen in `package.json`.

Handy-Test: `bun run dev:https`, dann `https://<LAN-IP>:5173` öffnen und die
Zertifikatswarnung bestätigen. Die Kamera braucht einen sicheren Kontext.

## Änderungen verifizieren

Nach jeder Änderung `bun run typecheck`, `bun run test`, `bun run lint` und `bun run build`
ausführen; alle vier müssen sauber sein. Neue Logik (Scoring, Winkel, Datenformat, Import)
bekommt Vitest-Tests. Kamera, Audio-Timing und iOS-Verhalten lassen sich nur am Gerät prüfen:
das im Bericht ausdrücklich sagen statt es als getestet auszugeben.

## Harte Regeln

**Datenschutz und Recht**

- Keine Uploads von Kamera- oder Videodaten. Frames werden nur lokal verarbeitet.
- Keine Secrets oder Tokens im Repo. Spotify-Client-ID trägt der Nutzer selbst ein; Tokens nur
  in `sessionStorage`.
- Jeder externe Abruf (CDN, YouTube, Spotify) muss in der UI benannt sein.
  Liste: [docs/architecture.md](docs/architecture.md#externe-abrufe).
- Nicht kommerziell: Die AIST-Freigabe gilt nur dafür, DanceBeat steht unter der PolyForm
  Noncommercial License (`LICENSE.md`). Neue mitgelieferte Fremdinhalte (Daten, Modelle,
  Schriften, Medien) bekommen einen Eintrag in `src/data/credits.ts`.
- Mediendateien werden nie eingecheckt; einzige Ausnahme `public/demo-audio/*.mp3` (eigene
  Demo-Songs, [docs/plans/etappe-14.md](docs/plans/etappe-14.md) 14-0.3).

**Spiel-Logik**

- Spielzeit kommt ausschließlich aus `AudioSource.getTimeMs()` (über `useAudioClock`), nie aus
  `Date.now()` oder `performance.now()` direkt.
- Pose-Inferenz läuft außerhalb des React-Renderzyklus (rAF/Video-Frame-Callback, Refs).
  Kein `setState` pro Frame.
- Overlays (Skelett, Coach) werden auf Canvas gezeichnet, nicht als DOM/SVG pro Frame.
- Fehlende oder unsichere Landmarks (visibility < 0.5) werden übersprungen, nie als 0 gewertet.
- Winkel immer über `computeAngles` mit dem Seitenverhältnis der Quelle (`aspect`).
  Konvention: [docs/choreography-format.md](docs/choreography-format.md#winkel).

**Daten**

- Bibliothekszugriff nur über `SongRepository` (`src/lib/library/repository.ts`). Screens und
  Hooks greifen nie direkt auf IndexedDB zu.
- Typen für persistierte Daten kommen aus den zod-Schemas in `src/lib/schema.ts`. Jede Formatänderung:
  Version erhöhen, Migration in `src/lib/library/migrations.ts` und im IndexedDB-Upgrade,
  Test, Doku in `docs/choreography-format.md`.

**Technik**

- Reine Client-SPA. Browser-APIs (`navigator`, `window`, `getUserMedia`, `AudioContext`,
  IndexedDB) nur in Effekten oder Event-Handlern verwenden, nicht auf Modulebene.
- `src/routeTree.gen.ts` nicht von Hand bearbeiten. Keine `src/pages/` anlegen.
- TypeScript-Strenge (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) nicht
  lockern. Kein `any`; für SDKs gibt es `@types/youtube` und `@types/spotify-web-playback-sdk`.
- Farben, Fonts und Animationskonstanten nur in `src/theme.ts`.
- `bunfig.toml` blockt Paketversionen, die jünger als 24 h sind. Keine Ausnahmen eintragen.

## Browser-Tests mit Playwright MCP

Vor jedem Test im Playwright-Browser den Skill `dancebeat-browser-test` laden. Immer gilt:

- Nur `mcp__dancebeat-playwright__*` verwenden; `mcp__playwright__*` und `mcp__plugin_playwright_*`
  stammen nicht aus diesem Projekt: nicht verwenden, den Nutzer informieren.
- `getUserMedia` niemals direkt aufrufen (es könnte die echte Kamera öffnen).
- Vor jedem Test mit Kamera per `ps` die Fake-Kamera-Flags prüfen; fehlen sie oder ist ein
  Browserfenster sichtbar: abbrechen, den Nutzer informieren, nichts anklicken.

## Arbeitsweise

- Neue Abhängigkeiten, große Refactorings und Löschungen nur nach Rückfrage, mit Begründung.
- Kleine Commits, eine Etappe oder ein Fix pro Commit. Nicht pushen ohne Auftrag; Historie nicht
  umschreiben (kein Force-Push, kein Rebase veröffentlichter Commits).
- Bei Unklarheit fragen statt raten.

## Doku

- [docs/architecture.md](docs/architecture.md): Schichten, Datenfluss, Speicher, externe Abrufe,
  Routing-Konventionen
- [docs/choreography-format.md](docs/choreography-format.md): JSON-Format, Winkel-Konvention,
  Versionen und Migration
- [docs/scoring.md](docs/scoring.md): Bewertung, Punkte, Combo, Sterne
- [docs/design.md](docs/design.md): visueller Stil
- [docs/roadmap.md](docs/roadmap.md): Etappen mit Status und offenen Befunden
