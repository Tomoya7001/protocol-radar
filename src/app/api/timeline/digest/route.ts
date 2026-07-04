import { getDb } from "@/app/_data/db";
import { buildDigest, digestToMarkdown } from "@/lib/aggregate";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WINDOW_HOURS = 24 * 30; // one month upper bound

/**
 * F-052 — GET /api/timeline/digest
 * Digest of the last `?window=<hours>` (default 24) of changes, resolved against `?now=`
 * (epoch ms; server clock if absent). `?format=markdown` returns rendered markdown; otherwise
 * JSON. Invalid `window` ⇒ 400.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const now = parseNow(url);

  let windowHours = 24;
  const rawWindow = url.searchParams.get("window");
  if (rawWindow !== null) {
    const n = Number(rawWindow);
    if (!Number.isInteger(n) || n < 1 || n > MAX_WINDOW_HOURS) {
      return jsonResponse(
        {
          error: "invalid_window",
          detail: `window must be an integer between 1 and ${MAX_WINDOW_HOURS} hours`,
        },
        400,
      );
    }
    windowHours = n;
  }

  const digest = buildDigest(getDb(), now, { windowHours });

  if (url.searchParams.get("format") === "markdown") {
    return new Response(digestToMarkdown(digest), {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  }

  return jsonResponse({ digest });
}
