import { describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db/connection";
import { runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/db/connection";
import {
  insertProtocol,
  insertSource,
  listEvents,
} from "@/lib/db/repo";
import { verify } from "@/lib/ledger/ledger";
import { contentHash } from "@/lib/fetch/hash";
import type { FetchOutcome } from "@/lib/fetch/fetchCore";
import { FakeHttpClient, response } from "@/lib/fetch/fakeClient";
import { noSleep } from "@/lib/fetch/types";
import { createMemoryLogger } from "@/lib/fetch/logger";
import { WATCHLIST_LAYER } from "@/config/sources/types";
import { recordFirstAppearance, runWatchlistOnce } from "./watchlist";

function db(): Db {
  const d = openDatabase(":memory:");
  runMigrations(d);
  return d;
}

/** Seed one active watchlist protocol + source (tagged so the monitor finds it). */
function seedWatch(d: Db, url: string) {
  const proto = insertProtocol(d, {
    key: "watch-future",
    name: "Future spec (watch)",
    layer: WATCHLIST_LAYER,
  });
  const source = insertSource(d, {
    protocol_id: proto.id,
    kind: "http",
    url,
    cadence_seconds: 86400,
    active: true,
  });
  return { proto, source };
}

describe("F-020 watchlist — first appearance fires EXACTLY once", () => {
  it("does not fire while absent, fires once on first content, and never again", async () => {
    const d = db();
    const url = "https://future.test/spec";
    seedWatch(d, url);
    const at = (iso: string) => new Date(iso);

    // Poll 1: the future spec is not published yet (404) → no appearance.
    const r1 = await runWatchlistOnce({
      db: d,
      client: new FakeHttpClient([response(404)]),
      now: at("2026-07-03T00:00:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });
    expect(r1[0]?.fired).toBe(false);
    expect(listEvents(d)).toHaveLength(0);

    // Poll 2: the spec appears → fires the ONE first-appearance event.
    const r2 = await runWatchlistOnce({
      db: d,
      client: new FakeHttpClient([response(200, "future spec v1")]),
      now: at("2026-07-03T01:00:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });
    expect(r2[0]?.fired).toBe(true);
    expect(listEvents(d).map((e) => e.type)).toEqual(["appeared"]);

    // Poll 3: same content on a later poll → must NOT fire again (exactly once).
    const r3 = await runWatchlistOnce({
      db: d,
      client: new FakeHttpClient([response(200, "future spec v1")]),
      now: at("2026-07-03T02:00:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });
    expect(r3[0]?.fired).toBe(false);

    // Still exactly one appearance event, and the hash-chain verifies.
    expect(
      listEvents(d).filter((e) => e.type === "appeared"),
    ).toHaveLength(1);
    expect(verify(d)).toEqual({ ok: true });
  });

  it("polls ONLY watchlist sources, ignoring normal protocol sources", async () => {
    const d = db();
    const watchUrl = "https://future.test/spec";
    seedWatch(d, watchUrl);

    // A normal (non-watchlist) protocol source must be ignored by the watchlist sweep.
    const normal = insertProtocol(d, { key: "mcp", name: "MCP", layer: "B" });
    insertSource(d, {
      protocol_id: normal.id,
      kind: "http",
      url: "https://normal.test/spec",
      active: true,
    });

    const client = new FakeHttpClient([response(200, "future spec v1")]);
    const results = await runWatchlistOnce({
      db: d,
      client,
      now: new Date("2026-07-03T00:00:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });

    // Exactly one poll, against the watchlist URL only.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.url).toBe(watchUrl);
    expect(results).toHaveLength(1);
    expect(results[0]?.protocolKey).toBe("watch-future");
  });
});

describe("F-020 watchlist — recordFirstAppearance (pure core)", () => {
  it("fires on first content and is idempotent for unchanged re-polls", () => {
    const d = db();
    const proto = insertProtocol(d, {
      key: "watch-core",
      name: "watch core",
      layer: WATCHLIST_LAYER,
    });
    const source = insertSource(d, {
      protocol_id: proto.id,
      kind: "http",
      url: "https://future.test/core",
      active: true,
    });

    const body = "spec body";
    const outcome: FetchOutcome = {
      kind: "content",
      httpStatus: 200,
      body,
      contentHash: contentHash(body),
      etag: null,
      lastModified: null,
    };

    const first = recordFirstAppearance({
      db: d,
      protocolId: proto.id,
      sourceId: source.id,
      fetchedAt: "2026-07-03T00:00:00.000Z",
      outcome,
    });
    expect(first.fired).toBe(true);
    expect(first.event?.type).toBe("appeared");

    const second = recordFirstAppearance({
      db: d,
      protocolId: proto.id,
      sourceId: source.id,
      fetchedAt: "2026-07-03T01:00:00.000Z",
      outcome,
    });
    expect(second.fired).toBe(false);
    expect(second.event).toBeNull();

    expect(listEvents(d).filter((e) => e.type === "appeared")).toHaveLength(1);
  });
});
