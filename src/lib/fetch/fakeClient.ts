import type { HttpClient, HttpRequest, HttpResponse } from "./types";

/**
 * A scripted, offline HttpClient for tests. Each call to `send` returns (or throws) the
 * next programmed step, keyed loosely by call order. Steps can also be a function to
 * inspect the request (e.g. assert conditional headers).
 */
export type FakeStep =
  HttpResponse | Error | ((req: HttpRequest) => HttpResponse | Error);

export class FakeHttpClient implements HttpClient {
  private steps: FakeStep[];
  public readonly calls: HttpRequest[] = [];

  constructor(steps: FakeStep[]) {
    this.steps = [...steps];
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    this.calls.push(req);
    const step = this.steps.shift();
    if (step === undefined) {
      throw new Error("FakeHttpClient: no more scripted steps");
    }
    const resolved = typeof step === "function" ? step(req) : step;
    if (resolved instanceof Error) {
      throw resolved;
    }
    return resolved;
  }
}

/** Convenience builder for an HttpResponse. */
export function response(
  status: number,
  body = "",
  headers: Record<string, string> = {},
): HttpResponse {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { status, body, headers: lower };
}
