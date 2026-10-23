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
import { StorageFullError } from "@/lib/library/storage";
import { formatOffsetMs } from "@/lib/sync";
import type { Song } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EditorPreview } from "./EditorPreview";
import { BTN, Card, ERROR, HINT } from "./parts";

/** Offset steps; `beat` steps use the choreography's beat length. */
const OFFSET_STEPS = [
  { beats: -1, label: "−1 Beat", aria: "Offset um 1 Beat verringern" },
  { ms: -100, label: "−100", aria: "Offset um 100 ms verringern" },
  { ms: -10, label: "−10", aria: "Offset um 10 ms verringern" },
  { ms: 10, label: "+10", aria: "Offset um 10 ms erhöhen" },
  { ms: 100, label: "+100", aria: "Offset um 100 ms erhöhen" },
  { beats: 1, label: "+1 Beat", aria: "Offset um 1 Beat erhöhen" },
] as const;

/** Time steps for the selected move, in beats of the choreography. */
const MOVE_STEPS = [
  { beats: -1, label: "−1 Beat", aria: "Move um 1 Beat früher" },
  { beats: -0.5, label: "−½ Beat", aria: "Move um ½ Beat früher" },
  { beats: 0.5, label: "+½ Beat", aria: "Move um ½ Beat später" },
  { beats: 1, label: "+1 Beat", aria: "Move um 1 Beat später" },
] as const;

const formatRate = (r: number) => `${String(r).replace(".", ",")}×`;

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
        setSaveError(
          e instanceof StorageFullError
            ? e.message
            : "Speichern hat nicht geklappt. Versuch es noch einmal.",
        );
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
            <h1 className="font-title text-stroke truncate text-3xl sm:text-4xl">{song.title}</h1>
            <p className="text-base text-white/90">Choreografie bearbeiten</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg" variant="secondary" className={BTN}>
              <Link to="/">
                <ArrowLeft aria-hidden />
                Zurück
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
              Verwerfen
            </Button>
            <Button size="lg" disabled={busy || !dirty} onClick={() => void save()} className={BTN}>
              <Save aria-hidden />
              {busy ? "Speichert …" : "Speichern"}
            </Button>
          </div>
        </div>
        {saveError && (
          <p role="alert" className={ERROR}>
            {saveError}
          </p>
        )}

        <Card title="Moves">
          <p className={HINT}>
            {moves.length} Moves, davon {goldCount} Gold Moves. Zeiten in Musikzeit (Move-Zeit plus
            Offset). Beim Abspielen leuchtet der aktuelle Move in Songfarbe.
          </p>
          <ol
            ref={timelineRef}
            aria-label="Timeline"
            className="-mx-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-2"
          >
            {moves.map((m, i) => (
              <li key={`${m.timeMs}-${i}`} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={i === sel}
                  aria-current={i === nowIndex ? "true" : undefined}
                  aria-label={`Move ${i + 1}, ${formatMoveTime(moveAudioMs(choreo, i))}${m.gold ? ", Gold Move" : ""}`}
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
            <Card title={`Move ${sel + 1}`}>
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
                  Zeit
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
                      aria-label={s.aria}
                      disabled={!shiftOk[i]}
                      aria-describedby={shiftOk[i] ? undefined : `${id}-time`}
                      onClick={() => editChoreo(shiftMove(choreo, sel, s.beats * beat))}
                      className={cn(BTN, "px-4 tabular-nums")}
                    >
                      {s.label}
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
                  Move danach einfügen
                </Button>
                {timeBlocked && (
                  <p id={`${id}-time`} className={HINT}>
                    Gesperrt, wenn der Abstand zum Nachbar-Move unter 0,3 s fällt, die Aufnahme dort
                    keine Pose hat oder der Move vor den Musikbeginn rutschen würde.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-4">
                <label htmlFor={`${id}-gold`} className="text-lg font-medium">
                  Gold Move
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
                  Move löschen
                </Button>
                {!deletable && (
                  <p id={`${id}-min`} className={HINT}>
                    Mindestens {MIN_MOVES} Moves müssen bleiben.
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
                  Gold-Vorschlag übernehmen
                </Button>
                <p className={HINT}>Wählt die Gold Moves der ganzen Choreografie neu aus.</p>
              </div>
            </Card>
          )}

          <div className="flex flex-col gap-4">
            <Card title="Offset">
              <p className="text-lg">
                Choreo-Offset:{" "}
                <strong data-testid="choreo-offset" className="tabular-nums">
                  {formatOffsetMs(choreo.offsetMs)}
                </strong>
              </p>
              <p className={HINT}>
                Verschiebt alle Moves gegen die Musik (plus = später). Die Verzögerung deines Geräts
                stellst du im Sync-Test ein, nicht hier.
              </p>
              <div className="flex flex-wrap gap-2">
                {OFFSET_STEPS.map((s) => (
                  <Button
                    key={s.label}
                    size="lg"
                    variant="secondary"
                    aria-label={s.aria}
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
                    {s.label}
                  </Button>
                ))}
              </div>
            </Card>

            <Card title="Tempo">
              <div role="group" aria-label="Tempo" className="flex flex-wrap gap-2">
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
                    {formatRate(r)}
                  </Button>
                ))}
              </div>
              <p className={HINT}>Spielt die Musik langsamer oder schneller ab, Moves inklusive.</p>
              {!tempoOk && (
                <p
                  id={`${id}-tempo`}
                  role="note"
                  className="flex items-start gap-2 text-base font-medium"
                >
                  <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-gold" />
                  <span>Spotify spielt immer mit normalem Tempo.</span>
                </p>
              )}
            </Card>
          </div>
        </div>
      </div>

      <AlertDialog open={blocked || resetOpen} onOpenChange={(open) => !open && closeDialog()}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Änderungen verwerfen?</AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "leave"
                ? "Du hast ungespeicherte Änderungen an der Choreografie. Beim Verlassen gehen sie verloren."
                : "Alle ungespeicherten Änderungen werden zurückgesetzt."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3 sm:space-x-0">
            <AlertDialogCancel className={cn(BTN, "mt-0")}>Weiter bearbeiten</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmed}
              className={cn(
                BTN,
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
            >
              {mode === "leave" ? "Verwerfen und verlassen" : "Verwerfen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
