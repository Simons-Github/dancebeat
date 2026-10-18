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
import { SPRING } from "@/theme";

export const GAME_BTN =
  "btn-pill h-14 gap-2 rounded-full px-8 text-lg focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5";
const PANEL =
  "bg-(--scrim-banner) shadow-pop flex max-w-md flex-col gap-4 rounded-3xl border border-white/15 p-6 text-white backdrop-blur-md";

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

export function PreparingOverlay({ onCancel }: { onCancel: () => void }) {
  return (
    <Layer>
      <div className={cn(PANEL, "items-center text-center")} role="status">
        <Loader2 aria-hidden className="size-10 motion-safe:animate-spin" />
        <p className="text-lg font-bold">Kamera und Musik werden vorbereitet …</p>
        <Button size="lg" variant="secondary" onClick={onCancel} className={GAME_BTN}>
          <X aria-hidden />
          Abbrechen
        </Button>
      </div>
    </Layer>
  );
}

/** 3-2-1 (count 0 = lead-in). Cancelable; the number only scales without reduced motion. */
export function CountdownOverlay({ count, onCancel }: { count: number; onCancel: () => void }) {
  return (
    <div className="safe-pad absolute inset-0 z-30 flex flex-col items-center justify-center gap-6">
      <div
        role="timer"
        aria-live="assertive"
        className="bg-(--hud-scrim) grid size-44 place-items-center rounded-full border border-white/20 text-white shadow-pop landscape:size-36"
      >
        {count === 0 ? (
          <p className="font-title px-4 text-center text-2xl">Bereit machen!</p>
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
        Abbrechen
      </Button>
    </div>
  );
}

/** play() was refused without a gesture: this tap starts the audio. */
export function BlockedOverlay({ onTap }: { onTap: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Layer>
      <Button ref={ref} size="lg" onClick={onTap} className={cn(GAME_BTN, "h-20 px-10 text-2xl")}>
        <Play aria-hidden />
        Zum Starten tippen
      </Button>
    </Layer>
  );
}

const PAUSE_TEXT: Record<PauseReason, string> = {
  user: "",
  hidden: "Pausiert, weil DanceBeat im Hintergrund war.",
  camera: "Die Kamera wurde unterbrochen. Sobald sie wieder läuft, kannst du weitermachen.",
};

export function PauseMenu({
  reason,
  canResume,
  cameraError,
  skeleton,
  beatPulse,
  onResume,
  onRestart,
  onQuit,
  onRetryCamera,
  onSkeleton,
  onBeatPulse,
}: {
  reason: PauseReason | null;
  canResume: boolean;
  cameraError: CameraError | null;
  skeleton: boolean;
  beatPulse: boolean;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onRetryCamera: () => void;
  onSkeleton: (v: boolean) => void;
  onBeatPulse: (v: boolean) => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <Layer label="Pause">
      <div className={cn(PANEL, "max-h-full w-full overflow-y-auto")}>
        <h2 className="font-title text-stroke text-3xl">Pause</h2>
        {reason && PAUSE_TEXT[reason] && <p className="text-base">{PAUSE_TEXT[reason]}</p>}
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
            Weiter
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={onRestart}
            disabled={!canResume}
            className={GAME_BTN}
          >
            <RotateCcw aria-hidden />
            Neustart
          </Button>
          <Button size="lg" variant="secondary" onClick={onQuit} className={GAME_BTN}>
            <Home aria-hidden />
            Beenden
          </Button>
        </div>
        <div className="flex flex-col gap-3 border-t border-white/20 pt-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="toggle-skeleton" className="text-base">
              Skelett anzeigen
            </Label>
            <Switch id="toggle-skeleton" checked={skeleton} onCheckedChange={onSkeleton} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="toggle-pulse" className="text-base">
              Beat-Puls am Rand
            </Label>
            <Switch id="toggle-pulse" checked={beatPulse} onCheckedChange={onBeatPulse} />
          </div>
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
