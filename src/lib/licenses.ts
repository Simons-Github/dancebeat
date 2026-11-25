// License texts for "Lizenztexte" in Settings. Loaded only when the viewer opens that section:
// the fixed texts as lazy chunks, the npm list from dist/licenses.json (own origin, written by
// Vite's build.license, see vite.config.ts). The dev server has no such file.
import { z } from "zod";

/** One entry of Vite's build.license JSON output. */
const BundledLicenseSchema = z.object({
  name: z.string(),
  version: z.string(),
  identifier: z.string().optional(),
  text: z.string().optional(),
});
export type BundledLicense = z.infer<typeof BundledLicenseSchema>;

export const LICENSES_FILE = "licenses.json";

/** Sorted package list, or null if `json` is not Vite's license output. */
export function parseBundledLicenses(json: unknown): BundledLicense[] | null {
  const parsed = z.array(BundledLicenseSchema).safeParse(json);
  if (!parsed.success) return null;
  return [...parsed.data].sort((a, b) => a.name.localeCompare(b.name));
}

export interface LicenseTexts {
  /** Apache License 2.0: MediaPipe Tasks Vision (JS, WASM) and the pose models. */
  apache: string;
  /** SIL Open Font License 1.1 with the Bricolage Grotesque copyright line. */
  font: string;
  /** Bundled npm packages; null if the list is missing (dev server) or unreadable. */
  bundled: BundledLicense[] | null;
}

async function fetchBundled(fetchFn: typeof fetch, base: string): Promise<BundledLicense[] | null> {
  try {
    const res = await fetchFn(`${base}${LICENSES_FILE}`);
    // The dev server answers unknown paths with index.html.
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    return parseBundledLicenses(await res.json());
  } catch {
    return null;
  }
}

export async function loadLicenseTexts(
  fetchFn: typeof fetch,
  base: string = import.meta.env.BASE_URL,
): Promise<LicenseTexts> {
  const [apache, font, tailwind, twAnimate, bundled] = await Promise.all([
    import("@/data/licenses/Apache-2.0.txt?raw").then((m) => m.default),
    import("@fontsource-variable/bricolage-grotesque/LICENSE?raw").then((m) => m.default),
    import("@/data/licenses/tailwindcss.txt?raw").then((m) => m.default),
    import("@/data/licenses/tw-animate-css.txt?raw").then((m) => m.default),
    fetchBundled(fetchFn, base),
  ]);
  // build.license only sees JS modules; these two end up in the CSS alone (src/styles.css).
  // Their exports maps hide LICENSE, so the texts are copies in src/data/licenses/.
  const css: BundledLicense[] = [
    { name: "tailwindcss", version: CSS_ONLY, identifier: "MIT", text: tailwind },
    { name: "tw-animate-css", version: CSS_ONLY, identifier: "MIT", text: twAnimate },
  ];
  return {
    apache,
    font,
    bundled: bundled && [...bundled, ...css].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Version label for packages that ship only as CSS (not listed by build.license). */
export const CSS_ONLY = "(im CSS)";
