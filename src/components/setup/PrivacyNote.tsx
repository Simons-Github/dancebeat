import { ShieldCheck } from "lucide-react";

/** Names the external fetches (rule: every CDN call must be stated in the UI). */
export function PrivacyNote() {
  return (
    <p className="flex items-start gap-2 text-sm text-white/90">
      <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        Kamerabilder verlassen dein Gerät nie. Beim Start der Kamera werden Erkennungsmodell und
        Laufzeit von jsDelivr und Google geladen; dabei wird deine IP-Adresse übertragen, keine
        Bilder.
      </span>
    </p>
  );
}
