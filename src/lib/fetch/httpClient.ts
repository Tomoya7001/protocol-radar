import type { HttpClient, HttpRequest, HttpResponse } from "./types";

/**
 * Default HttpClient backed by the global fetch. Resolves for any HTTP status and throws
 * only on network-level failures / timeouts. Not exercised by the offline test suite;
 * tests inject a fake client instead.
 */
export class FetchHttpClient implements HttpClient {
  async send(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeoutMs = req.timeoutMs ?? 15000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(req.url, {
        method: req.method ?? "GET",
        headers: req.headers,
        signal: controller.signal,
        redirect: "follow",
      });

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      const body = req.method === "HEAD" ? "" : await res.text();
      return { status: res.status, headers, body };
    } finally {
      clearTimeout(timer);
    }
  }
}
