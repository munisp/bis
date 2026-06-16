/**
 * BIS — Mojaloop / NIBSS NIP Gateway Client
 *
 * Provides interbank transfer initiation and status polling via:
 *   1. Mojaloop (ISO 20022 / ILP-based) when MOJALOOP_HUB_URL is set
 *   2. NIBSS NIP gateway when NIBSS_NIP_URL is set
 *   3. Deterministic sandbox fallback when neither is configured
 *
 * All amounts are in kobo (NGN × 100).
 */
import { ENV } from "./_core/env";

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
  mode: "mojaloop" | "nip" | "sandbox";
  message?: string;
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

// ── Sandbox fallback ─────────────────────────────────────────────────────────

function sandboxInitiate(req: TransferRequest): TransferResult {
  // Deterministic sandbox: always succeeds, external ref is predictable
  const externalRef = `SANDBOX-${req.txRef}-${Date.now()}`;
  return {
    txRef: req.txRef,
    externalRef,
    status: "completed",
    mode: "sandbox",
    message: "Sandbox transfer — no real funds moved",
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
 * Initiate an interbank transfer.
 * Routes to Mojaloop → NIBSS NIP → Sandbox based on available env vars.
 */
export async function initiateInterBankTransfer(req: TransferRequest): Promise<TransferResult> {
  if (process.env.MOJALOOP_HUB_URL) {
    return mojaloopInitiate(req);
  }
  if (process.env.NIBSS_NIP_URL) {
    return nipInitiate(req);
  }
  // Sandbox fallback
  return sandboxInitiate(req);
}

/**
 * Poll the status of a previously initiated transfer.
 */
export async function pollTransferStatus(txRef: string): Promise<TransferStatusResult> {
  if (process.env.MOJALOOP_HUB_URL) {
    return mojaloopStatus(txRef);
  }
  if (process.env.NIBSS_NIP_URL) {
    return nipStatus(txRef);
  }
  // Sandbox: always completed
  return { txRef, externalRef: `SANDBOX-${txRef}`, status: "completed" };
}

/**
 * Determine which payment rail is active.
 */
export function getActiveRail(): "mojaloop" | "nip" | "sandbox" {
  if (process.env.MOJALOOP_HUB_URL) return "mojaloop";
  if (process.env.NIBSS_NIP_URL) return "nip";
  return "sandbox";
}
