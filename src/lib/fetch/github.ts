import { fetchSource, type FetchOutcome, type RetryOptions } from "./fetchCore";
import type { HttpClient } from "./types";

/**
 * Shape of a GitHub tag or release item (only the fields we consume). We keep this loose
 * because both the tags API (`name`) and releases API (`tag_name`) are supported.
 */
export interface GithubRef {
  name: string;
}

/**
 * Parse a GitHub tags/releases JSON payload into a normalized list of ref names. Accepts
 * either the tags shape [{ name }] or the releases shape [{ tag_name }]. Returns [] on any
 * parse failure (never throws) so a malformed upstream payload cannot abort a run.
 */
export function parseGithubRefs(body: string): GithubRef[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const refs: GithubRef[] = [];
  for (const item of parsed) {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const name = rec["name"] ?? rec["tag_name"];
      if (typeof name === "string" && name.length > 0) {
        refs.push({ name });
      }
    }
  }
  return refs;
}

export interface GithubPollResult {
  outcome: FetchOutcome;
  /** Present only when outcome.kind === "content" and the payload parsed as refs. */
  refs?: GithubRef[];
  /** The first ref (GitHub returns most-recent first for tags/releases). */
  latestRef?: string;
}

/**
 * Poll a GitHub tags/releases endpoint. Reuses the conditional-GET / retry transport, then
 * parses the body into refs when content is returned. The HttpClient is injectable, so
 * tests never hit the network.
 */
export async function pollGithub(
  client: HttpClient,
  input: {
    url: string;
    etag?: string | null;
    lastModified?: string | null;
    timeoutMs?: number;
  },
  options: RetryOptions = {},
): Promise<GithubPollResult> {
  const outcome = await fetchSource(
    client,
    { ...input, kind: "github" },
    options,
  );

  if (outcome.kind !== "content") {
    return { outcome };
  }

  const refs = parseGithubRefs(outcome.body);
  return {
    outcome,
    refs,
    latestRef: refs[0]?.name,
  };
}
