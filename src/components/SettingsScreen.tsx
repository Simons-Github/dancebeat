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
import { CREDITS, type Credit } from "@/data/credits";
import { LANGUAGES, useT, type MessageKey } from "@/lib/i18n";
import { mediaVolumeIgnored } from "@/lib/audio/unlock";
import { getStorageUsage, type StorageUsage } from "@/lib/library/storage";
import { loadLicenseTexts, type LicenseTexts as Texts } from "@/lib/licenses";
import { DIFFICULTIES, type Difficulty } from "@/lib/scoring";
import { LATENCY_MAX, LATENCY_MIN, LATENCY_STEP, useSettings, type Settings } from "@/lib/settings";
import { formatOffsetMs } from "@/lib/sync";
import { cn } from "@/lib/utils";

const CARD = "glass flex flex-col gap-4 rounded-3xl p-5 text-white";
const BTN =
  "btn-pill h-12 gap-2 rounded-full px-6 text-base focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5";
const HINT = "text-sm text-white/85";

const DIFFICULTY_LABELS: Record<Difficulty, MessageKey> = {
  leicht: "settings.game.difficulty.leicht",
  normal: "settings.game.difficulty.normal",
  schwer: "settings.game.difficulty.schwer",
};

const formatMb = (bytes: number, locale: string) =>
  `${(bytes / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="font-title text-2xl">{title}</h2>
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
  disabled = false,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4">
      <div className={cn("flex flex-col gap-0.5", disabled && "opacity-50")}>
        <Label htmlFor={id} className="text-base">
          {label}
        </Label>
        <p className={HINT}>{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

const SPOTIFY_STATUS_LABELS: Record<SpotifyStatus, MessageKey> = {
  disconnected: "settings.spotify.status.disconnected",
  connected: "settings.spotify.status.connected",
  expired: "settings.spotify.status.expired",
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
  const t = useT();
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
      <p className={HINT}>{t("settings.spotify.intro")}</p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="spotify-client-id" className="text-base">
          {t("settings.spotify.clientId")}
        </Label>
        <Input
          id="spotify-client-id"
          value={clientId}
          placeholder={t("settings.spotify.clientIdPlaceholder")}
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
            {t("settings.spotify.clientIdError")}
          </p>
        )}
      </div>
      {env && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-base font-medium">{t("settings.spotify.redirectLabel")}</span>
            <code className="break-all rounded-lg bg-black/30 px-3 py-2 text-sm">
              {env.redirectUri}
            </code>
            {!env.redirect.ok && (
              <p className="text-sm font-medium text-white">
                {env.redirect.reason === "localhost"
                  ? t("settings.spotify.redirectLocalhost")
                  : t("settings.spotify.redirectHttps")}
              </p>
            )}
          </div>
          <p role="status" className="text-base">
            {t("settings.spotify.status", { status: t(SPOTIFY_STATUS_LABELS[env.status]) })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!validId || !env.redirect.ok || busy}
              onClick={connect}
              className={BTN}
            >
              {env.status === "disconnected"
                ? t("settings.spotify.connect")
                : t("settings.spotify.reconnect")}
            </Button>
            {env.status !== "disconnected" && (
              <Button type="button" variant="secondary" onClick={disconnect} className={BTN}>
                {t("settings.spotify.disconnect")}
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

/** Credits with their links; a link names its host and opens only on tap (no fetch on render). */
export function CreditList({ credits }: { credits: readonly Credit[] }) {
  const t = useT();
  return (
    <>
      {credits.map((c) => (
        <div key={c.title} className="flex flex-col gap-1">
          <h3 className="text-base font-medium">{c.title}</h3>
          {c.lines.map((line) => (
            <p key={line} className={HINT}>
              {line}
            </p>
          ))}
          {c.links.length > 0 && (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {c.links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {l.label} ({new URL(l.href).hostname})
                </a>
              ))}
            </p>
          )}
        </div>
      ))}
      {credits.some((c) => c.links.length > 0) && (
        <p className={HINT}>{t("settings.credits.linksNote")}</p>
      )}
    </>
  );
}

const LICENSE_PRE = "whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 text-xs";

/** Full license texts, loaded on first open (lazy chunks plus licenses.json from our origin). */
export function LicenseTexts() {
  const t = useT();
  const [texts, setTexts] = useState<Texts | null>(null);
  const [started, setStarted] = useState(false);

  const onToggle = (open: boolean) => {
    if (!open || started) return;
    setStarted(true);
    void loadLicenseTexts(fetch).then(setTexts);
  };

  return (
    <details onToggle={(e) => onToggle(e.currentTarget.open)} className="flex flex-col gap-2">
      <summary className="min-h-12 cursor-pointer content-center text-base font-medium">
        {t("settings.licenses.summary")}
      </summary>
      {!texts ? (
        <p className={HINT}>{t("settings.licenses.loading")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-medium">{t("settings.licenses.apache")}</h3>
          <pre className={LICENSE_PRE}>{texts.apache}</pre>
          <h3 className="text-base font-medium">{t("settings.licenses.font")}</h3>
          <pre className={LICENSE_PRE}>{texts.font}</pre>
          <h3 className="text-base font-medium">{t("settings.licenses.bundled")}</h3>
          {texts.bundled === null ? (
            <p className={HINT}>{t("settings.licenses.bundledNone")}</p>
          ) : (
            texts.bundled.map((p) => (
              <div key={`${p.name}@${p.version}`} className="flex flex-col gap-1">
                <h4 className="text-sm font-medium">
                  {p.name} {p.version}
                  {p.identifier ? ` – ${p.identifier}` : ""}
                </h4>
                {p.text && <pre className={LICENSE_PRE}>{p.text}</pre>}
              </div>
            ))
          )}
        </div>
      )}
    </details>
  );
}

/** Settings screen: all values persist immediately through `useSettings` (localStorage). */
export function SettingsScreen() {
  const t = useT();
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
          <h1 className="font-title chrome-text chrome-glow min-w-0 pb-[0.1em] text-4xl sm:text-5xl">
            {t("settings.title")}
          </h1>
          <Button asChild size="lg" variant="secondary" className={BTN}>
            <Link to="/">
              <ArrowLeft aria-hidden />
              {t("common.back")}
            </Link>
          </Button>
        </div>

        <Section title={t("common.language")}>
          <div role="group" aria-label={t("common.language")} className="flex gap-2">
            {LANGUAGES.map((l) => (
              <Button
                key={l}
                type="button"
                lang={l}
                aria-pressed={settings.language === l}
                variant={settings.language === l ? "default" : "secondary"}
                onClick={() => save({ language: l })}
                className={cn(BTN, "flex-1 px-2")}
              >
                {t(`common.language.${l}`)}
              </Button>
            ))}
          </div>
        </Section>

        <Section title={t("settings.game.title")}>
          <div className="flex flex-col gap-2">
            <span id="difficulty-label" className="text-base font-medium">
              {t("settings.game.difficulty")}
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
                  {t(DIFFICULTY_LABELS[d])}
                </Button>
              ))}
            </div>
            <p className={HINT}>{t("settings.game.difficultyHint")}</p>
          </div>
          <SwitchRow
            id="auto-start"
            label={t("settings.game.autoStart.label")}
            hint={t("settings.game.autoStart.hint")}
            checked={settings.autoStart}
            onChange={(autoStart) => save({ autoStart })}
          />
          <SwitchRow
            id="haptics"
            label={t("settings.game.haptics.label")}
            hint={t("settings.game.haptics.hint")}
            checked={settings.haptics}
            onChange={(haptics) => save({ haptics })}
          />
        </Section>

        <Section title={t("settings.audio.title")}>
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-base font-medium">{t("settings.audio.volume")}</span>
              <span aria-hidden className="text-base tabular-nums">
                {t("settings.audio.percent", { value: shownVolume })}
              </span>
            </div>
            <Slider
              aria-label={t("settings.audio.volume")}
              aria-valuetext={t("settings.audio.percent", { value: shownVolume })}
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
            {volumeIgnored && <p className={HINT}>{t("settings.audio.volumeIgnoredHint")}</p>}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-base font-medium">{t("settings.audio.latency")}</span>
              <span aria-hidden className="text-base tabular-nums">
                {formatOffsetMs(shownLatency)}
              </span>
            </div>
            <Slider
              aria-label={t("settings.audio.latency")}
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
            <p className={HINT}>{t("settings.audio.latencyHint")}</p>
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
              {t("settings.audio.latencyReset")}
            </Button>
          </div>
        </Section>

        <Section title={t("settings.display.title")}>
          <SwitchRow
            id="skeleton"
            label={t("settings.display.skeleton.label")}
            hint={t("settings.display.skeleton.hint")}
            checked={settings.skeleton}
            onChange={(skeleton) => save({ skeleton })}
          />
          <SwitchRow
            id="beat-pulse"
            label={t("settings.display.beatPulse.label")}
            hint={t("settings.display.beatPulse.hint")}
            checked={settings.beatPulse}
            onChange={(beatPulse) => save({ beatPulse })}
          />
          <SwitchRow
            id="dance-video"
            label={t("settings.display.danceVideo.label")}
            hint={t("settings.display.danceVideo.hint")}
            checked={settings.danceVideo}
            onChange={(danceVideo) => save({ danceVideo })}
          />
          <SwitchRow
            id="dance-video-large"
            label={t("settings.display.danceVideoLarge.label")}
            hint={
              settings.danceVideo
                ? t("settings.display.danceVideoLarge.hint")
                : t("settings.display.danceVideoLarge.hintOff")
            }
            checked={settings.danceVideoLarge}
            onChange={(danceVideoLarge) => save({ danceVideoLarge })}
            disabled={!settings.danceVideo}
          />
          <SwitchRow
            id="mirror"
            label={t("settings.display.mirror.label")}
            hint={t("settings.display.mirror.hint")}
            checked={settings.mirror}
            onChange={(mirror) => save({ mirror })}
          />
        </Section>

        <Section title={t("settings.camera.title")}>
          <p className="text-base">{t("settings.camera.hint")}</p>
          {settings.cameraId && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => save({ cameraId: "" })}
              className={cn(BTN, "self-start")}
            >
              {t("settings.camera.forget")}
            </Button>
          )}
        </Section>

        <SpotifySettings clientId={settings.spotifyClientId} save={save} />

        <Section title={t("settings.storage.title")}>
          <p className="text-base">
            {usage === undefined
              ? t("settings.storage.loading")
              : usage === null
                ? t("settings.storage.unavailable")
                : t("settings.storage.usage", {
                    used: formatMb(usage.usageBytes, t.locale),
                    quota: formatMb(usage.quotaBytes, t.locale),
                  })}
          </p>
          <p className={HINT}>{t("settings.storage.hint")}</p>
        </Section>

        <Section title={t("settings.about.title")}>
          <CreditList credits={CREDITS} />
          <LicenseTexts />
        </Section>
      </div>
    </main>
  );
}
