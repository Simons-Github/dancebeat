# DanceBeat

Ein Tanzspiel im Stil von Just Dance für eine Person, als PWA fürs Handy. Du stellst das Handy
auf, tanzt vor der Frontkamera, und die App vergleicht deine Pose in Echtzeit mit der
Choreografie.

Alles läuft im Browser: kein Backend, keine Accounts, kein Mehrspieler. Kamerabilder verlassen
das Gerät nie, die Song-Bibliothek liegt in IndexedDB. Die Oberfläche ist auf Deutsch.

## Funktionen

- **Bibliothek** mit vier eigenen Demo-Songs, Highscore und Sternen pro Song.
- **Aufstellhilfe:** Kamerabild mit Zielrahmen und Skelett. Das Spiel startet, sobald der ganze
  Körper erkannt wird.
- **Spiel:** Piktogramm-Leiste, Coach-Figur, Urteile (PERFECT bis X), Combo, Gold Moves, Pause,
  Neustart und danach ein Ergebnis-Screen.
- **Bewegungsmodus** ohne Kamera: Du hältst das Handy in der Hand, der Bewegungssensor misst die
  Intensität im Takt.
- **Songs hinzufügen** aus einer eigenen Audiodatei (BPM wird geschätzt), über eine HTTPS-URL,
  von YouTube oder von Spotify (Premium, eigene Client-ID nötig).
- **Tanz aus Video erstellen:** Die App analysiert ein Tanzvideo lokal mit MediaPipe und baut
  daraus eine Choreografie. Das Video kann auch als Musik dienen und im Spiel anstelle des Coachs
  laufen.
- **Editor** für Choreografien (Gold Moves, Moves löschen, Offset, Tempo) und **Sync-Test** zum
  Ausgleichen der Audio-Latenz.
- **Export und Import** von Choreografien als JSON (ohne Audio).
- **PWA:** installierbar und offline spielbar (eigener Service Worker). Das Display bleibt
  während des Spiels an, bei Treffern vibriert das Handy, wo es das unterstützt.

## Externe Abrufe

Standardmäßig lädt die App nur von ihrer eigenen Adresse, auch die MediaPipe-Laufzeit und das
Pose-Modell. Fremde Hosts kommen nur ins Spiel, wenn du sie selbst nutzt: YouTube
(`youtube-nocookie.com`), Spotify oder eine Audio-URL. Die App nennt sie jeweils in der
Oberfläche. Die eingebaute Telemetrie von MediaPipe sperrt eine Content Security Policy. Die
vollständige Liste steht in [docs/architecture.md](docs/architecture.md#externe-abrufe).

## Start

Voraussetzung: [bun](https://bun.sh). Beim ersten `dev` oder `build` lädt ein Skript die
MediaPipe-Modelle (ca. 15 MB) von Google und prüft ihre Prüfsummen. Dafür ist einmal Netz nötig.

```sh
bun install
bun run dev          # http://localhost:5173
```

### Am Handy testen

Die Kamera braucht am Handy HTTPS:

```sh
bun run dev:https    # selbstsigniertes Zertifikat, Handy und Rechner im selben WLAN
```

Dann am Handy `https://<LAN-IP-des-Rechners>:5173` öffnen und die Zertifikatswarnung einmal
bestätigen. Die Adresse zeigt Vite beim Start unter „Network“ an.

### Nur im Dev-Server

- Simulationsmodus ohne Kamera: `/play/<songId>?sim=1&noise=10&miss=0.2`
- Testsongs ohne Anlegen: `/?devsong=youtube:<ID>` oder `/?devsong=url:<MP3-URL>&bpm=<BPM>`

Beides ist im Produktions-Build nicht enthalten.

## Befehle

| Befehl                 | Zweck                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| `bun run dev`          | Dev-Server (HTTP, nur localhost)                                         |
| `bun run dev:https`    | Dev-Server mit HTTPS, im LAN erreichbar                                  |
| `bun run build`        | Produktions-Build nach `dist/`                                           |
| `bun run preview`      | Build lokal ansehen (mit Service Worker)                                 |
| `bun run typecheck`    | TypeScript-Prüfung (App und Service Worker)                              |
| `bun run lint`         | ESLint                                                                   |
| `bun run test`         | Vitest                                                                   |
| `bun run format`       | Prettier                                                                 |
| `bun run fetch-models` | MediaPipe-Modelle laden (läuft vor `dev` und `build` von selbst)         |
| `bun run tune-video …` | Parametersuche für den Video-Import mit exportierten Pose-Spuren         |
| `bun run eval-video …` | Messplatz für den Video-Import (Selbsttest, Verschiebung, fremdes Video) |

Nach jeder Änderung müssen `typecheck`, `test`, `lint` und `build` sauber durchlaufen.

## Hosting

`dist/` ist eine statische SPA ohne Server-Logik. Der Hoster muss:

- per **HTTPS** ausliefern (Kamera und Service Worker brauchen einen sicheren Kontext),
- unbekannte Pfade auf `index.html` umleiten (**SPA-Fallback** für Deep Links wie `/play/…` und
  `/spotify-callback`),
- `.wasm` als `application/wasm` ausliefern,
- `index.html` und `sw.js` ohne langes Caching ausliefern, sonst kommen Updates nicht an.

Der Build geht davon aus, dass die App im Wurzelpfad liegt (`/`). Für Spotify muss die
Redirect-URI `https://<domain>/spotify-callback` im Spotify-Dashboard eingetragen sein.

## Struktur

```
src/
  routes/       Seiten (TanStack Router, dateibasiert; __root.tsx = App-Hülle)
  components/   UI-Bausteine (components/ui = shadcn/ui)
  hooks/        usePoseTracking, useScoring, useAudioClock, useSongLibrary …
  lib/          Logik ohne React: Pose, Scoring, Beat, Choreografie, Video-Import, Settings
  lib/audio/    Audioquellen (Datei, URL, YouTube, Spotify)
  lib/library/  SongRepository (IndexedDB), Migrationen, Export/Import
  sw/           Service Worker
  data/         Demo-Choreografien
  theme.ts      Farben, Fonts, Animationskonstanten
  test/         Vitest-Tests
vite-plugins/   CSP, MediaPipe-WASM, Service-Worker-Build
scripts/        Modell-Download, Tuning für den Video-Import
docs/           Dokumentation (siehe unten)
```

## Dokumentation

- [docs/architecture.md](docs/architecture.md): Schichten, Datenfluss, Speicher, externe Abrufe,
  Service Worker
- [docs/choreography-format.md](docs/choreography-format.md): JSON-Format, Winkel-Konvention,
  Versionen und Migration
- [docs/scoring.md](docs/scoring.md): Bewertung, Punkte, Combo, Sterne
- [docs/design.md](docs/design.md): visueller Stil
- [docs/roadmap.md](docs/roadmap.md): Etappen, Status, offene Gerätetests und Befunde
- [CLAUDE.md](CLAUDE.md): Regeln für die Arbeit am Code

## Stand

Die Etappen 1–7, 9 und 10 sind umgesetzt, Etappe 8 (Tanz aus Video) bis auf 8h-2b. Getestet ist
per Vitest und Playwright im Browser. Viele Gerätetests stehen noch aus, vor allem iOS, echte
Kamera, Audio-Latenz und Spotify mit echtem Konto; die Checklisten stehen in der
[Roadmap](docs/roadmap.md).

## Stack

React 19, TypeScript (strict), Vite 8, TanStack Router und Query, Tailwind 4, shadcn/ui, Framer
Motion, zod, MediaPipe Pose Landmarker, Vitest.

## Rechtliches

Im Repo liegen keine geschützten Songs und keine Original-Assets; Audio- und Videodateien sind
per `.gitignore` ausgeschlossen. Einzige Ausnahme sind die vier eigenen Demo-Songs in
`public/demo-audio/` (KI-generiert mit Gemini). Die Credits stehen in der App unter
Einstellungen → „Über und Credits“ (`src/data/credits.ts`). Sobald das Motion-Paket
AIST++-Clips enthält, nennen sie zusätzlich AIST++ (CC BY 4.0, Google LLC) und die AIST Dance
Video Database (Nutzung von AIST nur nicht-kommerziell erlaubt). Eigene Songs bleiben lokal im
Browser.

## Lizenz

DanceBeat steht unter der [PolyForm Noncommercial License 1.0.0](LICENSE.md): Nutzung, Änderung
und Weitergabe sind nur für nicht-kommerzielle Zwecke erlaubt. Mitgelieferte Fremdbestandteile
behalten ihre eigenen Lizenzen: MediaPipe und die Pose-Modelle stehen unter Apache 2.0, die Schrift
Fredoka unter der SIL OFL 1.1, die npm-Pakete unter ihren jeweiligen Lizenzen. Die vollständigen
Texte stehen in der App unter Einstellungen → „Über und Credits“ → „Lizenztexte“.
