// Measures the AIST Dance DB music pieces (run: `bun run aist-music Rohdaten/aist-music/*.mp3`):
// checks the tempo table (`aistMusicBpm`, used for the clip list) and records the beat phase in
// the music file. That phase is not the clip phase: it does not carry over to the clips (12
// pieces are clearly offset), while clip time 0 lies on the beat (Etappe 13h-3,
// docs/choreography-format.md#aist-musik). The music files are third-party media and never
// committed; only the numbers are, in scripts/aist/music.json. Decoding needs ffmpeg on the PATH.
//
// The tempo is not estimated freely: on these pieces the estimate often lands on a wrong ratio
// (mMH0 160 instead of 80, mLH1 120 instead of 90). Instead the script fits the tempo within
// ±0.5 BPM of the table on the full band and warns above 0.1 BPM deviation. The phase is fitted
// at the table tempo on the kick band, as in measure-audio.ts.
// Format: docs/choreography-format.md#aist-musik.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { aistMusicBpm, AistMusicTableSchema, type AistMusicTable } from "../../src/lib/aist.ts";
import { onsetEnvelope } from "../../src/lib/beat.ts";
import { KICK_FILTER, SAMPLE_RATE, decode } from "../decodeAudio.ts";
import { fitBeatGrid } from "../measureAudio.ts";

const MAX_BPM_DEVIATION = 0.1;

const { values, positionals } = parseArgs({
  options: { out: { type: "string" } },
  allowPositionals: true,
});
if (positionals.length === 0) {
  console.error("Aufruf: bun run aist-music [--out=music.json] mHO0.mp3 ...");
  process.exit(1);
}
const out = path.resolve(values.out ?? path.join(import.meta.dirname, "music.json"));

const table: AistMusicTable = {};
let failed = 0;
for (const file of positionals) {
  const piece = path.basename(file).replace(/\.(mp3|wav)$/i, "");
  const bpm = aistMusicBpm(piece);
  if (bpm === null) {
    console.error(`${file}: kein AIST-Musikstück (mHO0 … mWA5), übersprungen`);
    failed++;
    continue;
  }
  try {
    const full = decode(file);
    const measured = fitBeatGrid(onsetEnvelope(full, SAMPLE_RATE), bpm - 0.5, bpm + 0.5).bpm;
    const { phaseMs } = fitBeatGrid(
      onsetEnvelope(decode(file, KICK_FILTER), SAMPLE_RATE),
      bpm,
      bpm,
    );
    const durationMs = Math.round((full.length / SAMPLE_RATE) * 1000);
    table[piece] = { bpm, measuredBpm: measured, beatPhaseMs: phaseMs, durationMs };
    console.log(`${piece}: ${bpm} BPM (gemessen ${measured}), Phase ${phaseMs} ms`);
    if (Math.abs(measured - bpm) > MAX_BPM_DEVIATION)
      console.log(
        `  Warnung: Tempo weicht um mehr als ${MAX_BPM_DEVIATION} BPM von der Tabelle ab`,
      );
  } catch (e) {
    console.error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

// A failed file would drop its piece from the committed table: write nothing then.
if (failed > 0) {
  console.error(`${failed} Datei(en) fehlgeschlagen, ${out} bleibt unverändert`);
  process.exit(1);
}
const sorted = AistMusicTableSchema.parse(
  Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b))),
);
writeFileSync(out, JSON.stringify(sorted, null, 2) + "\n");
console.log(`${Object.keys(sorted).length} Stücke → ${out}`);
