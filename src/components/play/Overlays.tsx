import { useEffect, useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Home, Loader2, Play, RotateCcw, X } from "lucide-react";

import { CameraErrorPanel } from "@/components/setup/CameraErrorPanel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PauseReason } from "@/lib/game/controller";
import type { CameraError } from "@/lib/cameraErrors";
import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/lib/i18n";
import { SPRING } from "@/theme";

export const GAME_BTN =
  "btn-pill h-14 gap-2 rounded-full px-8 text-lg focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5";
const PANEL = "glass flex max-w-md flex-col gap-4 rounded-3xl p-6 text-white";

/** Dimmed full-screen layer with a centered panel. */
function Layer({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div
      className="safe-pad absolute inset-0 z-30 flex items-center justify-center bg-black/45"
      {...(label ? { role: "dialog", "aria-modal": true, "aria-label": label } : {})}
    >
      {children}
    </div>
  );
}

export function PreparingOverlay({ onCancel, label }: { onCancel: () => void; label?: string }) {
  const t = useT();
  return (
    <Layer>
      <div className={cn(PANEL, "items-center text-center")} role="status">
        <Loader2 aria-hidden className="size-10 motion-safe:animate-spin" />
        <p className="text-lg font-bold">{label ?? t("shell.play.preparing")}</p>
        <Button size="lg" variant="secondary" onClick={onCancel} className={GAME_BTN}>
          <X aria-hidden />
          {t("common.cancel")}
        </Button>
      </div>
    </Layer>
  );
}

/** 3-2-1 (count 0 = lead-in). Cancelable; the number only scales without reduced motion. */
export function CountdownOverlay({ count, onCancel }: { count: number; onCancel: () => void }) {
  const t = useT();
  return (
    <div className="safe-pad absolute inset-0 z-30 flex flex-col items-center justify-center gap-6">
      <div
        role="timer"
        aria-live="assertive"
        className="bg-(--hud-scrim) grid size-44 place-items-center rounded-full border border-white/20 text-white shadow-pop landscape:size-36"
      >
        {count === 0 ? (
          <p className="font-title px-4 text-center text-2xl">{t("shell.play.getReady")}</p>
        ) : (
          <motion.span
            key={count}
            initial={{ scale: 1.4, opacity: 0.4 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={SPRING}
            className="font-title text-8xl tabular-nums landscape:text-7xl"
          >
            {count}
          </motion.span>
        )}
      </div>
      <Button size="lg" variant="secondary" onClick={onCancel} className={GAME_BTN}>
        <X aria-hidden />
        {t("common.cancel")}
      </Button>
    </div>
  );
}

/**
 * play() was refused without a gesture: this tap starts the audio. With `video` (YouTube) the
 * player sits enlarged in the middle of the screen, above this layer: iOS does not pass a tap on
 * the page into the iframe, so the tap on the video is the main way. The button stays for desktop
 * and keyboard.
 */
export function BlockedOverlay({ onTap, video = false }: { onTap: () => void; video?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  if (video) {
    return (
      <div className="safe-pad absolute inset-0 z-30 flex flex-col items-center justify-between bg-black/60">
        <p role="status" className="font-title text-center text-2xl landscape:text-xl">
          {t("shell.play.tapVideo")}
        </p>
        <Button ref={ref} size="lg" variant="secondary" onClick={onTap} className={GAME_BTN}>
          <Play aria-hidden />
          {t("shell.play.tapToStart")}
        </Button>
      </div>
    );
  }
  return (
    <Layer>
      <Button ref={ref} size="lg" onClick={onTap} className={cn(GAME_BTN, "h-20 px-10 text-2xl")}>
        <Play aria-hidden />
        {t("shell.play.tapToStart")}
      </Button>
    </Layer>
  );
}

const PAUSE_TEXT: Record<PauseReason, MessageKey | null> = {
  user: null,
  hidden: "shell.pause.hidden",
  camera: "shell.pause.camera",
};

export function PauseMenu({
  reason,
  canResume,
  cameraError,
  skeleton,
  beatPulse,
  danceVideo = null,
  danceVideoLarge = null,
  onResume,
  onRestart,
  onQuit,
  onRetryCamera,
  onSkeleton,
  onBeatPulse,
  onDanceVideo,
  onDanceVideoLarge,
}: {
  reason: PauseReason | null;
  canResume: boolean;
  cameraError: CameraError | null;
  /** null: no skeleton (movement mode), the switch is hidden. */
  skeleton: boolean | null;
  beatPulse: boolean;
  /** null: the song has no dance video, the switch is hidden. */
  danceVideo?: boolean | null;
  /** null: no dance video or it is switched off, the switch is hidden. */
  danceVideoLarge?: boolean | null;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onRetryCamera: () => void;
  onSkeleton: (v: boolean) => void;
  onBeatPulse: (v: boolean) => void;
  onDanceVideo?: (v: boolean) => void;
  onDanceVideoLarge?: (v: boolean) => void;
}) {
  const t = useT();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const reasonKey = reason ? PAUSE_TEXT[reason] : null;
  return (
    <Layer label={t("shell.pause.title")}>
      <div className={cn(PANEL, "max-h-full w-full overflow-y-auto")}>
        <h2 className="font-title text-3xl">{t("shell.pause.title")}</h2>
        {reasonKey && <p className="text-base">{t(reasonKey)}</p>}
        {cameraError && <CameraErrorPanel error={cameraError} onRetry={onRetryCamera} />}
        <div className="flex flex-col gap-3">
          <Button
            ref={first}
            size="lg"
            onClick={onResume}
            disabled={!canResume}
            className={GAME_BTN}
          >
            <Play aria-hidden />
            {t("shell.pause.resume")}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={onRestart}
            disabled={!canResume}
            className={GAME_BTN}
          >
            <RotateCcw aria-hidden />
            {t("shell.pause.restart")}
          </Button>
          <Button size="lg" variant="secondary" onClick={onQuit} className={GAME_BTN}>
            <Home aria-hidden />
            {t("shell.pause.quit")}
          </Button>
        </div>
        <div className="flex flex-col gap-3 border-t border-white/20 pt-4">
          {skeleton !== null && (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="toggle-skeleton" className="text-base">
                {t("shell.pause.skeleton")}
              </Label>
              <Switch id="toggle-skeleton" checked={skeleton} onCheckedChange={onSkeleton} />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="toggle-pulse" className="text-base">
              {t("shell.pause.pulse")}
            </Label>
            <Switch id="toggle-pulse" checked={beatPulse} onCheckedChange={onBeatPulse} />
          </div>
          {danceVideo !== null && onDanceVideo && (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="toggle-dance-video" className="text-base">
                {t("shell.pause.danceVideo")}
              </Label>
              <Switch id="toggle-dance-video" checked={danceVideo} onCheckedChange={onDanceVideo} />
            </div>
          )}
          {danceVideoLarge !== null && onDanceVideoLarge && (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="toggle-dance-video-large" className="text-base">
                {t("shell.pause.danceVideoLarge")}
              </Label>
              <Switch
                id="toggle-dance-video-large"
                checked={danceVideoLarge}
                onCheckedChange={onDanceVideoLarge}
              />
            </div>
          )}
        </div>
      </div>
    </Layer>
  );
}

/** Error or info panel with actions (song missing, audio failed, camera failed). */
export function MessageOverlay({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Layer>
      <div role="alert" className={PANEL}>
        <h2 className="text-2xl font-bold">{title}</h2>
        {children}
        <div className="flex flex-wrap gap-3">{actions}</div>
      </div>
    </Layer>
  );
}
