# Biometric Engine — Benchmark Harness & Accuracy Protocol (WP7)

**Status:** SYNTHETIC-COHORT decision-layer validation. This is a partial answer to
the Onfido/Entrust maturity gap: it validates that the engine's **decision layer**
(similarity math + configured thresholds) behaves correctly and measurably. It does
**not** claim production-grade biometric accuracy — see [LIMITATIONS](#limitations).

## What is benchmarked

The biometric engine (`services/biometric-engine/main.py`) turns model scores into
accept/reject decisions at three thresholds:

| Threshold | Env var | Engine default | Decision governed |
| --- | --- | --- | --- |
| `MATCH_THRESHOLD` | `MATCH_THRESHOLD` | 0.40 | ArcFace cosine similarity accept/reject (`_match_faces`) |
| `LIVENESS_THRESHOLD` | `LIVENESS_THRESHOLD` | 0.72 | Passive/active liveness composite score |
| `ANTISPOOFING_THRESHOLD` | `ANTISPOOFING_THRESHOLD` | 0.60 | MiniFASNetV2 genuine/spoof classifier |

The harness (`services/biometric-engine/benchmarks/run_benchmarks.py`) benchmarks the
layer where these thresholds live: **cosine similarity on 512-d embeddings and the
threshold decision rule**.

**No model weights are loaded.** MediaPipe, InsightFace/ONNX Runtime and the
MiniFASNetV2 weights are not exercised: they require network downloads unavailable
offline, and they are upstream of the decision layer being validated. If the engine
module is importable in the environment, the engine's own `_cosine_similarity` is
used; otherwise the identical math (`dot / (|a|·|b|)`, zero-norm → 0.0) is applied
locally and the report records which implementation ran
(`similarity_implementation` field). Thresholds are **read from the engine source /
env vars at run time — never hardcoded** in the harness.

## Protocol

1. **Synthetic cohort (deterministic).** `N` identities (default 200, `--identities`)
   × `K` samples each (default 10, `--samples`), 512-d L2-normalised embeddings
   matching InsightFace `normed_embedding` shape.
   - *Inter-class variance:* identity centres are uniform on the unit sphere
     (`rng.normal` + normalise), so impostor cosine ≈ N(0, 1/512) (std ≈ 0.044).
   - *Intra-class variance:* samples are `normalise(centre + σ_intra · N(0, I))` with
     `σ_intra = sqrt((1/target − 1)/dim)` derived from `--target-genuine-cosine`
     (default 0.65), so genuine-pair cosine is centred near the target with a spread
     smaller than the impostor spread.
   - One seeded `numpy.default_rng(seed)` (default seed `20260114`) drives every draw
     in fixed order → the cohort is bit-for-bit reproducible.
2. **Pairs.** Genuine: every within-identity pair (C(K,2) per identity → 9,000 pairs
   at defaults). Impostor: equal count of cross-identity pairs, sampled without
   replacement from an independent seeded RNG.
3. **Metrics.** Genuine/impostor score distributions; FAR/FRR at the engine's live
   `MATCH_THRESHOLD`; full ROC sweep over every observed score; EER (linear
   interpolation across the FAR=FRR crossing); trapezoidal ROC AUC.
4. **Latency.** `perf_counter` timing of every similarity call → p50/p95/p99 in µs.
5. **Anti-spoofing decision summary.** The MiniFASNetV2 weights are unavailable
   offline, so the classifier itself is **not** executed. Seeded Beta(8,2)/Beta(2,8)
   score models for genuine/spoof presentations are pushed through the engine's
   `ANTISPOOFING_THRESHOLD` decision rule and summarised (mean/std/percentiles/pass
   rates). Decision-layer behaviour only.
6. **Outputs.** `benchmarks/report.json` (machine-readable: label, seed, params,
   thresholds + provenance, metrics, latency, environment) and a markdown summary on
   stdout.

## How to run

Fully offline — no network, no dataset downloads, only `numpy` required:

```bash
cd services/biometric-engine
pip install numpy          # the only dependency
python benchmarks/run_benchmarks.py
python -m unittest test_benchmarks -v
```

### CI wiring

`.github/workflows/` exists in this repo. The ready-to-apply job below (validated
as YAML) could not be committed from the automation token used for this change
(`workflow` scope is required to modify GitHub Actions workflow files — the push
was rejected with HTTP 403 `insufficient scopes`). Apply this exact block to
`.github/workflows/ci.yml` (under `jobs:`) with an appropriately scoped token, or
run the command above manually / in any runner:

```yaml
  biometric-benchmarks:
    name: biometric-benchmarks
    runs-on: ubuntu-24.04
    # Non-blocking: synthetic-cohort decision-layer benchmark; must not gate PRs.
    continue-on-error: true
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - name: Install benchmark dependencies (numpy only — fully offline afterwards)
        run: pip install numpy
      - name: Run decision-layer benchmark (SYNTHETIC-COHORT)
        working-directory: services/biometric-engine
        run: python benchmarks/run_benchmarks.py --out benchmarks/report.json
      - name: Run benchmark harness tests
        working-directory: services/biometric-engine
        run: python -m unittest test_benchmarks -v
      - name: Upload benchmark report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: biometric-benchmark-report
          path: services/biometric-engine/benchmarks/report.json
          if-no-files-found: warn
```

## Results (real run, seed 20260114, 200 identities × 10 samples, 9,000 genuine / 9,000 impostor pairs)

Thresholds read from the engine: MATCH_THRESHOLD=0.40, LIVENESS_THRESHOLD=0.72,
ANTISPOOFING_THRESHOLD=0.60. Environment: CPython 3.12, numpy 2.2, Linux x86_64, no
model weights loaded.

| Metric | Value |
| --- | --- |
| FAR @ MATCH_THRESHOLD=0.40 | 0.000000 |
| FRR @ MATCH_THRESHOLD=0.40 | 0.000000 |
| EER | 0.000000 (crossing threshold 0.5445) |
| ROC AUC | 1.000000 |
| Genuine cosine (mean ± std) | 0.6493 ± 0.0215 |
| Impostor cosine (mean ± std) | −0.0008 ± 0.0438 |
| Similarity latency p50 / p95 / p99 | 8.7 / 13.7 / 20.4 µs per 512-d pair |
| Anti-spoof genuine pass rate @ 0.60 | 0.9314 (synthetic score model) |
| Anti-spoof spoof pass rate @ 0.60 | 0.0030 (synthetic score model) |

**Reading these numbers honestly:** the synthetic cohort is well separated by
construction (genuine centre 0.65 vs impostor centre ~0.0 with std 0.044), so zero
errors at the operating point are expected and say *nothing* about real-world
accuracy. What they do establish: the threshold logic, ROC/EER computation, env-var
configuration path, and similarity code path are correct, deterministic, and fast
(~9–20 µs per comparison, so similarity is not a latency bottleneck). Degraded
regimes (motion blur, low light, lookalikes) can be explored by lowering
`--target-genuine-cosine` toward the threshold.

## LIMITATIONS

- **Synthetic-cohort results validate the decision layer only.** The cohort is
  Gaussian noise on a sphere, not faces. Real FAR/FRR are dominated by the ArcFace
  model's embedding quality on real imagery (pose, age, lighting, demographic
  differentials), which this harness does not measure.
- **No iBeta PAD Level 1/2 certification is claimed or implied.** Presentation-attack
  detection certification requires an accredited lab (e.g. iBeta) testing with real
  attack-instrument datasets (print, replay, mask, deepfake) against ISO/IEC
  30107-3. That is a **roadmap item**, not claimed here.
- The anti-spoofing section models classifier *outputs* with synthetic Beta
  distributions; the MiniFASNetV2 classifier itself is not executed offline, so no
  statement is made about real spoof-detection accuracy.
- Liveness (landmark video) is recorded for threshold provenance only; its composite
  scoring path is not exercised by embedding-pair benchmarks.
- Production accuracy sign-off against vendor benchmarks (Onfido/Entrust parity)
  requires a labelled real-face evaluation set under a data-processing agreement —
  also roadmap.

## Roadmap to close the maturity gap

1. Accredited iBeta PAD Level 1, then Level 2, evaluation of the liveness +
   anti-spoofing stack.
2. Labelled real-face evaluation set (with consent/DPA) for production FAR/FRR at
   the operating threshold; rerun this harness's metric code on those scores.
3. Demographic-cohort breakdown of FAR/FRR once a real dataset exists.
