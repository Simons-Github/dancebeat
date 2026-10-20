import { ShieldCheck } from "lucide-react";

import type { SourceSpec } from "@/lib/types";

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function sourceSentence(source: SourceSpec | undefined): string | null {
  if (!source) return null;
  if (source.type === "youtube") {
    return "Die Musik kommt von YouTube (Skript von youtube.com, Video über youtube-nocookie.com); YouTube sieht dabei deine IP-Adresse.";
  }
  if (source.type === "spotify") {
    return "Die Musik kommt von Spotify (Skript von sdk.scdn.co, Anmeldung und Wiedergabe über accounts.spotify.com und api.spotify.com); Spotify sieht dabei deine IP-Adresse und welchen Song du spielst.";
  }
  if (source.type === "url") {
    const origin = hostOf(source.url) ?? "der eingetragenen Adresse";
    return `Die Musik wird von ${origin} geladen; der Server sieht deine IP-Adresse.`;
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
  const extra = sourceSentence(source);
  if (!camera && !extra) return null;
  return (
    <p className="flex items-start gap-2 text-sm text-white/90">
      <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        {camera &&
          "Kamerabilder verlassen dein Gerät nie. Die Bewegungserkennung läuft vollständig auf deinem Gerät."}
        {camera && extra ? " " : null}
        {extra}
      </span>
    </p>
  );
}
