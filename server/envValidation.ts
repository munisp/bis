import { resolveSessionSigningSource } from "./_core/env";

// envValidation.ts — Production environment variable validation
// Called at server startup to warn about missing or insecure defaults.
// In production (NODE_ENV=production), missing critical vars cause process exit.
// In development, warnings are logged but startup continues.

interface EnvSpec {
  key: string;
  required: boolean;
  secret: boolean;
  defaultValue?: string;
  description: string;
}

const ENV_SPECS: EnvSpec[] = [
  // ── Database ──────────────────────────────────────────────────────────────
  {
    key: "DATABASE_URL",
    required: true,
    secret: true,
    description: "PostgreSQL connection string (postgresql://user:pass@host:5432/db)",
  },
  // ── Auth ──────────────────────────────────────────────────────────────────
  {
    key: "JWT_SECRET",
    required: true,
    secret: true,
    description: "Platform JWT secret; production BFF sessions may use BIS_SESSION_SIGNING_SECRET instead",
  },
  {
    key: "BIS_SESSION_SIGNING_SECRET",
    required: false,
    secret: true,
    description: "Dedicated BFF session and TOTP-encryption root secret — must be at least 32 chars in production",
  },
  {
    key: "VITE_APP_ID",
    required: true,
    secret: false,
    description: "Manus OAuth application ID",
  },
  {
    key: "OAUTH_SERVER_URL",
    required: true,
    secret: false,
    defaultValue: "https://api.manus.im",
    description: "Manus OAuth backend base URL",
  },
  // ── Manus Built-in APIs ───────────────────────────────────────────────────
  {
    key: "BUILT_IN_FORGE_API_URL",
    required: false,
    secret: false,
    defaultValue: "https://api.manus.im",
    description: "Manus built-in Forge API URL (LLM, storage, notifications)",
  },
  {
    key: "BUILT_IN_FORGE_API_KEY",
    required: false,
    secret: true,
    description: "Manus built-in Forge API key (server-side)",
  },
  // ── Payment ───────────────────────────────────────────────────────────────
  {
    key: "PAYSTACK_SECRET_KEY",
    required: false,
    secret: true,
    description: "Paystack secret key for payment webhooks",
  },
  // ── SMS Gateway ───────────────────────────────────────────────────────────
  {
    key: "AT_API_KEY",
    required: false,
    secret: true,
    description: "Africa's Talking API key for outbound SMS",
  },
  {
    key: "AT_USERNAME",
    required: false,
    secret: false,
    defaultValue: "sandbox",
    description: "Africa's Talking username (sandbox for testing)",
  },
  {
    key: "TERMII_API_KEY",
    required: false,
    secret: true,
    description: "Termii API key for outbound SMS (alternative to Africa's Talking)",
  },
  // ── Observability ─────────────────────────────────────────────────────────
  {
    key: "GRAFANA_WEBHOOK_SECRET",
    required: false,
    secret: true,
    defaultValue: "bis-grafana-webhook-dev",
    description: "Grafana alert webhook Bearer token",
  },
  // ── Microservices ─────────────────────────────────────────────────────────
  {
    key: "GATEWAY_URL",
    required: false,
    secret: false,
    defaultValue: "http://localhost:8081",
    description: "Go gateway service URL",
  },
  {
    key: "RISK_ENGINE_URL",
    required: false,
    secret: false,
    defaultValue: "http://localhost:8082",
    description: "Python risk engine service URL",
  },
  {
    key: "EVENT_PROCESSOR_URL",
    required: false,
    secret: false,
    defaultValue: "http://localhost:8083",
    description: "Rust event processor service URL",
  },
  {
    key: "OLLAMA_ADAPTER_URL",
    required: false,
    secret: false,
    defaultValue: "http://localhost:8086",
    description: "Ollama adapter service URL",
  },
  {
    key: "LAKEHOUSE_URL",
    required: false,
    secret: false,
    defaultValue: "http://localhost:8085",
    description: "Lakehouse writer service URL",
  },
  // ── BIS API ───────────────────────────────────────────────────────────────
  {
    key: "BIS_API_URL",
    required: false,
    secret: false,
    defaultValue: "http://localhost:3001",
    description: "BIS BFF API URL (used by microservices to call back)",
  },
  {
    key: "BIS_API_KEY",
    required: false,
    secret: true,
    defaultValue: "bis-internal-dev-key",
    description: "BIS internal API key for microservice-to-BFF calls",
  },
  // ── LEX ───────────────────────────────────────────────────────────────────
  {
    key: "LEX_INTAKE_URL",
    required: false,
    secret: false,
    defaultValue: "http://localhost:8087",
    description: "LEX intake Go service URL",
  },
  {
    key: "LEX_VALIDATOR_URL",
    required: false,
    secret: false,
    defaultValue: "http://localhost:8088",
    description: "LEX validator Python service URL",
  },
  {
    key: "LEX_HMAC_SECRET",
    required: false,
    secret: true,
    defaultValue: "bis-lex-hmac-dev-secret",
    description: "HMAC secret for LEX webhook signature verification",
  },
  // ── DB SSL ────────────────────────────────────────────────────────────────
  {
    key: "DB_SSL_STRICT",
    required: false,
    secret: false,
    defaultValue: "false",
    description: "Set to 'true' to enforce SSL certificate verification for DB connections",
  },
  // ── Gateway / Verification Engine ─────────────────────────────────────────
  {
    key: "GATEWAY_SANDBOX",
    required: false,
    secret: false,
    defaultValue: "true",
    description: "Set to 'false' to enable live Nigerian verification API calls",
  },
  {
    key: "BIS_VERIFY_NIMC_URL",
    required: false,
    secret: false,
    defaultValue: "https://api.nimc.gov.ng/v1",
    description: "NIMC NIN verification API base URL",
  },
  {
    key: "BIS_VERIFY_NIMC_KEY",
    required: false,
    secret: true,
    defaultValue: "bis-nimc-key-default",
    description: "NIMC API key for NIN lookups — obtain from https://developers.nimc.gov.ng",
  },
  {
    key: "BIS_VERIFY_NIBSS_URL",
    required: false,
    secret: false,
    defaultValue: "https://api.nibss-plc.com.ng/v1",
    description: "NIBSS BVN verification API base URL",
  },
  {
    key: "BIS_VERIFY_NIBSS_KEY",
    required: false,
    secret: true,
    defaultValue: "bis-nibss-key-default",
    description: "NIBSS API key for BVN lookups — obtain from https://nibss-plc.com.ng/developers",
  },
  {
    key: "BIS_VERIFY_CAC_URL",
    required: false,
    secret: false,
    defaultValue: "https://search.cac.gov.ng/api/v1",
    description: "CAC company registry API base URL",
  },
  {
    key: "BIS_VERIFY_CAC_KEY",
    required: false,
    secret: true,
    defaultValue: "bis-cac-key-default",
    description: "CAC API key for company registry lookups — obtain from https://cac.gov.ng/developer",
  },
  {
    key: "YOUVERIFY_BASE_URL",
    required: false,
    secret: false,
    defaultValue: "https://api.youverify.co/v2",
    description: "Youverify API base URL",
  },
  {
    key: "YOUVERIFY_API_KEY",
    required: false,
    secret: true,
    defaultValue: "bis-youverify-key-default",
    description: "Youverify API key — fallback verification provider",
  },
  // ── Keycloak IDP ──────────────────────────────────────────────────────────
  {
    key: "KEYCLOAK_URL",
    required: false,
    secret: false,
    defaultValue: "http://keycloak:8080",
    description: "Keycloak server URL",
  },
  {
    key: "KEYCLOAK_REALM",
    required: false,
    secret: false,
    defaultValue: "bis-platform",
    description: "Keycloak realm name for BIS",
  },
  {
    key: "KEYCLOAK_CLIENT_ID",
    required: false,
    secret: false,
    defaultValue: "bis-platform",
    description: "Keycloak confidential client ID for the BIS BFF",
  },
  {
    key: "KEYCLOAK_CLIENT_SECRET",
    required: false,
    secret: true,
    defaultValue: "bis-keycloak-secret-default",
    description: "Keycloak client secret — generate in Keycloak Admin → Clients → bis-platform → Credentials",
  },
  // ── Temporal Workflow Engine ───────────────────────────────────────────────
  {
    key: "TEMPORAL_HOST",
    required: false,
    secret: false,
    defaultValue: "temporal:7233",
    description: "Temporal server address (host:port)",
  },
  {
    key: "TEMPORAL_NAMESPACE",
    required: false,
    secret: false,
    defaultValue: "default",
    description: "Temporal namespace for BIS workflows",
  },
  // ── Redis ─────────────────────────────────────────────────────────────────
  {
    key: "REDIS_URL",
    required: false,
    secret: false,
    defaultValue: "redis://redis:6379",
    description: "Redis connection URL for session store, rate limiting, and cache",
  },
  // ── SMTP / Email ──────────────────────────────────────────────────────────
  {
    key: "SMTP_HOST",
    required: false,
    secret: false,
    defaultValue: "smtp.sendgrid.net",
    description: "SMTP server hostname for email notifications",
  },
  {
    key: "SMTP_PORT",
    required: false,
    secret: false,
    defaultValue: "587",
    description: "SMTP port (587 for TLS, 465 for SSL)",
  },
  {
    key: "SMTP_USER",
    required: false,
    secret: true,
    defaultValue: "apikey",
    description: "SMTP username / API key username",
  },
  {
    key: "SMTP_PASS",
    required: false,
    secret: true,
    defaultValue: "bis-smtp-pass-default",
    description: "SMTP password / API key for email sending",
  },
  {
    key: "SMTP_FROM",
    required: false,
    secret: false,
    defaultValue: "noreply@bis-platform.com",
    description: "From address for BIS system emails",
  },
  // ── Slack ─────────────────────────────────────────────────────────────────
  {
    key: "SLACK_WEBHOOK_URL",
    required: false,
    secret: true,
    defaultValue: "https://hooks.slack.com/services/bis-default/webhook",
    description: "Slack incoming webhook URL for CI/CD deploy notifications and critical alerts",
  },
];

// INSECURE_DEFAULTS: values that should never be used in production
const INSECURE_DEFAULTS = new Set([
  "bis-grafana-webhook-dev",
  "bis-internal-dev-key",
  "bis-lex-hmac-dev-secret",
  "sandbox",
  "password",
  "secret",
  "changeme",
  "dev",
]);

function isUnsafeProductionDefault(value: string): boolean {
  return (
    value.includes("localhost") ||
    /:\/\/(?:keycloak|redis|temporal)(?::|\/)/.test(value) ||
    /(?:^|[-_])(dev|default|sandbox)(?:[-_]|$)/.test(value) ||
    value === "bis.localhost" ||
    value === "auth.bis.localhost"
  );
}

export function validateEnv(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const spec of ENV_SPECS) {
    const value = process.env[spec.key];

    if (!value) {
      if (spec.required) {
        errors.push(`MISSING REQUIRED: ${spec.key} — ${spec.description}`);
      } else if (spec.defaultValue) {
        if (isProduction && isUnsafeProductionDefault(spec.defaultValue)) {
          errors.push(`MISSING PRODUCTION CONFIG: ${spec.key} must be explicitly configured — ${spec.description}`);
        } else {
          process.env[spec.key] = spec.defaultValue;
          if (isProduction) {
            warnings.push(`DEFAULT APPLIED: ${spec.key}="${spec.defaultValue}" — ${spec.description}`);
          }
        }
      }
      continue;
    }

    // Check for insecure defaults in production
    if (isProduction && spec.secret && INSECURE_DEFAULTS.has(value)) {
      errors.push(`INSECURE DEFAULT: ${spec.key} uses a known-insecure default value — change before production use`);
    }

  }

  // Prefer an explicit session root. The injected Forge credential is an
  // acceptable fallback because the BFF derives a distinct HMAC-based root
  // from it; its opaque platform-issued format has a smaller practical
  // minimum than a directly used session secret.
  const effectiveSessionSecret = resolveSessionSigningSource();
  const usesForgeFallback = !process.env.BIS_SESSION_SIGNING_SECRET && Boolean(process.env.BUILT_IN_FORGE_API_KEY);
  const minimumSessionSourceLength = usesForgeFallback ? 20 : 32;
  if (isProduction && effectiveSessionSecret.length < minimumSessionSourceLength) {
    const requirement = usesForgeFallback
      ? "BUILT_IN_FORGE_API_KEY fallback must be at least 20 characters in production"
      : "BIS_SESSION_SIGNING_SECRET (or JWT_SECRET fallback) must be at least 32 characters in production";
    errors.push(`WEAK SESSION SIGNING SECRET: ${requirement}`);
  }

  if (isProduction && process.env.GATEWAY_SANDBOX === "true") {
    errors.push("GATEWAY_SANDBOX must not be enabled in production");
  }

  // Log summary
  const maskedEnv = ENV_SPECS.reduce<Record<string, string>>((acc, spec) => {
    const v = process.env[spec.key];
    if (v) {
      acc[spec.key] = spec.secret ? `${v.slice(0, 4)}****` : v;
    }
    return acc;
  }, {});

  console.log(`[BIS] Environment validation — ${isProduction ? "PRODUCTION" : "development"} mode`);
  console.log(`[BIS] Detected env vars: ${JSON.stringify(maskedEnv)}`);

  if (warnings.length > 0) {
    warnings.forEach(w => console.warn(`[BIS][WARN] ${w}`));
  }

  if (errors.length > 0) {
    errors.forEach(e => console.error(`[BIS][ERROR] ${e}`));
    if (isProduction) {
      console.error(`[BIS] ${errors.length} critical env var error(s) detected. Exiting.`);
      process.exit(1);
    } else {
      console.warn(`[BIS] ${errors.length} env var warning(s) in development mode — fix before deploying to production.`);
    }
  } else {
    console.log(`[BIS] Environment validation passed (${ENV_SPECS.length} vars checked).`);
  }
}
