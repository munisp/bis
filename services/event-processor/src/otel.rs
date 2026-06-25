// otel.rs — OpenTelemetry distributed tracing for BIS Event Processor
//
// Strategy: zero-extra-crate approach using the existing `tracing` + `tracing-subscriber`
// crates already in Cargo.toml.  We implement an OTLP/HTTP span exporter by hand
// using reqwest (already a dependency) so we don't need to add opentelemetry-* crates
// to the Docker build.  This keeps the binary lean while producing real OTLP spans
// that Jaeger, Grafana Tempo, and OpenSearch Observability can ingest.
//
// When OTEL_EXPORTER_OTLP_ENDPOINT is set, spans are batched and exported every 5s.
// When it is unset, the module is a no-op and normal stdout tracing continues.

use chrono::Utc;
use serde::Serialize;
use std::{
    collections::HashMap,
    env,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::mpsc;
use tracing::info;
use uuid::Uuid;

// ─── OTLP span structures (subset of the OTLP protobuf JSON encoding) ─────────

#[derive(Debug, Clone, Serialize)]
pub struct OtlpAttribute {
    pub key: String,
    pub value: OtlpAnyValue,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum OtlpAnyValue {
    StringValue { #[serde(rename = "stringValue")] string_value: String },
    IntValue    { #[serde(rename = "intValue")]    int_value: i64 },
    BoolValue   { #[serde(rename = "boolValue")]   bool_value: bool },
    DoubleValue { #[serde(rename = "doubleValue")]  double_value: f64 },
}

impl OtlpAnyValue {
    pub fn string(s: impl Into<String>) -> Self { Self::StringValue { string_value: s.into() } }
    pub fn int(i: i64) -> Self { Self::IntValue { int_value: i } }
    pub fn bool(b: bool) -> Self { Self::BoolValue { bool_value: b } }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtlpSpan {
    pub trace_id:           String,   // 32-char hex
    pub span_id:            String,   // 16-char hex
    pub parent_span_id:     Option<String>,
    pub name:               String,
    pub kind:               u8,       // 1=INTERNAL, 2=SERVER, 3=CLIENT, 4=PRODUCER, 5=CONSUMER
    pub start_time_unix_nano: u64,
    pub end_time_unix_nano:   u64,
    pub attributes:         Vec<OtlpAttribute>,
    pub status:             OtlpStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct OtlpStatus {
    pub code:    u8,    // 0=UNSET, 1=OK, 2=ERROR
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OtlpResourceSpans {
    resource: OtlpResource,
    scope_spans: Vec<OtlpScopeSpans>,
}

#[derive(Debug, Serialize)]
struct OtlpResource {
    attributes: Vec<OtlpAttribute>,
}

#[derive(Debug, Serialize)]
struct OtlpScopeSpans {
    scope: OtlpInstrumentationScope,
    spans: Vec<OtlpSpan>,
}

#[derive(Debug, Serialize)]
struct OtlpInstrumentationScope {
    name:    String,
    version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OtlpExportRequest {
    resource_spans: Vec<OtlpResourceSpans>,
}

// ─── Span builder ─────────────────────────────────────────────────────────────

pub struct SpanBuilder {
    name:           String,
    kind:           u8,
    trace_id:       String,
    span_id:        String,
    parent_span_id: Option<String>,
    start_ns:       u64,
    attributes:     Vec<OtlpAttribute>,
}

impl SpanBuilder {
    pub fn new(name: impl Into<String>) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        Self {
            name:           name.into(),
            kind:           1, // INTERNAL
            trace_id:       Uuid::new_v4().simple().to_string() + &Uuid::new_v4().simple().to_string()[..0],
            span_id:        Uuid::new_v4().simple().to_string()[..16].to_string(),
            parent_span_id: None,
            start_ns:       now,
            attributes:     Vec::new(),
        }
    }

    pub fn server(mut self) -> Self { self.kind = 2; self }
    pub fn consumer(mut self) -> Self { self.kind = 5; self }
    pub fn producer(mut self) -> Self { self.kind = 4; self }

    pub fn with_trace_id(mut self, trace_id: impl Into<String>) -> Self {
        self.trace_id = trace_id.into();
        self
    }

    pub fn with_parent(mut self, parent_span_id: impl Into<String>) -> Self {
        self.parent_span_id = Some(parent_span_id.into());
        self
    }

    /// Override the auto-generated span ID (used for W3C traceparent propagation).
    pub fn with_span_id(mut self, span_id: impl Into<String>) -> Self {
        self.span_id = span_id.into();
        self
    }

    /// Return the current span ID (needed to build downstream traceparent header).
    pub fn span_id(&self) -> &str {
        &self.span_id
    }

    pub fn attr(mut self, key: impl Into<String>, value: OtlpAnyValue) -> Self {
        self.attributes.push(OtlpAttribute { key: key.into(), value });
        self
    }

    pub fn attr_str(self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.attr(key, OtlpAnyValue::string(value))
    }

    pub fn attr_int(self, key: impl Into<String>, value: i64) -> Self {
        self.attr(key, OtlpAnyValue::int(value))
    }

    /// Finish the span and send it to the exporter channel.
    pub fn finish(self, tx: &SpanSender, ok: bool, message: impl Into<String>) {
        let end_ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        let span = OtlpSpan {
            trace_id:             self.trace_id,
            span_id:              self.span_id,
            parent_span_id:       self.parent_span_id,
            name:                 self.name,
            kind:                 self.kind,
            start_time_unix_nano: self.start_ns,
            end_time_unix_nano:   end_ns,
            attributes:           self.attributes,
            status:               OtlpStatus {
                code:    if ok { 1 } else { 2 },
                message: message.into(),
            },
        };
        let _ = tx.send(span);
    }
}

// ─── Exporter ─────────────────────────────────────────────────────────────────

pub type SpanSender   = mpsc::UnboundedSender<OtlpSpan>;
pub type SpanReceiver = mpsc::UnboundedReceiver<OtlpSpan>;

/// Returns (sender, join_handle).  The background task batches spans and POSTs
/// them to the OTLP endpoint every 5 seconds (or when the batch reaches 512 spans).
pub fn start_exporter(
    mut rx: SpanReceiver,
    endpoint: String,
    service_name: String,
    service_version: String,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        let mut batch: Vec<OtlpSpan> = Vec::with_capacity(512);
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                Some(span) = rx.recv() => {
                    batch.push(span);
                    if batch.len() >= 512 {
                        flush_batch(&client, &endpoint, &service_name, &service_version, &mut batch).await;
                    }
                }
                _ = interval.tick() => {
                    if !batch.is_empty() {
                        flush_batch(&client, &endpoint, &service_name, &service_version, &mut batch).await;
                    }
                }
            }
        }
    })
}

async fn flush_batch(
    client:          &reqwest::Client,
    endpoint:        &str,
    service_name:    &str,
    service_version: &str,
    batch:           &mut Vec<OtlpSpan>,
) {
    if batch.is_empty() { return; }

    let payload = OtlpExportRequest {
        resource_spans: vec![OtlpResourceSpans {
            resource: OtlpResource {
                attributes: vec![
                    OtlpAttribute { key: "service.name".into(),    value: OtlpAnyValue::string(service_name) },
                    OtlpAttribute { key: "service.version".into(), value: OtlpAnyValue::string(service_version) },
                    OtlpAttribute { key: "deployment.environment".into(), value: OtlpAnyValue::string(
                        std::env::var("DEPLOYMENT_ENV").unwrap_or_else(|_| "production".into())
                    )},
                ],
            },
            scope_spans: vec![OtlpScopeSpans {
                scope: OtlpInstrumentationScope {
                    name:    "bis-event-processor".into(),
                    version: service_version.to_string(),
                },
                spans: batch.drain(..).collect(),
            }],
        }],
    };

    let url = format!("{}/v1/traces", endpoint.trim_end_matches('/'));
    match client.post(&url).json(&payload).send().await {
        Ok(resp) if resp.status().is_success() => {
            tracing::debug!("[otel] Exported {} spans to {}", payload.resource_spans[0].scope_spans[0].spans.len(), url);
        }
        Ok(resp) => {
            tracing::warn!("[otel] OTLP export failed: HTTP {}", resp.status());
        }
        Err(e) => {
            tracing::warn!("[otel] OTLP export error: {}", e);
        }
    }
}

// ─── No-op sender for when OTEL is disabled ───────────────────────────────────

/// Returns a channel pair.  If OTEL_EXPORTER_OTLP_ENDPOINT is not set,
/// the receiver is dropped immediately (spans are discarded).
pub fn init_otel() -> (SpanSender, Option<tokio::task::JoinHandle<()>>) {
    let (tx, rx) = mpsc::unbounded_channel::<OtlpSpan>();

    let endpoint = env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok();
    let service_name = env::var("OTEL_SERVICE_NAME")
        .unwrap_or_else(|_| "bis-event-processor".into());
    let service_version = env!("CARGO_PKG_VERSION").to_string();

    if let Some(ep) = endpoint {
        info!("[otel] OTLP exporter enabled → {}", ep);
        let handle = start_exporter(rx, ep, service_name, service_version);
        (tx, Some(handle))
    } else {
        info!("[otel] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing spans discarded.");
        // Drop rx so the channel is closed; tx.send() will return Err but won't panic.
        drop(rx);
        (tx, None)
    }
}
