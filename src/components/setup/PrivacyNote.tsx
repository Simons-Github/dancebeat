import { ShieldCheck } from "lucide-react";

import { useT, type Translator } from "@/lib/i18n";
import type { SourceSpec } from "@/lib/types";

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function sourceSentence(source: SourceSpec | undefined, t: Translator): string | null {
  if (!source) return null;
  if (source.type === "youtube") {
    return t("settings.privacy.youtube");
  }
  if (source.type === "spotify") {
    return t("settings.privacy.spotify");
  }
  if (source.type === "url") {
    const origin = hostOf(source.url) ?? t("settings.privacy.urlFallback");
    return t("settings.privacy.url", { origin });
  }
  return null;
}

/** Names the external fetches (rule: every CDN call must be stated in the UI). */
export function PrivacyNote({
  source,
  camera = true,
}: {
  source?: SourceSpec;
  /** False on screens without camera (sync test): only the song source is named. */
  camera?: boolean;
}) {
  const t = useT();
  const extra = sourceSentence(source, t);
  if (!camera && !extra) return null;
  return (
    <p className="flex items-start gap-2 text-sm text-white/90">
      <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        {camera && t("settings.privacy.camera")}
        {camera && extra ? " " : null}
        {extra}
      </span>
    </p>
  );
}
