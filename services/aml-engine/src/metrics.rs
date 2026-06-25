/// metrics.rs — Prometheus metrics for the BIS AML Engine.
///
/// Exposes a /metrics endpoint in the Prometheus text format (no external
/// crate required — we hand-roll the format to avoid heavy dependencies).
///
/// Counters tracked:
///   aml_screenings_total          — total /screen requests
///   aml_hits_total                — screenings that produced at least one flag
///   aml_sdn_hits_total            — SDN name-match hits specifically
///   aml_structuring_hits_total    — structuring-detection hits
///   aml_reload_total              — SIGHUP-triggered sanctions reloads
///   aml_reload_errors_total       — failed SIGHUP reloads
///
/// Histograms (hand-rolled buckets):
///   aml_latency_seconds_bucket    — /screen endpoint latency

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

// ─── Atomic counters ──────────────────────────────────────────────────────────

pub static SCREENINGS_TOTAL: AtomicU64 = AtomicU64::new(0);
pub static HITS_TOTAL: AtomicU64 = AtomicU64::new(0);
pub static SDN_HITS_TOTAL: AtomicU64 = AtomicU64::new(0);
pub static STRUCTURING_HITS_TOTAL: AtomicU64 = AtomicU64::new(0);
pub static RELOAD_TOTAL: AtomicU64 = AtomicU64::new(0);
pub static RELOAD_ERRORS_TOTAL: AtomicU64 = AtomicU64::new(0);

// ─── Latency histogram (hand-rolled) ─────────────────────────────────────────
// Buckets: 1ms, 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, +Inf

pub static LATENCY_BUCKET_1MS: AtomicU64 = AtomicU64::new(0);
pub static LATENCY_BUCKET_5MS: AtomicU64 = AtomicU64::new(0);
pub static LATENCY_BUCKET_10MS: AtomicU64 = AtomicU64::new(0);
pub static LATENCY_BUCKET_25MS: AtomicU64 = AtomicU64::new(0);
pub static LATENCY_BUCKET_50MS: AtomicU64 = AtomicU64::new(0);
pub static LATENCY_BUCKET_100MS: AtomicU64 = AtomicU64::new(0);
pub static LATENCY_BUCKET_250MS: AtomicU64 = AtomicU64::new(0);
pub static LATENCY_BUCKET_500MS: AtomicU64 = AtomicU64::new(0);
pub static LATENCY_BUCKET_1S: AtomicU64 = AtomicU64::new(0);
pub static LATENCY_BUCKET_INF: AtomicU64 = AtomicU64::new(0);
pub static LATENCY_SUM_MICROS: AtomicU64 = AtomicU64::new(0);

/// Record a /screen latency sample.
pub fn record_latency(start: Instant) {
    let elapsed_ms = start.elapsed().as_millis() as u64;
    let elapsed_us = start.elapsed().as_micros() as u64;
    LATENCY_SUM_MICROS.fetch_add(elapsed_us, Ordering::Relaxed);
    // Cumulative buckets
    if elapsed_ms <= 1 { LATENCY_BUCKET_1MS.fetch_add(1, Ordering::Relaxed); }
    if elapsed_ms <= 5 { LATENCY_BUCKET_5MS.fetch_add(1, Ordering::Relaxed); }
    if elapsed_ms <= 10 { LATENCY_BUCKET_10MS.fetch_add(1, Ordering::Relaxed); }
    if elapsed_ms <= 25 { LATENCY_BUCKET_25MS.fetch_add(1, Ordering::Relaxed); }
    if elapsed_ms <= 50 { LATENCY_BUCKET_50MS.fetch_add(1, Ordering::Relaxed); }
    if elapsed_ms <= 100 { LATENCY_BUCKET_100MS.fetch_add(1, Ordering::Relaxed); }
    if elapsed_ms <= 250 { LATENCY_BUCKET_250MS.fetch_add(1, Ordering::Relaxed); }
    if elapsed_ms <= 500 { LATENCY_BUCKET_500MS.fetch_add(1, Ordering::Relaxed); }
    if elapsed_ms <= 1000 { LATENCY_BUCKET_1S.fetch_add(1, Ordering::Relaxed); }
    LATENCY_BUCKET_INF.fetch_add(1, Ordering::Relaxed);
}

/// Render all metrics in Prometheus text format.
pub fn render() -> String {
    let screenings = SCREENINGS_TOTAL.load(Ordering::Relaxed);
    let hits = HITS_TOTAL.load(Ordering::Relaxed);
    let sdn_hits = SDN_HITS_TOTAL.load(Ordering::Relaxed);
    let struct_hits = STRUCTURING_HITS_TOTAL.load(Ordering::Relaxed);
    let reloads = RELOAD_TOTAL.load(Ordering::Relaxed);
    let reload_errs = RELOAD_ERRORS_TOTAL.load(Ordering::Relaxed);
    let lat_sum_s = LATENCY_SUM_MICROS.load(Ordering::Relaxed) as f64 / 1_000_000.0;
    let lat_count = LATENCY_BUCKET_INF.load(Ordering::Relaxed);

    format!(
        r#"# HELP aml_screenings_total Total number of AML screening requests
# TYPE aml_screenings_total counter
aml_screenings_total {screenings}
# HELP aml_hits_total Screenings that produced at least one flag
# TYPE aml_hits_total counter
aml_hits_total {hits}
# HELP aml_sdn_hits_total SDN name-match hits
# TYPE aml_sdn_hits_total counter
aml_sdn_hits_total {sdn_hits}
# HELP aml_structuring_hits_total Structuring-detection hits
# TYPE aml_structuring_hits_total counter
aml_structuring_hits_total {struct_hits}
# HELP aml_reload_total SIGHUP-triggered sanctions list reloads
# TYPE aml_reload_total counter
aml_reload_total {reloads}
# HELP aml_reload_errors_total Failed SIGHUP reloads
# TYPE aml_reload_errors_total counter
aml_reload_errors_total {reload_errs}
# HELP aml_latency_seconds AML /screen endpoint latency
# TYPE aml_latency_seconds histogram
aml_latency_seconds_bucket{{le="0.001"}} {b1}
aml_latency_seconds_bucket{{le="0.005"}} {b5}
aml_latency_seconds_bucket{{le="0.010"}} {b10}
aml_latency_seconds_bucket{{le="0.025"}} {b25}
aml_latency_seconds_bucket{{le="0.050"}} {b50}
aml_latency_seconds_bucket{{le="0.100"}} {b100}
aml_latency_seconds_bucket{{le="0.250"}} {b250}
aml_latency_seconds_bucket{{le="0.500"}} {b500}
aml_latency_seconds_bucket{{le="1.000"}} {b1s}
aml_latency_seconds_bucket{{le="+Inf"}} {lat_count}
aml_latency_seconds_sum {lat_sum_s:.6}
aml_latency_seconds_count {lat_count}
"#,
        b1 = LATENCY_BUCKET_1MS.load(Ordering::Relaxed),
        b5 = LATENCY_BUCKET_5MS.load(Ordering::Relaxed),
        b10 = LATENCY_BUCKET_10MS.load(Ordering::Relaxed),
        b25 = LATENCY_BUCKET_25MS.load(Ordering::Relaxed),
        b50 = LATENCY_BUCKET_50MS.load(Ordering::Relaxed),
        b100 = LATENCY_BUCKET_100MS.load(Ordering::Relaxed),
        b250 = LATENCY_BUCKET_250MS.load(Ordering::Relaxed),
        b500 = LATENCY_BUCKET_500MS.load(Ordering::Relaxed),
        b1s = LATENCY_BUCKET_1S.load(Ordering::Relaxed),
    )
}
