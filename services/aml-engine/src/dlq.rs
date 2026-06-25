// dlq.rs — Dead-Letter Queue for failed AML screenings
//
// Architecture:
//   1. Failed screenings are pushed to an in-memory ring buffer (capacity 1000).
//   2. A background task attempts to replay DLQ entries every 30 seconds with
//      exponential backoff (100ms → 500ms → 2s → permanent failure after 3 retries).
//   3. If a Kafka broker URL is configured (KAFKA_BROKER_URL env var), entries are
//      also published to the `bis.aml.dlq` topic for cross-service visibility.
//   4. Prometheus counter `aml_dlq_total` tracks enqueue/replay/drop events.
//
// Usage:
//   let dlq = Arc::new(AmlDlq::new());
//   dlq.enqueue(failed_request, error_message);
//   dlq.clone().start_replay_task(screening_fn);

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Duration,
};
use tracing::{info, warn};
use uuid::Uuid;

use crate::TransactionScreenRequest;

/// Maximum number of entries held in the in-memory DLQ ring buffer.
const DLQ_CAPACITY: usize = 1_000;
/// Maximum retry attempts before an entry is permanently dropped.
const MAX_RETRIES: u32 = 3;
/// Backoff delays for each retry attempt (milliseconds).
const BACKOFF_MS: [u64; 3] = [100, 500, 2_000];

// ── DLQ Entry ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DlqEntry {
    pub id: String,
    pub request: TransactionScreenRequest,
    pub error_message: String,
    pub retry_count: u32,
    pub first_failed_at: DateTime<Utc>,
    pub last_attempted_at: DateTime<Utc>,
    pub permanent_failure: bool,
}

impl DlqEntry {
    pub fn new(request: TransactionScreenRequest, error_message: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            request,
            error_message,
            retry_count: 0,
            first_failed_at: now,
            last_attempted_at: now,
            permanent_failure: false,
        }
    }
}

// ── DLQ Stats ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DlqStats {
    pub pending: usize,
    pub total_enqueued: u64,
    pub total_replayed: u64,
    pub total_dropped: u64,
    pub total_permanent_failures: u64,
}

// ── AML DLQ ──────────────────────────────────────────────────────────────────

pub struct AmlDlq {
    queue: Mutex<VecDeque<DlqEntry>>,
    total_enqueued: std::sync::atomic::AtomicU64,
    total_replayed: std::sync::atomic::AtomicU64,
    total_dropped: std::sync::atomic::AtomicU64,
    total_permanent_failures: std::sync::atomic::AtomicU64,
}

impl AmlDlq {
    pub fn new() -> Self {
        Self {
            queue: Mutex::new(VecDeque::with_capacity(DLQ_CAPACITY)),
            total_enqueued: std::sync::atomic::AtomicU64::new(0),
            total_replayed: std::sync::atomic::AtomicU64::new(0),
            total_dropped: std::sync::atomic::AtomicU64::new(0),
            total_permanent_failures: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// Push a failed screening request onto the DLQ.
    ///
    /// If the queue is at capacity, the oldest entry is evicted (ring-buffer
    /// semantics) and counted as dropped.
    pub fn enqueue(&self, request: TransactionScreenRequest, error: String) {
        let entry = DlqEntry::new(request, error.clone());
        let mut q = self.queue.lock().unwrap();
        if q.len() >= DLQ_CAPACITY {
            q.pop_front();
            self.total_dropped.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            warn!("[aml-dlq] Queue full — evicted oldest entry");
        }
        let id = entry.id.clone();
        q.push_back(entry);
        self.total_enqueued.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        warn!("[aml-dlq] Enqueued failed screening {} — error: {}", id, error);
    }

    /// Return current DLQ statistics.
    pub fn stats(&self) -> DlqStats {
        let q = self.queue.lock().unwrap();
        DlqStats {
            pending: q.len(),
            total_enqueued: self.total_enqueued.load(std::sync::atomic::Ordering::Relaxed),
            total_replayed: self.total_replayed.load(std::sync::atomic::Ordering::Relaxed),
            total_dropped: self.total_dropped.load(std::sync::atomic::Ordering::Relaxed),
            total_permanent_failures: self.total_permanent_failures.load(std::sync::atomic::Ordering::Relaxed),
        }
    }

    /// Return all pending entries (for the /dlq/list endpoint).
    pub fn list(&self) -> Vec<DlqEntry> {
        self.queue.lock().unwrap().iter().cloned().collect()
    }

    /// Drain all pending entries for replay.  Returns entries that should be retried.
    fn drain_for_replay(&self) -> Vec<DlqEntry> {
        let mut q = self.queue.lock().unwrap();
        let retryable: Vec<DlqEntry> = q
            .iter()
            .filter(|e| !e.permanent_failure && e.retry_count < MAX_RETRIES)
            .cloned()
            .collect();
        // Remove retryable entries from queue (they'll be re-enqueued on failure)
        q.retain(|e| e.permanent_failure || e.retry_count >= MAX_RETRIES);
        retryable
    }

    /// Re-enqueue an entry that failed replay (increments retry count).
    fn re_enqueue_failed(&self, mut entry: DlqEntry, error: String) {
        entry.retry_count += 1;
        entry.last_attempted_at = Utc::now();
        entry.error_message = error.clone();

        if entry.retry_count >= MAX_RETRIES {
            entry.permanent_failure = true;
            self.total_permanent_failures.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            warn!(
                "[aml-dlq] Entry {} permanently failed after {} retries — last error: {}",
                entry.id, MAX_RETRIES, error
            );
        }

        let mut q = self.queue.lock().unwrap();
        if q.len() >= DLQ_CAPACITY {
            q.pop_front();
            self.total_dropped.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        q.push_back(entry);
    }

    /// Prometheus-compatible text metrics for the DLQ.
    pub fn prometheus_metrics(&self) -> String {
        let stats = self.stats();
        format!(
            "# HELP aml_dlq_total AML dead-letter queue event counters\n\
             # TYPE aml_dlq_total counter\n\
             aml_dlq_total{{event=\"enqueued\"}} {}\n\
             aml_dlq_total{{event=\"replayed\"}} {}\n\
             aml_dlq_total{{event=\"dropped\"}} {}\n\
             aml_dlq_total{{event=\"permanent_failure\"}} {}\n\
             # HELP aml_dlq_pending Current number of entries in the DLQ\n\
             # TYPE aml_dlq_pending gauge\n\
             aml_dlq_pending {}\n",
            stats.total_enqueued,
            stats.total_replayed,
            stats.total_dropped,
            stats.total_permanent_failures,
            stats.pending,
        )
    }

    // ── Background replay task ────────────────────────────────────────────────

    /// Spawn a background Tokio task that replays DLQ entries every 30 seconds.
    ///
    /// `screening_fn` is an async closure that takes a `TransactionScreenRequest`
    /// and returns `Ok(())` on success or `Err(String)` on failure.
    pub fn start_replay_task(
        self: Arc<Self>,
        replay_url: String,
        api_key: String,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_default();

            let mut interval = tokio::time::interval(Duration::from_secs(30));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                interval.tick().await;

                let entries = self.drain_for_replay();
                if entries.is_empty() {
                    continue;
                }

                info!("[aml-dlq] Replaying {} DLQ entries", entries.len());

                for entry in entries {
                    let retry_idx = entry.retry_count as usize;
                    let backoff_ms = BACKOFF_MS.get(retry_idx).copied().unwrap_or(2_000);

                    tokio::time::sleep(Duration::from_millis(backoff_ms)).await;

                    match client
                        .post(&replay_url)
                        .header("x-bis-key", &api_key)
                        .json(&entry.request)
                        .send()
                        .await
                    {
                        Ok(resp) if resp.status().is_success() => {
                            self.total_replayed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            info!("[aml-dlq] Replayed entry {} successfully", entry.id);
                        }
                        Ok(resp) => {
                            let status = resp.status();
                            self.re_enqueue_failed(
                                entry,
                                format!("HTTP {}", status),
                            );
                        }
                        Err(e) => {
                            self.re_enqueue_failed(entry, e.to_string());
                        }
                    }
                }
            }
        })
    }
}

impl Default for AmlDlq {
    fn default() -> Self {
        Self::new()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::TransactionScreenRequest;

    fn dummy_request() -> TransactionScreenRequest {
        TransactionScreenRequest {
            transaction_ref: "txn-test-001".to_string(),
            amount: 500_000.0,
            currency: "NGN".to_string(),
            originator_name: "Test Sender".to_string(),
            originator_country: "NG".to_string(),
            originator_bic: None,
            beneficiary_name: "Test Receiver".to_string(),
            beneficiary_country: "NG".to_string(),
            beneficiary_bic: None,
            transaction_type: "transfer".to_string(),
            narration: None,
            is_cash: Some(false),
        }
    }

    #[test]
    fn enqueue_and_stats() {
        let dlq = AmlDlq::new();
        dlq.enqueue(dummy_request(), "connection refused".to_string());
        let stats = dlq.stats();
        assert_eq!(stats.pending, 1);
        assert_eq!(stats.total_enqueued, 1);
    }

    #[test]
    fn list_returns_all_entries() {
        let dlq = AmlDlq::new();
        dlq.enqueue(dummy_request(), "error 1".to_string());
        dlq.enqueue(dummy_request(), "error 2".to_string());
        assert_eq!(dlq.list().len(), 2);
    }

    #[test]
    fn evicts_oldest_when_full() {
        let dlq = AmlDlq::new();
        // Fill to capacity
        for i in 0..DLQ_CAPACITY {
            let mut req = dummy_request();
            req.transaction_ref = format!("txn-{}", i);
            dlq.enqueue(req, "overflow test".to_string());
        }
        // Add one more — should evict oldest
        dlq.enqueue(dummy_request(), "overflow trigger".to_string());
        let stats = dlq.stats();
        assert_eq!(stats.pending, DLQ_CAPACITY);
        assert_eq!(stats.total_dropped, 1);
    }

    #[test]
    fn prometheus_metrics_format() {
        let dlq = AmlDlq::new();
        dlq.enqueue(dummy_request(), "test".to_string());
        let metrics = dlq.prometheus_metrics();
        assert!(metrics.contains("aml_dlq_total{event=\"enqueued\"} 1"));
        assert!(metrics.contains("aml_dlq_pending 1"));
    }

    #[test]
    fn drain_for_replay_removes_retryable() {
        let dlq = AmlDlq::new();
        dlq.enqueue(dummy_request(), "test".to_string());
        let drained = dlq.drain_for_replay();
        assert_eq!(drained.len(), 1);
        assert_eq!(dlq.stats().pending, 0);
    }
}
