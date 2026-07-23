import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import type { Db } from "@/lib/db";
import { GET } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;

// seededDb appends 7 events (mcp:3, a2a:1, x402:1, oldproto:2); head seq is 7.
const HEAD_SEQ = 7;

function inject(): Db {
  const db = seededDb(NOW);
  __setDbForTests(db);
  return db;
}

function req(): Request {
  return new Request("http://test.local/api/proof");
}

function call(seq: string): Promise<Response> {
  return GET(req(), { params: Promise.resolve({ seq }) });
}

interface ProofBody {
  seq: number;
  found: boolean;
  event: { seq: number; type: string; protocol_id: number; created_at: string };
  hash: string;
  prev_hash: string;
  chain_to_head: Array<{ seq: number; hash: string; prev_hash: string }>;
  head_hash: string;
  verify_instructions: string;
}

afterEach(() => {
  __setDbForTests(null);
  process.env.PROTOCOL_RADAR_HMAC_SECRET = SECRET;
});

describe("F5 GET /api/proof/:seq", () => {
  it("returns 200 with a proof whose chain links to head for an existing seq", async () => {
    const db = inject();
    const res = await call("2");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as ProofBody;
    expect(body.found).toBe(true);
    expect(body.seq).toBe(2);
    expect(body.event.seq).toBe(2);
    expect(body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.prev_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.verify_instructions).toContain("HMAC-SHA256");

    // chain_to_head runs from seq 2 to head (7).
    expect(body.chain_to_head.map((l) => l.seq)).toEqual([2, 3, 4, 5, 6, 7]);

    // first link's prev_hash equals the event's prev_hash.
    expect(body.chain_to_head[0]?.prev_hash).toBe(body.prev_hash);

    // each subsequent link chains: prev_hash === previous link's hash.
    for (let i = 1; i < body.chain_to_head.length; i++) {
      expect(body.chain_to_head[i]?.prev_hash).toBe(body.chain_to_head[i - 1]?.hash);
    }

    // last link's hash is head_hash, and matches the stored head hash.
    expect(body.chain_to_head.at(-1)?.hash).toBe(body.head_hash);
    const head = db
      .prepare("SELECT hash FROM events WHERE seq = ?")
      .get(HEAD_SEQ) as { hash: string };
    expect(body.head_hash).toBe(head.hash);
  });

  it("returns 200 for the head's own seq with a single-link chain", async () => {
    inject();
    const res = await call(String(HEAD_SEQ));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProofBody;
    expect(body.seq).toBe(HEAD_SEQ);
    expect(body.chain_to_head).toHaveLength(1);
    expect(body.chain_to_head[0]?.seq).toBe(HEAD_SEQ);
    expect(body.hash).toBe(body.head_hash);
  });

  it("returns 200 for the first event with a genesis prev_hash", async () => {
    inject();
    const res = await call("1");
    const body = (await res.json()) as ProofBody;
    expect(res.status).toBe(200);
    expect(body.prev_hash).toBe("0".repeat(64));
    expect(body.chain_to_head).toHaveLength(HEAD_SEQ);
  });

  it("returns 404 not_found for a well-formed seq absent from the ledger", async () => {
    inject();
    const res = await call("999");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 400 invalid_seq for non-numeric or out-of-range segments", async () => {
    inject();
    for (const bad of ["abc", "0", "-1", "1.5", "99999999999999999999"]) {
      const res = await call(bad);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_seq" });
    }
  });
});
