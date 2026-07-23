/**
 * Minimal ambient types for the `opentimestamps` package (the maintained successor of
 * `javascript-opentimestamps`; the old name was deprecated and renamed to `opentimestamps`
 * from 0.4.6 onward). The library ships no type declarations, so under strict/noImplicitAny
 * tsc would reject `import OpenTimestamps from "opentimestamps"` (TS7016). We declare only the
 * surface F6 actually uses; everything else is intentionally omitted.
 */
declare module "opentimestamps" {
  /** Base class for all notary attestations (Pending / Bitcoin / Litecoin / Unknown). */
  class TimeAttestation {}

  /** A "not yet Bitcoin-confirmed" attestation pointing at a calendar server URI. */
  class PendingAttestation extends TimeAttestation {
    constructor(uri: string);
    uri: string;
  }

  /** A Bitcoin-confirmed attestation: the block height is embedded in the proof itself. */
  class BitcoinBlockHeaderAttestation extends TimeAttestation {
    constructor(height: number);
    height: number;
  }

  /** A Litecoin-confirmed attestation (unused by F6, declared for completeness). */
  class LitecoinBlockHeaderAttestation extends TimeAttestation {
    height: number;
  }

  interface NotaryNamespace {
    TimeAttestation: typeof TimeAttestation;
    PendingAttestation: typeof PendingAttestation;
    BitcoinBlockHeaderAttestation: typeof BitcoinBlockHeaderAttestation;
    LitecoinBlockHeaderAttestation: typeof LitecoinBlockHeaderAttestation;
  }

  /** The SHA256 file-hash operation used to declare "these bytes are a SHA256 digest". */
  class OpSHA256 {
    constructor();
  }

  interface OpsNamespace {
    OpSHA256: typeof OpSHA256;
  }

  /** The timestamp proof tree attached to a detached file. */
  interface Timestamp {
    /** Every attestation anywhere in the proof tree, keyed by its message. No network. */
    allAttestations(): Map<string, TimeAttestation>;
    /** True once a Bitcoin attestation exists in the tree. No network. */
    isTimestampComplete(): boolean;
    /** The attestations directly on this node (used by the stamp/upgrade side-effect script). */
    attestations: TimeAttestation[];
  }

  /** A detached OpenTimestamps proof over a single file digest. */
  class DetachedTimestampFile {
    timestamp: Timestamp;
    /** The digest the proof commits to. */
    fileDigest(): number[];
    /** Serialize the proof to bytes for writing to a `.ots` file. */
    serializeToBytes(): Uint8Array;
    /** Build a detached file from a precomputed digest + its hash operation. No network. */
    static fromHash(
      op: OpSHA256,
      bytes: number[] | Uint8Array,
    ): DetachedTimestampFile;
    /** Parse a serialized `.ots` proof back into a detached file. No network. */
    static deserialize(bytes: number[] | Uint8Array): DetachedTimestampFile;
  }

  interface UtilsNamespace {
    hexToBytes(hex: string): number[];
    bytesToHex(bytes: number[] | Uint8Array): string;
  }

  interface OpenTimestamps {
    DetachedTimestampFile: typeof DetachedTimestampFile;
    Ops: OpsNamespace;
    Notary: NotaryNamespace;
    Utils: UtilsNamespace;
    /** Contact calendar servers to stamp the detached file(s). NETWORK. Mutates in place. */
    stamp(
      detached: DetachedTimestampFile | DetachedTimestampFile[],
      options?: unknown,
    ): Promise<void>;
    /** Try to upgrade pending attestations to Bitcoin-confirmed. NETWORK. Resolves changed?. */
    upgrade(detached: DetachedTimestampFile): Promise<boolean>;
    /** Human-readable dump of a proof (no network). */
    info(detached: DetachedTimestampFile): string;
  }

  const OpenTimestamps: OpenTimestamps;
  export = OpenTimestamps;
}
