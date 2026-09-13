"""
BIS Biometric Engine — Benchmark Harness Tests (WP7)

Validates the SYNTHETIC-COHORT decision-layer benchmark:
  - cohort generator determinism (same seed -> identical cohort)
  - pair derivation determinism and correctness
  - metric correctness on hand-computed toy confusion sets (FAR/FRR/EER/AUC)
  - thresholds are sourced from the engine config (no hardcoded duplicates)
  - report.json schema shape

Requires only numpy (no model weights, no network) — same offline guarantee
as the harness itself.
"""
import json
import os
import re
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "benchmarks"))
import run_benchmarks as rb  # noqa: E402

SEED = 20260114


class TestCohortDeterminism(unittest.TestCase):
    def test_same_seed_identical_cohort(self):
        a = rb.generate_cohort(n_identities=8, samples_per_identity=4, dim=512, seed=SEED)
        b = rb.generate_cohort(n_identities=8, samples_per_identity=4, dim=512, seed=SEED)
        np.testing.assert_array_equal(a, b)

    def test_different_seed_differs(self):
        a = rb.generate_cohort(n_identities=8, samples_per_identity=4, dim=512, seed=SEED)
        b = rb.generate_cohort(n_identities=8, samples_per_identity=4, dim=512, seed=SEED + 1)
        self.assertFalse(np.array_equal(a, b))

    def test_embeddings_are_unit_norm(self):
        cohort = rb.generate_cohort(n_identities=4, samples_per_identity=3, dim=512, seed=SEED)
        norms = np.linalg.norm(cohort, axis=2)
        np.testing.assert_allclose(norms, 1.0, atol=1e-12)

    def test_intra_variance_smaller_than_inter_variance(self):
        # Genuine-pair cosine spread must be tighter than impostor-pair spread.
        cohort = rb.generate_cohort(n_identities=60, samples_per_identity=6, dim=512,
                                    target_genuine_cosine=0.65, seed=SEED)
        genuine, impostor = rb.derive_pairs(cohort, impostor_ratio=1.0, seed=SEED)
        flat = cohort.reshape(-1, 512)
        g = np.array([rb._local_cosine_similarity(flat[a], flat[b]) for a, b in genuine])
        i = np.array([rb._local_cosine_similarity(flat[a], flat[b]) for a, b in impostor])
        self.assertLess(float(np.std(g)), float(np.std(i)))
        self.assertGreater(float(np.mean(g)), 0.5)   # centred near target 0.65
        self.assertAlmostEqual(float(np.mean(i)), 0.0, delta=0.02)

    def test_pair_derivation_deterministic_and_valid(self):
        cohort = rb.generate_cohort(n_identities=6, samples_per_identity=4, dim=64, seed=SEED)
        g1, i1 = rb.derive_pairs(cohort, seed=SEED)
        g2, i2 = rb.derive_pairs(cohort, seed=SEED)
        self.assertEqual(g1, g2)
        self.assertEqual(i1, i2)
        # Genuine: C(4,2)=6 per identity x 6 identities
        self.assertEqual(len(g1), 6 * 6)
        self.assertEqual(len(i1), len(g1))  # default impostor_ratio=1.0
        # Genuine pairs are within-identity; impostor pairs cross identities
        k = 4
        for a, b in g1:
            self.assertEqual(a // k, b // k)
        for a, b in i1:
            self.assertNotEqual(a // k, b // k)
        self.assertEqual(len(set(i1)), len(i1))  # no duplicate impostor pairs


class TestToyMetrics(unittest.TestCase):
    """Hand-computed FAR/FRR/EER/AUC on tiny confusion sets."""

    def setUp(self):
        # genuine: 0.9, 0.8, 0.7, 0.3   impostor: 0.5, 0.2, 0.15, 0.1
        self.genuine = np.array([0.9, 0.8, 0.7, 0.3])
        self.impostor = np.array([0.5, 0.2, 0.15, 0.1])

    def test_confusion_at_threshold(self):
        # threshold 0.6: impostor accepts = {0.5>=0.6? no} -> FAR=0/4=0.0
        # genuine rejects = {0.3} -> FRR=1/4=0.25
        r = rb.confusion_at_threshold(self.genuine, self.impostor, 0.6)
        self.assertAlmostEqual(r["far"], 0.0)
        self.assertAlmostEqual(r["frr"], 0.25)
        # threshold 0.4: impostor accepts = {0.5} -> FAR=0.25; FRR=0.25
        r = rb.confusion_at_threshold(self.genuine, self.impostor, 0.4)
        self.assertAlmostEqual(r["far"], 0.25)
        self.assertAlmostEqual(r["frr"], 0.25)

    def test_roc_sweep_endpoints(self):
        pts = rb.roc_sweep(self.genuine, self.impostor)
        # Endpoint above max score: accept nothing -> FAR=0, FRR=1
        self.assertAlmostEqual(pts[0]["far"], 0.0)
        self.assertAlmostEqual(pts[0]["frr"], 1.0)
        # Endpoint below min score: accept everything -> FAR=1, FRR=0
        self.assertAlmostEqual(pts[-1]["far"], 1.0)
        self.assertAlmostEqual(pts[-1]["frr"], 0.0)
        # Every unique score appears as a candidate threshold
        self.assertEqual(len(pts), 8 + 2)

    def test_eer_hand_computed(self):
        # FAR/FRR by threshold (score >= t accepts):
        #   t in (0.5, 0.7]: FAR=0,    FRR=0.25  -> |d|=0.25
        #   t in (0.3, 0.5]: FAR=0.25, FRR=0.25  -> crossing, EER=0.25
        #   t in (0.2, 0.3]: FAR=0.25, FRR=0
        pts = rb.roc_sweep(self.genuine, self.impostor)
        res = rb.eer_from_roc(pts)
        self.assertAlmostEqual(res["eer"], 0.25)
        self.assertTrue(0.3 < res["eer_threshold"] <= 0.5)

    def test_eer_perfect_separation_is_zero(self):
        genuine = np.array([0.9, 0.8, 0.7])
        impostor = np.array([0.3, 0.2, 0.1])
        res = rb.eer_from_roc(rb.roc_sweep(genuine, impostor))
        self.assertAlmostEqual(res["eer"], 0.0)
        self.assertTrue(0.3 < res["eer_threshold"] <= 0.7)

    def test_auc_hand_computed(self):
        # Perfect separation -> AUC 1.0
        genuine = np.array([0.9, 0.8, 0.7])
        impostor = np.array([0.3, 0.2, 0.1])
        self.assertAlmostEqual(rb.auc_from_roc(rb.roc_sweep(genuine, impostor)), 1.0)
        # Fully overlapping identical distributions -> AUC 0.5
        same = np.array([0.5, 0.5])
        self.assertAlmostEqual(rb.auc_from_roc(rb.roc_sweep(same, same)), 0.5)


class TestThresholdSourcing(unittest.TestCase):
    def test_thresholds_come_from_engine_source(self):
        cfg = rb.load_engine_thresholds()
        t = cfg["thresholds"]
        self.assertEqual(set(t), {"LIVENESS_THRESHOLD", "MATCH_THRESHOLD", "ANTISPOOFING_THRESHOLD"})
        for name in t:
            self.assertIn(name, cfg["provenance"])
        # The parsed value must equal the default literally declared in the
        # engine source — proving the harness reads the real config.
        with open(rb.ENGINE_MAIN, encoding="utf-8") as fh:
            src = fh.read()
        m = re.search(
            r'MATCH_THRESHOLD\s*=\s*float\(\s*os\.getenv\(\s*"MATCH_THRESHOLD"\s*,\s*"([^"]+)"\s*\)\s*\)',
            src,
        )
        self.assertIsNotNone(m, "MATCH_THRESHOLD default not found in engine source")
        self.assertEqual(float(m.group(1)), t["MATCH_THRESHOLD"])

    def test_env_override_wins(self):
        os.environ["MATCH_THRESHOLD"] = "0.55"
        try:
            cfg = rb.load_engine_thresholds()
            self.assertEqual(cfg["thresholds"]["MATCH_THRESHOLD"], 0.55)
            self.assertEqual(cfg["provenance"]["MATCH_THRESHOLD"], "env:MATCH_THRESHOLD")
        finally:
            del os.environ["MATCH_THRESHOLD"]


class TestReportSchema(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = rb.run_benchmark(
            n_identities=12, samples_per_identity=4, dim=512,
            target_genuine_cosine=0.65, impostor_ratio=1.0, seed=SEED,
        )

    def test_top_level_schema(self):
        r = self.report
        self.assertEqual(r["label"], "SYNTHETIC-COHORT")
        for key in ("seed", "params", "thresholds", "threshold_provenance",
                    "similarity_implementation", "match_metrics", "latency",
                    "antispoofing_decision_summary", "environment"):
            self.assertIn(key, r)
        self.assertIsInstance(r["seed"], int)
        self.assertFalse(r["environment"]["network_required"])
        self.assertFalse(r["environment"]["model_weights_loaded"])

    def test_metrics_schema_and_ranges(self):
        m = self.report["match_metrics"]
        for key in ("operating_point", "eer", "eer_threshold", "roc_auc", "roc_points"):
            self.assertIn(key, m)
        op = m["operating_point"]
        for key in ("threshold", "far", "frr", "genuine_mean", "impostor_mean"):
            self.assertIn(key, op)
        for v in (op["far"], op["frr"], m["eer"]):
            self.assertGreaterEqual(v, 0.0)
            self.assertLessEqual(v, 1.0)
        self.assertGreaterEqual(m["roc_auc"], 0.0)
        self.assertLessEqual(m["roc_auc"], 1.0)
        # Threshold used at the operating point is the engine's MATCH_THRESHOLD
        self.assertEqual(op["threshold"], self.report["thresholds"]["MATCH_THRESHOLD"])

    def test_latency_schema(self):
        lat = self.report["latency"]
        self.assertGreater(lat["n_calls"], 0)
        self.assertLessEqual(lat["p50_us"], lat["p95_us"])
        self.assertLessEqual(lat["p95_us"], lat["p99_us"])
        self.assertLessEqual(lat["p99_us"], lat["max_us"])

    def test_antispoofing_summary_schema(self):
        a = self.report["antispoofing_decision_summary"]
        for side in ("genuine", "spoof"):
            for key in ("n", "mean", "std", "p05", "p50", "p95", "min", "max",
                        "pass_rate_at_threshold"):
                self.assertIn(key, a[side])
        self.assertEqual(a["threshold"],
                         self.report["thresholds"]["ANTISPOOFING_THRESHOLD"])

    def test_report_is_json_serializable_and_deterministic(self):
        r2 = rb.run_benchmark(n_identities=12, samples_per_identity=4, dim=512,
                              target_genuine_cosine=0.65, impostor_ratio=1.0, seed=SEED)
        # Latency is wall-clock and varies; everything else must be identical.
        for r in (self.report, r2):
            r["latency"] = None
        self.assertEqual(self.report, r2)
        json.dumps(self.report)  # must not raise

    def test_cli_writes_report_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "report.json")
            rc = rb.main(["--identities", "8", "--samples", "3", "--seed", str(SEED),
                          "--out", out])
            self.assertEqual(rc, 0)
            with open(out, encoding="utf-8") as fh:
                report = json.load(fh)
            self.assertEqual(report["label"], "SYNTHETIC-COHORT")
            self.assertEqual(report["params"]["n_identities"], 8)


if __name__ == "__main__":
    unittest.main()
