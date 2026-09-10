#!/usr/bin/env node
/** Validates the portable on-premises MinIO/KES/Vault profile without network access. */
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const CONFIRMATION = "I_APPROVE_ISOLATED_ONPREM_PROFILE_VALIDATION";
const REQUIRED = [
  "BIS_ONPREM_CONFIG_DIR",
  "BIS_ONPREM_PKI_DIR",
  "BIS_EVIDENCE_S3_ENDPOINT",
  "BIS_EVIDENCE_S3_REGION",
  "BIS_EVIDENCE_S3_BUCKET",
  "BIS_EVIDENCE_S3_KMS_KEY_ID",
  "BIS_EVIDENCE_ACTIVE_KEY_VERSION",
  "BIS_EVIDENCE_KEYRING",
  "PERMIFY_URL",
  "PERMIFY_TENANT_ID",
  "PERMIFY_API_KEY",
  "KES_ROOT_IDENTITY",
  "MINIO_KES_IDENTITY",
  "VAULT_KES_ROLE_ID",
  "VAULT_KES_SECRET_ID",
  "MINIO_KES_API_KEY",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("<REQUIRED_") || value.includes("REPLACE_WITH")) throw new Error(`${name} is required and may not contain a template marker`);
  return value;
}

async function content(path) {
  await access(path);
  return readFile(path, "utf8");
}

async function main() {
  if (required("BIS_ENV") !== "staging") throw new Error("BIS_ENV must be staging; production validation is prohibited");
  if (required("BIS_ONPREM_VALIDATION_CONFIRMATION") !== CONFIRMATION) throw new Error("explicit isolated-profile validation confirmation is required");
  for (const name of REQUIRED) required(name);

  const s3Endpoint = new URL(process.env.BIS_EVIDENCE_S3_ENDPOINT);
  const permifyEndpoint = new URL(process.env.PERMIFY_URL);
  if (s3Endpoint.protocol !== "https:" || permifyEndpoint.protocol !== "https:") throw new Error("object storage and Permify endpoints must use HTTPS");
  if ((process.env.BIS_EVIDENCE_S3_SSE_ALGORITHM ?? "aws:kms").trim() !== "aws:kms") throw new Error("BIS_EVIDENCE_S3_SSE_ALGORITHM must be aws:kms");
  if ((process.env.BIS_EVIDENCE_S3_FORCE_PATH_STYLE ?? "true").trim() !== "true") throw new Error("on-premises MinIO profile requires BIS_EVIDENCE_S3_FORCE_PATH_STYLE=true");

  const accessKey = (process.env.BIS_EVIDENCE_S3_ACCESS_KEY ?? "").trim();
  const secretKey = (process.env.BIS_EVIDENCE_S3_SECRET_KEY ?? "").trim();
  if (Boolean(accessKey) !== Boolean(secretKey)) throw new Error("S3 static credentials must be both present or both absent for workload identity");

  const configDir = resolve(process.env.BIS_ONPREM_CONFIG_DIR);
  const [vault, kes, policy] = await Promise.all([
    content(join(configDir, "vault.hcl")),
    content(join(configDir, "kes.yaml")),
    content(join(configDir, "vault-kes-policy.hcl")),
  ]);
  if (/\b-dev\b|inmem/i.test(vault)) throw new Error("Vault development or in-memory storage configuration is prohibited");
  if (!vault.includes('storage "raft"') || !vault.includes("tls_require_and_verify_client_cert")) throw new Error("Vault must use Raft storage and client-verified TLS");
  if (!kes.includes("https://vault:8200") || !kes.includes("offline: 0s") || !kes.includes("/v1/key/generate/bis-evidence-*")) throw new Error("KES must use TLS Vault access, no offline-key use, and a restricted evidence-key namespace");
  if (!policy.includes('path "kv/data/bis/staging/kes/*"')) throw new Error("Vault KES policy must restrict K/V v2 access to the staging evidence namespace");

  process.stdout.write("PASS isolated on-premises S3-compatible/KMS profile validation completed without network I/O\n");
}

main().catch((error) => {
  process.stderr.write(`FAIL isolated on-premises S3-compatible/KMS profile validation: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
