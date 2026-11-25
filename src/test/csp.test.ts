import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { describe, expect, it } from "vitest";

import { connectSrcPolicy, csp, cspPolicy } from "../../vite-plugins/csp";

const directives = (policy: string) =>
  new Map(
    policy.split("; ").map((d) => {
      const [name = "", ...sources] = d.split(" ");
      return [name, sources] as const;
    }),
  );

describe("Content-Security-Policy", () => {
  const SPOTIFY = "https://accounts.spotify.com https://api.spotify.com";

  it("erlaubt im Build nur den eigenen Origin, blob:, data: und Spotify als Verbindung", () => {
    expect(connectSrcPolicy("build")).toBe(`connect-src 'self' blob: data: ${SPOTIFY}`);
  });

  it("erlaubt im Dev-Server zusätzlich WebSockets für HMR", () => {
    expect(connectSrcPolicy("serve")).toBe(`connect-src 'self' blob: data: ${SPOTIFY} ws: wss:`);
  });

  it("sperrt Google-Telemetrie und erlaubt als Verbindung nur Spotify", () => {
    for (const command of ["build", "serve"] as const) {
      const connect = directives(cspPolicy(command)).get("connect-src") ?? [];
      expect(connect.join(" ")).not.toMatch(/googleapis|\*/);
      expect(connect.filter((s) => s.startsWith("https:"))).toEqual(SPOTIFY.split(" "));
    }
  });

  it("beschränkt Skripte, Frames, Bilder und Fonts auf eigene und benannte Hosts", () => {
    const d = directives(cspPolicy("build"));
    expect(d.get("default-src")).toEqual(["'self'"]);
    expect(d.get("script-src")).toEqual([
      "'self'",
      "'wasm-unsafe-eval'",
      "https://www.youtube.com",
      "https://sdk.scdn.co",
    ]);
    expect(d.get("frame-src")).toEqual(["https://www.youtube-nocookie.com", "https://sdk.scdn.co"]);
    expect(d.get("img-src")).toEqual(["'self'", "blob:", "data:"]);
    expect(d.get("font-src")).toEqual(["'self'", "data:"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual(["'self'"]);
  });

  it("erlaubt Audio von https und http nur auf Loopback", () => {
    const media = directives(cspPolicy("build")).get("media-src") ?? [];
    expect(media).toContain("https:");
    expect(media.filter((s) => s.startsWith("http:"))).toEqual([
      "http://localhost:*",
      "http://127.0.0.1:*",
    ]);
  });

  it("erlaubt Inline-Skripte nur im Dev-Server (React-Refresh-Präambel)", () => {
    expect(directives(cspPolicy("build")).get("script-src")).not.toContain("'unsafe-inline'");
    expect(directives(cspPolicy("serve")).get("script-src")).toContain("'unsafe-inline'");
    for (const command of ["build", "serve"] as const) {
      expect(cspPolicy(command)).not.toMatch(/'unsafe-eval'/);
    }
  });

  it("setzt genau ein CSP-Meta-Tag an den Anfang von <head>", async () => {
    const server = await createServer({
      configFile: false,
      logLevel: "silent",
      plugins: [csp()],
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    try {
      const html = await server.transformIndexHtml("/", readFileSync("index.html", "utf8"));
      const metas = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/g) ?? [];
      // Vite escapes ' as &#39; in attributes; the browser decodes it again.
      const content = cspPolicy("serve").replaceAll("'", "&#39;");
      expect(metas).toEqual([`<meta http-equiv="Content-Security-Policy" content="${content}">`]);
      expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script"));
    } finally {
      await server.close();
    }
  });
});
