import { afterEach, describe, expect, it } from "vitest";
import OpenTimestamps from "opentimestamps";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { computeLedgerHead } from "@/lib/anchor";
import {
  __setOtsReaderForTests,
  buildTimestamp,
  detachedForHead,
  serializeProof,
} from "@/lib/timestamp";
import { GET as getTimestamp } from "./route";

const { Notary } = OpenTimestamps;
const NOW = Date.parse("2026-07-02T00:00:00.000Z");

interface TimestampBody {
  head_hash: string;
  ots_present: boolean;
  ots_base64: string | null;
  status: "none" | "pending" | "confirmed";
  bitcoin?: { block_height: number; block_time: number | null };
  calendar_urls?: string[];
}

/** Build a serialized `.ots` proof for a head with optional attestations, fully offline. */
function proofBytes(
  headHash: string,
  attach: (ts: { attestations: unknown[] }) => void = () => {},
): Uint8Array {
  const detached = detachedForHead(headHash);
  attach(detached.timestamp as unknown as { attestations: unknown[] });
  return serializeProof(detached);
}

afterEach(() => {
  __setDbForTests(null);
  __setOtsReaderForTests(null);
});

describe("F6 buildTimestamp (pure shape)", () => {
  const head = "a".repeat(64);

  it("reports status none / empty-safe when no proof exists", () => {
    const res = buildTimestamp(head, null);
    expect(res).toEqual({
      head_hash: head,
      ots_present: false,
      ots_base64: null,
      status: "none",
    });
  });

  it("includes base64 + calendar_urls for a pending proof", () => {
    const url = "https://alice.btc.calendar.opentimestamps.org";
    const bytes = proofBytes(head, (ts) => {
      ts.attestations.push(new Notary.PendingAttestation(url));
    });
    const res = buildTimestamp(head, bytes);
    expect(res.ots_present).toBe(true);
    expect(res.status).toBe("pending");
    expect(res.calendar_urls).toEqual([url]);
    expect(res.bitcoin).toBeUndefined();
    // ots_base64 decodes back to the exact proof bytes.
    expect(Buffer.from(res.ots_base64!, "base64").equals(Buffer.from(bytes))).toBe(
      true,
    );
  });

  it("includes bitcoin block height for a confirmed proof", () => {
    const bytes = proofBytes(head, (ts) => {
      ts.attestations.push(new Notary.BitcoinBlockHeaderAttestation(783123));
    });
    const res = buildTimestamp(head, bytes);
    expect(res.status).toBe("confirmed");
    expect(res.bitcoin).toEqual({ block_height: 783123, block_time: null });
  });

  it("is present-but-pending (not a crash) for an unparseable proof", () => {
    const res = buildTimestamp(head, new Uint8Array([1, 2, 3]));
    expect(res.ots_present).toBe(true);
    expect(res.status).toBe("pending");
    expect(res.calendar_urls).toEqual([]);
  });
});

describe("F6 GET /api/timestamp", () => {
  it("returns status none (200) when the head has no committed proof", async () => {
    const db = seededDb(NOW);
    __setDbForTests(db);
    __setOtsReaderForTests(() => null);

    const res = await getTimestamp(new Request("http://test.local/api/timestamp"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as TimestampBody;
    const head = computeLedgerHead(db);
    expect(body.head_hash).toBe(head.headHash);
    expect(body.head_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.ots_present).toBe(false);
    expect(body.ots_base64).toBeNull();
    expect(body.status).toBe("none");
  });

  it("returns a pending anchor for the current head when a proof is committed", async () => {
    const db = seededDb(NOW);
    __setDbForTests(db);
    const head = computeLedgerHead(db).headHash;
    const url = "https://alice.btc.calendar.opentimestamps.org";
    const bytes = proofBytes(head, (ts) => {
      ts.attestations.push(new Notary.PendingAttestation(url));
    });
    // Reader only returns the proof for the ACTUAL current head - proves head/file linkage.
    __setOtsReaderForTests((h) => (h === head ? bytes : null));

    const res = await getTimestamp(new Request("http://test.local/api/timestamp"));
    const body = (await res.json()) as TimestampBody;
    expect(res.status).toBe(200);
    expect(body.head_hash).toBe(head);
    expect(body.ots_present).toBe(true);
    expect(body.status).toBe("pending");
    expect(body.calendar_urls).toEqual([url]);
  });

  it("returns a confirmed anchor with bitcoin height when the proof has one", async () => {
    const db = seededDb(NOW);
    __setDbForTests(db);
    const head = computeLedgerHead(db).headHash;
    const bytes = proofBytes(head, (ts) => {
      ts.attestations.push(new Notary.BitcoinBlockHeaderAttestation(812345));
    });
    __setOtsReaderForTests(() => bytes);

    const res = await getTimestamp(new Request("http://test.local/api/timestamp"));
    const body = (await res.json()) as TimestampBody;
    expect(body.status).toBe("confirmed");
    expect(body.bitcoin).toEqual({ block_height: 812345, block_time: null });
  });
});
