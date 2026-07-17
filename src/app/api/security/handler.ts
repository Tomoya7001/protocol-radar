import { getDb } from "@/app/_data/db";
import { getProtocolSummaries, protocolExists } from "@/app/_data/queries";
import { jsonResponse, parseLimit, parseNow } from "@/app/api/_lib/http";
import { advisoryTargetsFor } from "@/config/sources/advisories";
import {
  fetchAdvisories,
  type NormalizedAdvisory,
} from "@/lib/fetch/advisories";
import { noSleep, type HttpClient } from "@/lib/fetch";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** One protocol's advisory block in the response. */
interface ProtocolAdvisories {
  key: string;
  name: string;
  advisories: NormalizedAdvisory[];
  advisory_count: number;
  /** Present only when at least one upstream lookup failed (graceful degradation). */
  error?: string;
}

/**
 * Gather + normalize advisories for a single protocol across all its lookup targets, capped at
 * `limit`. Any upstream failure degrades to `advisories: []` for that target plus an `error`
 * note — a single bad source can never fail the whole response.
 */
async function collectForProtocol(
  client: HttpClient,
  key: string,
  name: string,
  limit: number,
): Promise<ProtocolAdvisories> {
  const targets = advisoryTargetsFor(key);
  const advisories: NormalizedAdvisory[] = [];
  const errors: string[] = [];

  for (const target of targets) {
    const result = await fetchAdvisories(client, target, { sleep: noSleep });
    if (result.error) errors.push(`${target.owner}/${target.repo}: ${result.error}`);
    advisories.push(...result.advisories);
  }

  const capped = advisories.slice(0, limit);
  const block: ProtocolAdvisories = {
    key,
    name,
    advisories: capped,
    advisory_count: capped.length,
  };
  if (errors.length > 0) block.error = errors.join("; ");
  return block;
}

/**
 * Testable core: the request handler with an injectable HttpClient so unit tests can drive it
 * with a scripted, offline client (no real network). GET() wires the real fetch client.
 */
export async function handleSecurity(
  req: Request,
  client: HttpClient,
): Promise<Response> {
  const url = new URL(req.url);
  const db = getDb();
  const now = parseNow(url);

  const limit = parseLimit(url, DEFAULT_LIMIT, MAX_LIMIT);
  if ("error" in limit) {
    return jsonResponse({ error: "invalid_limit", detail: limit.error }, 400);
  }

  const protocolKey = url.searchParams.get("protocol");
  if (protocolKey !== null && !protocolExists(db, protocolKey)) {
    return jsonResponse({ error: "protocol_not_found", key: protocolKey }, 404);
  }

  // Resolve key -> name from the existing read layer (deterministic, key-sorted).
  const summaries = getProtocolSummaries(db, now);
  const selected =
    protocolKey !== null
      ? summaries.filter((s) => s.key === protocolKey)
      : summaries;

  const protocols = await Promise.all(
    selected.map((s) =>
      collectForProtocol(client, s.key, s.name, limit.value),
    ),
  );

  const body = {
    generated_at: new Date(now).toISOString(),
    protocols,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Advisory feeds move slowly; allow shared-cache reuse with background revalidation.
      "cache-control": "public, s-maxage=1800, stale-while-revalidate=3600",
    },
  });
}
