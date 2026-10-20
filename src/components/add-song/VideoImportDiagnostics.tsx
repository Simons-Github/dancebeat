import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { importOptions, type PoseTrackFile } from "@/lib/poseTrackFile";
import { trackMetrics } from "@/lib/videoChoreo";

const BTN = "h-11 rounded-full px-4 text-base focus-visible:ring-4 focus-visible:ring-gold";

const pct = (v: number) => `${Math.round(v * 100)} %`;
const deg = (v: number | null) => (v === null ? "–" : `${v.toFixed(2)}°`);

const slugify = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "video";

interface VideoImportDiagnosticsProps {
  file: PoseTrackFile;
  /** Wall-clock duration of the analysis, null if unknown. */
  analysisMs: number | null;
}

/**
 * Dev-only quality figures of the video import and the raw-data export for
 * `scripts/tune-video-choreo.ts`. Only rendered behind `import.meta.env.DEV`.
 */
export function VideoImportDiagnostics({ file, analysisMs }: VideoImportDiagnosticsProps) {
  const m = useMemo(() => {
    const { track, opts } = importOptions(file);
    return trackMetrics(track, opts);
  }, [file]);

  const exportRaw = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ ...file, exportedAt: Date.now() })], {
        type: "application/json",
      }),
    );
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(file.video)}${file.model ? `-${file.model}` : ""}.posetrack.json`;
      document.body.append(a);
      a.click();
      a.remove();
    } finally {
      // Safari/iOS starts the download asynchronously; revoking right away can cancel it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  return (
    <section
      aria-label="Diagnose (Dev)"
      className="flex flex-col gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground"
    >
      <p className="font-medium">Diagnose (nur Dev-Modus)</p>
      <ul className="flex flex-col gap-1">
        <li>
          Erkennung {pct(m.detectionRatio)} von {m.samples} Proben
        </li>
        <li>
          Moves {m.moves} von {m.moveSlots} Rasterpunkten ({pct(m.usableMoveRatio)})
        </li>
        <li>
          Zittern roh {deg(m.jitterRawDeg)}, geglättet {deg(m.jitterSmoothDeg)} pro Probe
        </li>
        <li>Holdout-Fehler {deg(m.holdoutDeg)}</li>
        <li>
          Bewegung an den Moves{" "}
          {m.moveMotionDegPerS === null ? "–" : `${m.moveMotionDegPerS.toFixed(1)} °/s`}
          {file.movePlacement && ` (${file.movePlacement})`}
        </li>
        <li>
          BPM {file.bpm}, Beat-Phase {file.beatPhaseMs} ms
        </li>
        {file.model && <li>Modell {file.model}</li>}
        {analysisMs !== null && <li>Analyse {(analysisMs / 1000).toFixed(1)} s</li>}
      </ul>
      <Button type="button" variant="secondary" onClick={exportRaw} className={BTN}>
        Rohdaten exportieren
      </Button>
    </section>
  );
}
