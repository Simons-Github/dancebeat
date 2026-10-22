"""Converts AIST++ keypoints3d pickles to the neutral JSON of src/lib/aist.ts (Etappe 13h-2).

Run isolated, with numpy from a venv outside the repo (scripts/aist/requirements.txt):

    <venv>/bin/python -I scripts/aist/convert.py --out=DIR a.pkl b.pkl ...

Writes `<clip name>.aist.json` ({fps, joints}, COCO-17 in cm, missing joints null) per input and
`clips.json` with the BPM of each clip's music piece, both for `bun run aist-track`. Clips of
genres without standing dance are skipped, as are names in the optional --ignore list
(ignore_list.txt of AIST++).

The pickles are third-party data: they are read with a restricted unpickler that only resolves
the numpy array reconstruction helpers; any other global aborts the file.
"""

import argparse
import io
import json
import math
import pickle
import re
import sys
from pathlib import Path

import numpy as np

FPS = 60
JOINTS = 17

# Same set as AIST_STANDING_GENRES in src/lib/aist.ts.
STANDING_GENRES = ("gHO", "gLH", "gMH", "gLO", "gWA", "gJB")

# Tempo of the music pieces m<genre>0..5 (AIST Dance DB, data formats page): House 110-135 in
# steps of 5, all other genres 80-130 in steps of 10.
def music_bpm(genre: str, index: int) -> int:
    return 110 + 5 * index if genre == "HO" else 80 + 10 * index


# AIST clip name, e.g. gHO_sBM_cAll_d19_mHO0_ch01: genre, situation, camera, dancer, music, choreo.
NAME = re.compile(r"^g([A-Z]{2})_s(?:BM|FM)_c\w+_d\d{2}_m([A-Z]{2})([0-5])_ch\d{2}$")

# Globals a numpy array pickle needs (protocols 2-5, numpy 1 and 2 module paths). The data bytes
# of protocol 2 go through _codecs.encode.
ALLOWED = {
    ("numpy", "ndarray"),
    ("numpy", "dtype"),
    ("numpy.core.multiarray", "_reconstruct"),
    ("numpy._core.multiarray", "_reconstruct"),
    ("numpy.core.multiarray", "scalar"),
    ("numpy._core.multiarray", "scalar"),
    ("numpy.core.numeric", "_frombuffer"),
    ("numpy._core.numeric", "_frombuffer"),
    ("_codecs", "encode"),
}


class RestrictedUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if (module, name) not in ALLOWED:
            raise pickle.UnpicklingError(f"nicht erlaubt: {module}.{name}")
        # numpy 2 moved numpy.core to numpy._core; resolve the new path directly.
        return super().find_class(module.replace("numpy.core", "numpy._core", 1), name)


def load_pickle(data: bytes):
    return RestrictedUnpickler(io.BytesIO(data)).load()


def keypoints(data: bytes) -> np.ndarray:
    """keypoints3d_optim of one pickle as float array (frames, 17, 3)."""
    obj = load_pickle(data)
    if not isinstance(obj, dict) or "keypoints3d_optim" not in obj:
        raise ValueError("kein keypoints3d_optim")
    arr = obj["keypoints3d_optim"]
    if not isinstance(arr, np.ndarray) or arr.dtype.kind != "f":
        raise ValueError("keypoints3d_optim ist kein Float-Array")
    if arr.ndim != 3 or arr.shape[0] < 1 or arr.shape[1:] != (JOINTS, 3):
        raise ValueError(f"keypoints3d_optim hat Form {arr.shape}, erwartet (N, 17, 3)")
    return arr


def to_json(arr: np.ndarray) -> dict:
    """Neutral JSON: cm rounded to 0.01, a joint with any non-finite coordinate is null."""
    joints = [
        [
            [round(float(c), 2) for c in j] if all(math.isfinite(c) for c in j) else None
            for j in frame.tolist()
        ]
        for frame in arr
    ]
    return {"fps": FPS, "joints": joints}


def clip_entry(name: str) -> dict | None:
    """Clip list entry with the music BPM, None for other genres or names."""
    m = NAME.match(name)
    if not m or f"g{m[1]}" not in STANDING_GENRES or m[2] != m[1]:
        return None
    return {"name": name, "bpm": music_bpm(m[2], int(m[3]))}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--ignore", type=Path, help="ignore_list.txt von AIST++")
    parser.add_argument("inputs", nargs="+", type=Path)
    args = parser.parse_args(argv)

    ignored = set()
    if args.ignore:
        ignored = {line.strip() for line in args.ignore.read_text().splitlines() if line.strip()}

    args.out.mkdir(parents=True, exist_ok=True)
    clips, failed, skipped = [], 0, 0
    for path in args.inputs:
        name = path.name.removesuffix(".pkl")
        entry = clip_entry(name)
        if entry is None or name in ignored:
            skipped += 1
            continue
        try:
            arr = keypoints(path.read_bytes())
        except (pickle.UnpicklingError, ValueError, EOFError) as e:
            print(f"{path}: {e}", file=sys.stderr)
            failed += 1
            continue
        (args.out / f"{name}.aist.json").write_text(json.dumps(to_json(arr), separators=(",", ":")))
        clips.append(entry)
        print(f"{path}: {arr.shape[0]} Bilder, {entry['bpm']} BPM")

    clips.sort(key=lambda c: c["name"])
    (args.out / "clips.json").write_text(json.dumps(clips, indent=2) + "\n")
    print(f"{len(clips)} Clips, {skipped} übersprungen, {failed} fehlerhaft → {args.out}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
