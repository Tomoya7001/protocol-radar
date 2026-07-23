import { handleSdkVersions } from "./handler";

// F1 — GET /api/sdk-versions (read-only observed SDK package versions).
// The testable core lives in ./handler. This module keeps ONLY the Next.js-allowed Route
// exports (runtime/dynamic/GET); Next.js rejects any other export field from a route file.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return handleSdkVersions(req);
}
