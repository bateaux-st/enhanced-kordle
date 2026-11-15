"""scripts/smoke.py의 기대값이 서버 코드·export_d1.py와 같은지 고정한다.

어긋나면 운영 smoke가 배포 뒤에야 깨지므로, 같은 근거를 커밋 전에 잡는다.
"""
import json
import re
import unittest

from export_d1 import MAX_N, MIN_N, THRESHOLDS
from smoke_defs import ROOT, load_smoke

SERVER = ROOT / "src" / "lib" / "server"


def read(path):
    return path.read_text(encoding="utf-8")


def pool_threshold_from_dict_ts():
    body = re.search(r"export const POOL_THRESHOLD[^=]*=\s*\{([^}]*)\}", read(SERVER / "dict.ts")).group(1)
    return {m[0]: int(m[1]) for m in re.findall(r"'?([\w-]+)'?\s*:\s*(\d+)", body)}


class SmokeParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.smoke = load_smoke("EXPECTED_T", "POOL_SIZE", "DAILY_DEDUP_START", "daily_idx")

    def test_expected_t_equals_pool_threshold(self):
        self.assertEqual(self.smoke["EXPECTED_T"], pool_threshold_from_dict_ts())

    def test_dedup_start_equals_token_ts(self):
        ts = re.search(r"export const DAILY_DEDUP_START = '([^']+)'", read(SERVER / "token.ts")).group(1)
        self.assertEqual(self.smoke["DAILY_DEDUP_START"], ts)

    def test_pool_size_keys_are_every_threshold_and_length_export_d1_writes(self):
        expected = {(t, n) for t in THRESHOLDS for n in range(MIN_N, MAX_N + 1)}
        self.assertEqual(set(self.smoke["POOL_SIZE"]), expected)

    def test_every_expected_t_has_a_pool_in_export_d1(self):
        self.assertLessEqual(set(self.smoke["EXPECTED_T"].values()), set(THRESHOLDS))

    def test_daily_idx_matches_shared_vectors(self):
        """tests/daily-vectors.json은 token.ts dailyIndex를 쓰는 daily-parity.test.mjs와 같은 파일이다."""
        vectors = json.loads(read(ROOT / "tests" / "daily-vectors.json"))
        daily_idx = self.smoke["daily_idx"]
        for v in vectors:
            with self.subTest(**v):
                self.assertEqual(daily_idx(v["day"], v["n"], v["climb"], v["count"]), v["idx"])


if __name__ == "__main__":
    unittest.main()
