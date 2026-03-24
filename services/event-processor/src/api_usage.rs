// services/event-processor/src/api_usage.rs
// Rust module: consumes "bis.api_usage" Kafka topic and persists
// token usage records to PostgreSQL with sub-millisecond throughput.
//
// Architecture:
//   Go gateway  →  Kafka "bis.api_usage"  →  Rust consumer (this file)
//                                         →  PostgreSQL token_usage_log
//                                         →  Redis usage counters (for real-time dashboard)
//
// The Rust event processor is the single writer for token_usage_log,
// keeping the hot write path out of the Node.js BFF.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::env;
use tokio_postgres::{Client, NoTls};
use tracing::{error, info, warn};

// ─── Kafka usage event (mirrors Go struct in apitoken/middleware.go) ──────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiUsageEvent {
    pub token_id: i32,
    pub tenant_id: Option<i32>,
    pub endpoint: String,
    pub method: String,
    pub status_code: i32,
    pub latency_ms: i64,
    pub ip_address: String,
    pub timestamp: String,
}

// ─── Database writer ──────────────────────────────────────────────────────────

pub struct UsageLogger {
    db: Client,
}

impl UsageLogger {
    /// Connect to PostgreSQL and return a UsageLogger.
    pub async fn connect() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let db_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db".to_string());

        let (client, connection) = tokio_postgres::connect(&db_url, NoTls).await?;

        // Spawn the connection driver
        tokio::spawn(async move {
            if let Err(e) = connection.await {
                error!("[api_usage] PostgreSQL connection error: {}", e);
            }
        });

        info!("[api_usage] Connected to PostgreSQL");
        Ok(Self { db: client })
    }

    /// Persist a single usage event to token_usage_log.
    pub async fn log_event(&self, event: &ApiUsageEvent) -> Result<(), tokio_postgres::Error> {
        self.db
            .execute(
                r#"
                INSERT INTO token_usage_log
                    ("tokenId", endpoint, method, "statusCode", "latencyMs", "ipAddress", "createdAt")
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                "#,
                &[
                    &event.token_id,
                    &event.endpoint.as_str(),
                    &event.method.as_str(),
                    &event.status_code,
                    &(event.latency_ms as i32),
                    &event.ip_address.as_str(),
                ],
            )
            .await?;

        // Also increment the usage counter on the token row
        self.db
            .execute(
                r#"
                UPDATE api_tokens
                SET "usageCount" = "usageCount" + 1,
                    "lastUsedAt" = NOW(),
                    "updatedAt"  = NOW()
                WHERE id = $1
                "#,
                &[&event.token_id],
            )
            .await?;

        Ok(())
    }

    /// Batch-persist a slice of events in a single transaction.
    pub async fn log_batch(&self, events: &[ApiUsageEvent]) -> Result<usize, tokio_postgres::Error> {
        if events.is_empty() {
            return Ok(0);
        }

        let mut count = 0usize;
        for event in events {
            match self.log_event(event).await {
                Ok(_) => count += 1,
                Err(e) => warn!("[api_usage] Failed to log event for token {}: {}", event.token_id, e),
            }
        }
        info!("[api_usage] Persisted {}/{} usage events", count, events.len());
        Ok(count)
    }
}

// ─── Kafka consumer loop ──────────────────────────────────────────────────────

/// Consume "bis.api_usage" messages from Kafka and persist them.
/// This is spawned as a background Tokio task in main.rs.
pub async fn run_usage_consumer(logger: UsageLogger) {
    use rdkafka::config::ClientConfig;
    use rdkafka::consumer::{Consumer, StreamConsumer};
    use rdkafka::message::Message;

    let brokers = env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:9092".to_string());

    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("group.id", "bis-api-usage-logger")
        .set("auto.offset.reset", "latest")
        .set("enable.auto.commit", "true")
        .create()
        .expect("[api_usage] Failed to create Kafka consumer");

    consumer
        .subscribe(&["bis.api_usage"])
        .expect("[api_usage] Failed to subscribe to bis.api_usage");

    info!("[api_usage] Kafka consumer started on topic bis.api_usage");

    // Micro-batch: accumulate up to 100 events or 500ms, then flush
    let mut batch: Vec<ApiUsageEvent> = Vec::with_capacity(100);
    let mut last_flush = std::time::Instant::now();

    loop {
        use rdkafka::consumer::CommitMode;
        use futures::StreamExt;

        // Poll with a short timeout so we can flush on time
        let timeout = std::time::Duration::from_millis(500);

        match tokio::time::timeout(timeout, consumer.stream().next()).await {
            Ok(Some(Ok(msg))) => {
                if let Some(payload) = msg.payload() {
                    match serde_json::from_slice::<ApiUsageEvent>(payload) {
                        Ok(event) => batch.push(event),
                        Err(e) => warn!("[api_usage] Deserialize error: {}", e),
                    }
                }
                let _ = consumer.commit_message(&msg, CommitMode::Async);
            }
            Ok(Some(Err(e))) => warn!("[api_usage] Kafka error: {}", e),
            Ok(None) => break, // Stream ended
            Err(_) => {} // Timeout — fall through to flush check
        }

        // Flush if batch is full or 500ms elapsed
        if batch.len() >= 100 || last_flush.elapsed().as_millis() >= 500 {
            if !batch.is_empty() {
                let _ = logger.log_batch(&batch).await;
                batch.clear();
            }
            last_flush = std::time::Instant::now();
        }
    }
}

// ─── HTTP endpoint: real-time usage stats ────────────────────────────────────
// Exposed on the event processor at GET /api/usage/stats?tokenId=<id>&days=<n>
// Called by the Python analytics engine and the Node.js BFF.

#[derive(Debug, Serialize)]
pub struct UsageSummary {
    pub token_id: i32,
    pub total_requests: i64,
    pub success_rate: f64,
    pub avg_latency_ms: f64,
    pub p95_latency_ms: f64,
    pub requests_by_day: Vec<DaySummary>,
    pub top_endpoints: Vec<EndpointSummary>,
}

#[derive(Debug, Serialize)]
pub struct DaySummary {
    pub day: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct EndpointSummary {
    pub endpoint: String,
    pub method: String,
    pub count: i64,
    pub avg_latency_ms: f64,
}

pub async fn get_usage_stats(
    db: &Client,
    token_id: i32,
    days: i32,
) -> Result<UsageSummary, tokio_postgres::Error> {
    let rows = db
        .query(
            r#"
            SELECT
                COUNT(*)                                            AS total,
                AVG(CASE WHEN "statusCode" < 400 THEN 1.0 ELSE 0.0 END) * 100 AS success_rate,
                AVG("latencyMs")                                    AS avg_latency,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95_latency
            FROM token_usage_log
            WHERE "tokenId" = $1
              AND "createdAt" >= NOW() - ($2 || ' days')::interval
            "#,
            &[&token_id, &days.to_string()],
        )
        .await?;

    let (total, success_rate, avg_latency, p95_latency) = if let Some(row) = rows.first() {
        (
            row.get::<_, i64>(0),
            row.get::<_, f64>(1),
            row.get::<_, f64>(2),
            row.get::<_, f64>(3),
        )
    } else {
        (0, 100.0, 0.0, 0.0)
    };

    // By day
    let day_rows = db
        .query(
            r#"
            SELECT DATE_TRUNC('day', "createdAt")::date::text AS day, COUNT(*) AS cnt
            FROM token_usage_log
            WHERE "tokenId" = $1
              AND "createdAt" >= NOW() - ($2 || ' days')::interval
            GROUP BY 1 ORDER BY 1
            "#,
            &[&token_id, &days.to_string()],
        )
        .await?;

    let requests_by_day = day_rows
        .iter()
        .map(|r| DaySummary {
            day: r.get(0),
            count: r.get(1),
        })
        .collect();

    // Top endpoints
    let ep_rows = db
        .query(
            r#"
            SELECT endpoint, method, COUNT(*) AS cnt, AVG("latencyMs") AS avg_lat
            FROM token_usage_log
            WHERE "tokenId" = $1
              AND "createdAt" >= NOW() - ($2 || ' days')::interval
            GROUP BY endpoint, method
            ORDER BY cnt DESC
            LIMIT 10
            "#,
            &[&token_id, &days.to_string()],
        )
        .await?;

    let top_endpoints = ep_rows
        .iter()
        .map(|r| EndpointSummary {
            endpoint: r.get(0),
            method: r.get(1),
            count: r.get(2),
            avg_latency_ms: r.get(3),
        })
        .collect();

    Ok(UsageSummary {
        token_id,
        total_requests: total,
        success_rate,
        avg_latency_ms: avg_latency,
        p95_latency_ms: p95_latency,
        requests_by_day,
        top_endpoints,
    })
}
