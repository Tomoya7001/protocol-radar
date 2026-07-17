import { buildCertificateResponse } from "@/lib/certificate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * B1 - GET /api/certificate
 * Returns an as-of provenance certificate for `?protocol=<key|name>` (required), optionally at
 * `?asOf=<ISO-8601|unix epoch>` (default now) and `?mode=raw|chain` (default raw). The logic
 * lives entirely in @/lib/certificate; this Route file only exports the Next.js-allowed
 * runtime/dynamic/GET (A3 lesson: never export a handler field Next.js rejects at build).
 */
export async function GET(req: Request): Promise<Response> {
  return buildCertificateResponse(req);
}
