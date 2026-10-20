import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  checkRedirectOrigin,
  isSpotifyClientId,
  spotifyLogin,
  spotifyLogout,
  spotifyRedirectUri,
  spotifyStatus,
  type RedirectCheck,
  type SpotifyStatus,
} from "@/lib/audio/spotifyAuth";
import { mediaVolumeIgnored } from "@/lib/audio/unlock";
import { getStorageUsage, type StorageUsage } from "@/lib/library/storage";
import { DIFFICULTIES, type Difficulty } from "@/lib/scoring";
import { LATENCY_MAX, LATENCY_MIN, LATENCY_STEP, useSettings, type Settings } from "@/lib/settings";
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

const SPOTIFY_STATUS_LABELS: Record<SpotifyStatus, string> = {
  disconnected: "Nicht verbunden",
  connected: "Verbunden",
  expired: "Anmeldung abgelaufen, bitte neu verbinden",
};

/**
 * Spotify login (PKCE, src/lib/audio/spotifyAuth.ts): client ID, redirect URI to register,
 * connect and disconnect. The token lives in sessionStorage only, so it ends with the tab.
 */
function SpotifySettings({
  clientId,
  save,
}: {
  clientId: string;
  save: (p: Partial<Settings>) => void;
}) {
  // Read in an effect: location and sessionStorage are browser APIs.
  const [env, setEnv] = useState<{
    status: SpotifyStatus;
    redirect: RedirectCheck;
    redirectUri: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnv({
      status: spotifyStatus(),
      redirect: checkRedirectOrigin(location),
      redirectUri: spotifyRedirectUri(location),
    });
  }, []);

  const validId = isSpotifyClientId(clientId);
  const showIdError = clientId !== "" && !validId;
  const connect = () => {
    setError("");
    setBusy(true);
    spotifyLogin(clientId).catch((e: unknown) => {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    });
  };
  const disconnect = () => {
    spotifyLogout();
    setEnv((v) => (v ? { ...v, status: "disconnected" } : v));
  };

  return (
    <Section title="Spotify">
      <p className={HINT}>
        Für Spotify-Songs brauchst du Spotify Premium und eine eigene App im
        Spotify-Developer-Dashboard. Beim Verbinden und Abspielen spricht dein Gerät direkt mit
        Spotify (accounts.spotify.com, api.spotify.com, sdk.scdn.co); Spotify sieht dabei deine
        IP-Adresse. Die Anmeldung gilt nur, bis du den Tab schließt. Sync-Test und Editor-Vorschau
        mit Spotify folgen in einer späteren Etappe.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="spotify-client-id" className="text-base">
          Client-ID
        </Label>
        <Input
          id="spotify-client-id"
          value={clientId}
          placeholder="32 Zeichen aus dem Dashboard"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={showIdError ? true : undefined}
          aria-describedby={showIdError ? "spotify-client-id-err" : undefined}
          onChange={(e) => save({ spotifyClientId: e.target.value.trim() })}
          className="h-11 rounded-xl border-white/40 text-base placeholder:text-white/60 md:text-base"
        />
        {showIdError && (
          <p id="spotify-client-id-err" className="text-sm font-medium text-white">
            Die Client-ID besteht aus 32 Zeichen (0–9, a–f).
          </p>
        )}
      </div>
      {env && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-base font-medium">Redirect-URI für das Dashboard</span>
            <code className="break-all rounded-lg bg-black/30 px-3 py-2 text-sm">
              {env.redirectUri}
            </code>
            {!env.redirect.ok && (
              <p className="text-sm font-medium text-white">
                {env.redirect.reason === "localhost"
                  ? "Spotify erlaubt „localhost“ nicht. Öffne die App über 127.0.0.1 statt localhost."
                  : "Spotify verlangt eine HTTPS-Adresse. Auf dem Handy die App über HTTPS öffnen."}
              </p>
            )}
          </div>
          <p role="status" className="text-base">
            Status: {SPOTIFY_STATUS_LABELS[env.status]}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!validId || !env.redirect.ok || busy}
              onClick={connect}
              className={BTN}
            >
              {env.status === "disconnected" ? "Mit Spotify verbinden" : "Neu verbinden"}
            </Button>
            {env.status !== "disconnected" && (
              <Button type="button" variant="secondary" onClick={disconnect} className={BTN}>
                Trennen
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-white">
              {error}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

/** Settings screen: all values persist immediately through `useSettings` (localStorage). */
export function SettingsScreen() {
  const [settings, save] = useSettings();
  // Sliders show their live value while dragging and write only on release.
  const [volume, setVolume] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null | undefined>(undefined);
  // iOS ignores the media element volume; probed in an effect (creates an Audio element).
  const [volumeIgnored, setVolumeIgnored] = useState(false);

  useEffect(() => {
    setVolumeIgnored(mediaVolumeIgnored());
  }, []);

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
            {volumeIgnored && (
              <p className={HINT}>
                Auf diesem Gerät regelt der Regler nur eigene Audiodateien. Bei Audio-URLs und
                YouTube gelten die Lautstärketasten.
              </p>
            )}
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

        <SpotifySettings clientId={settings.spotifyClientId} save={save} />

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
