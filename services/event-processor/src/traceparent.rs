// traceparent.rs — W3C Trace Context (traceparent / tracestate) propagation
//
// Implements the W3C Trace Context Level 1 specification:
//   https://www.w3.org/TR/trace-context/
//
// This module:
//   1. Parses `traceparent` and `tracestate` headers from Kafka message headers.
//   2. Creates a child SpanBuilder that is linked to the upstream trace context.
//   3. Serialises a new `traceparent` header value for downstream HTTP calls.
//
// Format:
//   traceparent: {version}-{trace-id}-{parent-id}-{flags}
//   e.g.         00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
//
// Usage:
//   // Extract from Kafka headers
//   let ctx = TraceContext::from_kafka_headers(&headers);
//
//   // Create a child span linked to the upstream trace
//   let span = ctx.child_span("event.process").consumer();
//
//   // Propagate downstream (e.g. in HTTP fan-out)
//   let header_value = ctx.to_traceparent_header();

use crate::otel::{OtlpAnyValue, SpanBuilder};

/// Parsed W3C trace context extracted from Kafka message headers or HTTP headers.
#[derive(Debug, Clone)]
pub struct TraceContext {
    /// 32-char lowercase hex trace ID from the upstream `traceparent` header.
    pub trace_id: String,
    /// 16-char lowercase hex span ID of the upstream span (becomes parent_span_id).
    pub parent_span_id: String,
    /// Trace flags byte (bit 0 = sampled).
    pub flags: u8,
    /// Raw `tracestate` value (passed through unchanged).
    pub tracestate: Option<String>,
    /// Whether this context was extracted from a real header (true) or is a
    /// freshly generated root context (false).
    pub is_remote: bool,
}

impl TraceContext {
    // ── Constructors ──────────────────────────────────────────────────────────

    /// Generate a new root trace context (no upstream parent).
    pub fn new_root() -> Self {
        Self {
            trace_id:      new_trace_id(),
            parent_span_id: new_span_id(),
            flags:         1, // sampled
            tracestate:    None,
            is_remote:     false,
        }
    }

    /// Parse a W3C `traceparent` header value.
    ///
    /// Returns `None` if the header is absent or malformed; callers should fall
    /// back to `TraceContext::new_root()` in that case.
    pub fn parse(traceparent: &str) -> Option<Self> {
        let parts: Vec<&str> = traceparent.trim().splitn(4, '-').collect();
        if parts.len() != 4 {
            return None;
        }
        let version = parts[0];
        let trace_id = parts[1];
        let parent_span_id = parts[2];
        let flags_str = parts[3];

        // Version must be "00" (the only defined version)
        if version.len() != 2 || !version.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        // trace-id: 32 lowercase hex chars, must not be all-zeros
        if trace_id.len() != 32 || !is_hex(trace_id) || trace_id == "0".repeat(32) {
            return None;
        }
        // parent-id: 16 lowercase hex chars, must not be all-zeros
        if parent_span_id.len() != 16 || !is_hex(parent_span_id) || parent_span_id == "0".repeat(16) {
            return None;
        }
        // flags: 2 hex chars
        if flags_str.len() != 2 || !is_hex(flags_str) {
            return None;
        }
        let flags = u8::from_str_radix(flags_str, 16).ok()?;

        Some(Self {
            trace_id:      trace_id.to_lowercase(),
            parent_span_id: parent_span_id.to_lowercase(),
            flags,
            tracestate:    None,
            is_remote:     true,
        })
    }

    /// Extract trace context from a slice of Kafka message headers.
    ///
    /// Looks for the `traceparent` key (case-insensitive) and optionally
    /// the `tracestate` key.  Returns a root context if no valid header is found.
    pub fn from_kafka_headers(headers: &[(String, Vec<u8>)]) -> Self {
        let mut ctx = None;
        let mut tracestate: Option<String> = None;

        for (key, value) in headers {
            let key_lower = key.to_lowercase();
            if key_lower == "traceparent" {
                if let Ok(s) = std::str::from_utf8(value) {
                    ctx = Self::parse(s);
                }
            } else if key_lower == "tracestate" {
                if let Ok(s) = std::str::from_utf8(value) {
                    tracestate = Some(s.to_string());
                }
            }
        }

        match ctx {
            Some(mut c) => {
                c.tracestate = tracestate;
                c
            }
            None => Self::new_root(),
        }
    }

    /// Extract trace context from HTTP-style headers (Vec<(String, String)>).
    pub fn from_http_headers(headers: &[(String, String)]) -> Self {
        let kafka_headers: Vec<(String, Vec<u8>)> = headers
            .iter()
            .map(|(k, v)| (k.clone(), v.as_bytes().to_vec()))
            .collect();
        Self::from_kafka_headers(&kafka_headers)
    }

    // ── Child span creation ───────────────────────────────────────────────────

    /// Create a `SpanBuilder` that is a child of this trace context.
    ///
    /// The child span:
    ///   - Inherits the upstream `trace_id` (so it appears in the same trace).
    ///   - Sets `parent_span_id` to the upstream span ID.
    ///   - Adds `trace.context.is_remote` and `trace.context.flags` attributes.
    pub fn child_span(&self, name: impl Into<String>) -> SpanBuilder {
        let span_id = new_span_id();
        SpanBuilder::new(name)
            .with_trace_id(self.trace_id.clone())
            .with_parent(self.parent_span_id.clone())
            .with_span_id(span_id)
            .attr_str("trace.context.is_remote", self.is_remote.to_string())
            .attr_int("trace.context.flags", self.flags as i64)
    }

    // ── Serialisation ─────────────────────────────────────────────────────────

    /// Produce a W3C `traceparent` header value for this context.
    ///
    /// The returned string uses the *current* span ID (i.e. the span created by
    /// `child_span`) as the parent-id so that downstream services see the correct
    /// parent.  Call this after creating the child span and extracting its span_id.
    pub fn to_traceparent_header(&self, current_span_id: &str) -> String {
        format!(
            "00-{}-{}-{:02x}",
            self.trace_id, current_span_id, self.flags
        )
    }

    /// Produce a `tracestate` header value (pass-through of upstream value).
    pub fn to_tracestate_header(&self) -> Option<&str> {
        self.tracestate.as_deref()
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn is_hex(s: &str) -> bool {
    s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Generate a new 32-char lowercase hex trace ID.
fn new_trace_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // Use two UUID-like random values concatenated to form a 32-char hex string.
    // We avoid pulling in the `rand` crate by using SystemTime + process ID as
    // entropy sources mixed with a counter.
    let ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    let pid = std::process::id();
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{:016x}{:08x}{:08x}", seq.wrapping_mul(0x9e37_79b9_7f4a_7c15), ns, pid)
}

/// Generate a new 16-char lowercase hex span ID.
fn new_span_id() -> String {
    let ns = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    static SPAN_CTR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let seq = SPAN_CTR.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{:016x}", seq.wrapping_add(ns as u64).wrapping_mul(0x517c_c1b7_2722_0a95))
}

use std::time::SystemTime;

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    const VALID_TRACEPARENT: &str =
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    #[test]
    fn parse_valid_traceparent() {
        let ctx = TraceContext::parse(VALID_TRACEPARENT).expect("should parse");
        assert_eq!(ctx.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736");
        assert_eq!(ctx.parent_span_id, "00f067aa0ba902b7");
        assert_eq!(ctx.flags, 1);
        assert!(ctx.is_remote);
    }

    #[test]
    fn reject_all_zero_trace_id() {
        let bad = "00-00000000000000000000000000000000-00f067aa0ba902b7-01";
        assert!(TraceContext::parse(bad).is_none());
    }

    #[test]
    fn reject_all_zero_span_id() {
        let bad = "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01";
        assert!(TraceContext::parse(bad).is_none());
    }

    #[test]
    fn reject_wrong_field_count() {
        assert!(TraceContext::parse("00-abc-def").is_none());
    }

    #[test]
    fn from_kafka_headers_extracts_context() {
        let headers = vec![
            ("traceparent".to_string(), VALID_TRACEPARENT.as_bytes().to_vec()),
            ("tracestate".to_string(), b"rojo=00f067aa0ba902b7".to_vec()),
        ];
        let ctx = TraceContext::from_kafka_headers(&headers);
        assert!(ctx.is_remote);
        assert_eq!(ctx.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736");
        assert_eq!(ctx.tracestate.as_deref(), Some("rojo=00f067aa0ba902b7"));
    }

    #[test]
    fn from_kafka_headers_falls_back_to_root() {
        let headers: Vec<(String, Vec<u8>)> = vec![];
        let ctx = TraceContext::from_kafka_headers(&headers);
        assert!(!ctx.is_remote);
        assert_eq!(ctx.trace_id.len(), 32);
    }

    #[test]
    fn to_traceparent_header_format() {
        let ctx = TraceContext::parse(VALID_TRACEPARENT).unwrap();
        let header = ctx.to_traceparent_header("aabbccdd11223344");
        assert!(header.starts_with("00-4bf92f3577b34da6a3ce929d0e0e4736-aabbccdd11223344-"));
    }

    #[test]
    fn new_root_generates_valid_ids() {
        let ctx = TraceContext::new_root();
        assert_eq!(ctx.trace_id.len(), 32);
        assert!(is_hex(&ctx.trace_id));
        assert!(!ctx.is_remote);
    }
}
