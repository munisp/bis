// db.rs — PostgreSQL persistence for bis-screening-engine
//
// Writes completed ScreeningResult rows back to the `screening_results` table
// (defined in the BIS Drizzle schema) and updates the parent `screening_orders`
// row when all checks for an order are complete.
//
// Column names match the Drizzle migration exactly (camelCase quoted identifiers).
//
// The pool is optional: when DATABASE_URL is absent the engine still works
// (results are published to Kafka only) so CI / local dev is unaffected.

use crate::{ScreeningOutcome, ScreeningResult, ScreeningType};
use deadpool_postgres::{Config as PoolConfig, Pool, Runtime};
use std::env;
use tokio_postgres::NoTls;
use tracing::{error, info, warn};

// ─── Pool bootstrap ───────────────────────────────────────────────────────────

/// Build a connection pool from DATABASE_URL.
/// Returns None when DATABASE_URL is absent (dev / test mode).
pub async fn build_pool() -> Option<Pool> {
    let dsn = match env::var("DATABASE_URL") {
        Ok(v) if !v.is_empty() => v,
        _ => {
            warn!("DATABASE_URL not set — screening-engine running without DB persistence");
            return None;
        }
    };

    let mut cfg = PoolConfig::new();
    cfg.url = Some(dsn);

    match cfg.create_pool(Some(Runtime::Tokio1), NoTls) {
        Ok(pool) => {
            info!("PostgreSQL pool created for screening-engine");
            Some(pool)
        }
        Err(e) => {
            error!("Failed to create PostgreSQL pool: {e}");
            None
        }
    }
}

// ─── Result persistence ───────────────────────────────────────────────────────

/// Persist a completed ScreeningResult to the `screening_results` table.
///
/// The BFF pre-creates a `pending` row identified by `(orderId, screeningType)`.
/// We UPDATE that row with the completed outcome, rawResult, summary, and riskScore.
/// `result_id` in ScreeningResult is the `screening_results.id` PK set by the BFF.
pub async fn persist_result(pool: &Pool, result: &ScreeningResult) {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            error!("persist_result: pool error: {e}");
            return;
        }
    };

    let outcome_str = outcome_to_str(&result.outcome);
    let screening_type_str = screening_type_to_db_str(&result.screening_type);

    // UPDATE the pre-created pending row by (id) — the BFF sets result_id = screening_results.id
    let rows_updated = match client
        .execute(
            r#"UPDATE screening_results
               SET status          = 'completed',
                   outcome         = $1,
                   "rawResult"     = $2,
                   summary         = $3,
                   "riskScore"     = $4,
                   "completedAt"   = NOW(),
                   "updatedAt"     = NOW()
               WHERE id = $5"#,
            &[
                &outcome_str,
                &result.details,
                &result.summary,
                &(result.risk_score as f32),
                &(result.result_id as i32),
            ],
        )
        .await
    {
        Ok(n) => n,
        Err(e) => {
            error!(
                result_id = result.result_id,
                screening_type = %screening_type_str,
                "persist_result UPDATE failed: {e}"
            );
            return;
        }
    };

    if rows_updated == 0 {
        warn!(
            result_id = result.result_id,
            order_ref = %result.order_ref,
            screening_type = %screening_type_str,
            "persist_result: no row found with id={}, skipping fallback insert",
            result.result_id
        );
        // Do not insert — the BFF owns the insert; if the row is missing it means
        // the order was cancelled or the result_id is stale.
        return;
    }

    info!(
        result_id = result.result_id,
        order_ref = %result.order_ref,
        outcome = %outcome_str,
        "Screening result persisted to DB"
    );

    // Attempt to update the parent order's overall outcome
    update_order_outcome(pool, &result.order_ref).await;
}

/// Recompute and update `screening_orders.overallOutcome` and `status`
/// based on the current state of all child `screening_results` rows.
///
/// Mirrors the TypeScript `autoAssessOrder` logic in ngScreeningWebhooks.ts:
///   1. Any "adverse" / "suspended_licence" / "revoked_licence" → adverse
///   2. Any "consider" → consider
///   3. All "clear" or "unverified" → clear
///   4. Any still "pending" / "processing" → not ready yet, skip
async fn update_order_outcome(pool: &Pool, order_ref: &str) {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            error!("update_order_outcome: pool error: {e}");
            return;
        }
    };

    // Fetch all result statuses and outcomes for this order
    let rows = match client
        .query(
            r#"SELECT sr.status, sr.outcome
               FROM screening_results sr
               JOIN screening_orders so ON so.id = sr."orderId"
               WHERE so."orderRef" = $1"#,
            &[&order_ref],
        )
        .await
    {
        Ok(r) => r,
        Err(e) => {
            error!("update_order_outcome query failed for {order_ref}: {e}");
            return;
        }
    };

    if rows.is_empty() {
        return;
    }

    // Check if any result is still in progress
    let has_pending = rows.iter().any(|r| {
        let status: String = r.get("status");
        status == "pending" || status == "processing"
    });
    if has_pending {
        return; // Not all checks done yet
    }

    // Compute overall outcome (mirrors TypeScript autoAssessOrder)
    let outcomes: Vec<String> = rows
        .iter()
        .map(|r| {
            r.try_get::<_, String>("outcome")
                .unwrap_or_else(|_| "unverified".to_string())
        })
        .collect();

    let overall = if outcomes.iter().any(|o| {
        o == "adverse" || o == "suspended_licence" || o == "revoked_licence"
    }) {
        "adverse"
    } else if outcomes.iter().any(|o| o == "consider") {
        "consider"
    } else {
        "clear"
    };

    if let Err(e) = client
        .execute(
            r#"UPDATE screening_orders
               SET "overallOutcome" = $1,
                   status           = 'completed',
                   "completedAt"    = NOW(),
                   "updatedAt"      = NOW()
               WHERE "orderRef" = $2
                 AND status != 'completed'"#,
            &[&overall, &order_ref],
        )
        .await
    {
        error!("update_order_outcome UPDATE failed for {order_ref}: {e}");
    } else {
        info!(order_ref, overall, "Order outcome updated to {overall}");
    }
}

// ─── Enum → DB string helpers ─────────────────────────────────────────────────

fn outcome_to_str(outcome: &ScreeningOutcome) -> &'static str {
    match outcome {
        ScreeningOutcome::Clear      => "clear",
        ScreeningOutcome::Consider   => "consider",
        ScreeningOutcome::Adverse    => "adverse",
        ScreeningOutcome::Unverified => "unverified",
        ScreeningOutcome::Error      => "consider", // map Error → consider (no adverse evidence)
    }
}

/// Convert ScreeningType to the snake_case DB enum value used in `screening_type` PG enum.
fn screening_type_to_db_str(t: &ScreeningType) -> &'static str {
    match t {
        ScreeningType::NinTrace               => "nin_trace",
        ScreeningType::CriminalEfcc           => "criminal_efcc",
        ScreeningType::CriminalIcpc           => "criminal_icpc",
        ScreeningType::CourtRecord            => "court_record",
        ScreeningType::CacDirectorship        => "cac_directorship",
        ScreeningType::EducationWaec          => "education_waec",
        ScreeningType::EducationNeco          => "education_neco",
        ScreeningType::EducationUniversity    => "education_university",
        ScreeningType::NyscDischarge          => "nysc_discharge",
        ScreeningType::EmploymentVerification => "employment_verification",
        ScreeningType::ProfessionalLicenceCoren => "professional_licence_coren",
        ScreeningType::ProfessionalLicenceNba   => "professional_licence_nba",
        ScreeningType::ProfessionalLicenceMdcn  => "professional_licence_mdcn",
        ScreeningType::ProfessionalLicenceIcan  => "professional_licence_ican",
        ScreeningType::ProfessionalLicenceCibn  => "professional_licence_cibn",
        ScreeningType::AdverseMedia           => "adverse_media",
        ScreeningType::PepSanctions           => "pep_sanctions",
        ScreeningType::Watchlist              => "watchlist",
        ScreeningType::WorkPermit             => "work_permit",
        ScreeningType::ContinuousMonitor      => "continuous_monitor",
        ScreeningType::AddressVerification    => "address_verification",
        ScreeningType::BvnVerification        => "bvn_fraud_check",
        ScreeningType::CreditCheck            => "credit_check",
        ScreeningType::DrugTest               => "drug_test",
        ScreeningType::SexOffenderRegistry    => "sex_offender_registry",
        ScreeningType::TerrorismWatchlist     => "terrorism_watchlist",
        ScreeningType::InterpolNotice         => "interpol_notice",
        ScreeningType::SocialMedia            => "social_media",
    }
}
