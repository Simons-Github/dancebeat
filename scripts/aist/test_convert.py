"""Tests for convert.py: <venv>/bin/python -I scripts/aist/test_convert.py"""

import importlib.util
import json
import math
import os
import pickle
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

# -I leaves the script directory off sys.path, so load the module by file path.
_spec = importlib.util.spec_from_file_location("convert", Path(__file__).with_name("convert.py"))
assert _spec and _spec.loader
convert = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(convert)


def figure(frames: int = 2) -> np.ndarray:
    arr = np.arange(frames * 17 * 3, dtype=np.float64).reshape(frames, 17, 3)
    return arr + 0.123


class Evil:
    def __reduce__(self):
        return (os.system, ("echo pwned",))


class RestrictedUnpicklerTest(unittest.TestCase):
    def test_reads_arrays_with_every_protocol(self):
        arr = figure()
        for protocol in range(2, pickle.HIGHEST_PROTOCOL + 1):
            with self.subTest(protocol=protocol):
                data = pickle.dumps({"keypoints3d_optim": arr, "loss": np.float64(1.5)}, protocol)
                np.testing.assert_array_equal(convert.keypoints(data), arr)

    def test_rejects_other_globals(self):
        for protocol in range(2, pickle.HIGHEST_PROTOCOL + 1):
            with self.subTest(protocol=protocol):
                data = pickle.dumps({"keypoints3d_optim": Evil()}, protocol)
                with self.assertRaisesRegex(pickle.UnpicklingError, "posix.system|nt.system"):
                    convert.load_pickle(data)

    def test_rejects_object_arrays(self):
        arr = np.array([Evil()], dtype=object)
        with self.assertRaises(pickle.UnpicklingError):
            convert.load_pickle(pickle.dumps({"keypoints3d_optim": arr}))
        plain = np.empty((1, 17, 3), dtype=object)
        plain.fill(1.0)
        with self.assertRaisesRegex(ValueError, "Float"):
            convert.keypoints(pickle.dumps({"keypoints3d_optim": plain}))

    def test_rejects_wrong_content(self):
        with self.assertRaisesRegex(ValueError, "keypoints3d_optim"):
            convert.keypoints(pickle.dumps({"keypoints3d": figure()}))
        with self.assertRaisesRegex(ValueError, "Form"):
            convert.keypoints(pickle.dumps({"keypoints3d_optim": np.zeros((2, 18, 3))}))
        with self.assertRaisesRegex(ValueError, "Form"):
            convert.keypoints(pickle.dumps({"keypoints3d_optim": np.zeros((0, 17, 3))}))


class ConvertTest(unittest.TestCase):
    def test_json_rounds_and_nulls_non_finite_joints(self):
        arr = figure(1)
        arr[0, 3, 1] = math.nan
        arr[0, 4, 2] = math.inf
        out = convert.to_json(arr)
        self.assertEqual(out["fps"], 60)
        self.assertEqual(len(out["joints"]), 1)
        self.assertEqual(len(out["joints"][0]), 17)
        self.assertEqual(out["joints"][0][0], [0.12, 1.12, 2.12])
        self.assertIsNone(out["joints"][0][3])
        self.assertIsNone(out["joints"][0][4])
        self.assertEqual(out["joints"][0][16], [48.12, 49.12, 50.12])

    def test_clip_entry_bpm_and_genres(self):
        self.assertEqual(
            convert.clip_entry("gHO_sBM_cAll_d19_mHO0_ch01"),
            {"name": "gHO_sBM_cAll_d19_mHO0_ch01", "bpm": 110},
        )
        self.assertEqual(convert.clip_entry("gHO_sFM_cAll_d20_mHO5_ch13")["bpm"], 135)
        self.assertEqual(convert.clip_entry("gLH_sBM_cAll_d16_mLH0_ch01")["bpm"], 80)
        self.assertEqual(convert.clip_entry("gJB_sFM_cAll_d09_mJB5_ch20")["bpm"], 130)
        self.assertIsNone(convert.clip_entry("gBR_sBM_cAll_d04_mBR0_ch01"))
        self.assertIsNone(convert.clip_entry("gKR_sBM_cAll_d28_mKR2_ch01"))
        self.assertIsNone(convert.clip_entry("gHO_sBM_cAll_d19_mLH0_ch01"))
        self.assertIsNone(convert.clip_entry("readme"))

    def test_main_writes_json_and_clip_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, out = Path(tmp, "src"), Path(tmp, "out")
            src.mkdir()
            good = src / "gLO_sBM_cAll_d13_mLO2_ch02.pkl"
            good.write_bytes(pickle.dumps({"keypoints3d_optim": figure(3)}))
            (src / "gBR_sBM_cAll_d04_mBR0_ch01.pkl").write_bytes(good.read_bytes())
            (src / "gWA_sBM_cAll_d25_mWA0_ch01.pkl").write_bytes(good.read_bytes())
            (src / "gHO_sBM_cAll_d19_mHO1_ch02.pkl").write_bytes(
                pickle.dumps({"keypoints3d_optim": Evil()})
            )
            ignore = Path(tmp, "ignore_list.txt")
            ignore.write_text("gWA_sBM_cAll_d25_mWA0_ch01\n")

            inputs = [str(p) for p in sorted(src.iterdir())]
            code = convert.main(["--out", str(out), "--ignore", str(ignore), *inputs])

            self.assertEqual(code, 1)
            self.assertEqual(
                sorted(p.name for p in out.iterdir()),
                ["clips.json", "gLO_sBM_cAll_d13_mLO2_ch02.aist.json"],
            )
            self.assertEqual(
                json.loads((out / "clips.json").read_text()),
                [{"name": "gLO_sBM_cAll_d13_mLO2_ch02", "bpm": 100}],
            )
            data = json.loads((out / "gLO_sBM_cAll_d13_mLO2_ch02.aist.json").read_text())
            self.assertEqual(len(data["joints"]), 3)


if __name__ == "__main__":
    unittest.main(argv=sys.argv[:1])
