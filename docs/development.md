# Development

Everything beyond the quick start in the README: requirements, scripts, environment, dev-only URLs,
storage, CI, project structure and troubleshooting. The architecture notes in
[architecture.md](architecture.md), [scoring.md](scoring.md) and
[choreography-format.md](choreography-format.md) are written in German.

## Requirements

| Tool    | Version | Note                                                                |
| ------- | ------- | ------------------------------------------------------------------- |
| Bun     | 1.4+    | Package manager and script runner (CI uses 1.4.2)                   |
| Network | once    | `fetch-models` downloads the MediaPipe models (~15 MB) on first run |
| Browser | current | Chrome, Edge or Safari; the camera needs `localhost` or HTTPS       |

Before `dev`, `dev:https` and `build`, `scripts/fetch-models.ts` downloads the pose models from
pinned Google URLs into `public/mediapipe/models/` (gitignored) and verifies their SHA-256.

## Test on a phone

The camera needs a secure context on the phone:

```sh
bun run dev:https    # self-signed certificate, reachable in the LAN
```

Open `https://<LAN-IP>:5173` on the phone (Vite prints it under "Network") and accept the
certificate warning once.

## Environment variables

The app needs no `.env` file. Secrets are never stored in the repo.

| Variable              | Used by                 | Purpose                                                       |
| --------------------- | ----------------------- | ------------------------------------------------------------- |
| `DEV_HTTPS`           | `vite.config.ts`        | Set to `1` by `bun run dev:https`; enables HTTPS and LAN host |
| `DANCEBEAT_VIDEO_DIR` | `scripts/eval-video.ts` | Folder with dance videos for the video-import benchmark only  |

The Spotify client ID is entered by the user under Settings and stored on the device; Spotify
tokens live only in `sessionStorage`. The Spotify app needs the redirect URI
`https://<domain>/spotify-callback`.

## Scripts

| Command                     | Purpose                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `bun run dev`               | Dev server (HTTP, localhost only)                                        |
| `bun run dev:https`         | Dev server with HTTPS, reachable in the LAN                              |
| `bun run build`             | Production build to `dist/`                                              |
| `bun run build:dev`         | Build in development mode                                                |
| `bun run preview`           | Serve the build locally (with service worker)                            |
| `bun run typecheck`         | TypeScript check for the app and the service worker                      |
| `bun run lint`              | ESLint                                                                   |
| `bun run test`              | Vitest (single run); `bun run test:watch` for watch mode                 |
| `bun run format`            | Prettier                                                                 |
| `bun run fetch-models`      | Download and verify the MediaPipe models (runs before `dev` and `build`) |
| `bun run build-motion-pack` | Build `src/data/motion-pack.json` from pose tracks                       |
| `bun run build-demo`        | Build the demo choreographies from their manifests                       |
| `bun run eval-choreo`       | Benchmark generated choreographies (output in `eval-results/`)           |
| `bun run eval-demos`        | Benchmark the demo songs                                                 |
| `bun run eval-video`        | Benchmark the video import (needs `DANCEBEAT_VIDEO_DIR`)                 |
| `bun run tune-video`        | Parameter search for the video import                                    |
| `bun run aist-track`        | Convert AIST++ keypoints into pose tracks                                |
| `bun run aist-music`        | Check tempo and beat phase of AIST music (needs ffmpeg)                  |
| `bun run measure-audio`     | Measure tempo, beat phase and energy of demo songs (needs ffmpeg)        |

## Dev-only URLs

These are stripped from the production build.

| URL                                      | Effect                                       |
| ---------------------------------------- | -------------------------------------------- |
| `/play/<songId>?sim=1&noise=10&miss=0.2` | Play without camera using a simulated player |
| `/?devsong=youtube:<id>`                 | Temporary YouTube test song                  |
| `/?devsong=url:<mp3-url>&bpm=<bpm>`      | Temporary audio URL test song                |

## Database and storage

There is no server database. Everything is stored per origin in the browser.

| Data                                 | Where                                            | Access                     |
| ------------------------------------ | ------------------------------------------------ | -------------------------- |
| Songs including choreography         | IndexedDB `dancebeat` (version 3), store `songs` | `SongRepository`           |
| Audio files and dance videos         | IndexedDB, store `blobs`                         | `SongRepository.getAudio`  |
| Settings                             | `localStorage` `dancebeat.settings`              | `useSettings`              |
| Deleted demos, demo data versions    | `localStorage` `dancebeat.*`                     | `seedDemos`                |
| Spotify token and PKCE verifier      | `sessionStorage`                                 | `lib/audio/spotifyAuth.ts` |
| App shell, MediaPipe WASM and models | Cache Storage `dancebeat-*`                      | Service worker (`src/sw/`) |

| Topic         | Behaviour                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Schema        | Persisted types come from zod schemas in `src/lib/schema.ts`; invalid records are skipped on read, not deleted.              |
| Format        | Choreography format version 2 (frames with landmarks, joint angles and optional 3D pose; moves with time, label, Gold flag). |
| Migrations    | `src/lib/library/migrations.ts` migrates 0 -> 1 -> 2; the IndexedDB upgrade runs it over all songs on open.                  |
| Transactions  | Song and audio are written and deleted in one transaction; `QuotaExceededError` becomes a readable "storage full" error.     |
| Export/import | Choreographies export as JSON (`dancebeat-choreo`, without audio); imports are validated, migrated and get new UUIDs.        |
| Persistence   | Adding a song requests persistent storage so Safari does not evict the library of non-installed pages.                       |

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push to `main` and on pull
requests: `bun install --frozen-lockfile`, `fetch-models` (cached), `typecheck`, `lint`,
`test --testTimeout=30000` (hosted runners are slower than a dev machine) and `build`.

## Project structure

```
index.html, src/main.tsx   Entry (client-only SPA)
src/
  routes/                  Screens (TanStack Router, file-based; __root.tsx = app shell)
  components/              UI components; components/ui = shadcn/ui
  hooks/                   usePoseTracking, useAudioClock, useScoring, useSongLibrary, ...
  lib/                     Logic without React: pose, angles, scoring, beat, choreo, settings
  lib/audio/               Audio sources (file, URL, YouTube, Spotify) and game clock
  lib/game/                Game controller, drawing, pictograms, simulated player
  lib/generator/           Choreography generator (plan -> select -> realize)
  lib/library/             SongRepository, IndexedDB, migrations, export/import, video import
  sw/                      Service worker
  data/                    Demo songs, motion pack, credits, license texts
  theme.ts                 Colours, fonts, animation constants
  test/                    Vitest tests
public/                    Icons, manifest, demo audio; MediaPipe models are downloaded here
vite-plugins/              CSP, MediaPipe WASM, service worker build
scripts/                   Model download, motion pack, demo build, benchmarks, AIST tools
docs/                      Architecture, format, scoring, design, roadmap (German)
.github/workflows/ci.yml   CI
vercel.json                Hosting config (rewrites, headers)
```

## Troubleshooting

| Problem                                                           | Cause and fix                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `dev` or `build` aborts while fetching models                     | No network on first run, or a checksum mismatch. Connect once and rerun `bun run fetch-models`.                           |
| Camera does not start on the phone                                | The page is served over plain HTTP. Use `bun run dev:https` and accept the certificate.                                   |
| Console shows CSP errors for `odml.pa.googleapis.com`             | Expected: the CSP blocks MediaPipe's built-in telemetry. Not an app error.                                                |
| `bun install` skips or rejects a fresh package version            | `bunfig.toml` blocks versions younger than 24 h (`minimumReleaseAge`). Wait or pin an older version.                      |
| Pose detection fails after deploying elsewhere                    | The host must serve `.wasm` as `application/wasm`.                                                                        |
| Updates don't show up after a deploy                              | `index.html`, `sw.js` and the manifest must not be cached long. The app shows "Update available" in library and settings. |
| Library from the `vercel.app` URL is missing on the custom domain | IndexedDB is per origin; each domain has its own library.                                                                 |
