# Deployment

`dist/` is a static SPA. Production runs on Vercel at
[dancebeat.berger-labs.com](https://dancebeat.berger-labs.com); a push to `main` deploys to
production, other branches deploy as previews. [`vercel.json`](../vercel.json) sets install
(`bun install --frozen-lockfile`), build (`bun run build`), output `dist/`, the SPA rewrite and the
headers below.

## Production checklist

| Requirement                                                         | Why                                                  | Covered by `vercel.json` |
| ------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------ |
| Serve over HTTPS                                                    | Camera and service worker need a secure context      | Vercel default           |
| Rewrite unknown paths to `index.html`                               | Deep links such as `/play/...` and `/spotify-callback` | Yes                    |
| Serve `.wasm` as `application/wasm`                                 | MediaPipe runtime                                    | Yes                      |
| `no-cache` for `index.html`, `sw.js`, `manifest.webmanifest`        | Otherwise updates don't arrive                       | Yes                      |
| `immutable` caching for `/assets/`                                  | Hashed build files                                   | Yes                      |
| `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy` headers      | `frame-ancestors` does not work in the meta CSP      | Yes                      |
| App served at the root path `/`                                     | The build assumes base `/`                           | Yes                      |
| Spotify redirect URI `https://<domain>/spotify-callback` registered | Spotify login                                        | Spotify dashboard        |
| Build server has network access                                     | `prebuild` downloads the MediaPipe models            | Vercel default           |
| Vercel toolbar disabled on previews                                 | The CSP blocks `vercel.live`                         | Project settings         |
