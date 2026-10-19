// Downloads the pose models into public/mediapipe/models/ (run: `bun run fetch-models`).
// Runs automatically before dev and build; skips files that already match their hash.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { MODELS, MODELS_DIR, needsDownload, verifyModel, type ModelSpec } from "./models.ts";

const TIMEOUT_MS = 60_000;

async function fetchModel(spec: ModelSpec): Promise<void> {
  const target = path.join(MODELS_DIR, spec.file);
  const existing = existsSync(target) ? readFileSync(target) : null;
  if (!needsDownload(existing, spec.sha256)) {
    console.log(`[fetch-models] ${spec.file}: present, hash ok`);
    return;
  }
  console.log(`[fetch-models] ${spec.file}: downloading ${spec.url}`);
  let data: Uint8Array;
  try {
    const res = await fetch(spec.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    data = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    const reason =
      e instanceof Error && e.name === "TimeoutError"
        ? `no complete response within ${TIMEOUT_MS / 1000} s`
        : e instanceof Error
          ? e.message
          : String(e);
    throw new Error(
      `Download of ${spec.file} failed (${reason}). ` +
        `Check the network connection and run "bun run fetch-models" again.`,
    );
  }
  verifyModel(spec, data);
  mkdirSync(MODELS_DIR, { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, target);
  } finally {
    rmSync(tmp, { force: true });
  }
  console.log(`[fetch-models] ${spec.file}: saved, hash ok`);
}

try {
  for (const spec of MODELS) await fetchModel(spec);
} catch (e) {
  console.error(`[fetch-models] ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
