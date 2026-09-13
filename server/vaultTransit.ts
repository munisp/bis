import { TRPCError } from "@trpc/server";

type VaultFetch = typeof fetch;

export type VaultTransitConfig = {
  address: URL;
  token: string;
  mount: string;
  namespace?: string;
  timeoutMs: number;
};

export type VaultTransitKeyMetadata = {
  name: string;
  type: string;
  derived: boolean;
  exportable: boolean;
  allowPlaintextBackup: boolean;
  latestVersion: number;
  minDecryptionVersion: number;
  supportsEncryption: boolean;
  supportsDecryption: boolean;
  supportsDerivation: boolean;
};

const KEY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MOUNT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const TRANSIT_CIPHERTEXT = /^vault:v([1-9][0-9]*):[A-Za-z0-9+/=]+$/;

function unavailable(message: string): never {
  throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message });
}

function validateConfig(source: NodeJS.ProcessEnv = process.env): VaultTransitConfig {
  if ((source.BIS_PII_CRYPTO_PROVIDER ?? "").trim() !== "vault_transit") {
    unavailable("PII cryptography is unavailable because BIS_PII_CRYPTO_PROVIDER is not vault_transit.");
  }
  const addressRaw = (source.BIS_VAULT_TRANSIT_ADDR ?? "").trim();
  const token = (source.BIS_VAULT_TRANSIT_TOKEN ?? "").trim();
  const mount = (source.BIS_VAULT_TRANSIT_MOUNT ?? "").trim().replace(/^\/+|\/+$/g, "");
  const namespace = (source.BIS_VAULT_TRANSIT_NAMESPACE ?? "").trim() || undefined;
  const timeoutRaw = (source.BIS_VAULT_TRANSIT_TIMEOUT_MS ?? "5000").trim();
  if (!addressRaw || !token || !mount) unavailable("Vault Transit address, token, and mount are required for PII cryptography.");
  if (!MOUNT_NAME.test(mount) || mount.includes("..")) unavailable("Vault Transit mount is invalid.");
  let address: URL;
  try { address = new URL(addressRaw); } catch { unavailable("Vault Transit address is invalid."); }
  if (address.protocol !== "https:" && !(address.protocol === "http:" && source.NODE_ENV !== "production" && source.BIS_VAULT_TRANSIT_ALLOW_INSECURE_HTTP === "true")) {
    unavailable("Vault Transit must use HTTPS outside explicitly approved non-production testing.");
  }
  if (address.username || address.password || address.search || address.hash) unavailable("Vault Transit address must not include credentials, query parameters, or fragments.");
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) unavailable("Vault Transit timeout must be an integer between 250 and 30000 milliseconds.");
  return { address, token, mount, namespace, timeoutMs };
}

export function parseVaultTransitRef(reference: string, expectedMount: string): { mount: string; keyName: string } {
  let parsed: URL;
  try { parsed = new URL(reference); } catch { unavailable("PII key registry external_key_ref must be a Vault Transit reference."); }
  if (parsed.protocol !== "vault-transit:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    unavailable("PII key registry external_key_ref must use vault-transit://<mount>/<key-name>.");
  }
  const mount = parsed.hostname;
  const keyName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!MOUNT_NAME.test(mount) || !KEY_NAME.test(keyName) || mount !== expectedMount) {
    unavailable("PII key registry Transit mount or key name is not authorized by runtime configuration.");
  }
  return { mount, keyName };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) unavailable("Vault Transit returned an invalid response.");
  return value as Record<string, unknown>;
}

function providerVersion(ciphertext: string): number {
  const matched = TRANSIT_CIPHERTEXT.exec(ciphertext);
  if (!matched) unavailable("Vault Transit returned malformed ciphertext.");
  return Number(matched[1]);
}

export class VaultTransitClient {
  private readonly config: VaultTransitConfig;
  private readonly requestFetch: VaultFetch;

  get mount(): string { return this.config.mount; }

  constructor(config: VaultTransitConfig = validateConfig(), requestFetch: VaultFetch = fetch) {
    this.config = config;
    this.requestFetch = requestFetch;
  }

  private endpoint(path: string): URL {
    const normalized = path.replace(/^\/+/, "");
    if (normalized.includes("..")) unavailable("Vault Transit request path is invalid.");
    const basePath = this.config.address.pathname.replace(/\/$/, "");
    return new URL(`${basePath}/v1/${this.config.mount}/${normalized}`, this.config.address);
  }

  private async request(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.requestFetch(this.endpoint(path), {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Vault-Token": this.config.token,
          ...(this.config.namespace ? { "X-Vault-Namespace": this.config.namespace } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      let parsed: unknown;
      try { parsed = await response.json(); } catch { unavailable("Vault Transit returned a non-JSON response."); }
      const root = requireObject(parsed);
      if (!response.ok || !root.data) unavailable("Vault Transit cryptographic operation was rejected or unavailable.");
      return requireObject(root.data);
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      unavailable("Vault Transit cryptographic operation was unavailable.");
    } finally {
      clearTimeout(timer);
    }
  }

  async readKey(keyName: string): Promise<VaultTransitKeyMetadata> {
    if (!KEY_NAME.test(keyName)) unavailable("Vault Transit key name is invalid.");
    const data = await this.request("GET", `keys/${encodeURIComponent(keyName)}`);
    const type = typeof data.type === "string" ? data.type : "";
    const name = typeof data.name === "string" ? data.name : "";
    const latestVersion = typeof data.latest_version === "number" ? data.latest_version : 0;
    const minDecryptionVersion = typeof data.min_decryption_version === "number" ? data.min_decryption_version : 0;
    if (!name || !type || !Number.isInteger(latestVersion) || latestVersion < 1) unavailable("Vault Transit key metadata is invalid.");
    return {
      name,
      type,
      derived: data.derived === true,
      exportable: data.exportable === true,
      allowPlaintextBackup: data.allow_plaintext_backup === true,
      latestVersion,
      minDecryptionVersion,
      supportsEncryption: data.supports_encryption === true,
      supportsDecryption: data.supports_decryption === true,
      supportsDerivation: data.supports_derivation === true,
    };
  }

  async assertDerivedAes256Gcm(keyName: string): Promise<VaultTransitKeyMetadata> {
    const metadata = await this.readKey(keyName);
    if (metadata.name !== keyName || metadata.type !== "aes256-gcm96" || !metadata.derived || metadata.exportable || metadata.allowPlaintextBackup || !metadata.supportsEncryption || !metadata.supportsDecryption || !metadata.supportsDerivation) {
      unavailable("Vault Transit PII key must be non-exportable derived aes256-gcm96 with encryption and decryption enabled.");
    }
    return metadata;
  }

  async assertDerivedHmac(keyName: string): Promise<VaultTransitKeyMetadata> {
    const metadata = await this.readKey(keyName);
    if (metadata.name !== keyName || metadata.type !== "hmac" || !metadata.derived || metadata.exportable || metadata.allowPlaintextBackup || !metadata.supportsDerivation) {
      unavailable("Vault Transit blind-index key must be non-exportable derived HMAC with derivation enabled.");
    }
    return metadata;
  }

  async encrypt(keyName: string, context: string, plaintext: Buffer): Promise<{ ciphertext: string; keyVersion: number }> {
    if (!KEY_NAME.test(keyName) || !context || !plaintext.length) unavailable("Vault Transit encryption input is invalid.");
    const data = await this.request("POST", `encrypt/${encodeURIComponent(keyName)}`, { plaintext: plaintext.toString("base64"), context: Buffer.from(context, "utf8").toString("base64") });
    const ciphertext = typeof data.ciphertext === "string" ? data.ciphertext : "";
    const keyVersion = typeof data.key_version === "number" ? data.key_version : providerVersion(ciphertext);
    if (!TRANSIT_CIPHERTEXT.test(ciphertext) || !Number.isInteger(keyVersion) || keyVersion < 1 || providerVersion(ciphertext) !== keyVersion) unavailable("Vault Transit encryption response is invalid.");
    return { ciphertext, keyVersion };
  }

  async decrypt(keyName: string, context: string, ciphertext: string): Promise<Buffer> {
    if (!KEY_NAME.test(keyName) || !context || !TRANSIT_CIPHERTEXT.test(ciphertext)) unavailable("Vault Transit decryption input is invalid.");
    const data = await this.request("POST", `decrypt/${encodeURIComponent(keyName)}`, { ciphertext, context: Buffer.from(context, "utf8").toString("base64") });
    const plaintext = typeof data.plaintext === "string" ? data.plaintext : "";
    if (!plaintext) unavailable("Vault Transit decryption response is invalid.");
    try { return Buffer.from(plaintext, "base64"); } catch { unavailable("Vault Transit decryption response was not base64."); }
  }

  async hmac(keyName: string, context: string, value: string): Promise<{ hmac: string; keyVersion: number }> {
    if (!KEY_NAME.test(keyName) || !context || !value) unavailable("Vault Transit HMAC input is invalid.");
    const data = await this.request("POST", `hmac/${encodeURIComponent(keyName)}`, { input: Buffer.from(value, "utf8").toString("base64"), context: Buffer.from(context, "utf8").toString("base64") });
    const hmac = typeof data.hmac === "string" ? data.hmac : "";
    const matched = /^vault:v([1-9][0-9]*):hmac:[A-Za-z0-9+/=]+$/.exec(hmac);
    if (!matched) unavailable("Vault Transit HMAC response is invalid.");
    return { hmac, keyVersion: Number(matched[1]) };
  }

  async rewrap(keyName: string, context: string, ciphertext: string): Promise<{ ciphertext: string; keyVersion: number }> {
    if (!KEY_NAME.test(keyName) || !context || !TRANSIT_CIPHERTEXT.test(ciphertext)) unavailable("Vault Transit rewrap input is invalid.");
    const data = await this.request("POST", `rewrap/${encodeURIComponent(keyName)}`, { ciphertext, context: Buffer.from(context, "utf8").toString("base64") });
    const rewrapped = typeof data.ciphertext === "string" ? data.ciphertext : "";
    const keyVersion = typeof data.key_version === "number" ? data.key_version : providerVersion(rewrapped);
    if (!TRANSIT_CIPHERTEXT.test(rewrapped) || !Number.isInteger(keyVersion) || keyVersion < 1 || providerVersion(rewrapped) !== keyVersion) unavailable("Vault Transit rewrap response is invalid.");
    return { ciphertext: rewrapped, keyVersion };
  }
}

export function loadVaultTransitClient(source: NodeJS.ProcessEnv = process.env, requestFetch: VaultFetch = fetch): VaultTransitClient {
  return new VaultTransitClient(validateConfig(source), requestFetch);
}
