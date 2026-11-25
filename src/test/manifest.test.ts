import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { APP_BACKGROUND } from "@/theme";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}
interface Manifest {
  name: string;
  short_name: string;
  lang: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  orientation: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
}

const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")) as Manifest;
const html = readFileSync("index.html", "utf8");

describe("Web-App-Manifest", () => {
  it("hat die Pflichtfelder", () => {
    expect(manifest.name).toBe("DanceBeat");
    expect(manifest.short_name).toBe("DanceBeat");
    expect(manifest.lang).toBe("de");
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("any");
  });

  it("nutzt die Hintergrundfarbe aus theme.ts", () => {
    expect(manifest.background_color.toLowerCase()).toBe(APP_BACKGROUND.toLowerCase());
    expect(manifest.theme_color.toLowerCase()).toBe(APP_BACKGROUND.toLowerCase());
    const meta = /<meta\s+name="theme-color"\s+content="([^"]+)"/.exec(html);
    expect(meta?.[1]?.toLowerCase()).toBe(APP_BACKGROUND.toLowerCase());
  });

  it("verweist nur auf vorhandene Icons", () => {
    for (const icon of manifest.icons) {
      expect(existsSync(`public${icon.src}`), icon.src).toBe(true);
    }
    expect(existsSync("public/icons/apple-touch-icon.png")).toBe(true);
  });

  it("enthält PNG 192 und 512 (any) sowie ein maskable Icon", () => {
    const any = manifest.icons.filter((i) => i.purpose === "any" && i.type === "image/png");
    expect(any.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("ist in index.html verlinkt", () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('href="/icons/apple-touch-icon.png"');
  });
});
