import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SOURCE,
  buildWebhookPayload,
  deliverWebhooks,
  parseWebhookUrls,
  signPayload,
  type WebhookEvent,
  type WebhookFetch,
  type WebhookRequestInit,
} from "./deliver";

function event(seq: number, overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    seq,
    protocol: "mcp",
    protocolName: "MCP",
    type: "version_bump",
    summary: `change ${seq}`,
    createdAt: "2026-07-18T00:00:00.000Z",
    hash: `hash-${seq}`,
    ...overrides,
  };
}

/** Record every call a fake fetch receives so tests can assert method/headers/body/url. */
interface Recorded {
  url: string;
  init: WebhookRequestInit;
}

function recordingFetch(
  responder: (url: string) => { ok: boolean; status: number } | Error,
): { fetchImpl: WebhookFetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl: WebhookFetch = async (url, init) => {
    calls.push({ url, init });
    const outcome = responder(url);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { fetchImpl, calls };
}

describe("buildWebhookPayload", () => {
  it("is stable regardless of input event ordering (byte-identical JSON)", () => {
    const a = buildWebhookPayload([event(3), event(1), event(2)], {
      source: WEBHOOK_SOURCE,
      generatedAt: "2026-07-18T00:00:00.000Z",
    });
    const b = buildWebhookPayload([event(1), event(2), event(3)], {
      source: WEBHOOK_SOURCE,
      generatedAt: "2026-07-18T00:00:00.000Z",
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("sorts events by ascending seq and reports count", () => {
    const payload = buildWebhookPayload([event(5), event(2)], {
      source: WEBHOOK_SOURCE,
      generatedAt: "2026-07-18T00:00:00.000Z",
    });
    expect(payload.count).toBe(2);
    expect(payload.events.map((e) => e.seq)).toEqual([2, 5]);
    expect(payload.source).toBe("protocol-radar");
    expect(payload.generatedAt).toBe("2026-07-18T00:00:00.000Z");
  });

  it("does not read the wall clock (generatedAt is echoed verbatim)", () => {
    const payload = buildWebhookPayload([], {
      source: WEBHOOK_SOURCE,
      generatedAt: "1999-12-31T23:59:59.000Z",
    });
    expect(payload.generatedAt).toBe("1999-12-31T23:59:59.000Z");
    expect(payload.count).toBe(0);
    expect(payload.events).toEqual([]);
  });
});

describe("signPayload", () => {
  it("matches a known HMAC-SHA256 vector", () => {
    // Well-known vector: HMAC-SHA256(key="key", msg="hello").
    expect(signPayload("hello", "key")).toBe(
      "9307b3b915efb5171ff14d8cb55fbcc798c6c0ef1456d66ded1a6aa723a58b7b",
    );
  });

  it("is deterministic and secret-sensitive", () => {
    const body = JSON.stringify({ a: 1 });
    expect(signPayload(body, "s1")).toBe(signPayload(body, "s1"));
    expect(signPayload(body, "s1")).not.toBe(signPayload(body, "s2"));
  });
});

describe("deliverWebhooks", () => {
  it("POSTs application/json to every URL in order", async () => {
    const { fetchImpl, calls } = recordingFetch(() => ({ ok: true, status: 200 }));
    const payload = buildWebhookPayload([event(1)], {
      source: WEBHOOK_SOURCE,
      generatedAt: "2026-07-18T00:00:00.000Z",
    });
    const results = await deliverWebhooks({
      urls: ["https://a.example/hook", "https://b.example/hook"],
      payload,
      fetchImpl,
    });

    expect(calls.map((c) => c.url)).toEqual([
      "https://a.example/hook",
      "https://b.example/hook",
    ]);
    const first = calls[0];
    expect(first).toBeDefined();
    expect(first?.init.method).toBe("POST");
    expect(first?.init.headers["Content-Type"]).toBe("application/json");
    expect(first?.init.body).toBe(JSON.stringify(payload));
    expect(results).toEqual([
      { url: "https://a.example/hook", ok: true, status: 200 },
      { url: "https://b.example/hook", ok: true, status: 200 },
    ]);
  });

  it("attaches the signature header only when a secret is provided", async () => {
    const secret = "whsec_test";
    const payload = buildWebhookPayload([event(1)], {
      source: WEBHOOK_SOURCE,
      generatedAt: "2026-07-18T00:00:00.000Z",
    });
    const body = JSON.stringify(payload);

    const signed = recordingFetch(() => ({ ok: true, status: 204 }));
    await deliverWebhooks({
      urls: ["https://a.example/hook"],
      payload,
      secret,
      fetchImpl: signed.fetchImpl,
    });
    const signedCall = signed.calls[0];
    expect(signedCall).toBeDefined();
    expect(signedCall?.init.headers[WEBHOOK_SIGNATURE_HEADER]).toBe(
      `sha256=${signPayload(body, secret)}`,
    );

    const unsigned = recordingFetch(() => ({ ok: true, status: 204 }));
    await deliverWebhooks({
      urls: ["https://a.example/hook"],
      payload,
      fetchImpl: unsigned.fetchImpl,
    });
    const unsignedCall = unsigned.calls[0];
    expect(unsignedCall).toBeDefined();
    expect(unsignedCall?.init.headers[WEBHOOK_SIGNATURE_HEADER]).toBeUndefined();
  });

  it("continues delivering after one URL fails (per-URL isolation)", async () => {
    const { fetchImpl, calls } = recordingFetch((url) =>
      url.includes("bad") ? new Error("connection refused") : { ok: true, status: 200 },
    );
    const payload = buildWebhookPayload([event(1)], {
      source: WEBHOOK_SOURCE,
      generatedAt: "2026-07-18T00:00:00.000Z",
    });
    const results = await deliverWebhooks({
      urls: [
        "https://ok1.example/hook",
        "https://bad.example/hook",
        "https://ok2.example/hook",
      ],
      payload,
      fetchImpl,
    });

    // All three were attempted despite the middle one throwing.
    expect(calls).toHaveLength(3);
    expect(results[0]).toEqual({ url: "https://ok1.example/hook", ok: true, status: 200 });
    expect(results[1]).toEqual({
      url: "https://bad.example/hook",
      ok: false,
      error: "connection refused",
    });
    expect(results[2]).toEqual({ url: "https://ok2.example/hook", ok: true, status: 200 });
  });

  it("records a non-2xx response as ok:false with its status (no throw)", async () => {
    const { fetchImpl } = recordingFetch(() => ({ ok: false, status: 500 }));
    const payload = buildWebhookPayload([event(1)], {
      source: WEBHOOK_SOURCE,
      generatedAt: "2026-07-18T00:00:00.000Z",
    });
    const results = await deliverWebhooks({
      urls: ["https://a.example/hook"],
      payload,
      fetchImpl,
    });
    expect(results[0]).toEqual({ url: "https://a.example/hook", ok: false, status: 500 });
  });
});

describe("signature round-trip (receiver verification)", () => {
  it("a receiver recomputing with the shared secret matches the sent signature", async () => {
    const secret = "shared-secret";
    const payload = buildWebhookPayload([event(1), event(2)], {
      source: WEBHOOK_SOURCE,
      generatedAt: "2026-07-18T00:00:00.000Z",
    });

    let receivedBody: string | null = null;
    let receivedSig: string | null = null;
    const fetchImpl: WebhookFetch = async (_url, init) => {
      receivedBody = init.body;
      receivedSig = init.headers[WEBHOOK_SIGNATURE_HEADER] ?? null;
      return { ok: true, status: 200 };
    };

    await deliverWebhooks({
      urls: ["https://a.example/hook"],
      payload,
      secret,
      fetchImpl,
    });

    expect(receivedBody).not.toBeNull();
    expect(receivedSig).not.toBeNull();
    // Receiver independently recomputes the HMAC over the raw body it received.
    const recomputed =
      "sha256=" +
      createHmac("sha256", secret)
        .update(receivedBody as unknown as string, "utf8")
        .digest("hex");
    expect(recomputed).toBe(receivedSig);

    // A wrong secret must NOT verify.
    const wrong =
      "sha256=" +
      createHmac("sha256", "not-the-secret")
        .update(receivedBody as unknown as string, "utf8")
        .digest("hex");
    expect(wrong).not.toBe(receivedSig);
  });
});

describe("parseWebhookUrls", () => {
  it("splits on commas and trims surrounding whitespace", () => {
    expect(
      parseWebhookUrls("https://a.example/hook, https://b.example/hook"),
    ).toEqual(["https://a.example/hook", "https://b.example/hook"]);
  });

  it("drops empty and whitespace-only entries", () => {
    expect(parseWebhookUrls("https://a.example/hook, ,, \t ,https://b.example/hook")).toEqual([
      "https://a.example/hook",
      "https://b.example/hook",
    ]);
  });

  it("returns [] for undefined, null, empty, or whitespace-only input", () => {
    expect(parseWebhookUrls(undefined)).toEqual([]);
    expect(parseWebhookUrls(null)).toEqual([]);
    expect(parseWebhookUrls("")).toEqual([]);
    expect(parseWebhookUrls("   ")).toEqual([]);
    expect(parseWebhookUrls(" , , ")).toEqual([]);
  });
});
