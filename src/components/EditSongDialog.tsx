import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
} from "react";
import { Link } from "@tanstack/react-router";
import {
  AudioWaveform,
  Download,
  Film,
  ListMusic,
  Pencil,
  Sparkles,
  Trash2,
  VideoOff,
} from "lucide-react";

import { VIDEO_BEAT_MAX_BYTES } from "@/components/add-song/VideoChoreoPanel";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StorageFullError, formatMb } from "@/lib/library/storage";
import type { SongDetailsPatch } from "@/hooks/useSongLibrary";
import { formatOffsetMs, formatStartOffsetSeconds, parseStartOffsetSeconds } from "@/lib/sync";
import type { Song } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Same limits as SongSchema in src/lib/schema.ts. */
const TITLE_MAX = 120;
const ARTIST_MAX = 120;

const BTN =
  "btn-pill h-12 gap-2 rounded-full px-6 text-base focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5";
const INPUT = "h-11 rounded-xl text-base md:text-base";
const ERROR =
  "rounded-xl bg-destructive px-3 py-2 text-base font-medium text-destructive-foreground";
const HINT = "text-sm text-muted-foreground";
const FIELD_ERROR = "text-sm font-medium text-destructive";

/** File-name safe version of a title: lowercase ASCII words joined by dashes. */
const slugify = (title: string) =>
  title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "song";

const errorText = (e: unknown, fallback: string) =>
  e instanceof StorageFullError ? e.message : fallback;

interface EditSongDialogProps {
  /** Selected song; the trigger is hidden without one. */
  song: Song | undefined;
  /** Saves title, artist and start offset together in one write. */
  onSave: (song: Song, patch: Required<SongDetailsPatch>) => Promise<void>;
  onRemove: (song: Song) => Promise<void>;
  /** Replaces the choreography with a newly generated one; resolves with the saved song. */
  onRegenerate: (song: Song, difficulty: 1 | 2 | 3) => Promise<Song>;
  /** Attaches, replaces or (`undefined`) removes the dance video; resolves with the saved song. */
  onSetVideo: (song: Song, video: Blob | undefined) => Promise<Song>;
  /** Whether the music itself is a video shown in the game (local blob of type video/*). */
  onCheckMusicVideo: (song: Song) => Promise<boolean>;
  /** JSON text of the song's choreography export. */
  onExport: (song: Song) => Promise<string>;
  /** Called once the dialogs are gone after a delete; the caller moves focus somewhere useful. */
  onDeleted: () => void;
}

/**
 * Edit button plus dialog to change a song's title, artist and start offset, regenerate its
 * choreography, attach or remove a dance video, or delete it (with confirmation). Stays mounted
 * while the selection changes, so a delete can close its dialogs cleanly. The dialog works on a
 * snapshot of the song taken when it opened; a regeneration or video change replaces the snapshot
 * with the saved song.
 */
export function EditSongDialog({
  song,
  onSave,
  onRemove,
  onRegenerate,
  onSetVideo,
  onCheckMusicVideo,
  onExport,
  onDeleted,
}: EditSongDialogProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Song | undefined>(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [start, setStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenDone, setRegenDone] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoDone, setVideoDone] = useState<string | null>(null);
  const [removeVideoOpen, setRemoveVideoOpen] = useState(false);
  const [removeVideoError, setRemoveVideoError] = useState<string | null>(null);
  /** Result of the music check, keyed by song id so a stale answer never shows. */
  const [musicVideo, setMusicVideo] = useState<{ id: string; value: boolean } | null>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const attachButton = useRef<HTMLButtonElement>(null);
  /** Set after a successful delete: the trigger's song is gone, so focus goes elsewhere. */
  const deleted = useRef(false);
  const videoRemoved = useRef(false);

  const trimmedTitle = title.trim();
  const trimmedArtist = artist.trim();
  const titleValid = trimmedTitle.length >= 1 && trimmedTitle.length <= TITLE_MAX;
  const artistValid = trimmedArtist.length <= ARTIST_MAX;
  const startMs = parseStartOffsetSeconds(start);
  const startValid = startMs !== null;

  const changeOpen = (next: boolean) => {
    if (busy) return; // never close while a write is running
    if (next) {
      if (!song) return;
      setTarget(song);
      setTitle(song.title);
      setArtist(song.artist);
      setStart(formatStartOffsetSeconds(song.startOffsetMs));
      setDifficulty(song.difficulty);
      setError(null);
      setRegenDone(false);
      setVideoError(null);
      setVideoDone(null);
    }
    setOpen(next);
  };

  const targetId = target?.id;
  const localMusic = target?.source.type === "local" ? target : undefined;
  useEffect(() => {
    if (!open || !localMusic) return;
    let live = true;
    onCheckMusicVideo(localMusic).then(
      (value) => {
        if (live) setMusicVideo({ id: localMusic.id, value });
      },
      () => {}, // unknown: no hint
    );
    return () => {
      live = false;
    };
  }, [open, localMusic, onCheckMusicVideo]);
  const musicIsVideo = musicVideo !== null && musicVideo.id === targetId && musicVideo.value;

  const attachVideo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be chosen again
    if (!file || !target || busy) return;
    setVideoError(null);
    setVideoDone(null);
    setRegenDone(false);
    if (file.size > VIDEO_BEAT_MAX_BYTES) {
      setVideoError(
        `Das Video ist zu groß (${formatMb(file.size)}, höchstens ${formatMb(VIDEO_BEAT_MAX_BYTES)}).`,
      );
      return;
    }
    setBusy(true);
    try {
      // "Speichern" writes the snapshot, so it must carry the new videoBlobId.
      setTarget(await onSetVideo(target, file));
      setVideoDone(`Tanzvideo gespeichert. Es belegt ${formatMb(file.size)} in der Bibliothek.`);
    } catch (err) {
      setVideoError(errorText(err, "Das Video konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemoveVideo = async (e: MouseEvent) => {
    e.preventDefault(); // keep the confirmation open until the video is removed
    if (!target || busy) return;
    setBusy(true);
    setRemoveVideoError(null);
    try {
      setTarget(await onSetVideo(target, undefined));
      videoRemoved.current = true;
      setRemoveVideoOpen(false);
      setVideoError(null);
      setVideoDone("Tanzvideo entfernt.");
      setRegenDone(false);
    } catch (err) {
      setRemoveVideoError(errorText(err, "Entfernen hat nicht geklappt. Versuch es noch einmal."));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target || !titleValid || !artistValid || startMs === null || busy) return;
    // The field shows one decimal: an untouched field keeps the exact stored value.
    const startOffsetMs =
      start === formatStartOffsetSeconds(target.startOffsetMs) ? target.startOffsetMs : startMs;
    setBusy(true);
    setError(null);
    try {
      await onSave(target, { title: trimmedTitle, artist: trimmedArtist, startOffsetMs });
      setOpen(false);
    } catch (err) {
      setError(errorText(err, "Speichern hat nicht geklappt. Versuch es noch einmal."));
    } finally {
      setBusy(false);
    }
  };

  const exportFile = async () => {
    if (!target || busy) return;
    setError(null);
    try {
      const json = await onExport(target);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slugify(target.title)}.dancebeat.json`;
        document.body.append(a);
        a.click();
        a.remove();
      } finally {
        // Safari/iOS starts the download asynchronously; revoking right away can cancel it.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setError("Die Choreografie konnte nicht exportiert werden.");
    }
  };

  const confirmDelete = async (e: MouseEvent) => {
    e.preventDefault(); // keep the confirmation open until the delete succeeded
    if (!target || busy) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await onRemove(target);
      deleted.current = true;
      setConfirmOpen(false);
      setOpen(false);
    } catch (err) {
      setDeleteError(errorText(err, "Löschen hat nicht geklappt. Versuch es noch einmal."));
    } finally {
      setBusy(false);
    }
  };

  const confirmRegenerate = async (e: MouseEvent) => {
    e.preventDefault(); // keep the confirmation open until the new choreography is saved
    if (!target || busy) return;
    setBusy(true);
    setRegenError(null);
    setRegenDone(false);
    try {
      const saved = await onRegenerate(target, difficulty);
      // "Speichern" writes the snapshot including its choreography, so it must be the saved song.
      setTarget(saved);
      setRegenOpen(false);
      setRegenDone(true);
      setVideoDone(null);
    } catch (err) {
      setRegenError(errorText(err, "Neu erzeugen hat nicht geklappt. Versuch es noch einmal."));
    } finally {
      setBusy(false);
    }
  };

  const shownTitle = target?.title ?? "";

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {song && (
        <DialogTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Song bearbeiten"
            className="btn-pill size-12 shrink-0 focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5"
          >
            <Pencil aria-hidden />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-3xl"
        onCloseAutoFocus={(e) => {
          if (!deleted.current) return; // default: back to the edit button
          deleted.current = false;
          e.preventDefault();
          onDeleted();
        }}
      >
        <DialogHeader>
          <DialogTitle>Song bearbeiten</DialogTitle>
          <DialogDescription>
            Ändere Titel, Künstler und Startpunkt, prüfe den Takt im Sync-Test, bearbeite die
            Choreografie oder erzeuge sie neu, hänge ein Tanzvideo an oder lösche den Song.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-title`} className="text-base">
              Titel
            </Label>
            <Input
              id={`${id}-title`}
              value={title}
              maxLength={TITLE_MAX}
              required
              autoComplete="off"
              aria-invalid={!titleValid}
              onChange={(e) => setTitle(e.target.value)}
              className={INPUT}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-artist`} className="text-base">
              Künstler
            </Label>
            <Input
              id={`${id}-artist`}
              value={artist}
              maxLength={ARTIST_MAX}
              autoComplete="off"
              aria-invalid={!artistValid}
              onChange={(e) => setArtist(e.target.value)}
              className={INPUT}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-start`} className="text-base">
              Start ab (Sekunden)
            </Label>
            <Input
              id={`${id}-start`}
              value={start}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={!startValid}
              aria-describedby={
                startValid ? `${id}-start-hint` : `${id}-start-err ${id}-start-hint`
              }
              onChange={(e) => setStart(e.target.value)}
              className={INPUT}
            />
            {!startValid && (
              <p id={`${id}-start-err`} className={FIELD_ERROR}>
                Bitte eine Zahl zwischen 0 und 600 Sekunden.
              </p>
            )}
            <p id={`${id}-start-hint`} className={HINT}>
              Überspringt ein Intro. Moves davor zählen nicht.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void exportFile()}
            className={BTN}
          >
            <Download aria-hidden />
            Choreografie exportieren
          </Button>
          {target && (
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild variant="secondary" className={BTN}>
                <Link to="/sync/$songId" params={{ songId: target.id }}>
                  <AudioWaveform aria-hidden />
                  Sync-Test
                </Link>
              </Button>
              <p className="text-base">
                Sync-Offset:{" "}
                <span className="tabular-nums">{formatOffsetMs(target.syncOffsetMs)}</span>
              </p>
            </div>
          )}
          {target && (
            <Button asChild variant="secondary" className={BTN}>
              <Link to="/edit/$songId" params={{ songId: target.id }}>
                <ListMusic aria-hidden />
                Choreografie bearbeiten
              </Link>
            </Button>
          )}
          {target && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-difficulty`} className="text-base">
                Schwierigkeit
              </Label>
              <select
                id={`${id}-difficulty`}
                value={difficulty}
                disabled={busy}
                aria-describedby={`${id}-difficulty-hint`}
                onChange={(e) => setDifficulty(Number(e.target.value) as 1 | 2 | 3)}
                className="h-11 rounded-xl border border-input bg-transparent px-3 text-base"
              >
                <option value={1}>1 – Leicht</option>
                <option value={2}>2 – Mittel</option>
                <option value={3}>3 – Schwer</option>
              </select>
              <p id={`${id}-difficulty-hint`} className={HINT}>
                Erzeugt neue Moves im Takt des Songs. Bei einer Audiodatei wird die Musik dafür neu
                analysiert.
              </p>
              <AlertDialog
                open={regenOpen}
                onOpenChange={(next) => {
                  if (busy) return;
                  if (next) setRegenError(null);
                  setRegenOpen(next);
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="secondary" disabled={busy} className={BTN}>
                    <Sparkles aria-hidden />
                    Choreografie neu erzeugen
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-3xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Choreografie von „{shownTitle}“ neu erzeugen?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Die aktuelle Choreografie wird ersetzt, auch Änderungen aus dem Editor.
                      Highscore und Sterne bleiben.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {regenError && (
                    <p role="alert" className={ERROR}>
                      {regenError}
                    </p>
                  )}
                  <AlertDialogFooter className="gap-3 sm:space-x-0">
                    <AlertDialogCancel disabled={busy} className={cn(BTN, "mt-0")}>
                      Abbrechen
                    </AlertDialogCancel>
                    <AlertDialogAction
                      disabled={busy}
                      onClick={(e) => void confirmRegenerate(e)}
                      className={BTN}
                    >
                      Neu erzeugen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {regenDone && (
                <p role="status" className="text-base">
                  Neue Choreografie gespeichert.
                </p>
              )}
            </div>
          )}
          {target && target.source.type !== "youtube" && (
            <section aria-labelledby={`${id}-video`} className="flex flex-col gap-2">
              <h3 id={`${id}-video`} className="text-base font-medium">
                Tanzvideo
              </h3>
              <p className="text-base">
                {target.videoBlobId
                  ? "Angehängt. Es läuft beim Spielen stumm statt des Coachs."
                  : "Kein Video angehängt."}
              </p>
              {!target.videoBlobId && musicIsVideo && (
                <p className={HINT}>
                  Die Musik ist schon ein Video, es läuft beim Spielen statt des Coachs. Ein
                  angehängtes Video hat Vorrang.
                </p>
              )}
              <input
                ref={videoInput}
                type="file"
                accept="video/*"
                hidden
                tabIndex={-1}
                aria-label="Tanzvideo wählen"
                onChange={(e) => void attachVideo(e)}
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  ref={attachButton}
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  aria-describedby={`${id}-video-hint`}
                  onClick={() => videoInput.current?.click()}
                  className={BTN}
                >
                  <Film aria-hidden />
                  {target.videoBlobId ? "Video ersetzen" : "Video anhängen"}
                </Button>
                {target.videoBlobId && (
                  <AlertDialog
                    open={removeVideoOpen}
                    onOpenChange={(next) => {
                      if (busy) return;
                      if (next) setRemoveVideoError(null);
                      setRemoveVideoOpen(next);
                    }}
                  >
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="secondary" disabled={busy} className={BTN}>
                        <VideoOff aria-hidden />
                        Video entfernen
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent
                      className="rounded-3xl"
                      onCloseAutoFocus={(e) => {
                        // After a removal the trigger is gone; the attach button stays.
                        if (!videoRemoved.current) return; // default: back to the trigger
                        videoRemoved.current = false;
                        e.preventDefault();
                        attachButton.current?.focus();
                      }}
                    >
                      <AlertDialogHeader>
                        <AlertDialogTitle>Tanzvideo von „{shownTitle}“ entfernen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Das Video wird von diesem Gerät gelöscht. Musik, Choreografie und
                          Highscore bleiben.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      {removeVideoError && (
                        <p role="alert" className={ERROR}>
                          {removeVideoError}
                        </p>
                      )}
                      <AlertDialogFooter className="gap-3 sm:space-x-0">
                        <AlertDialogCancel disabled={busy} className={cn(BTN, "mt-0")}>
                          Abbrechen
                        </AlertDialogCancel>
                        <AlertDialogAction
                          disabled={busy}
                          onClick={(e) => void confirmRemoveVideo(e)}
                          className={cn(
                            BTN,
                            "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                          )}
                        >
                          Entfernen
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
              <p id={`${id}-video-hint`} className={HINT}>
                Das Video muss zur Musik passen und an derselben Stelle beginnen, sonst läuft es
                versetzt. Es wird auf diesem Gerät gespeichert (höchstens{" "}
                {formatMb(VIDEO_BEAT_MAX_BYTES)}).
              </p>
              {videoError && (
                <p role="alert" className={ERROR}>
                  {videoError}
                </p>
              )}
              {videoDone && (
                <p role="status" className="text-base">
                  {videoDone}
                </p>
              )}
            </section>
          )}
          {error && (
            <p role="alert" className={ERROR}>
              {error}
            </p>
          )}
          <DialogFooter className="gap-3 sm:justify-between sm:space-x-0">
            <AlertDialog
              open={confirmOpen}
              onOpenChange={(next) => {
                if (busy) return;
                if (next) setDeleteError(null);
                setConfirmOpen(next);
              }}
            >
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={busy} className={BTN}>
                  <Trash2 aria-hidden />
                  Song löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent
                className="rounded-3xl"
                onCloseAutoFocus={(e) => {
                  if (deleted.current) e.preventDefault(); // the edit dialog handles it
                }}
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>„{shownTitle}“ löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Highscore und Audio werden entfernt. Das kann nicht rückgängig gemacht werden.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {deleteError && (
                  <p role="alert" className={ERROR}>
                    {deleteError}
                  </p>
                )}
                <AlertDialogFooter className="gap-3 sm:space-x-0">
                  <AlertDialogCancel disabled={busy} className={cn(BTN, "mt-0")}>
                    Abbrechen
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={busy}
                    onClick={(e) => void confirmDelete(e)}
                    className={cn(
                      BTN,
                      "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                    )}
                  >
                    Löschen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              type="submit"
              disabled={busy || !titleValid || !artistValid || !startValid}
              className={BTN}
            >
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
