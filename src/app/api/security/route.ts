import { FetchHttpClient } from "@/lib/fetch";
import { handleSecurity } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A3 - GET api security (read-only advisory watch).
// The testable core (injectable HttpClient) lives in ./handler. This module keeps
// only the Next.js-allowed Route exports (runtime/dynamic/GET) and wires the real
// fetch client, so the build no longer rejects a non-Route export field.
export async function GET(req: Request): Promise<Response> {
  return handleSecurity(req, new FetchHttpClient());
}
