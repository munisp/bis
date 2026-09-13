/**
 * WP6 FIX B — Temporal contract test.
 *
 * Loads server/temporal.manifest.json (the committed both-sides contract
 * between the TypeScript client and the Go workers) and asserts:
 *
 *   1. Every client-invoked workflow has a registered worker handler on the
 *      SAME task queue, unless it is explicitly guarded fail-closed.
 *   2. The wire input fields the client sends are accepted by the worker's
 *      input struct, and every required (non-omitempty) worker field is sent.
 *   3. Guarded starters really throw a typed TemporalWorkflowUnavailableError
 *      (behavioral check, not just manifest bookkeeping).
 *   4. Client-used status/cancel endpoints have real gateway handlers.
 *   5. One namespace ("bis") everywhere; no duplicate workflow registrations.
 *
 * Optional worker fields below mirror the `omitempty` JSON tags in the Go
 * structs (services/gateway/temporal/*.go,
 * services/compliance-worker/internal/workflows/compliance.go).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  TemporalWorkflowUnavailableError,
  startPaymentTransferWorkflow,
  startAmlWorkflow,
  startCaseEscalationWorkflow,
  startAccessReviewWorkflow,
} from "./temporal";

interface Invocation {
  kind: string;
  name: string;
  taskQueue?: string;
  endpoint?: string;
  guarded?: boolean;
  inputFields: string[];
}
interface Registration {
  kind: string;
  name: string;
  taskQueue?: string;
  namespace?: string;
  endpoint?: string;
  inputFields?: string[];
}
interface Manifest {
  namespace: string;
  wireConvention: { casing: string };
  clientInvocations: Invocation[];
  workerRegistrations: Registration[];
}

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "temporal.manifest.json"), "utf8"),
) as Manifest;

/** Go fields tagged `json:"...,omitempty"` — optional on the wire. */
const OPTIONAL_WORKER_FIELDS: Record<string, string[]> = {
  InvestigationWorkflow: ["nin", "bvn", "rc_number"],
  ScreeningWorkflow: ["nin", "bvn", "date_of_birth", "state_of_origin"],
};

const workflowInvocations = manifest.clientInvocations.filter((c) => c.kind === "workflow");
const workflowWorkers = manifest.workerRegistrations.filter((r) => r.kind === "workflow");

describe("temporal contract — manifest integrity", () => {
  it("uses exactly one namespace everywhere", () => {
    expect(manifest.namespace).toBe("bis");
    for (const reg of workflowWorkers) {
      expect(reg.namespace, `${reg.name} namespace`).toBe("bis");
    }
  });

  it("has no duplicate workflow registrations", () => {
    const names = workflowWorkers.map((w) => w.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("declares camelCase as the wire convention", () => {
    expect(manifest.wireConvention.casing).toBe("camelCase");
  });
});

describe("temporal contract — client invocations vs worker registrations", () => {
  for (const inv of workflowInvocations) {
    it(`${inv.name}: contract is satisfied`, () => {
      const worker = workflowWorkers.find((w) => w.name === inv.name);

      if (inv.guarded) {
        // Guarded fail-closed starters must NOT have a registered handler —
        // otherwise the guard is stale and must be removed.
        expect(
          worker,
          `guarded workflow ${inv.name} unexpectedly has a registered worker; remove the guard`,
        ).toBeUndefined();
        return;
      }

      expect(worker, `no worker registers ${inv.name}`).toBeDefined();
      expect(
        worker!.taskQueue,
        `${inv.name}: client targets queue ${inv.taskQueue} but worker listens on ${worker!.taskQueue}`,
      ).toBe(inv.taskQueue);

      const clientFields = new Set(inv.inputFields);
      const workerFields = new Set(worker!.inputFields ?? []);
      const optional = new Set(OPTIONAL_WORKER_FIELDS[inv.name] ?? []);

      // The client must not send fields the worker struct cannot decode.
      for (const field of clientFields) {
        expect(
          workerFields.has(field),
          `${inv.name}: client sends unknown field '${field}'`,
        ).toBe(true);
      }
      // Every required (non-omitempty) worker field must be sent by the client.
      for (const field of workerFields) {
        if (optional.has(field)) continue;
        expect(
          clientFields.has(field),
          `${inv.name}: client does not send required worker field '${field}'`,
        ).toBe(true);
      }
    });
  }

  it("every registered worker workflow is either client-invoked or gateway-internal", () => {
    // Gateway-internal workflows are started by the gateway itself
    // (criminal_records.go, mojaloop_compliance.go), not by the Node client.
    const gatewayInternal = new Set(["CriminalRecordsWorkflow", "CorporateCheckWorkflow", "FieldVisitWorkflow"]);
    const invoked = new Set(workflowInvocations.map((i) => i.name));
    for (const w of workflowWorkers) {
      expect(
        invoked.has(w.name) || gatewayInternal.has(w.name),
        `registered workflow ${w.name} is unreachable`,
      ).toBe(true);
    }
  });
});

describe("temporal contract — status/cancel endpoints", () => {
  for (const inv of manifest.clientInvocations.filter((c) => c.kind === "query" || c.kind === "signal")) {
    it(`${inv.kind} ${inv.name} has a real gateway handler`, () => {
      const handler = manifest.workerRegistrations.find(
        (r) => r.kind === "httpHandler" && r.endpoint === inv.endpoint,
      );
      expect(handler, `no gateway handler for ${inv.endpoint}`).toBeDefined();
    });
  }
});

describe("temporal contract — guarded starters fail closed (behavioral)", () => {
  const guardedCases: Array<[string, () => Promise<unknown>]> = [
    ["PaymentTransferWorkflow", () => startPaymentTransferWorkflow({
      txRef: "TXN-CONTRACT", transactionId: 1, originatorAccountId: "A", beneficiaryAccountId: "B",
      beneficiaryName: "B", beneficiaryBankCode: "000", amountKobo: 1, currency: "NGN", rail: "nip",
    })],
    ["AMLWorkflow", () => startAmlWorkflow({
      investigationRef: "AML-CONTRACT", subjectName: "X", subjectType: "individual", triggerReason: "test",
    })],
    ["CaseEscalationWorkflow", () => startCaseEscalationWorkflow({
      caseRef: "CASE-CONTRACT", caseId: 1, priority: "high", escalationReason: "test", escalatedBy: 1,
    })],
    ["AccessReviewWorkflow", () => startAccessReviewWorkflow({
      reviewId: 1, reviewRef: "AR-CONTRACT", userId: 1, reviewType: "auto_escalation",
    })],
  ];

  for (const [name, call] of guardedCases) {
    it(`${name} starter throws TemporalWorkflowUnavailableError`, async () => {
      const error = await call().then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(TemporalWorkflowUnavailableError);
      expect((error as TemporalWorkflowUnavailableError).code).toBe("TEMPORAL_WORKFLOW_UNAVAILABLE");
      expect((error as TemporalWorkflowUnavailableError).workflowType).toBe(name);
    });
  }
});
