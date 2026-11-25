import { describe, expect, it } from "vitest";

import { CSS_ONLY, LICENSES_FILE, loadLicenseTexts, parseBundledLicenses } from "@/lib/licenses";

const json = (body: unknown, contentType = "application/json") =>
  new Response(JSON.stringify(body), { headers: { "content-type": contentType } });

describe("Lizenztexte", () => {
  it("liest Vites build.license-JSON und sortiert nach Namen", () => {
    const list = parseBundledLicenses([
      { name: "zod", version: "3.25.76", identifier: "MIT", text: "MIT License …" },
      { name: "@mediapipe/tasks-vision", version: "1.1.1", identifier: "Apache-2.0" },
    ]);
    expect(list?.map((p) => p.name)).toEqual(["@mediapipe/tasks-vision", "zod"]);
    expect(list?.[0]?.text).toBeUndefined();
  });

  it("verwirft alles andere", () => {
    expect(parseBundledLicenses({ name: "x" })).toBeNull();
    expect(parseBundledLicenses([{ name: "x" }])).toBeNull();
  });

  it("lädt Apache-2.0 und OFL vollständig und die Paketliste vom eigenen Origin", async () => {
    const urls: string[] = [];
    const texts = await loadLicenseTexts(async (input) => {
      urls.push(String(input));
      return json([{ name: "react", version: "19.2.0", identifier: "MIT", text: "MIT" }]);
    }, "/app/");
    expect(urls).toEqual([`/app/${LICENSES_FILE}`]);
    expect(texts.apache).toContain("Apache License");
    expect(texts.apache).toContain("END OF TERMS AND CONDITIONS");
    expect(texts.font).toContain("Copyright 2022 The Bricolage Grotesque Project Authors");
    expect(texts.font).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(texts.bundled?.map((p) => p.name)).toEqual(["react", "tailwindcss", "tw-animate-css"]);
    expect(texts.bundled?.[1]).toMatchObject({ version: CSS_ONLY, identifier: "MIT" });
    expect(texts.bundled?.[1]?.text).toContain("Copyright (c) Tailwind Labs, Inc.");
    expect(texts.bundled?.[2]?.text).toContain("Copyright (c) 2025 Wombosvideo");
  });

  it("ohne Build-Datei (Dev-Server liefert index.html) bleibt die Paketliste leer", async () => {
    const html = await loadLicenseTexts(async () => json("<!doctype html>", "text/html"), "/");
    expect(html.bundled).toBeNull();
    const failed = await loadLicenseTexts(async () => {
      throw new TypeError("offline");
    }, "/");
    expect(failed.bundled).toBeNull();
  });
});
