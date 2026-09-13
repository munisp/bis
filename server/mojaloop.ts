/**
 * BIS — Mojaloop / NIBSS NIP Gateway Client
 *
 * Provides interbank transfer initiation and status polling via:
 *   1. Mojaloop (ISO 20022 / ILP-based) when MOJALOOP_HUB_URL is set
 *   2. NIBSS NIP gateway when NIBSS_NIP_URL is set
 *   3. Pending/manual mode when neither is configured (no fake completions)
 *
 * All amounts are in kobo (NGN × 100).
 */
import { ENV } from "./_core/env";
import { withCircuitBreaker } from "./circuitBreaker";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TransferRequest {
  txRef: string;
  originatorAccount: string;
  originatorName: string;
  beneficiaryAccount: string;
  beneficiaryName: string;
  beneficiaryBankCode: string;
  amountKobo: number;
  currency?: string;
  narration?: string;
}

export interface TransferResult {
  txRef: string;
  externalRef: string;
  status: "pending" | "completed" | "failed";
  mode: "mojaloop" | "nip";
  message?: string;
}

export type ActivePaymentRail = "mojaloop" | "nip";

/**
 * Resolve only a configured live payment rail. Payment initiation must not
 * synthesize a manual or sandbox result because callers could mistake that for
 * a submitted funds transfer.
 */
export function requireActivePaymentRail(): ActivePaymentRail {
  if (process.env.MOJALOOP_HUB_URL) return "mojaloop";
  if (process.env.NIBSS_NIP_URL && process.env.NIBSS_NIP_KEY) return "nip";
  throw new Error("No credentialed live payment rail is configured");
}

export interface TransferStatusResult {
  txRef: string;
  externalRef: string;
  status: "pending" | "completed" | "failed";
  completedAt?: string;
  failureReason?: string;
}

// ── Mojaloop client ──────────────────────────────────────────────────────────

async function mojaloopInitiate(req: TransferRequest): Promise<TransferResult> {
  const hubUrl = process.env.MOJALOOP_HUB_URL!;
  const dfspId = process.env.MOJALOOP_DFSP_ID ?? "bis-dfsp";

  const body = {
    transferId: req.txRef,
    payerFsp: dfspId,
    payeeFsp: req.beneficiaryBankCode,
    amount: {
      amount: (req.amountKobo / 100).toFixed(2),
      currency: req.currency ?? "NGN",
    },
    ilpPacket: "", // populated by Mojaloop hub
    condition: "", // populated by Mojaloop hub
    expiration: new Date(Date.now() + 30_000).toISOString(),
    extensionList: {
      extension: [
        { key: "originatorAccount", value: req.originatorAccount },
        { key: "beneficiaryAccount", value: req.beneficiaryAccount },
        { key: "narration", value: req.narration ?? "" },
      ],
    },
  };

  const resp = await fetch(`${hubUrl}/transfers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "FSPIOP-Source": dfspId,
      "FSPIOP-Destination": req.beneficiaryBankCode,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`Mojaloop transfer failed: ${resp.status} ${errBody}`);
  }

  const result = (await resp.json()) as { transferId: string; transferState: string };
  return {
    txRef: req.txRef,
    externalRef: result.transferId,
    status: result.transferState === "COMMITTED" ? "completed" : "pending",
    mode: "mojaloop",
  };
}

// ── NIBSS NIP client ─────────────────────────────────────────────────────────

async function nipInitiate(req: TransferRequest): Promise<TransferResult> {
  const nipUrl = process.env.NIBSS_NIP_URL!;
  const nipKey = process.env.NIBSS_NIP_KEY ?? "";

  const body = {
    SessionID: req.txRef,
    ChannelCode: "1",
    TargetBankCode: req.beneficiaryBankCode,
    CreditAccount: req.beneficiaryAccount,
    CreditAccountName: req.beneficiaryName,
    DebitAccount: req.originatorAccount,
    DebitAccountName: req.originatorName,
    TransactionLocation: "NG",
    Narration: req.narration ?? "BIS Transfer",
    Amount: (req.amountKobo / 100).toFixed(2),
    Currency: req.currency ?? "NGN",
  };

  const resp = await fetch(`${nipUrl}/FundsTransfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${nipKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`NIBSS NIP transfer failed: ${resp.status} ${errBody}`);
  }

  const result = (await resp.json()) as {
    SessionID: string;
    ResponseCode: string;
    ResponseMessage: string;
  };

  const success = result.ResponseCode === "00";
  return {
    txRef: req.txRef,
    externalRef: result.SessionID,
    status: success ? "completed" : "failed",
    mode: "nip",
    message: result.ResponseMessage,
  };
}

// ── Status polling ───────────────────────────────────────────────────────────

async function mojaloopStatus(txRef: string): Promise<TransferStatusResult> {
  const hubUrl = process.env.MOJALOOP_HUB_URL!;
  const dfspId = process.env.MOJALOOP_DFSP_ID ?? "bis-dfsp";

  const resp = await fetch(`${hubUrl}/transfers/${txRef}`, {
    headers: {
      Accept: "application/json",
      "FSPIOP-Source": dfspId,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) return { txRef, externalRef: txRef, status: "pending" };

  const result = (await resp.json()) as {
    transferId: string;
    transferState: string;
    completedTimestamp?: string;
  };

  return {
    txRef,
    externalRef: result.transferId,
    status: result.transferState === "COMMITTED" ? "completed" : "pending",
    completedAt: result.completedTimestamp,
  };
}

async function nipStatus(txRef: string): Promise<TransferStatusResult> {
  const nipUrl = process.env.NIBSS_NIP_URL!;
  const nipKey = process.env.NIBSS_NIP_KEY ?? "";

  const resp = await fetch(`${nipUrl}/TransactionStatus`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${nipKey}`,
    },
    body: JSON.stringify({ SessionID: txRef }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) return { txRef, externalRef: txRef, status: "pending" };

  const result = (await resp.json()) as {
    SessionID: string;
    ResponseCode: string;
    ResponseMessage: string;
  };

  return {
    txRef,
    externalRef: result.SessionID,
    status: result.ResponseCode === "00" ? "completed" : "failed",
    failureReason: result.ResponseCode !== "00" ? result.ResponseMessage : undefined,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initiate an interbank transfer through one configured live rail. Missing or
 * incomplete provider configuration is an explicit failure before any transfer
 * claim or external money-moving request is created.
 */
export async function initiateInterBankTransfer(req: TransferRequest): Promise<TransferResult> {
  const rail = requireActivePaymentRail();
  if (rail === "mojaloop") {
    return withCircuitBreaker("mojaloop", () => mojaloopInitiate(req));
  }
  return withCircuitBreaker("nip", () => nipInitiate(req));
}

/**
 * Poll the status of a previously initiated transfer.
 */
export async function pollTransferStatus(txRef: string): Promise<TransferStatusResult> {
  const rail = requireActivePaymentRail();
  if (rail === "mojaloop") return mojaloopStatus(txRef);
  return nipStatus(txRef);
}

/** Resolve the configured live rail for display and durable transfer metadata. */
export function getActiveRail(): ActivePaymentRail {
  return requireActivePaymentRail();
}
