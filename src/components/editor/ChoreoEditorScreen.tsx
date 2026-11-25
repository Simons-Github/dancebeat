import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Plus, Save, Sparkles, Star, Trash2, Undo2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useDanceVideo } from "@/hooks/useDanceVideo";
import {
  MIN_MOVES,
  TEMPO_OPTIONS,
  beatLengthMs,
  canDeleteMove,
  canInsertAfter,
  canShiftMove,
  deleteMove,
  formatMoveTime,
  insertMoveAfter,
  isEdited,
  moveAudioMs,
  prepareSave,
  setTempo,
  shiftMove,
  shiftOffset,
  suggestGold,
  supportsTempo,
  tempoOf,
  toggleGold,
} from "@/lib/choreoEditor";
import { scrollIntoBoxDelta } from "@/lib/editorPreview";
import { drawMoveFigure } from "@/lib/game/draw";
import { createMoveFigureCache, type MoveFigure } from "@/lib/game/pikto";
import { useT, type MessageKey } from "@/lib/i18n";
import { StorageFullError } from "@/lib/library/storage";
import { formatOffsetMs } from "@/lib/sync";
import type { Song } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EditorPreview } from "./EditorPreview";
import { BTN, Card, ERROR, HINT } from "./parts";

/** Offset steps; `beat` steps use the choreography's beat length. */
const OFFSET_STEPS = [
  { beats: -1, label: "editor.choreo.step.beat-1", aria: "editor.choreo.offsetStep.beat-1" },
  { ms: -100, label: "editor.choreo.step.ms-100", aria: "editor.choreo.offsetStep.ms-100" },
  { ms: -10, label: "editor.choreo.step.ms-10", aria: "editor.choreo.offsetStep.ms-10" },
  { ms: 10, label: "editor.choreo.step.ms+10", aria: "editor.choreo.offsetStep.ms+10" },
  { ms: 100, label: "editor.choreo.step.ms+100", aria: "editor.choreo.offsetStep.ms+100" },
  { beats: 1, label: "editor.choreo.step.beat+1", aria: "editor.choreo.offsetStep.beat+1" },
] as const satisfies readonly (
  | { beats: number; label: MessageKey; aria: MessageKey }
  | { ms: number; label: MessageKey; aria: MessageKey }
)[];

/** Time steps for the selected move, in beats of the choreography. */
const MOVE_STEPS = [
  { beats: -1, label: "editor.choreo.step.beat-1", aria: "editor.choreo.moveStep.beat-1" },
  {
    beats: -0.5,
    label: "editor.choreo.step.beat-half-1",
    aria: "editor.choreo.moveStep.beat-half-1",
  },
  {
    beats: 0.5,
    label: "editor.choreo.step.beat-half+1",
    aria: "editor.choreo.moveStep.beat-half+1",
  },
  { beats: 1, label: "editor.choreo.step.beat+1", aria: "editor.choreo.moveStep.beat+1" },
] as const satisfies readonly { beats: number; label: MessageKey; aria: MessageKey }[];

const formatRate = (r: number, decimal: string) => `${String(r).replace(".", decimal)}×`;

/** Stick figure on a fixed-size canvas, redrawn only when figure, gold flag or colors change. */
function MoveCanvas({
  fig,
  gold,
  accent,
  secondary,
  className,
}: {
  fig: MoveFigure | null;
  gold: boolean;
  accent: string;
  secondary: string;
  className: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawMoveFigure(ref.current, fig, gold, { accent, secondary });
  }, [fig, gold, accent, secondary]);
  return <canvas ref={ref} aria-hidden className={className} />;
}

/**
 * Choreography editor (stages 8d-1, 8d-2a, 8d-2b): works on a local copy of the song. Moves can be
 * marked gold, shifted in time (half or whole beats), inserted after the selected move or deleted,
 * the gold suggestion applied, `choreo.offsetMs` shifted and the tempo chosen. Shifts and
 * insertions that break the timing rules (see `shiftMove`) are disabled, with a hint.
 * "Vorschau" (`EditorPreview`) plays the working copy with a click per move and highlights the
 * current move in the timeline; edits apply while it plays, a tempo change rebuilds its source.
 * "Speichern" writes the copy via `onSave` and returns to the library; "Verwerfen" resets it
 * after a confirmation.
 */
export function ChoreoEditorScreen({
  song,
  onSave,
}: {
  song: Song;
  onSave: (song: Song) => Promise<void>;
}) {
  const t = useT();
  const id = useId();
  const navigate = useNavigate();
  const [working, setWorking] = useState(song);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  // Last dialog mode; kept after closing so the text does not flip during the close animation.
  const [mode, setMode] = useState<"leave" | "reset">("leave");
  /** Move the preview is at (null: not playing or before the first move). */
  const [nowIndex, setNowIndex] = useState<number | null>(null);
  /** "Klick bei jedem Move" (not persisted); here so it survives the preview's tempo remount. */
  const [click, setClick] = useState(true);
  /** Dance video for the preview; loaded here so the preview's tempo remount keeps the URL. */
  const danceVideo = useDanceVideo(working);
  const timelineRef = useRef<HTMLOListElement>(null);
  // Set right before the navigation after a successful save, which must not be blocked.
  const leavingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const choreo = working.choreo;
  const { moves, frames, accentColor: accent, secondaryColor: secondary } = choreo;
  const [figureCache] = useState(createMoveFigureCache);
  const figures = useMemo(
    () => figureCache.figures({ moves, frames }),
    [figureCache, moves, frames],
  );
  const sel = Math.min(selected, moves.length - 1);
  const move = moves[sel];
  const dirty = isEdited(song, working);
  const deletable = canDeleteMove(choreo);
  const rate = tempoOf(working);
  const beat = beatLengthMs(choreo.bpm);
  const goldCount = moves.filter((m) => m.gold).length;
  const tempoOk = supportsTempo(working);
  const shiftOk = MOVE_STEPS.map((s) => canShiftMove(choreo, sel, s.beats * beat));
  const insertOk = canInsertAfter(choreo, sel);
  const timeBlocked = !insertOk || shiftOk.some((ok) => !ok);

  // Keep the current preview move visible in the timeline (horizontal scroll only).
  useEffect(() => {
    const ol = timelineRef.current;
    const li = nowIndex === null ? null : ol?.children[nowIndex];
    if (!ol || !(li instanceof HTMLElement)) return;
    const delta = scrollIntoBoxDelta(ol.getBoundingClientRect(), li.getBoundingClientRect());
    if (delta === 0) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ol.scrollBy({ left: delta, behavior: still ? "auto" : "smooth" });
  }, [nowIndex]);

  // Any navigation away (in-app link, browser or Android back) with unsaved changes asks first;
  // reloading or closing the tab triggers the browser's beforeunload warning.
  const shouldBlock = useCallback(() => !leavingRef.current, []);
  const blocker = useBlocker({
    shouldBlockFn: shouldBlock,
    enableBeforeUnload: shouldBlock,
    disabled: !dirty,
    withResolver: true,
  });
  const blocked = blocker.status === "blocked";
  if (blocked && mode !== "leave") setMode("leave");

  const edit = (next: Song) => {
    setSaveError(null);
    setWorking(next);
  };
  const editChoreo = (next: Song["choreo"]) => {
    if (next !== choreo) edit({ ...working, choreo: next });
  };
  const insertMove = () => {
    const next = insertMoveAfter(choreo, sel);
    if (next.choreo === choreo) return;
    setSelected(next.index);
    editChoreo(next.choreo);
  };
  const removeMove = () => {
    const next = deleteMove(choreo, sel);
    if (next === choreo) return;
    setSelected(Math.min(sel, next.moves.length - 1));
    editChoreo(next);
  };

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    setSaveError(null);
    const next = prepareSave(working, Date.now());
    try {
      await onSave(next);
      if (mountedRef.current) {
        leavingRef.current = true;
        void navigate({ to: "/" });
      }
    } catch (e) {
      if (mountedRef.current)
        setSaveError(e instanceof StorageFullError ? e.message : t("editor.choreo.saveError"));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const discard = () => {
    setWorking(song);
    setSelected(Math.min(sel, song.choreo.moves.length - 1));
    setSaveError(null);
  };
  const openReset = () => {
    setMode("reset");
    setResetOpen(true);
  };
  const closeDialog = () => {
    if (blocked) blocker.reset();
    setResetOpen(false);
  };
  const confirmed = () => {
    if (blocked) blocker.proceed();
    else discard();
    setResetOpen(false);
  };

  return (
    <main className="safe-pad flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-240 flex-col gap-4 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-title chrome-text chrome-glow truncate pb-[0.1em] text-4xl sm:text-5xl">
              {song.title}
            </h1>
            <p className="text-base text-white/90">{t("editor.choreo.subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg" variant="secondary" className={BTN}>
              <Link to="/">
                <ArrowLeft aria-hidden />
                {t("common.back")}
              </Link>
            </Button>
            <Button
              size="lg"
              variant="secondary"
              disabled={busy || !dirty}
              onClick={openReset}
              className={BTN}
            >
              <Undo2 aria-hidden />
              {t("editor.choreo.discard")}
            </Button>
            <Button size="lg" disabled={busy || !dirty} onClick={() => void save()} className={BTN}>
              <Save aria-hidden />
              {busy ? t("editor.choreo.saving") : t("common.save")}
            </Button>
          </div>
        </div>
        {saveError && (
          <p role="alert" className={ERROR}>
            {saveError}
          </p>
        )}

        <Card title={t("editor.choreo.movesTitle")}>
          <p className={HINT}>
            {t("editor.choreo.movesSummary", { moves: moves.length, gold: goldCount })}
          </p>
          <ol
            ref={timelineRef}
            aria-label={t("editor.choreo.timeline")}
            className="-mx-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-2"
          >
            {moves.map((m, i) => (
              <li key={`${m.timeMs}-${i}`} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={i === sel}
                  aria-current={i === nowIndex ? "true" : undefined}
                  aria-label={t(
                    m.gold ? "editor.choreo.timelineMoveGold" : "editor.choreo.timelineMove",
                    { n: i + 1, time: formatMoveTime(moveAudioMs(choreo, i)) },
                  )}
                  onClick={() => setSelected(i)}
                  className={cn(
                    "flex w-24 flex-col items-center gap-1 rounded-2xl border-4 p-1.5 text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold",
                    i === nowIndex ? "glow-song bg-song/60" : "bg-black/25",
                    i === sel ? "border-white" : m.gold ? "border-gold" : "border-white/20",
                  )}
                >
                  <MoveCanvas
                    fig={figures[i] ?? null}
                    gold={m.gold}
                    accent={accent}
                    secondary={secondary}
                    className="h-24 w-full"
                  />
                  <span className="flex items-center gap-1 text-sm tabular-nums">
                    {m.gold && <Star aria-hidden className="size-3.5 fill-gold text-gold" />}
                    {formatMoveTime(moveAudioMs(choreo, i))}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Card>

        <EditorPreview
          key={rate}
          song={working}
          selected={sel}
          onNow={setNowIndex}
          click={click}
          onClickChange={setClick}
          videoUrl={danceVideo.url}
          onVideoError={danceVideo.onError}
        />

        <div className="grid gap-4 landscape:grid-cols-2">
          {move && (
            <Card title={t("editor.choreo.moveTitle", { n: sel + 1 })}>
              <div className="flex items-center gap-4">
                <MoveCanvas
                  fig={figures[sel] ?? null}
                  gold={move.gold}
                  accent={accent}
                  secondary={secondary}
                  className={cn(
                    "size-36 shrink-0 rounded-2xl border-4 bg-black/25",
                    move.gold ? "border-gold" : "border-white/20",
                  )}
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-lg tabular-nums" data-testid="selected-time">
                    {formatMoveTime(moveAudioMs(choreo, sel))}
                  </p>
                  {move.label && <p className={HINT}>{move.label}</p>}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <p id={`${id}-zeit`} className="text-lg font-medium">
                  {t("editor.choreo.timeLabel")}
                </p>
                <div
                  role="group"
                  aria-labelledby={`${id}-zeit`}
                  aria-describedby={timeBlocked ? `${id}-time` : undefined}
                  className="flex flex-wrap gap-2"
                >
                  {MOVE_STEPS.map((s, i) => (
                    <Button
                      key={s.label}
                      size="lg"
                      variant="secondary"
                      aria-label={t(s.aria)}
                      disabled={!shiftOk[i]}
                      aria-describedby={shiftOk[i] ? undefined : `${id}-time`}
                      onClick={() => editChoreo(shiftMove(choreo, sel, s.beats * beat))}
                      className={cn(BTN, "px-4 tabular-nums")}
                    >
                      {t(s.label)}
                    </Button>
                  ))}
                </div>
                <Button
                  size="lg"
                  variant="secondary"
                  disabled={!insertOk}
                  aria-describedby={insertOk ? undefined : `${id}-time`}
                  onClick={insertMove}
                  className={cn(BTN, "self-start")}
                >
                  <Plus aria-hidden />
                  {t("editor.choreo.insert")}
                </Button>
                {timeBlocked && (
                  <p id={`${id}-time`} className={HINT}>
                    {t("editor.choreo.timeBlocked")}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-4">
                <label htmlFor={`${id}-gold`} className="text-lg font-medium">
                  {t("editor.choreo.gold")}
                </label>
                <Switch
                  id={`${id}-gold`}
                  checked={move.gold}
                  onCheckedChange={() => editChoreo(toggleGold(choreo, sel))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  size="lg"
                  variant="destructive"
                  disabled={!deletable}
                  aria-describedby={deletable ? undefined : `${id}-min`}
                  onClick={removeMove}
                  className={cn(BTN, "self-start")}
                >
                  <Trash2 aria-hidden />
                  {t("editor.choreo.deleteMove")}
                </Button>
                {!deletable && (
                  <p id={`${id}-min`} className={HINT}>
                    {t("editor.choreo.minMoves", { min: MIN_MOVES })}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => editChoreo(suggestGold(choreo))}
                  className={cn(BTN, "self-start")}
                >
                  <Sparkles aria-hidden />
                  {t("editor.choreo.suggestGold")}
                </Button>
                <p className={HINT}>{t("editor.choreo.suggestGoldHint")}</p>
              </div>
            </Card>
          )}

          <div className="flex flex-col gap-4">
            <Card title={t("editor.choreo.offsetTitle")}>
              <p className="text-lg">
                {t("editor.choreo.offsetLabel")}{" "}
                <strong data-testid="choreo-offset" className="tabular-nums">
                  {formatOffsetMs(choreo.offsetMs)}
                </strong>
              </p>
              <p className={HINT}>{t("editor.choreo.offsetHint")}</p>
              <div className="flex flex-wrap gap-2">
                {OFFSET_STEPS.map((s) => (
                  <Button
                    key={s.label}
                    size="lg"
                    variant="secondary"
                    aria-label={t(s.aria)}
                    onClick={() =>
                      editChoreo(
                        shiftOffset(
                          choreo,
                          "beats" in s ? s.beats * beat : s.ms,
                          song.choreo.offsetMs,
                        ),
                      )
                    }
                    className={cn(BTN, "px-4 tabular-nums")}
                  >
                    {t(s.label)}
                  </Button>
                ))}
              </div>
            </Card>

            <Card title={t("editor.choreo.tempoTitle")}>
              <div
                role="group"
                aria-label={t("editor.choreo.tempoTitle")}
                className="flex flex-wrap gap-2"
              >
                {TEMPO_OPTIONS.map((r) => (
                  <Button
                    key={r}
                    size="lg"
                    variant={rate === r ? "default" : "secondary"}
                    aria-pressed={rate === r}
                    disabled={!tempoOk}
                    aria-describedby={tempoOk ? undefined : `${id}-tempo`}
                    onClick={() => rate !== r && edit(setTempo(working, r))}
                    className={cn(BTN, "px-5 tabular-nums")}
                  >
                    {formatRate(r, t("editor.time.decimal"))}
                  </Button>
                ))}
              </div>
              <p className={HINT}>{t("editor.choreo.tempoHint")}</p>
              {!tempoOk && (
                <p
                  id={`${id}-tempo`}
                  role="note"
                  className="flex items-start gap-2 text-base font-medium"
                >
                  <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-gold" />
                  <span>{t("editor.choreo.tempoSpotify")}</span>
                </p>
              )}
            </Card>
          </div>
        </div>
      </div>

      <AlertDialog open={blocked || resetOpen} onOpenChange={(open) => !open && closeDialog()}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("editor.choreo.discardTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "leave"
                ? t("editor.choreo.leaveDescription")
                : t("editor.choreo.resetDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3 sm:space-x-0">
            <AlertDialogCancel className={cn(BTN, "mt-0")}>
              {t("editor.choreo.keepEditing")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmed}
              className={cn(
                BTN,
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
            >
              {mode === "leave" ? t("editor.choreo.discardAndLeave") : t("editor.choreo.discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
