export interface FrameStatsSnapshot {
  fps: number;
  inferenceMs: number;
}

/**
 * Detection rate and inference time. `record` runs once per processed frame and only touches
 * numbers; the UI polls `snapshot` a few times per second (never per frame).
 */
export class FrameStats {
  private times: number[] = [];
  private inferenceMs = 0;

  constructor(private readonly windowMs = 1000) {}

  record(nowMs: number, inferenceMs: number) {
    this.times.push(nowMs);
    const cutoff = nowMs - this.windowMs;
    while (this.times.length > 1 && (this.times[0] ?? 0) < cutoff) this.times.shift();
    // Smoothed so the readout does not jitter.
    this.inferenceMs =
      this.inferenceMs === 0 ? inferenceMs : this.inferenceMs * 0.8 + inferenceMs * 0.2;
  }

  snapshot(nowMs: number): FrameStatsSnapshot {
    const cutoff = nowMs - this.windowMs;
    const recent = this.times.filter((t) => t >= cutoff);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const span = first !== undefined && last !== undefined ? last - first : 0;
    return {
      fps: recent.length > 1 && span > 0 ? ((recent.length - 1) * 1000) / span : 0,
      inferenceMs: this.inferenceMs,
    };
  }

  reset() {
    this.times = [];
    this.inferenceMs = 0;
  }
}
