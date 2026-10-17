# Entwicklungsnotizen

## Stack und Build

- React 19, TypeScript (strict, inkl. `noUncheckedIndexedAccess` – nicht lockern), Tailwind 4, shadcn/ui (new-york), Framer Motion.
- TanStack Start im **SPA-Modus** (`vite.config.ts`): kein Server, kein Nitro. Der Build erzeugt `dist/client/_shell.html`.
- Routing dateibasiert in `src/routes/` (`__root.tsx` ist die App-Hülle, `routeTree.gen.ts` wird generiert und nicht von Hand bearbeitet). Details: `src/routes/README.md`.
- Paketmanager: bun. `bunfig.toml` setzt eine 24h-Schutzfrist für neue Paketversionen; keine Ausnahmen eintragen.
- Pfad-Alias `@` -> `src/` (tsconfig `paths`, in Vite über `resolve.tsconfigPaths`).

## Befehle

- `bun run dev` – Dev-Server (http://localhost:5173)
- `bun run dev:https` – Dev-Server mit HTTPS, für die Handykamera (siehe README)
- `bun run build` / `bun run preview`
- `bun run typecheck`, `bun run lint`, `bun run test`

## Bekannte Punkte

- Das MediaPipe-WASM und das Pose-Modell werden vorerst vom CDN geladen (`src/lib/mediapipe.ts`: jsDelivr, storage.googleapis.com). Später nach `public/` verlegen, damit die App wirklich offline/lokal läuft.
- YouTube- und Spotify-Quellen (`src/lib/audio/sources.ts`) laden externe SDKs; das ist beabsichtigt.
- Scoring und Pose-Mathematik: fehlende Landmarks bzw. leere Array-Einträge gelten als „nicht verfügbar“ und werden übersprungen, nie als 0 gewertet.
- Kamera (`getUserMedia`) funktioniert am Handy nur in einem sicheren Kontext (HTTPS oder localhost).

## Git

- Projekthistorie nicht ohne Grund umschreiben (Force-Push, Rebase bereits gepushter Commits).

## Routing-Konventionen (TanStack Router, dateibasiert in `src/routes/`)

Nicht `src/pages/` oder `app/layout.tsx` anlegen; die einzige Root-Hülle ist `src/routes/__root.tsx` (`<Outlet />` darin erhalten).

| Datei                    | URL                                            |
| ------------------------ | ---------------------------------------------- |
| `index.tsx`              | `/`                                            |
| `about.tsx`              | `/about`                                       |
| `users/index.tsx`        | `/users`                                       |
| `users/$id.tsx`          | `/users/:id` (dynamisch, bares `$`)            |
| `posts/{-$category}.tsx` | `/posts/:category?` (optionales Segment)       |
| `files/$.tsx`            | `/files/*` (Splat, Parameter `_splat`)         |
| `_layout.tsx`            | Layout-Route (rendert Kinder per `<Outlet />`) |

`src/routeTree.gen.ts` wird generiert und nicht von Hand bearbeitet.

## Zum Gegenlesen (Opus)

- `src/hooks/useScoring.ts:26` (`finalize`): Fehlt der Move zum Index, bricht `finalize` still ab (kein Zählen, kein Score, keine Combo-Änderung). `sample` schiebt den Zeiger trotzdem weiter. Im Normalbetrieb nicht erreichbar, aber inhaltlich prüfen, ob „überspringen“ hier richtig ist.
- Weitere Typ-Guards (nicht erreichbare Pfade) in `src/lib/pose.ts`, `src/lib/beat.ts`, `src/data/demo.ts`, `src/hooks/usePoseTracking.ts`: fehlende Werte gelten als „nicht verfügbar“ und werden übersprungen, nicht als 0 gewertet.
- `src/lib/beat.ts`: Die Autokorrelations-Schleife läuft nur über Terme, deren gerundete Indizes existieren. `src/test/beat.test.ts` vergleicht mit der früheren Implementierung auf synthetischen Klick-Tracks.
