import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { describe, expect, it } from "vitest";

import { connectSrcPolicy, csp } from "../../vite-plugins/csp";

describe("Content-Security-Policy (nur connect-src)", () => {
  const SPOTIFY = "https://accounts.spotify.com https://api.spotify.com";

  it("erlaubt im Build nur den eigenen Origin, blob:, data: und Spotify", () => {
    expect(connectSrcPolicy("build")).toBe(`connect-src 'self' blob: data: ${SPOTIFY}`);
  });

  it("erlaubt im Dev-Server zusätzlich WebSockets für HMR", () => {
    expect(connectSrcPolicy("serve")).toBe(`connect-src 'self' blob: data: ${SPOTIFY} ws: wss:`);
  });

  it("lässt keine Google-Telemetrie und keine anderen Direktiven zu", () => {
    for (const command of ["build", "serve"] as const) {
      const policy = connectSrcPolicy(command);
      expect(policy).not.toMatch(/googleapis|\*/);
      // The only remote hosts are Spotify's login and Web API.
      expect(policy.match(/https:\S*/g)).toEqual(SPOTIFY.split(" "));
      expect(policy.split(";")).toHaveLength(1);
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
      const content = connectSrcPolicy("serve").replaceAll("'", "&#39;");
      expect(metas).toEqual([`<meta http-equiv="Content-Security-Policy" content="${content}">`]);
      expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script"));
    } finally {
      await server.close();
    }
  });
});
