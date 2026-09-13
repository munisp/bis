#!/usr/bin/env python3
"""
BIS Biometric Engine — Decision-Layer Benchmark Harness (WP7)

WHAT THIS BENCHMARKS
--------------------
This harness validates the *decision layer* of the biometric engine: the
cosine-similarity math and the configured thresholds
(LIVENESS_THRESHOLD, MATCH_THRESHOLD, ANTISPOOFING_THRESHOLD) that turn
model scores into accept/reject decisions.

It deliberately does NOT load MediaPipe, InsightFace/ONNX Runtime, or the
MiniFASNetV2 anti-spoofing weights: those model files require
network/dataset downloads that are unavailable offline, and they are not
the layer where the thresholds live. If the engine module can be imported
without heavy deps, the engine's own ``_cosine_similarity`` is used;
otherwise the identical math (dot / (|a| * |b|)) is applied locally and the
report records which implementation was used. Thresholds are always read
from the engine source (``services/biometric-engine/main.py``) or the same
environment variables the engine reads — they are never hardcoded here.

COHORT MODEL (fully documented, fully synthetic)
------------------------------------------------
Identity class centres are drawn uniformly on the unit 512-sphere
(``rng.normal`` + L2 normalise). For random unit vectors in 512-d the
inter-class cosine similarity has mean ~0 and std ~1/sqrt(512) ~ 0.044.
Within-class samples are ``normalise(centre + sigma_intra * N(0, I))`` where
``sigma_intra`` is derived from ``target_genuine_cosine`` (default 0.65) via
``sigma_intra = sqrt((1/target - 1) / dim)``: in 512-d the noise vector norm
squared is ``sigma_intra^2 * dim = (1/target - 1)``, so the expected genuine
cosine is ``1 / (1 + noise_norm^2) = target``. This places the genuine
distribution on the realistic side of, but close to, the engine's
MATCH_THRESHOLD so both decision tails are exercised.
ALL RESULTS ARE SYNTHETIC-COHORT — see docs/biometric-benchmarks.md.

OFFLINE GUARANTEE: no network access, no dataset downloads, no model files.

Usage:
    python benchmarks/run_benchmarks.py [--identities 200] [--samples 10]
        [--seed 20260114] [--out benchmarks/report.json]
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import platform
import re
import sys
import time
from typing import Any, Optional

import numpy as np

# ── Paths ─────────────────────────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
SERVICE_DIR = os.path.dirname(HERE)              # services/biometric-engine
ENGINE_MAIN = os.path.join(SERVICE_DIR, "main.py")

RESULTS_LABEL = "SYNTHETIC-COHORT"

# Threshold names the engine configures via env (single source of truth:
# main.py). We never restate their defaults here.
THRESHOLD_ENV_VARS = ("LIVENESS_THRESHOLD", "MATCH_THRESHOLD", "ANTISPOOFING_THRESHOLD")


# ── Engine config ingestion ───────────────────────────────────────────────────
def load_engine_thresholds(engine_main_path: str = ENGINE_MAIN) -> dict[str, Any]:
    """
    Read the engine's decision thresholds WITHOUT hardcoded duplicates.

    Precedence (identical to the engine):
      1. Environment variables (LIVENESS_THRESHOLD / MATCH_THRESHOLD /
         ANTISPOOFING_THRESHOLD) — the engine reads these at import time.
      2. The defaults parsed from the engine source file
         (``NAME = float(os.getenv("NAME", "<default>"))``).

    Returns a dict with the thresholds plus provenance for each value.
    """
    with open(engine_main_path, "r", encoding="utf-8") as fh:
        src = fh.read()

    thresholds: dict[str, float] = {}
    provenance: dict[str, str] = {}
    for name in THRESHOLD_ENV_VARS:
        env_val = os.getenv(name)
        if env_val is not None:
            thresholds[name] = float(env_val)
            provenance[name] = f"env:{name}"
            continue
        m = re.search(
            rf'{name}\s*=\s*float\(\s*os\.getenv\(\s*"{name}"\s*,\s*"([0-9.eE+-]+)"\s*\)\s*\)',
            src,
        )
        if not m:
            raise RuntimeError(
                f"Could not locate {name} default in {engine_main_path}; "
                "refusing to guess a threshold (no hardcoded duplicates)."
            )
        thresholds[name] = float(m.group(1))
        provenance[name] = f"source:{os.path.basename(engine_main_path)}"
    return {"thresholds": thresholds, "provenance": provenance}


# ── Similarity (decision layer) ───────────────────────────────────────────────
def _local_cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Identical math to main._cosine_similarity (dot / (|a| * |b|))."""
    if a.shape != b.shape:
        raise ValueError("embedding dimensions are inconsistent")
    norm_a = float(np.linalg.norm(a))
    norm_b = float(np.linalg.norm(b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(np.dot(a, b)) / (norm_a * norm_b)


def get_cosine_similarity_fn() -> tuple[Any, str]:
    """
    Prefer the engine's own ``_cosine_similarity``. Importing main.py pulls in
    FastAPI/cv2/redis/etc., which are frequently unavailable offline; in that
    case fall back to the byte-for-byte identical local math and record it.
    """
    try:
        sys.path.insert(0, SERVICE_DIR)
        import main as engine_main  # noqa: PLC0415 — intentional late import

        return engine_main._cosine_similarity, "engine:main._cosine_similarity"
    except Exception as exc:  # offline env without FastAPI/cv2/redis — expected
        return _local_cosine_similarity, f"local-identical-math (engine import unavailable: {type(exc).__name__})"


# ── Synthetic cohort generator ────────────────────────────────────────────────
def generate_cohort(
    n_identities: int = 200,
    samples_per_identity: int = 10,
    dim: int = 512,
    target_genuine_cosine: float = 0.65,
    seed: int = 20260114,
) -> np.ndarray:
    """
    Deterministic synthetic embedding cohort.

    Shape: (n_identities, samples_per_identity, dim). Every sample is an
    L2-normalised dim-vector, matching InsightFace ``normed_embedding``.

    Inter-class variance: identity centres are uniform on the unit sphere,
    so impostor cosine ~ N(0, 1/dim) (std ~0.044 for dim=512).
    Intra-class variance: additive isotropic Gaussian noise of per-dimension
    std ``sigma_intra = sqrt((1/target_genuine_cosine - 1) / dim)`` before
    re-normalisation. The total noise energy relative to the unit centre is
    ``sigma_intra^2 * dim = 1/target_genuine_cosine - 1``, so the genuine-pair
    cosine distribution is centred near ``target_genuine_cosine``.

    Determinism: a single seeded ``numpy.default_rng`` drives every draw in a
    fixed order, so the same seed reproduces the cohort bit-for-bit.
    """
    if n_identities < 2:
        raise ValueError("need at least 2 identities for impostor pairs")
    if samples_per_identity < 2:
        raise ValueError("need at least 2 samples per identity for genuine pairs")
    if not 0.0 < target_genuine_cosine < 1.0:
        raise ValueError("target_genuine_cosine must be in (0, 1)")

    intra_std = float(np.sqrt((1.0 / target_genuine_cosine - 1.0) / dim))
    rng = np.random.default_rng(seed)
    centres = rng.normal(size=(n_identities, dim))
    centres /= np.linalg.norm(centres, axis=1, keepdims=True)

    cohort = np.empty((n_identities, samples_per_identity, dim), dtype=np.float64)
    for i in range(n_identities):
        noise = rng.normal(scale=intra_std, size=(samples_per_identity, dim))
        samples = centres[i] + noise
        samples /= np.linalg.norm(samples, axis=1, keepdims=True)
        cohort[i] = samples
    return cohort


def derive_pairs(
    cohort: np.ndarray,
    impostor_ratio: float = 1.0,
    seed: int = 20260114,
) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    """
    Genuine pairs: every unordered within-identity sample pair (C(K, 2) each).
    Impostor pairs: ``impostor_ratio * len(genuine)`` cross-identity pairs
    sampled uniformly without replacement from a seeded RNG (independent of
    the cohort RNG so pair sampling does not perturb cohort determinism).
    Returns index pairs into the flattened (identity * K + sample) axis.
    """
    n_id, k, _ = cohort.shape
    genuine: list[tuple[int, int]] = []
    for i in range(n_id):
        for a, b in itertools.combinations(range(k), 2):
            genuine.append((i * k + a, i * k + b))

    n_impostor = int(round(len(genuine) * impostor_ratio))
    rng = np.random.default_rng(seed + 1)
    impostor: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()
    while len(impostor) < n_impostor:
        i, j = sorted(rng.choice(n_id, size=2, replace=False).tolist())
        a, b = int(rng.integers(k)), int(rng.integers(k))
        key = (i * k + a, j * k + b)
        if key in seen:
            continue
        seen.add(key)
        impostor.append(key)
    return genuine, impostor


# ── Metrics ───────────────────────────────────────────────────────────────────
def confusion_at_threshold(
    genuine_scores: np.ndarray, impostor_scores: np.ndarray, threshold: float
) -> dict[str, float]:
    """Accept iff score >= threshold. FAR = impostor accepts; FRR = genuine rejects."""
    far = float(np.mean(impostor_scores >= threshold)) if len(impostor_scores) else 0.0
    frr = float(np.mean(genuine_scores < threshold)) if len(genuine_scores) else 0.0
    return {"threshold": float(threshold), "far": far, "frr": frr}


def roc_sweep(
    genuine_scores: np.ndarray, impostor_scores: np.ndarray
) -> list[dict[str, float]]:
    """
    Proper ROC sweep over every candidate threshold (all observed scores,
    plus endpoints above the max and at/below the min so (FAR=0,FRR=1) and
    (FAR=1,FRR=0) are both represented).
    """
    candidates = np.unique(np.concatenate([genuine_scores, impostor_scores]))
    points = [{"threshold": float(np.nextafter(candidates.max(), np.inf)), "far": 0.0, "frr": 1.0}]
    for t in candidates[::-1]:
        points.append(confusion_at_threshold(genuine_scores, impostor_scores, float(t)))
    points.append({"threshold": float(np.nextafter(candidates.min(), -np.inf)), "far": 1.0, "frr": 0.0})
    return points


def eer_from_roc(points: list[dict[str, float]]) -> dict[str, float]:
    """
    EER = operating point minimising |FAR - FRR| over the ROC sweep, with
    linear interpolation between the two sweep points that straddle the
    FAR==FRR crossing (falls back to the closest discrete point).
    """
    best = min(points, key=lambda p: abs(p["far"] - p["frr"]))
    for hi, lo in zip(points, points[1:]):
        d_hi = hi["far"] - hi["frr"]
        d_lo = lo["far"] - lo["frr"]
        if d_hi == 0.0:
            return {"eer": hi["far"], "eer_threshold": hi["threshold"]}
        if d_hi * d_lo < 0:  # sign change -> interpolate
            w = abs(d_hi) / (abs(d_hi) + abs(d_lo))
            eer = hi["far"] + w * (lo["far"] - hi["far"])
            thr = hi["threshold"] + w * (lo["threshold"] - hi["threshold"])
            return {"eer": float(eer), "eer_threshold": float(thr)}
    return {"eer": float(best["far"]), "eer_threshold": float(best["threshold"])}


def auc_from_roc(points: list[dict[str, float]]) -> float:
    """Trapezoidal AUC over TPR (= 1 - FRR) vs FAR, sorted by FAR."""
    pts = sorted(points, key=lambda p: p["far"])
    xs = [p["far"] for p in pts]
    ys = [1.0 - p["frr"] for p in pts]
    return float(np.trapezoid(ys, xs))


def percentile(values: np.ndarray, q: float) -> float:
    return float(np.percentile(values, q)) if len(values) else 0.0


# ── Anti-spoofing decision summary ───────────────────────────────────────────
def antispoofing_decision_summary(
    threshold: float, seed: int, n_genuine: int = 5000, n_spoof: int = 5000
) -> dict[str, Any]:
    """
    DECISION-LAYER ONLY: the MiniFASNetV2 weights are not available offline,
    so the classifier itself is not executed. Instead we model classifier
    output scores with two seeded Beta distributions (genuine presentations
    skew high, spoof presentations skew low) and summarise how the engine's
    ANTISPOOFING_THRESHOLD decision rule behaves on them.
    """
    rng = np.random.default_rng(seed + 2)
    genuine_scores = rng.beta(8.0, 2.0, size=n_genuine)   # skewed toward 1
    spoof_scores = rng.beta(2.0, 8.0, size=n_spoof)       # skewed toward 0

    def stats(x: np.ndarray) -> dict[str, float]:
        return {
            "n": int(len(x)),
            "mean": float(np.mean(x)),
            "std": float(np.std(x)),
            "p05": percentile(x, 5),
            "p50": percentile(x, 50),
            "p95": percentile(x, 95),
            "min": float(np.min(x)),
            "max": float(np.max(x)),
        }

    return {
        "model": "MiniFASNetV2 score model (Beta(8,2) genuine / Beta(2,8) spoof) — classifier weights NOT loaded",
        "threshold": threshold,
        "genuine": {**stats(genuine_scores), "pass_rate_at_threshold": float(np.mean(genuine_scores >= threshold))},
        "spoof": {**stats(spoof_scores), "pass_rate_at_threshold": float(np.mean(spoof_scores >= threshold))},
        "note": "Decision-layer behaviour only; production PAD performance requires the real classifier and attack-instrument datasets.",
    }


# ── Latency ───────────────────────────────────────────────────────────────────
def measure_latency(
    flat: np.ndarray, pairs: list[tuple[int, int]], sim_fn
) -> dict[str, float]:
    """perf_counter timing of the embedding-similarity path (per pair, µs)."""
    samples = np.empty(len(pairs), dtype=np.float64)
    for idx, (a, b) in enumerate(pairs):
        va, vb = flat[a], flat[b]
        t0 = time.perf_counter()
        sim_fn(va, vb)
        samples[idx] = (time.perf_counter() - t0) * 1e6
    return {
        "n_calls": int(len(samples)),
        "mean_us": float(np.mean(samples)),
        "p50_us": percentile(samples, 50),
        "p95_us": percentile(samples, 95),
        "p99_us": percentile(samples, 99),
        "max_us": float(np.max(samples)),
        "unit": "microseconds per cosine-similarity call (512-d, CPU)",
    }


# ── Report assembly ───────────────────────────────────────────────────────────
def run_benchmark(
    n_identities: int = 200,
    samples_per_identity: int = 10,
    dim: int = 512,
    target_genuine_cosine: float = 0.65,
    impostor_ratio: float = 1.0,
    seed: int = 20260114,
) -> dict[str, Any]:
    cfg = load_engine_thresholds()
    thresholds = cfg["thresholds"]
    sim_fn, sim_impl = get_cosine_similarity_fn()

    cohort = generate_cohort(n_identities, samples_per_identity, dim, target_genuine_cosine, seed)
    genuine_pairs, impostor_pairs = derive_pairs(cohort, impostor_ratio, seed)
    flat = cohort.reshape(-1, dim)

    genuine_scores = np.array([sim_fn(flat[a], flat[b]) for a, b in genuine_pairs])
    impostor_scores = np.array([sim_fn(flat[a], flat[b]) for a, b in impostor_pairs])

    match_threshold = thresholds["MATCH_THRESHOLD"]
    operating = confusion_at_threshold(genuine_scores, impostor_scores, match_threshold)
    roc = roc_sweep(genuine_scores, impostor_scores)
    eer = eer_from_roc(roc)
    auc = auc_from_roc(roc)
    latency = measure_latency(flat, genuine_pairs + impostor_pairs, sim_fn)

    return {
        "label": RESULTS_LABEL,
        "benchmark": "biometric-engine decision-layer (similarity + thresholds)",
        "seed": seed,
        "params": {
            "n_identities": n_identities,
            "samples_per_identity": samples_per_identity,
            "embedding_dim": dim,
            "target_genuine_cosine": target_genuine_cosine,
            "intra_std": float(np.sqrt((1.0 / target_genuine_cosine - 1.0) / dim)),
            "impostor_ratio": impostor_ratio,
            "n_genuine_pairs": len(genuine_pairs),
            "n_impostor_pairs": len(impostor_pairs),
            "cohort_model": (
                "centres uniform on unit sphere (impostor cosine ~ N(0, 1/dim)); "
                "samples = normalise(centre + intra_std * N(0, I)) with "
                "intra_std = sqrt((1/target_genuine_cosine - 1)/dim), so genuine "
                "cosine is centred near target_genuine_cosine"
            ),
        },
        "thresholds": thresholds,
        "threshold_provenance": cfg["provenance"],
        "similarity_implementation": sim_impl,
        "match_metrics": {
            "operating_point": {
                **operating,
                "genuine_mean": float(np.mean(genuine_scores)),
                "genuine_std": float(np.std(genuine_scores)),
                "impostor_mean": float(np.mean(impostor_scores)),
                "impostor_std": float(np.std(impostor_scores)),
            },
            "eer": eer["eer"],
            "eer_threshold": eer["eer_threshold"],
            "roc_auc": auc,
            "roc_points": len(roc),
        },
        "latency": latency,
        "antispoofing_decision_summary": antispoofing_decision_summary(
            thresholds["ANTISPOOFING_THRESHOLD"], seed
        ),
        "liveness_threshold_note": (
            f"LIVENESS_THRESHOLD={thresholds['LIVENESS_THRESHOLD']} governs landmark-video "
            "liveness composite scores; embedding-pair FAR/FRR does not exercise it. "
            "Recorded here for provenance only."
        ),
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "numpy": np.__version__,
            "cpu_count": os.cpu_count(),
            "network_required": False,
            "model_weights_loaded": False,
        },
    }


# ── Markdown rendering ────────────────────────────────────────────────────────
def render_markdown(report: dict[str, Any]) -> str:
    m = report["match_metrics"]
    op = m["operating_point"]
    lat = report["latency"]
    anti = report["antispoofing_decision_summary"]
    t = report["thresholds"]
    lines = [
        "## Biometric Decision-Layer Benchmark — SYNTHETIC-COHORT",
        "",
        f"- Seed: `{report['seed']}` | Identities: {report['params']['n_identities']} "
        f"x {report['params']['samples_per_identity']} samples "
        f"({report['params']['n_genuine_pairs']} genuine / {report['params']['n_impostor_pairs']} impostor pairs)",
        f"- Thresholds (from engine): MATCH_THRESHOLD={t['MATCH_THRESHOLD']}, "
        f"LIVENESS_THRESHOLD={t['LIVENESS_THRESHOLD']}, ANTISPOOFING_THRESHOLD={t['ANTISPOOFING_THRESHOLD']}",
        f"- Similarity implementation: `{report['similarity_implementation']}`",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        f"| FAR @ MATCH_THRESHOLD={t['MATCH_THRESHOLD']} | {op['far']:.6f} |",
        f"| FRR @ MATCH_THRESHOLD={t['MATCH_THRESHOLD']} | {op['frr']:.6f} |",
        f"| EER | {m['eer']:.6f} (threshold {m['eer_threshold']:.4f}) |",
        f"| ROC AUC | {m['roc_auc']:.6f} |",
        f"| Genuine cosine (mean +/- std) | {op['genuine_mean']:.4f} +/- {op['genuine_std']:.4f} |",
        f"| Impostor cosine (mean +/- std) | {op['impostor_mean']:.4f} +/- {op['impostor_std']:.4f} |",
        f"| Similarity latency p50 / p95 / p99 (us) | {lat['p50_us']:.1f} / {lat['p95_us']:.1f} / {lat['p99_us']:.1f} |",
        f"| Anti-spoof genuine pass rate @ {anti['threshold']} | {anti['genuine']['pass_rate_at_threshold']:.4f} (synthetic scores) |",
        f"| Anti-spoof spoof pass rate @ {anti['threshold']} | {anti['spoof']['pass_rate_at_threshold']:.4f} (synthetic scores) |",
        "",
        "> ALL RESULTS ARE SYNTHETIC-COHORT: they validate the decision layer only. "
        "See docs/biometric-benchmarks.md LIMITATIONS.",
    ]
    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--identities", type=int, default=200)
    parser.add_argument("--samples", type=int, default=10, help="samples per identity")
    parser.add_argument("--dim", type=int, default=512)
    parser.add_argument("--target-genuine-cosine", type=float, default=0.65,
                        help="target centre of the genuine-pair cosine distribution")
    parser.add_argument("--impostor-ratio", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=20260114)
    parser.add_argument("--out", default=os.path.join(HERE, "report.json"))
    parser.add_argument("--markdown-out", default=None, help="optional path to also write the markdown summary")
    args = parser.parse_args(argv)

    report = run_benchmark(
        n_identities=args.identities,
        samples_per_identity=args.samples,
        dim=args.dim,
        target_genuine_cosine=args.target_genuine_cosine,
        impostor_ratio=args.impostor_ratio,
        seed=args.seed,
    )

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, sort_keys=True)
    md = render_markdown(report)
    print(md)
    print(f"\nReport written to {args.out}")
    if args.markdown_out:
        with open(args.markdown_out, "w", encoding="utf-8") as fh:
            fh.write(md + "\n")
        print(f"Markdown summary written to {args.markdown_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
