// Measures demo songs (run: `bun run measure-audio public/demo-audio/*.mp3`): tempo, beat phase
// (time of the first downbeat), duration and the energy per 4 beats, from which the sections in
// src/data/demos/*.manifest.json are judged (see docs/choreography-format.md#demo-manifest).
// Decoding needs ffmpeg on the PATH (optional system tool, not a project dependency).
//
// Tempo: coarse estimate and refinement as in the app (src/lib/beat.ts), then a comb filter over
// the whole song ±0.5 BPM in 0.01 steps. Phase: the same comb filter at fixed tempo on the kick
// band (lowpass 120 Hz); the full band locks onto hi-hat offbeats in some songs.
// Logic: scripts/measureAudio.ts, decoding: scripts/decodeAudio.ts.
import path from "node:path";

import { estimateBpmFromSamples, onsetEnvelope, refineBpm } from "../src/lib/beat.ts";
import { KICK_FILTER, SAMPLE_RATE, decode } from "./decodeAudio.ts";
import { blockRms, fitBeatGrid, formatTime } from "./measureAudio.ts";

const BLOCK_BEATS = 4;

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Aufruf: bun run measure-audio <datei.mp3> [...]");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  try {
    const full = decode(file);
    const low = decode(file, KICK_FILTER);
    const durationMs = Math.round((full.length / SAMPLE_RATE) * 1000);
    const fullEnv = onsetEnvelope(full, SAMPLE_RATE);
    const coarse = refineBpm(fullEnv, Math.round(estimateBpmFromSamples(full, SAMPLE_RATE)));
    const { bpm } = fitBeatGrid(fullEnv, coarse - 0.5, coarse + 0.5);
    const { phaseMs } = fitBeatGrid(onsetEnvelope(low, SAMPLE_RATE), bpm, bpm);
    const beatMs = 60_000 / bpm;

    console.log(`\n${path.basename(file)}`);
    console.log(`  bpm: ${bpm}  (coarse ${coarse})`);
    console.log(`  beatPhaseMs: ${phaseMs}`);
    console.log(`  durationMs: ${durationMs}`);
    console.log(`  beats from phase to end: ${Math.floor((durationMs - phaseMs) / beatMs)}`);
    const rmsFull = blockRms(full, SAMPLE_RATE, bpm, phaseMs, BLOCK_BEATS);
    const rmsLow = blockRms(low, SAMPLE_RATE, bpm, phaseMs, BLOCK_BEATS);
    console.log(`  RMS per ${BLOCK_BEATS} beats:`);
    console.log("   beat    time   full    low");
    rmsFull.forEach((r, k) => {
      const beat = k * BLOCK_BEATS;
      const t = formatTime(phaseMs + beat * beatMs);
      const bar = "#".repeat(Math.round(r * 100));
      console.log(
        `  ${String(beat).padStart(5)} ${t.padStart(7)} ${r.toFixed(3)}  ${(rmsLow[k] ?? 0).toFixed(3)}  ${bar}`,
      );
    });
  } catch (err) {
    failed++;
    console.error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
if (failed > 0) process.exit(1);
