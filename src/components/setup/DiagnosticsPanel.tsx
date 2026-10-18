import { useEffect, useState, type RefObject } from "react";

import type { PoseStatsRef } from "@/hooks/usePoseTracking";

interface Readout {
  fps: number;
  inferenceMs: number;
}

/** Polls the stats ref twice a second; the detection loop itself never renders. */
export function DiagnosticsPanel({ statsRef }: { statsRef: RefObject<PoseStatsRef> }) {
  const [read, setRead] = useState<Readout>({ fps: 0, inferenceMs: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      const snap = statsRef.current.stats.snapshot(performance.now());
      setRead({ fps: snap.fps, inferenceMs: snap.inferenceMs });
    }, 500);
    return () => clearInterval(id);
  }, [statsRef]);

  return (
    <dl
      aria-label="Diagnose"
      className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-xl bg-black/40 px-3 py-2 text-sm text-white tabular-nums"
    >
      <dt className="text-white/80">Erkennung</dt>
      <dd>{read.fps.toFixed(0)} FPS (Ziel: über 25)</dd>
      <dt className="text-white/80">Inferenz</dt>
      <dd>{read.inferenceMs.toFixed(1)} ms</dd>
      <dt className="text-white/80">Delegate</dt>
      <dd>{statsRef.current.delegate ?? "–"}</dd>
      <dt className="text-white/80">Modell</dt>
      <dd>{statsRef.current.model || "–"}</dd>
    </dl>
  );
}
