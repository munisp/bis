/*!
# BIS Fluvio Velocity Processor

Real-time payment velocity checks using a sliding-window algorithm.

## Architecture

```text
Fluvio topic: bis.payment.events
        |
        v
+-----------------------------+
|  VelocityEngine             |
|  +----------------------+   |
|  |  SlidingWindow       |   |  per (accountId, windowSecs)
|  |  VecDeque<Timestamp> |   |
|  +----------------------+   |
|  +----------------------+   |
|  |  RuleSet             |   |
|  |  - count_limit       |   |
|  |  - amount_limit_kobo |   |
|  |  - window_secs       |   |
|  +----------------------+   |
+-----------------------------+
        | breach
        v
  POST /v1/velocity/alert  (BIS Gateway)
```

## Velocity Rules (defaults, overridable via env)

| Rule                    | Window | Threshold          |
|-------------------------|--------|--------------------|
| COUNT_1MIN              | 60s    | 5 transactions     |
| COUNT_1HOUR             | 3600s  | 20 transactions    |
| AMOUNT_1HOUR_NGN        | 3600s  | ₦5,000,000 (kobo)  |
| AMOUNT_24HOUR_NGN       | 86400s | ₦20,000,000 (kobo) |
| CROSS_BORDER_1HOUR      | 3600s  | 3 cross-border     |
*/

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use uuid::Uuid;

// ─── Payment event ────────────────────────────────────────────────────────────

/// Incoming payment event from the Fluvio topic `bis.payment.events`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentEvent {
    pub event_type: String,
    pub tx_ref: String,
    pub account_id: String,
    pub amount_kobo: i64,
    pub currency: String,
    pub rail: String,
    pub is_cross_border: Option<bool>,
    pub tenant_id: String,
    #[serde(default = "Utc::now")]
    pub timestamp: DateTime<Utc>,
}

// ─── Velocity rule ────────────────────────────────────────────────────────────

/// A single velocity rule definition.
#[derive(Debug, Clone)]
pub struct VelocityRule {
    /// Human-readable rule name (e.g. "COUNT_1MIN")
    pub name: &'static str,
    /// Sliding window in seconds
    pub window_secs: u64,
    /// Maximum number of transactions allowed in the window (None = no limit)
    pub count_limit: Option<u64>,
    /// Maximum total amount in kobo allowed in the window (None = no limit)
    pub amount_limit_kobo: Option<i64>,
    /// Only apply to cross-border transactions
    pub cross_border_only: bool,
    /// Risk level to assign when this rule fires
    pub risk_level: &'static str,
}

/// Default velocity rules.
pub fn default_rules() -> Vec<VelocityRule> {
    vec![
        VelocityRule {
            name: "COUNT_1MIN",
            window_secs: 60,
            count_limit: Some(5),
            amount_limit_kobo: None,
            cross_border_only: false,
            risk_level: "high",
        },
        VelocityRule {
            name: "COUNT_1HOUR",
            window_secs: 3600,
            count_limit: Some(20),
            amount_limit_kobo: None,
            cross_border_only: false,
            risk_level: "medium",
        },
        VelocityRule {
            name: "AMOUNT_1HOUR_NGN",
            window_secs: 3600,
            count_limit: None,
            amount_limit_kobo: Some(500_000_000), // ₦5,000,000
            cross_border_only: false,
            risk_level: "high",
        },
        VelocityRule {
            name: "AMOUNT_24HOUR_NGN",
            window_secs: 86400,
            count_limit: None,
            amount_limit_kobo: Some(2_000_000_000), // ₦20,000,000
            cross_border_only: false,
            risk_level: "critical",
        },
        VelocityRule {
            name: "CROSS_BORDER_1HOUR",
            window_secs: 3600,
            count_limit: Some(3),
            amount_limit_kobo: None,
            cross_border_only: true,
            risk_level: "high",
        },
    ]
}

// ─── Sliding window ───────────────────────────────────────────────────────────

/// A sliding-window accumulator for a single (accountId, windowSecs) pair.
#[derive(Debug, Default)]
pub struct SlidingWindow {
    /// Timestamps of events in the window (oldest first)
    pub timestamps: VecDeque<DateTime<Utc>>,
    /// Amounts in kobo for each event (parallel to timestamps)
    pub amounts: VecDeque<i64>,
    /// Cross-border flags for each event
    pub cross_border: VecDeque<bool>,
}

impl SlidingWindow {
    /// Evict events older than `window_secs` from the front of the deque.
    pub fn evict_stale(&mut self, now: DateTime<Utc>, window_secs: u64) {
        let cutoff = now - chrono::Duration::seconds(window_secs as i64);
        while let Some(&ts) = self.timestamps.front() {
            if ts < cutoff {
                self.timestamps.pop_front();
                self.amounts.pop_front();
                self.cross_border.pop_front();
            } else {
                break;
            }
        }
    }

    /// Add a new event to the window.
    pub fn push(&mut self, ts: DateTime<Utc>, amount_kobo: i64, is_cross_border: bool) {
        self.timestamps.push_back(ts);
        self.amounts.push_back(amount_kobo);
        self.cross_border.push_back(is_cross_border);
    }

    /// Count events in the window (optionally filtered to cross-border only).
    pub fn count(&self, cross_border_only: bool) -> u64 {
        if cross_border_only {
            self.cross_border.iter().filter(|&&cb| cb).count() as u64
        } else {
            self.timestamps.len() as u64
        }
    }

    /// Sum amounts in the window (optionally filtered to cross-border only).
    pub fn total_amount(&self, cross_border_only: bool) -> i64 {
        self.amounts
            .iter()
            .zip(self.cross_border.iter())
            .filter(|(_, &cb)| !cross_border_only || cb)
            .map(|(&amt, _)| amt)
            .sum()
    }
}

// ─── Velocity breach ──────────────────────────────────────────────────────────

/// A velocity rule breach that should be reported to the BIS gateway.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VelocityBreach {
    pub alert_id: String,
    pub account_id: String,
    pub tenant_id: String,
    pub rule_name: String,
    pub risk_level: String,
    pub window_secs: u64,
    pub tx_count: u64,
    pub total_amount_kobo: i64,
    pub triggering_tx_ref: String,
    pub detected_at: DateTime<Utc>,
}

// ─── Velocity engine ──────────────────────────────────────────────────────────

/// Key for the per-account sliding window map: (accountId, windowSecs)
type WindowKey = (String, u64);

/// The main velocity engine.
pub struct VelocityEngine {
    rules: Vec<VelocityRule>,
    /// Per-(account, window) sliding windows
    windows: HashMap<WindowKey, SlidingWindow>,
}

impl VelocityEngine {
    pub fn new(rules: Vec<VelocityRule>) -> Self {
        Self {
            rules,
            windows: HashMap::new(),
        }
    }

    /// Process a payment event and return any velocity breaches detected.
    pub fn process(&mut self, event: &PaymentEvent) -> Vec<VelocityBreach> {
        let now = event.timestamp;
        let is_cross_border = event.is_cross_border.unwrap_or(false);
        let mut breaches = Vec::new();

        for rule in &self.rules {
            // Skip cross-border-only rules for domestic transactions
            if rule.cross_border_only && !is_cross_border {
                continue;
            }

            let key = (event.account_id.clone(), rule.window_secs);
            let window = self.windows.entry(key).or_default();

            // Evict stale entries first
            window.evict_stale(now, rule.window_secs);

            // Add the new event
            window.push(now, event.amount_kobo, is_cross_border);

            // Evaluate rule
            let count = window.count(rule.cross_border_only);
            let total = window.total_amount(rule.cross_border_only);

            let count_breach = rule.count_limit.map_or(false, |limit| count > limit);
            let amount_breach = rule
                .amount_limit_kobo
                .map_or(false, |limit| total > limit);

            if count_breach || amount_breach {
                breaches.push(VelocityBreach {
                    alert_id: Uuid::new_v4().to_string(),
                    account_id: event.account_id.clone(),
                    tenant_id: event.tenant_id.clone(),
                    rule_name: rule.name.to_string(),
                    risk_level: rule.risk_level.to_string(),
                    window_secs: rule.window_secs,
                    tx_count: count,
                    total_amount_kobo: total,
                    triggering_tx_ref: event.tx_ref.clone(),
                    detected_at: now,
                });
            }
        }

        breaches
    }

    /// Return the number of active windows (for monitoring).
    pub fn active_windows(&self) -> usize {
        self.windows.len()
    }

    /// Evict all stale windows to free memory (call periodically).
    pub fn gc(&mut self) {
        let now = Utc::now();
        // Find the maximum window size across all rules
        let max_window = self
            .rules
            .iter()
            .map(|r| r.window_secs)
            .max()
            .unwrap_or(86400);

        self.windows.retain(|_, w| {
            w.evict_stale(now, max_window);
            !w.timestamps.is_empty()
        });
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn make_event(
        account_id: &str,
        amount_kobo: i64,
        ts: DateTime<Utc>,
        is_cross_border: bool,
    ) -> PaymentEvent {
        PaymentEvent {
            event_type: "initiated".to_string(),
            tx_ref: format!("TXN-{}", Uuid::new_v4()),
            account_id: account_id.to_string(),
            amount_kobo,
            currency: "NGN".to_string(),
            rail: "nip".to_string(),
            is_cross_border: Some(is_cross_border),
            tenant_id: "tenant-001".to_string(),
            timestamp: ts,
        }
    }

    fn base_time() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 6, 16, 12, 0, 0).unwrap()
    }

    // ── SlidingWindow tests ───────────────────────────────────────────────────

    #[test]
    fn test_sliding_window_evict_stale() {
        let mut w = SlidingWindow::default();
        let t0 = base_time();

        w.push(t0, 1000, false);
        w.push(t0 + chrono::Duration::seconds(30), 2000, false);
        w.push(t0 + chrono::Duration::seconds(90), 3000, false);

        // Evict with 60s window at t0+90 → first event should be evicted
        let now = t0 + chrono::Duration::seconds(90);
        w.evict_stale(now, 60);

        assert_eq!(w.timestamps.len(), 2);
        assert_eq!(w.total_amount(false), 5000);
    }

    #[test]
    fn test_sliding_window_count_cross_border() {
        let mut w = SlidingWindow::default();
        let t0 = base_time();

        w.push(t0, 1000, false);
        w.push(t0 + chrono::Duration::seconds(1), 2000, true);
        w.push(t0 + chrono::Duration::seconds(2), 3000, true);

        assert_eq!(w.count(false), 3);
        assert_eq!(w.count(true), 2);
        assert_eq!(w.total_amount(true), 5000);
    }

    #[test]
    fn test_sliding_window_empty() {
        let w = SlidingWindow::default();
        assert_eq!(w.count(false), 0);
        assert_eq!(w.total_amount(false), 0);
    }

    // ── VelocityEngine tests ──────────────────────────────────────────────────

    #[test]
    fn test_no_breach_below_threshold() {
        let mut engine = VelocityEngine::new(default_rules());
        let t0 = base_time();

        // 4 transactions in 1 minute — below COUNT_1MIN limit of 5
        for i in 0..4 {
            let event = make_event("ACC-001", 10_000, t0 + chrono::Duration::seconds(i), false);
            let breaches = engine.process(&event);
            assert!(
                breaches.is_empty(),
                "Expected no breach at tx {i}, got: {breaches:?}"
            );
        }
    }

    #[test]
    fn test_count_breach_1min() {
        let mut engine = VelocityEngine::new(default_rules());
        let t0 = base_time();

        // 5 transactions in 1 minute — COUNT_1MIN limit is 5, 6th triggers breach
        for i in 0..5 {
            let event = make_event("ACC-002", 10_000, t0 + chrono::Duration::seconds(i), false);
            engine.process(&event);
        }
        let event = make_event("ACC-002", 10_000, t0 + chrono::Duration::seconds(5), false);
        let breaches = engine.process(&event);

        let count_breach = breaches.iter().find(|b| b.rule_name == "COUNT_1MIN");
        assert!(count_breach.is_some(), "Expected COUNT_1MIN breach");
        assert_eq!(count_breach.unwrap().tx_count, 6);
    }

    #[test]
    fn test_amount_breach_1hour() {
        let mut engine = VelocityEngine::new(default_rules());
        let t0 = base_time();

        // ₦5,000,001 in 1 hour → AMOUNT_1HOUR_NGN breach
        let event = make_event("ACC-003", 500_000_100, t0, false); // 500_000_100 kobo = ₦5,000,001
        let breaches = engine.process(&event);

        let amount_breach = breaches.iter().find(|b| b.rule_name == "AMOUNT_1HOUR_NGN");
        assert!(amount_breach.is_some(), "Expected AMOUNT_1HOUR_NGN breach");
    }

    #[test]
    fn test_cross_border_breach() {
        let mut engine = VelocityEngine::new(default_rules());
        let t0 = base_time();

        // 3 cross-border transactions → CROSS_BORDER_1HOUR limit is 3, 4th triggers
        for i in 0..3 {
            let event = make_event("ACC-004", 10_000, t0 + chrono::Duration::seconds(i), true);
            engine.process(&event);
        }
        let event = make_event("ACC-004", 10_000, t0 + chrono::Duration::seconds(3), true);
        let breaches = engine.process(&event);

        let cb_breach = breaches.iter().find(|b| b.rule_name == "CROSS_BORDER_1HOUR");
        assert!(cb_breach.is_some(), "Expected CROSS_BORDER_1HOUR breach");
    }

    #[test]
    fn test_cross_border_rule_not_triggered_for_domestic() {
        let mut engine = VelocityEngine::new(default_rules());
        let t0 = base_time();

        // 10 domestic transactions — CROSS_BORDER_1HOUR should NOT fire
        for i in 0..10 {
            let event = make_event("ACC-005", 10_000, t0 + chrono::Duration::seconds(i), false);
            let breaches = engine.process(&event);
            let cb_breach = breaches.iter().find(|b| b.rule_name == "CROSS_BORDER_1HOUR");
            assert!(
                cb_breach.is_none(),
                "CROSS_BORDER_1HOUR should not fire for domestic tx at {i}"
            );
        }
    }

    #[test]
    fn test_stale_events_not_counted() {
        let mut engine = VelocityEngine::new(default_rules());
        let t0 = base_time();

        // 5 transactions at t0 (within 1 min window)
        for _ in 0..5 {
            let event = make_event("ACC-006", 10_000, t0, false);
            engine.process(&event);
        }

        // 1 transaction 2 minutes later — old events should be evicted
        let event = make_event("ACC-006", 10_000, t0 + chrono::Duration::seconds(120), false);
        let breaches = engine.process(&event);

        let count_breach = breaches.iter().find(|b| b.rule_name == "COUNT_1MIN");
        assert!(
            count_breach.is_none(),
            "Stale events should not trigger COUNT_1MIN breach"
        );
    }

    #[test]
    fn test_different_accounts_isolated() {
        let mut engine = VelocityEngine::new(default_rules());
        let t0 = base_time();

        // 6 transactions for ACC-007 (should breach)
        for i in 0..6 {
            let event = make_event("ACC-007", 10_000, t0 + chrono::Duration::seconds(i), false);
            engine.process(&event);
        }

        // 1 transaction for ACC-008 (should NOT breach)
        let event = make_event("ACC-008", 10_000, t0, false);
        let breaches = engine.process(&event);
        assert!(
            breaches.is_empty(),
            "ACC-008 should not be affected by ACC-007 breaches"
        );
    }

    #[test]
    fn test_gc_removes_empty_windows() {
        let mut engine = VelocityEngine::new(default_rules());
        let t0 = base_time();

        // Add events far in the past
        let old_time = t0 - chrono::Duration::days(2);
        let event = make_event("ACC-009", 10_000, old_time, false);
        engine.process(&event);

        assert!(engine.active_windows() > 0);
        engine.gc();
        assert_eq!(engine.active_windows(), 0, "GC should remove all stale windows");
    }

    #[test]
    fn test_breach_fields_populated() {
        let mut engine = VelocityEngine::new(default_rules());
        let t0 = base_time();

        // Trigger COUNT_1MIN breach
        for i in 0..6 {
            let event = make_event("ACC-010", 10_000, t0 + chrono::Duration::seconds(i), false);
            let breaches = engine.process(&event);
            if let Some(breach) = breaches.iter().find(|b| b.rule_name == "COUNT_1MIN") {
                assert!(!breach.alert_id.is_empty());
                assert_eq!(breach.account_id, "ACC-010");
                assert_eq!(breach.tenant_id, "tenant-001");
                assert_eq!(breach.risk_level, "high");
                assert_eq!(breach.window_secs, 60);
                return;
            }
        }
        panic!("Expected COUNT_1MIN breach not found");
    }

    #[test]
    fn test_serialization_roundtrip() {
        let breach = VelocityBreach {
            alert_id: "test-alert-001".to_string(),
            account_id: "ACC-001".to_string(),
            tenant_id: "tenant-001".to_string(),
            rule_name: "COUNT_1MIN".to_string(),
            risk_level: "high".to_string(),
            window_secs: 60,
            tx_count: 6,
            total_amount_kobo: 60_000,
            triggering_tx_ref: "TXN-001".to_string(),
            detected_at: base_time(),
        };

        let json = serde_json::to_string(&breach).expect("serialize");
        let decoded: VelocityBreach = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(decoded.alert_id, breach.alert_id);
        assert_eq!(decoded.rule_name, breach.rule_name);
        assert_eq!(decoded.tx_count, breach.tx_count);
    }
}
