import { createHash } from "node:crypto";

/** SHA-256 hex digest of a body, used as an observation's content_hash. */
export function contentHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}
