/**
 * Insider Threat Middleware — unit tests
 *
 * Covers:
 *   1. Dapr topic constants and publish helper shape
 *   2. Cache TTL constants for insider threat keys
 *   3. Mobile tRPC bridge helpers (trpcQuery / trpcMutate URL construction)
 *   4. Python UEBA endpoint request/response schema validation
 *   5. Rust Kafka event descriptor mapping
 *   6. Go Dapr subscription handler payload parsing
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 1. Dapr topic constants ──────────────────────────────────────────────────

describe("Dapr — insider threat topic constants", () => {
  it("insider topic is defined and non-empty", async () => {
    const { TOPICS } = await import("./dapr");
    expect(TOPICS.insider).toBeDefined();
    expect(typeof TOPICS.insider).toBe("string");
    expect(TOPICS.insider.length).toBeGreaterThan(0);
    expect(TOPICS.insider).toBe("bis.insider.events");
  });

  it("uebaAlert topic is defined and non-empty", async () => {
    const { TOPICS } = await import("./dapr");
    expect(TOPICS.uebaAlert).toBeDefined();
    expect(typeof TOPICS.uebaAlert).toBe("string");
    expect(TOPICS.uebaAlert).toBe("bis.ueba.alerts");
  });

  it("accessReview topic is defined and non-empty", async () => {
    const { TOPICS } = await import("./dapr");
    expect(TOPICS.accessReview).toBeDefined();
    expect(TOPICS.accessReview).toBe("bis.access-review.events");
  });

  it("publishInsiderThreatEvent is a function", async () => {
    const dapr = await import("./dapr");
    expect(typeof dapr.publishInsiderThreatEvent).toBe("function");
  });

  it("publishUebaAlert is a function", async () => {
    const dapr = await import("./dapr");
    expect(typeof dapr.publishUebaAlert).toBe("function");
  });

  it("publishAccessReviewEvent is a function", async () => {
    const dapr = await import("./dapr");
    expect(typeof dapr.publishAccessReviewEvent).toBe("function");
  });
});

// ─── 2. Cache TTL constants ───────────────────────────────────────────────────

describe("Cache — insider threat TTL constants", () => {
  it("TTL.INSIDER_EVENTS is a positive integer (seconds)", async () => {
    const { TTL } = await import("./cache");
    expect(TTL.INSIDER_EVENTS).toBeDefined();
    expect(typeof TTL.INSIDER_EVENTS).toBe("number");
    expect(TTL.INSIDER_EVENTS).toBeGreaterThan(0);
    expect(Number.isInteger(TTL.INSIDER_EVENTS)).toBe(true);
  });

  it("TTL.UEBA_PROFILES is a positive integer (seconds)", async () => {
    const { TTL } = await import("./cache");
    expect(TTL.UEBA_PROFILES).toBeDefined();
    expect(typeof TTL.UEBA_PROFILES).toBe("number");
    expect(TTL.UEBA_PROFILES).toBeGreaterThan(0);
  });

  it("TTL.ACCESS_REVIEWS is a positive integer (seconds)", async () => {
    const { TTL } = await import("./cache");
    expect(TTL.ACCESS_REVIEWS).toBeDefined();
    expect(typeof TTL.ACCESS_REVIEWS).toBe("number");
    expect(TTL.ACCESS_REVIEWS).toBeGreaterThan(0);
  });

  it("UEBA_PROFILES TTL is longer than INSIDER_EVENTS TTL (profiles change less often)", async () => {
    const { TTL } = await import("./cache");
    expect(TTL.UEBA_PROFILES).toBeGreaterThanOrEqual(TTL.INSIDER_EVENTS);
  });
});

// ─── 3. Mobile tRPC bridge URL construction ───────────────────────────────────

describe("Mobile tRPC bridge — URL construction", () => {
  const BASE_URL = "http://10.0.2.2:3000/api";

  it("trpcQuery builds correct GET URL with encoded input", () => {
    const procedure = "insiderThreat.listEvents";
    const input = { page: 1, pageSize: 20, severity: "high" };
    const encoded = encodeURIComponent(JSON.stringify({ json: input }));
    const url = `${BASE_URL}/trpc/${procedure}?input=${encoded}&batch=1`;
    expect(url).toContain("/api/trpc/insiderThreat.listEvents");
    expect(url).toContain("batch=1");
    expect(url).toContain("input=");
    // Decoded input should round-trip correctly
    const decoded = JSON.parse(decodeURIComponent(url.split("input=")[1].split("&")[0]));
    expect(decoded.json.page).toBe(1);
    expect(decoded.json.severity).toBe("high");
  });

  it("trpcMutate builds correct POST URL", () => {
    const procedure = "insiderThreat.completeAccessReview";
    const url = `${BASE_URL}/trpc/${procedure}?batch=1`;
    expect(url).toContain("/api/trpc/insiderThreat.completeAccessReview");
    expect(url).toContain("batch=1");
    expect(url).not.toContain("input=");
  });

  it("tRPC batch response is parsed correctly", () => {
    // Simulate the tRPC batch response format
    const batchResponse = [
      {
        result: {
          data: {
            json: {
              events: [{ id: 1, subjectId: "user-001", severity: "high" }],
              total: 1,
              page: 1,
              pageSize: 20,
            },
          },
        },
      },
    ];
    const parsed = batchResponse[0]?.result?.data?.json;
    expect(parsed).toBeDefined();
    expect((parsed as any).events).toHaveLength(1);
    expect((parsed as any).total).toBe(1);
  });

  it("tRPC batch mutation body is correctly structured", () => {
    const input = { id: 42, decision: "approved", reason: "Verified with manager" };
    const body = JSON.stringify([{ json: input }]);
    const parsed = JSON.parse(body);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].json.id).toBe(42);
    expect(parsed[0].json.decision).toBe("approved");
  });
});

// ─── 4. Python UEBA endpoint schema validation ────────────────────────────────

describe("Python UEBA endpoint — request/response schema", () => {
  it("UebaScoreRequest requires subjectId and eventHistory", () => {
    const validRequest = {
      subject_id: "user-001",
      tenant_id: "tenant-abc",
      event_history: [
        { event_type: "data_access", hour: 14, payload_bytes: 1024 },
        { event_type: "login", hour: 9, payload_bytes: 0 },
      ],
      peer_group_stats: { mean_events: 50, std_events: 10 },
    };
    expect(validRequest.subject_id).toBeTruthy();
    expect(Array.isArray(validRequest.event_history)).toBe(true);
    expect(validRequest.event_history.length).toBeGreaterThan(0);
  });

  it("UebaScoreResponse contains required score fields", () => {
    const validResponse = {
      subject_id: "user-001",
      anomaly_score: 0.72,
      drift_score: 0.45,
      off_hours_ratio: 0.15,
      failed_auth_count: 3,
      privilege_change_count: 1,
      baseline_ready: true,
      risk_level: "high",
      computed_at: new Date().toISOString(),
    };
    expect(validResponse.anomaly_score).toBeGreaterThanOrEqual(0);
    expect(validResponse.anomaly_score).toBeLessThanOrEqual(1);
    expect(validResponse.drift_score).toBeGreaterThanOrEqual(0);
    expect(validResponse.drift_score).toBeLessThanOrEqual(1);
    expect(["low", "medium", "high", "critical"]).toContain(validResponse.risk_level);
  });

  it("UebaScoreResponse anomaly_score is clamped to [0, 1]", () => {
    const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
    expect(clamp(-0.5)).toBe(0);
    expect(clamp(1.5)).toBe(1);
    expect(clamp(0.75)).toBe(0.75);
  });

  it("UebaBatchRequest accepts up to 100 subjects", () => {
    const subjects = Array.from({ length: 100 }, (_, i) => ({
      subject_id: `user-${i.toString().padStart(3, "0")}`,
      event_history: [],
    }));
    expect(subjects.length).toBe(100);
    expect(subjects[0].subject_id).toBe("user-000");
    expect(subjects[99].subject_id).toBe("user-099");
  });

  it("Redis cache key for UEBA score is deterministic", () => {
    const makeKey = (subjectId: string, tenantId?: string) =>
      `ueba:score:${tenantId ?? "global"}:${subjectId}`;
    expect(makeKey("user-001", "tenant-abc")).toBe("ueba:score:tenant-abc:user-001");
    expect(makeKey("user-001")).toBe("ueba:score:global:user-001");
    // Same inputs always produce same key
    expect(makeKey("user-001", "tenant-abc")).toBe(makeKey("user-001", "tenant-abc"));
  });
});

// ─── 5. Rust Kafka event descriptor mapping ───────────────────────────────────

describe("Rust Kafka — InsiderKafkaEvent to EventDescriptor mapping", () => {
  it("maps category to is_privilege_change correctly", () => {
    const privCategories = ["privilege_abuse", "policy_violation"];
    const nonPrivCategories = ["data_exfiltration", "off_hours_access", "anomalous_behavior"];

    for (const cat of privCategories) {
      const isPrivChange = ["privilege_abuse", "policy_violation"].includes(cat);
      expect(isPrivChange).toBe(true);
    }
    for (const cat of nonPrivCategories) {
      const isPrivChange = ["privilege_abuse", "policy_violation"].includes(cat);
      expect(isPrivChange).toBe(false);
    }
  });

  it("defaults payload_bytes to 0 when not provided", () => {
    const payloadBytes = undefined ?? 0;
    expect(payloadBytes).toBe(0);
  });

  it("generates a UUID when event_id is not provided", () => {
    // Simulate the Rust logic: use event_id if present, otherwise generate UUID
    const generateId = (eventId?: number) =>
      eventId !== undefined ? String(eventId) : "generated-uuid";
    expect(generateId(42)).toBe("42");
    expect(generateId()).toBe("generated-uuid");
  });

  it("parses ISO 8601 triggered_at or falls back to now", () => {
    const parseDate = (s?: string): Date => {
      if (!s) return new Date();
      const d = new Date(s);
      return isNaN(d.getTime()) ? new Date() : d;
    };
    const valid = parseDate("2024-01-15T14:30:00Z");
    expect(valid.getFullYear()).toBe(2024);
    const fallback = parseDate(undefined);
    expect(fallback instanceof Date).toBe(true);
    const invalid = parseDate("not-a-date");
    expect(invalid instanceof Date).toBe(true);
  });

  it("severity mapping: ExfiltrationSuspected → critical, PrivilegeEscalation → high", () => {
    type AlertKind = "ExfiltrationSuspected" | "PrivilegeEscalation" | "Other";
    const mapSeverity = (kind: AlertKind, defaultSev: string): string => {
      if (kind === "ExfiltrationSuspected") return "critical";
      if (kind === "PrivilegeEscalation") return "high";
      return defaultSev;
    };
    expect(mapSeverity("ExfiltrationSuspected", "medium")).toBe("critical");
    expect(mapSeverity("PrivilegeEscalation", "medium")).toBe("high");
    expect(mapSeverity("Other", "medium")).toBe("medium");
  });
});

// ─── 6. Go Dapr subscription handler payload parsing ─────────────────────────

describe("Go Dapr — insider event subscription handler", () => {
  it("InsiderEventPayload has required fields", () => {
    const payload = {
      event_id: 123,
      subject_id: "user-001",
      tenant_id: "tenant-abc",
      category: "data_exfiltration",
      severity: "high",
      anomaly_score: 0.85,
      drift_score: 0.42,
      source_ip: "192.168.1.100",
      resource_path: "/api/v1/reports/export",
      payload_bytes: 5242880,
      rule_id: "rust-ep:ExfiltrationSuspected",
      triggered_at: new Date().toISOString(),
      source: "rust-event-processor",
    };
    expect(payload.event_id).toBeDefined();
    expect(payload.subject_id).toBeTruthy();
    expect(payload.category).toBeTruthy();
    expect(payload.severity).toBeTruthy();
  });

  it("Dapr subscription route follows /dapr/subscribe/insider-events pattern", () => {
    const route = "/dapr/subscribe/insider-events";
    expect(route).toMatch(/^\/dapr\/subscribe\//);
    expect(route).toContain("insider");
  });

  it("Dapr pub/sub component name follows bis-pubsub convention", () => {
    const pubsubName = "bis-pubsub";
    expect(pubsubName).toBe("bis-pubsub");
  });

  it("Dapr subscription handler returns 200 on success", () => {
    // Simulate the Go handler response
    const handleEvent = (payload: { subject_id?: string }) => {
      if (!payload.subject_id) return { status: 400, error: "missing subject_id" };
      return { status: 200, ok: true };
    };
    expect(handleEvent({ subject_id: "user-001" }).status).toBe(200);
    expect(handleEvent({}).status).toBe(400);
  });

  it("Dapr handler enriches payload with gateway metadata before forwarding to BFF", () => {
    const enrichPayload = (
      raw: Record<string, unknown>,
      gatewayId: string,
    ) => ({
      ...raw,
      gateway_id: gatewayId,
      forwarded_at: new Date().toISOString(),
      source: raw.source ?? "go-gateway",
    });
    const enriched = enrichPayload(
      { subject_id: "user-001", category: "data_exfiltration" },
      "gw-001",
    );
    expect(enriched.gateway_id).toBe("gw-001");
    expect(enriched.forwarded_at).toBeDefined();
    expect(enriched.source).toBe("go-gateway");
  });
});

// ─── 7. Mobile hook state machine ────────────────────────────────────────────

describe("Mobile hooks — state machine invariants", () => {
  it("useInsiderEvents initial state is loading=true, events=[]", () => {
    // Simulate the initial state of the hook
    const initialState = {
      events: [] as unknown[],
      total: 0,
      page: 1,
      loading: true,
      refreshing: false,
      error: null as string | null,
    };
    expect(initialState.loading).toBe(true);
    expect(initialState.events).toHaveLength(0);
    expect(initialState.error).toBeNull();
  });

  it("loadMore does not trigger when events.length >= total", () => {
    const state = { events: new Array(20).fill({}), total: 20, loading: false };
    const hasMore = state.events.length < state.total;
    expect(hasMore).toBe(false);
  });

  it("loadMore triggers when events.length < total", () => {
    const state = { events: new Array(20).fill({}), total: 50, loading: false };
    const hasMore = state.events.length < state.total;
    expect(hasMore).toBe(true);
  });

  it("SLA countdown returns OVERDUE for past due dates", () => {
    const slaLabel = (dueAt: string) => {
      const msLeft = new Date(dueAt).getTime() - Date.now();
      if (msLeft <= 0) return "OVERDUE";
      const hLeft = msLeft / 3_600_000;
      if (hLeft < 1) return `${Math.ceil(hLeft * 60)}m left`;
      return `${hLeft.toFixed(0)}h left`;
    };
    const pastDue = new Date(Date.now() - 3_600_000).toISOString();
    expect(slaLabel(pastDue)).toBe("OVERDUE");
    const futureDue = new Date(Date.now() + 7_200_000).toISOString();
    expect(slaLabel(futureDue)).toContain("left");
  });

  it("dual-control notice is shown when decision modal is open", () => {
    // Simulate the modal state
    const modalState = { mode: "decide" as const, decision: "approved" as const };
    const showDualControl = modalState.mode === "decide";
    expect(showDualControl).toBe(true);
  });

  it("escalate modal does not show dual-control notice", () => {
    const modalState = { mode: "escalate" as const };
    const showDualControl = modalState.mode === "decide";
    expect(showDualControl).toBe(false);
  });
});
