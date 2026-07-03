import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * F-042 — API-key issuance + lookup.
 *
 * The agent surface (F-040/F-041) does not own any DB migrations (schema is owned by the
 * `core` group), so keys live in an in-process store. Secrets are never persisted in
 * plaintext: only a sha256 hash is kept, and the plaintext is returned exactly once at
 * issuance. Clock and generators are injectable so tests are fully deterministic offline.
 */

export type ApiTier = "free" | "paid";

/** Public metadata about a key (never contains the secret). */
export interface ApiKeyRecord {
  id: string;
  tier: ApiTier;
  label: string | null;
  createdAt: number;
}

/** The result of issuing a key — includes the plaintext secret, returned ONCE. */
export interface IssuedApiKey extends ApiKeyRecord {
  /** Plaintext API key. Present only on the issuance response; never stored. */
  key: string;
}

interface StoredKey extends ApiKeyRecord {
  secretHash: string;
}

export interface KeyStoreOptions {
  now?: () => number;
  generateId?: () => string;
  generateSecret?: () => string;
}

/** Human-recognisable prefix so a leaked key is easy to grep/revoke. */
export const KEY_PREFIX = "prk_";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class ApiKeyStore {
  private readonly keysById = new Map<string, StoredKey>();
  private readonly idBySecretHash = new Map<string, string>();
  private readonly now: () => number;
  private readonly generateId: () => string;
  private readonly generateSecret: () => string;

  constructor(opts: KeyStoreOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.generateId = opts.generateId ?? (() => `key_${randomUUID()}`);
    this.generateSecret =
      opts.generateSecret ??
      (() => `${KEY_PREFIX}${randomBytes(24).toString("hex")}`);
  }

  /** Issue a new key. Returns the record plus the one-time plaintext secret. */
  issue(input: { tier?: ApiTier; label?: string } = {}): IssuedApiKey {
    const id = this.generateId();
    const key = this.generateSecret();
    const secretHash = sha256(key);
    const record: StoredKey = {
      id,
      tier: input.tier ?? "free",
      label: input.label ?? null,
      createdAt: this.now(),
      secretHash,
    };
    this.keysById.set(id, record);
    this.idBySecretHash.set(secretHash, id);
    return {
      id: record.id,
      tier: record.tier,
      label: record.label,
      createdAt: record.createdAt,
      key,
    };
  }

  /** Resolve a plaintext key to its record, or null if unknown/revoked. */
  authenticate(key: string | null | undefined): ApiKeyRecord | null {
    if (key === null || key === undefined || key.length === 0) return null;
    const id = this.idBySecretHash.get(sha256(key));
    if (id === undefined) return null;
    const rec = this.keysById.get(id);
    return rec === undefined ? null : toPublic(rec);
  }

  /** Look up a key by its public id. */
  get(id: string): ApiKeyRecord | null {
    const rec = this.keysById.get(id);
    return rec === undefined ? null : toPublic(rec);
  }

  /** Revoke a key by id. Returns true when a key was removed. */
  revoke(id: string): boolean {
    const rec = this.keysById.get(id);
    if (rec === undefined) return false;
    this.keysById.delete(id);
    this.idBySecretHash.delete(rec.secretHash);
    return true;
  }

  /** Number of live keys (test/introspection helper). */
  size(): number {
    return this.keysById.size;
  }
}

function toPublic(rec: StoredKey): ApiKeyRecord {
  return {
    id: rec.id,
    tier: rec.tier,
    label: rec.label,
    createdAt: rec.createdAt,
  };
}
