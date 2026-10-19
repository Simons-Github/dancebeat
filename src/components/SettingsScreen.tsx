import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { getStorageUsage, type StorageUsage } from "@/lib/library/storage";
import { DIFFICULTIES, type Difficulty } from "@/lib/scoring";
import { LATENCY_MAX, LATENCY_MIN, LATENCY_STEP, useSettings } from "@/lib/settings";
import { formatOffsetMs } from "@/lib/sync";
import { cn } from "@/lib/utils";

const CARD =
  "bg-(--scrim-banner) shadow-pop flex flex-col gap-4 rounded-3xl border border-white/15 p-5 text-white backdrop-blur-md";
const BTN =
  "btn-pill h-12 gap-2 rounded-full px-6 text-base focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5";
const HINT = "text-sm text-white/85";

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  leicht: "Leicht",
  normal: "Normal",
  schwer: "Schwer",
};

const formatMb = (bytes: number) =>
  `${(bytes / (1024 * 1024)).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="font-title text-stroke text-2xl">{title}</h2>
      {children}
    </section>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="text-base">
          {label}
        </Label>
        <p className={HINT}>{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Settings screen: all values persist immediately through `useSettings` (localStorage). */
export function SettingsScreen() {
  const [settings, save] = useSettings();
  // Sliders show their live value while dragging and write only on release.
  const [volume, setVolume] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void getStorageUsage().then((u) => {
      if (alive) setUsage(u);
    });
    return () => {
      alive = false;
    };
  }, []);

  const storedVolume = Math.round(settings.volume * 100);
  // A drag value is only shown while it differs from the stored one; released drags are dropped.
  const shownVolume = volume !== null && volume !== storedVolume ? volume : storedVolume;
  const shownLatency =
    latency !== null && latency !== settings.latencyMs ? latency : settings.latencyMs;
  const endDrag = () => {
    setVolume(null);
    setLatency(null);
  };

  return (
    <main className="safe-pad flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-160 flex-col gap-4 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-title text-stroke min-w-0 text-3xl sm:text-4xl">Einstellungen</h1>
          <Button asChild size="lg" variant="secondary" className={BTN}>
            <Link to="/">
              <ArrowLeft aria-hidden />
              Zurück
            </Link>
          </Button>
        </div>

        <Section title="Spiel">
          <div className="flex flex-col gap-2">
            <span id="difficulty-label" className="text-base font-medium">
              Schwierigkeit
            </span>
            <div role="group" aria-labelledby="difficulty-label" className="flex gap-2">
              {DIFFICULTIES.map((d) => (
                <Button
                  key={d}
                  type="button"
                  aria-pressed={settings.difficulty === d}
                  variant={settings.difficulty === d ? "default" : "secondary"}
                  onClick={() => save({ difficulty: d })}
                  className={cn(BTN, "flex-1 px-2")}
                >
                  {DIFFICULTY_LABELS[d]}
                </Button>
              ))}
            </div>
            <p className={HINT}>
              Verändert, wie genau deine Bewegung zur Vorlage passen muss: leicht verzeiht mehr,
              schwer weniger.
            </p>
          </div>
          <SwitchRow
            id="auto-start"
            label="Automatisch starten"
            hint="Die Aufstellhilfe startet das Spiel, sobald du erkannt wirst."
            checked={settings.autoStart}
            onChange={(autoStart) => save({ autoStart })}
          />
          <SwitchRow
            id="haptics"
            label="Vibration"
            hint="Kurzes Vibrieren bei PERFECT und getroffenen Gold Moves. Nicht auf dem iPhone verfügbar."
            checked={settings.haptics}
            onChange={(haptics) => save({ haptics })}
          />
        </Section>

        <Section title="Ton">
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-base font-medium">Lautstärke</span>
              <span aria-hidden className="text-base tabular-nums">
                {shownVolume} %
              </span>
            </div>
            <Slider
              aria-label="Lautstärke"
              aria-valuetext={`${shownVolume} %`}
              min={0}
              max={100}
              step={5}
              value={[shownVolume]}
              onValueChange={([v]) => setVolume(v ?? 0)}
              onPointerUp={endDrag}
              onLostPointerCapture={endDrag}
              onValueCommit={([v]) => {
                save({ volume: (v ?? 0) / 100 });
                setVolume(null);
              }}
            />
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-base font-medium">Latenz-Ausgleich</span>
              <span aria-hidden className="text-base tabular-nums">
                {formatOffsetMs(shownLatency)}
              </span>
            </div>
            <Slider
              aria-label="Latenz-Ausgleich"
              aria-valuetext={formatOffsetMs(shownLatency)}
              min={LATENCY_MIN}
              max={LATENCY_MAX}
              step={LATENCY_STEP}
              value={[shownLatency]}
              onValueChange={([v]) => setLatency(v ?? 0)}
              onPointerUp={endDrag}
              onLostPointerCapture={endDrag}
              onValueCommit={([v]) => {
                save({ latencyMs: v ?? 0 });
                setLatency(null);
              }}
            />
            <p className={HINT}>
              Positiv: die Piktogramme kommen später. Das hilft, wenn Bluetooth-Kopfhörer den Ton
              verzögern. Ein Sync-Test, der den Wert misst, folgt später.
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={settings.latencyMs === 0}
              onClick={() => {
                setLatency(null);
                save({ latencyMs: 0 });
              }}
              className={cn(BTN, "self-start")}
            >
              Zurücksetzen
            </Button>
          </div>
        </Section>

        <Section title="Anzeige">
          <SwitchRow
            id="skeleton"
            label="Skelett anzeigen"
            hint="Zeichnet deine erkannten Gelenke über das Kamerabild."
            checked={settings.skeleton}
            onChange={(skeleton) => save({ skeleton })}
          />
          <SwitchRow
            id="beat-pulse"
            label="Beat-Puls am Rand"
            hint="Der Bildschirmrand pulsiert im Takt der Musik."
            checked={settings.beatPulse}
            onChange={(beatPulse) => save({ beatPulse })}
          />
          <SwitchRow
            id="mirror"
            label="Kamerabild spiegeln"
            hint="Nur die Anzeige wird gespiegelt, die Bewertung ändert sich nicht."
            checked={settings.mirror}
            onChange={(mirror) => save({ mirror })}
          />
        </Section>

        <Section title="Kamera">
          <p className="text-base">
            Die Kamera wählst du in der Aufstellhilfe, bevor ein Song startet.
          </p>
          {settings.cameraId && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => save({ cameraId: "" })}
              className={cn(BTN, "self-start")}
            >
              Gespeicherte Kamera vergessen
            </Button>
          )}
        </Section>

        <Section title="Speicher">
          <p className="text-base">
            {usage === undefined
              ? "Wird ermittelt …"
              : usage === null
                ? "Nicht verfügbar"
                : `${formatMb(usage.usageBytes)} belegt von ${formatMb(usage.quotaBytes)}`}
          </p>
          <p className={HINT}>Songs und Audiodateien liegen nur auf diesem Gerät.</p>
        </Section>
      </div>
    </main>
  );
}
