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
    description: "JWT signing secret — must be at least 32 chars in production",
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
        // Apply default value
        process.env[spec.key] = spec.defaultValue;
        if (isProduction) {
          warnings.push(`DEFAULT APPLIED: ${spec.key}="${spec.defaultValue}" — ${spec.description}`);
        }
      }
      continue;
    }

    // Check for insecure defaults in production
    if (isProduction && spec.secret && INSECURE_DEFAULTS.has(value)) {
      errors.push(`INSECURE DEFAULT: ${spec.key} uses a known-insecure default value — change before production use`);
    }

    // JWT_SECRET must be at least 32 chars in production
    if (isProduction && spec.key === "JWT_SECRET" && value.length < 32) {
      errors.push(`WEAK SECRET: JWT_SECRET is ${value.length} chars — must be at least 32 chars in production`);
    }
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
