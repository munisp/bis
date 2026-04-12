/**
 * BIS Platform — Shared Production Constants
 * All app-wide defaults, limits, and configuration values.
 * Import from both server and client code.
 */

// ─── Application Identity ─────────────────────────────────────────────────────
export const APP_NAME = "BIS — Background Intelligence System";
export const APP_VERSION = "1.0.0";
export const APP_DESCRIPTION = "Integrated intelligence and case management platform for financial crime investigation";

// ─── Service URLs (overridable via environment variables) ─────────────────────
export const DEFAULT_BIS_API_URL = "https://bis.manus.space/api";
export const DEFAULT_LEX_INTAKE_URL = "http://localhost:8080";   // Go microservice
export const DEFAULT_LEX_VALIDATOR_URL = "http://localhost:8090"; // Python microservice
export const DEFAULT_SMS_PROVIDER = "africas_talking";            // "africas_talking" | "termii"

// ─── Pagination Limits ────────────────────────────────────────────────────────
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 200;
export const EXPORT_ROWS_MAX = 1000;
export const SEARCH_RESULTS_MAX = 50;

// ─── File Upload Limits ───────────────────────────────────────────────────────
export const FILE_UPLOAD_MAX_BYTES = 16 * 1024 * 1024; // 16 MB
export const FILE_UPLOAD_MAX_MB = 16;
export const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv", "jpg", "jpeg", "png", "gif", "webp",
  "mp4", "mp3", "wav", "zip", "rar",
]);

// ─── Input Size Limits ────────────────────────────────────────────────────────
export const NARRATIVE_MAX_CHARS = 5000;
export const COMMENT_MAX_CHARS = 2000;
export const DESCRIPTION_MAX_CHARS = 1000;
export const SHORT_TEXT_MAX_CHARS = 255;
export const LLM_MESSAGE_MAX_CHARS = 4000;
export const LLM_MESSAGES_MAX_COUNT = 50;

// ─── Rate Limiting ────────────────────────────────────────────────────────────
export const RATE_LIMIT_GENERAL_MAX = 300;       // requests per window
export const RATE_LIMIT_GENERAL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_AUTH_MAX = 10;
export const RATE_LIMIT_AUTH_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_LEX_SUBMIT_MAX = 30;
export const RATE_LIMIT_LEX_SUBMIT_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_LLM_MAX = 20;
export const RATE_LIMIT_LLM_WINDOW_MS = 60 * 1000; // 1 minute

// ─── Session & Auth ───────────────────────────────────────────────────────────
export const SESSION_COOKIE_NAME = "bis_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const JWT_EXPIRY = "7d";
export const TOTP_ISSUER = "BIS Platform";
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const BACKUP_CODES_COUNT = 10;

// ─── SLA Thresholds ───────────────────────────────────────────────────────────
export const SLA_CASE_CRITICAL_HOURS = 24;
export const SLA_CASE_HIGH_HOURS = 72;
export const SLA_CASE_MEDIUM_HOURS = 168;   // 7 days
export const SLA_CASE_LOW_HOURS = 720;      // 30 days
export const SLA_LEX_REVIEW_HOURS = 72;     // LEX submissions must be reviewed within 72h
export const SLA_ESCALATION_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ─── Risk Score Thresholds ────────────────────────────────────────────────────
export const RISK_SCORE_CRITICAL = 80;
export const RISK_SCORE_HIGH = 60;
export const RISK_SCORE_MEDIUM = 40;
export const RISK_SCORE_LOW = 20;

// ─── LEX Configuration ────────────────────────────────────────────────────────
export const LEX_SUBMISSION_EXPIRY_DAYS = 365;
export const LEX_AGENCY_PIN_LENGTH = 6;
export const LEX_AGENCY_PIN_EXPIRY_DAYS = 90;
export const LEX_VALIDATION_PASS_THRESHOLD = 60; // minimum score to auto-pass
export const LEX_VALIDATION_AUTO_REJECT_THRESHOLD = 20; // auto-reject below this
export const LEX_REPUTATION_DECAY_DAYS = 180; // reputation score resets after 6 months

// ─── Nigerian States ─────────────────────────────────────────────────────────
export const NIGERIAN_STATES = [
  { code: "AB", name: "Abia" },
  { code: "AD", name: "Adamawa" },
  { code: "AK", name: "Akwa Ibom" },
  { code: "AN", name: "Anambra" },
  { code: "BA", name: "Bauchi" },
  { code: "BY", name: "Bayelsa" },
  { code: "BE", name: "Benue" },
  { code: "BO", name: "Borno" },
  { code: "CR", name: "Cross River" },
  { code: "DE", name: "Delta" },
  { code: "EB", name: "Ebonyi" },
  { code: "ED", name: "Edo" },
  { code: "EK", name: "Ekiti" },
  { code: "EN", name: "Enugu" },
  { code: "FC", name: "FCT Abuja" },
  { code: "GO", name: "Gombe" },
  { code: "IM", name: "Imo" },
  { code: "JI", name: "Jigawa" },
  { code: "KD", name: "Kaduna" },
  { code: "KN", name: "Kano" },
  { code: "KT", name: "Katsina" },
  { code: "KE", name: "Kebbi" },
  { code: "KO", name: "Kogi" },
  { code: "KW", name: "Kwara" },
  { code: "LA", name: "Lagos" },
  { code: "NA", name: "Nasarawa" },
  { code: "NI", name: "Niger" },
  { code: "OG", name: "Ogun" },
  { code: "ON", name: "Ondo" },
  { code: "OS", name: "Osun" },
  { code: "OY", name: "Oyo" },
  { code: "PL", name: "Plateau" },
  { code: "RI", name: "Rivers" },
  { code: "SO", name: "Sokoto" },
  { code: "TA", name: "Taraba" },
  { code: "YO", name: "Yobe" },
  { code: "ZA", name: "Zamfara" },
] as const;

export type NigerianStateCode = (typeof NIGERIAN_STATES)[number]["code"];

// ─── API Response Codes ───────────────────────────────────────────────────────
export const API_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
} as const;

// ─── Notification Types ───────────────────────────────────────────────────────
export const NOTIFICATION_TYPES = [
  "case_assigned",
  "case_sla_breach",
  "case_escalated",
  "case_comment",
  "investigation_alert",
  "lex_submission_received",
  "lex_submission_validated",
  "lex_submission_rejected",
  "lex_agency_flagged",
  "risk_alert",
  "system",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// ─── Export Formats ───────────────────────────────────────────────────────────
export const EXPORT_FORMATS = ["csv", "pdf", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

// ─── Timeouts ─────────────────────────────────────────────────────────────────
export const HTTP_TIMEOUT_MS = 30_000;
export const LLM_TIMEOUT_MS = 60_000;
export const DB_QUERY_TIMEOUT_MS = 10_000;
export const S3_UPLOAD_TIMEOUT_MS = 30_000;
export const SMS_SEND_TIMEOUT_MS = 10_000;

// ─── Health Check ─────────────────────────────────────────────────────────────
export const HEALTH_CHECK_PATH = "/api/health";
export const HEALTH_CHECK_INTERVAL_MS = 30_000;
