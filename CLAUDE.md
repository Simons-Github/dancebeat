# DanceBeat

Tanzspiel im Stil von Just Dance für eine Person, als PWA fürs Handy. Der Spieler tanzt vor der
Frontkamera; Pose-Erkennung und Bewertung laufen vollständig im Browser. Kein Backend, keine
Accounts, kein Mehrspieler, keine Veröffentlichung.

**Warum so:** privat und lokal. Kamerabilder verlassen das Gerät nie, die Song-Bibliothek liegt
in IndexedDB. Die Datenschicht ist trotzdem so geschnitten, dass später ein Server angebunden
werden kann, ohne Screens umzubauen.

Sprache: UI Deutsch, Code und Kommentare Englisch, Doku Deutsch.

## Stack

React 19, TypeScript strict, Vite 8, TanStack Router (dateibasiert, `@tanstack/router-plugin`),
TanStack Query, Tailwind 4, shadcn/ui (new-york), Framer Motion, zod, MediaPipe Pose Landmarker,
Vitest. Paketmanager: **bun**.

## Ordner

```
index.html, src/main.tsx   Einstieg (reine Client-SPA)
src/routes/                Seiten; __root.tsx = App-Hülle, routeTree.gen.ts wird generiert
src/components/            UI-Bausteine; components/ui = shadcn/ui
src/hooks/                 usePoseTracking, useScoring, useAudioClock, useSongLibrary
src/lib/                   Logik ohne React: pose, scoring, beat, choreo, schema, settings, sfx
src/lib/audio/             AudioSource-Adapter (Datei, URL, YouTube, Spotify)
src/lib/library/           SongRepository, IndexedDB-Implementierung, Migrationen, Export/Import
src/data/                  Demo-Choreografien
src/theme.ts               Farben, Fonts, Animationskonstanten (einzige Quelle)
src/test/                  Vitest-Tests
docs/                      Details, siehe unten
```

## Befehle

| Zweck                          | Befehl              |
| ------------------------------ | ------------------- |
| Dev-Server (HTTP, localhost)   | `bun run dev`       |
| Dev-Server mit HTTPS (Handy)   | `bun run dev:https` |
| Produktions-Build nach `dist/` | `bun run build`     |
| Build ansehen                  | `bun run preview`   |
| Typprüfung                     | `bun run typecheck` |
| ESLint                         | `bun run lint`      |
| Tests                          | `bun run test`      |
| Formatieren                    | `bun run format`    |

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
- Keine geschützten Songs oder Original-Assets (Logos, Fonts, Coach-Modelle, Piktogramme) im
  Repo. Audio- und Videodateien sind per `.gitignore` ausgeschlossen.
- Keine Secrets oder Tokens im Repo. Spotify-Client-ID trägt der Nutzer selbst ein; Tokens nur
  in `sessionStorage`.
- Jeder externe Abruf (CDN, YouTube, Spotify) muss in der UI benannt sein.
  Liste: [docs/architecture.md](docs/architecture.md#externe-abrufe).

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
