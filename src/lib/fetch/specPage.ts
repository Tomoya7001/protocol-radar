import { fetchSource, type FetchOutcome, type RetryOptions } from "./fetchCore";
import { contentHash } from "./hash";
import type { HttpClient } from "./types";

/**
 * Generic spec-page content-hash source (A2 — 汎用 spec-page 内容ハッシュ観測ソース).
 *
 * This mirrors github.ts's pollGithub() but for ARBITRARY spec/RFC/registry pages: it reuses
 * the same conditional-GET / retry transport (fetchSource, kind "http"), then folds the raw
 * page body into a DETERMINISTIC, hashable text so the existing diff engine can classify a
 * content change as `spec_change` (first observation => `appeared`, 404/410 => `vanished`).
 *
 * Provenance invariant — the single rule that keeps verifyFromRaw() (the default /api/verify
 * mode) green — is that a stored observation's `content_hash` MUST equal sha256(its body). We
 * therefore NORMALIZE the fetched page once and both STORE that exact string as the body and
 * derive content_hash from those same bytes. The caller persists poll.outcome unchanged.
 */

/**
 * Deterministically normalize a fetched spec/RFC/registry page into a stable, hashable text
 * body. Pure and idempotent — the same input always yields the same output, so a page that is
 * byte-for-byte re-served (or only changes in whitespace/markup noise) produces an identical
 * hash and therefore NO spurious spec_change event.
 *
 * Steps (all order-independent in effect):
 *  - drop HTML comments and <script>/<style> blocks (never spec text),
 *  - remove the remaining HTML tags,
 *  - decode the handful of entities normalization would otherwise leave as noise,
 *  - collapse every run of whitespace to a single space and trim.
 *
 * A non-HTML page (e.g. a raw Markdown spec) simply has no tags to strip and is whitespace-
 * normalized, which is still deterministic.
 */
export function normalizeSpecPage(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** SHA-256 of the NORMALIZED page body — the value stored as an observation's content_hash. */
export function specPageContentHash(raw: string): string {
  return contentHash(normalizeSpecPage(raw));
}

export interface SpecPagePollResult {
  /**
   * A FetchOutcome ready to hand straight to classifyAndAppend(). On a content outcome the
   * body is the NORMALIZED page text and contentHash === sha256(body) — the invariant. Non-
   * content outcomes (not_modified / absent / error) pass through unchanged.
   */
  outcome: FetchOutcome;
}

/**
 * Poll a spec/RFC/registry page once. Reuses the conditional-GET / retry transport (so tests
 * never hit the network — the HttpClient is injectable), then, for a 2xx body, replaces the
 * outcome with one whose body is the deterministic normalization and whose contentHash is
 * derived from that SAME string. Never throws — always resolves to a FetchOutcome.
 */
export async function pollSpecPage(
  client: HttpClient,
  input: {
    url: string;
    etag?: string | null;
    lastModified?: string | null;
    timeoutMs?: number;
  },
  options: RetryOptions = {},
): Promise<SpecPagePollResult> {
  const outcome = await fetchSource(client, { ...input, kind: "http" }, options);

  if (outcome.kind !== "content") {
    return { outcome };
  }

  const body = normalizeSpecPage(outcome.body);
  const normalized: FetchOutcome = {
    kind: "content",
    httpStatus: outcome.httpStatus,
    body,
    contentHash: contentHash(body),
    etag: outcome.etag,
    lastModified: outcome.lastModified,
  };
  return { outcome: normalized };
}
