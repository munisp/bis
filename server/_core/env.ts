export const ENV = {
  // Core platform
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",

  // Internal service-to-service gateway key
  bisGatewayKey: process.env.BIS_GATEWAY_KEY ?? "dev-gateway-key-change-in-prod",
  // AML / risk engine sidecar URLs
  bisAmlEngineUrl: process.env.BIS_AML_ENGINE_URL ?? "http://localhost:8095",
  riskEngineUrl: process.env.RISK_ENGINE_URL ?? "http://localhost:8082",
  // Lakehouse writer (Python Delta Lake + DuckDB)
  lakehouseUrl: process.env.LAKEHOUSE_URL ?? "http://localhost:8085",
  // Ollama local LLM (optional — used by OpenClaw skill engine)
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  // Biometric engine (Go sidecar)
  biometricEngineUrl: process.env.BIOMETRIC_ENGINE_URL ?? "http://localhost:8084",
  // Event processor (Rust sidecar)
  eventProcessorUrl: process.env.EVENT_PROCESSOR_URL ?? "http://localhost:8083",
  // BIS API gateway (Go)
  bisGatewayUrl: process.env.BIS_GATEWAY_URL ?? "http://localhost:8081",
  // TigerBeetle ledger HTTP proxy
  tigerBeetleUrl: process.env.TIGERBEETLE_URL ?? "",
  tigerBeetleHttpUrl: process.env.TIGERBEETLE_HTTP_URL ?? "http://localhost:3001",
  // Paystack payment gateway
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY ?? "",
  // CORS allowed origins (comma-separated)
  allowedOrigins: process.env.ALLOWED_ORIGINS ?? "",
  // Metrics bearer token
  metricsToken: process.env.METRICS_TOKEN ?? "",
  // SMS provider
  smsProvider: process.env.SMS_PROVIDER ?? "africas_talking",
  // DB SSL strict mode
  dbSslStrict: (process.env.DB_SSL_STRICT ?? "false") === "true",
  // Server port
  port: parseInt(process.env.PORT ?? "3000", 10),

  // Gateway / verification engine
  // Default false in production — set GATEWAY_SANDBOX=true explicitly for sandbox/dev mode.
  // Lesson (1B payments): Never default to sandbox in production; fail loudly if real APIs are unreachable.
  gatewaySandbox: (process.env.GATEWAY_SANDBOX ?? "false") === "true",

  // Own Nigerian verification engine
  bisVerifyNimcUrl: process.env.BIS_VERIFY_NIMC_URL ?? "https://api.nimc.gov.ng/v1",
  bisVerifyNimcKey: process.env.BIS_VERIFY_NIMC_KEY ?? "",
  bisVerifyNibssUrl: process.env.BIS_VERIFY_NIBSS_URL ?? "https://api.nibss-plc.com.ng/v1",
  bisVerifyNibssKey: process.env.BIS_VERIFY_NIBSS_KEY ?? "",
  bisVerifyCacUrl: process.env.BIS_VERIFY_CAC_URL ?? "https://search.cac.gov.ng/api/v1",
  bisVerifyCacKey: process.env.BIS_VERIFY_CAC_KEY ?? "",

  // Youverify fallback
  youverifyApiKey: process.env.YOUVERIFY_API_KEY ?? "",
  youverifyBaseUrl: process.env.YOUVERIFY_BASE_URL ?? "https://api.youverify.co/v2",

  // Keycloak IDP
  keycloakUrl: process.env.KEYCLOAK_URL ?? "http://keycloak:8080",
  keycloakRealm: process.env.KEYCLOAK_REALM ?? "bis-platform",
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? "bis-platform",
  keycloakClientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",

  // Temporal workflow engine
  temporalHost: process.env.TEMPORAL_HOST ?? "temporal:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",

  // Redis cache / session store
  // Single-node: REDIS_URL=redis://host:6379
  // Sentinel HA: REDIS_SENTINELS=host1:26379,host2:26379 + REDIS_SENTINEL_NAME=mymaster
  redisUrl: process.env.REDIS_URL ?? "redis://redis:6379",
  redisSentinels: process.env.REDIS_SENTINELS ?? "",
  redisSentinelName: process.env.REDIS_SENTINEL_NAME ?? "mymaster",

  // Notifications
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",
  smtpHost: process.env.SMTP_HOST ?? "smtp.sendgrid.net",
  smtpPort: parseInt(process.env.SMTP_PORT ?? "587", 10),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  smtpFrom: process.env.SMTP_FROM ?? "noreply@bis-platform.com",
};

/**
 * Validate required environment variables on startup.
 * Logs a warning for missing optional vars; throws for truly required ones.
 */
export function validateEnv(): void {
  const required: Array<[string, string]> = [
    ["DATABASE_URL", ENV.databaseUrl],
    ["JWT_SECRET", ENV.cookieSecret],
  ];

  const optional: Array<[string, string, string]> = [
    ["BIS_VERIFY_NIMC_KEY", ENV.bisVerifyNimcKey, "NIN own-engine lookups will fall back to Youverify/sandbox"],
    ["BIS_VERIFY_NIBSS_KEY", ENV.bisVerifyNibssKey, "BVN own-engine lookups will fall back to Youverify/sandbox"],
    ["BIS_VERIFY_CAC_KEY", ENV.bisVerifyCacKey, "CAC own-engine lookups will fall back to Youverify/sandbox"],
    ["YOUVERIFY_API_KEY", ENV.youverifyApiKey, "Verification fallback disabled — sandbox mode only"],
    ["KEYCLOAK_CLIENT_SECRET", ENV.keycloakClientSecret, "Keycloak IDP page will show 'not configured'"],
    ["BIS_GATEWAY_KEY", ENV.bisGatewayKey, "Internal service-to-service auth uses insecure dev key"],
    ["BIS_AML_ENGINE_URL", ENV.bisAmlEngineUrl, "AML engine defaults to localhost:8095"],
    ["RISK_ENGINE_URL", ENV.riskEngineUrl, "Risk engine defaults to localhost:8082"],
    ["LAKEHOUSE_URL", ENV.lakehouseUrl, "Lakehouse writer defaults to localhost:8085"],
    ["OLLAMA_URL", ENV.ollamaUrl, "Ollama LLM defaults to localhost:11434"],
    ["SLACK_WEBHOOK_URL", ENV.slackWebhookUrl, "Slack deploy/alert notifications disabled"],
    ["SMTP_USER", ENV.smtpUser, "Email notifications disabled"],
    ["SMTP_PASS", ENV.smtpPass, "Email notifications disabled"],
  ];

  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`[BIS] Missing required environment variables: ${missing.join(", ")}`);
  }

  for (const [key, value, hint] of optional) {
    if (!value || value.endsWith("-default")) {
      console.warn(`[BIS] Optional env var ${key} not set — ${hint}`);
    }
  }

  if (ENV.gatewaySandbox) {
    console.info("[BIS] Gateway running in SANDBOX mode — synthetic verification data");
  } else {
    console.info("[BIS] Gateway running in LIVE mode — real Nigerian data APIs active");
  }
}
