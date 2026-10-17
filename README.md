# DanceBeat

Ein Tanzspiel im Stil von Just Dance für eine Person, als PWA fürs Handy. Du stellst das Handy auf, tanzt vor der Frontkamera, und die App bewertet in Echtzeit per Pose-Erkennung, wie genau deine Bewegungen zur Choreografie passen. Rein lokal: kein Backend, keine Accounts, Kamerabilder verlassen das Gerät nie. UI-Sprache ist Deutsch.

Stand: Grundgerüst. Die Startseite ist noch minimal; Pose-Mathematik, Scoring, Audio und Song-Bibliothek liegen in `src/lib` und `src/hooks`.

## Start

Voraussetzung: [bun](https://bun.sh).

```sh
bun install
bun run dev          # http://localhost:5173
```

### Handy-Test mit Kamera

Die Kamera funktioniert am Handy nur über HTTPS:

```sh
bun run dev:https    # selbstsigniertes Zertifikat, Handy und Rechner im selben WLAN
```

Dann am Handy `https://<LAN-IP-des-Rechners>:5173` öffnen und die Zertifikatswarnung einmal bestätigen. Die Adresse zeigt Vite beim Start unter „Network“ an.

## Befehle

| Befehl              | Zweck                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| `bun run dev`       | Dev-Server (HTTP)                                                        |
| `bun run dev:https` | Dev-Server mit HTTPS                                                     |
| `bun run build`     | Produktions-Build nach `dist/` (SPA, Einstieg `dist/client/_shell.html`) |
| `bun run preview`   | Build lokal ansehen                                                      |
| `bun run typecheck` | TypeScript-Prüfung                                                       |
| `bun run lint`      | ESLint                                                                   |
| `bun run test`      | Vitest                                                                   |

## Struktur

```
src/
  routes/       Seiten (TanStack Router, dateibasiert; __root.tsx = App-Hülle)
  components/   UI-Bausteine (components/ui = shadcn/ui)
  hooks/        usePoseTracking, useScoring, useAudioClock, useSongLibrary
  lib/          Pose-Mathematik, Beat, Scoring, MediaPipe, Audio-Quellen, IndexedDB
  data/         Demo-Choreografie
  test/         Tests
docs/
  spec.md       Ursprüngliche Projektbeschreibung
  notes.md      Entwicklungsnotizen und bekannte Punkte
```

## Stack

React 19, TypeScript (strict), Vite, TanStack Start (SPA-Modus), Tailwind 4, shadcn/ui, Framer Motion, MediaPipe Pose Landmarker.
