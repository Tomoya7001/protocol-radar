import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../lib/db/connection";
import { runMigrations } from "../lib/db/migrate";
import {
  getSourceById,
  insertProtocol,
  insertSource,
  listEvents,
  listRuns,
} from "../lib/db/repo";
import type { Db } from "../lib/db/connection";
import { verify } from "../lib/ledger/ledger";
import { FakeHttpClient, response } from "../lib/fetch/fakeClient";
import { noSleep } from "../lib/fetch/types";
import { createMemoryLogger } from "../lib/fetch/logger";
import { runOnce } from "./runOnce";
import { acquireLock } from "./lock";
import { assertSecretPresent } from "./index";

function db(): Db {
  const d = openDatabase(":memory:");
  runMigrations(d);
  return d;
}

const ORIGINAL_SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;
afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.PROTOCOL_RADAR_HMAC_SECRET;
  } else {
    process.env.PROTOCOL_RADAR_HMAC_SECRET = ORIGINAL_SECRET;
  }
});

describe("F-005 scheduler/worker — runOnce", () => {
  it("polls only DUE sources (respects per-source cadence)", async () => {
    const d = db();
    const proto = insertProtocol(d, { key: "mcp", name: "MCP" });

    // Due source: never polled.
    const due = insertSource(d, {
      protocol_id: proto.id,
      kind: "http",
      url: "https://example.test/due",
      cadence_seconds: 3600,
    });
    // Not-due source: polled 1 minute ago with a 1h cadence.
    const notDue = insertSource(d, {
      protocol_id: proto.id,
      kind: "http",
      url: "https://example.test/notdue",
      cadence_seconds: 3600,
    });
    d.prepare("UPDATE sources SET last_polled_at = ? WHERE id = ?").run(
      "2026-07-02T00:59:00.000Z",
      notDue.id,
    );

    const client = new FakeHttpClient([response(200, "body due")]);
    const result = await runOnce({
      db: d,
      client,
      now: new Date("2026-07-02T01:00:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });

    expect(result.ran).toBe(true);
    expect(result.sourcesPolled).toBe(1);
    // Only the due source made an HTTP call.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.url).toBe("https://example.test/due");
    // Due source got its last_polled_at updated; not-due one unchanged.
    expect(getSourceById(d, due.id)?.last_polled_at).toBe(
      "2026-07-02T01:00:00.000Z",
    );
    expect(getSourceById(d, notDue.id)?.last_polled_at).toBe(
      "2026-07-02T00:59:00.000Z",
    );
  });

  it("lock prevents a concurrent runOnce from double-processing", async () => {
    const d = db();
    const proto = insertProtocol(d, { key: "mcp", name: "MCP" });
    insertSource(d, {
      protocol_id: proto.id,
      kind: "http",
      url: "https://example.test/spec",
    });

    // Simulate another run already holding the lock.
    expect(acquireLock(d, "2026-07-02T00:00:00.000Z")).toBe(true);

    const client = new FakeHttpClient([]); // must NOT be called
    const result = await runOnce({
      db: d,
      client,
      now: new Date("2026-07-02T01:00:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });

    expect(result.ran).toBe(false);
    expect(result.sourcesPolled).toBe(0);
    expect(client.calls).toHaveLength(0);
    expect(listRuns(d)).toHaveLength(0);
  });

  it("releases the lock so a subsequent runOnce can run", async () => {
    const d = db();
    const proto = insertProtocol(d, { key: "mcp", name: "MCP" });
    insertSource(d, {
      protocol_id: proto.id,
      kind: "http",
      url: "https://example.test/spec",
    });

    const c1 = new FakeHttpClient([response(200, "first")]);
    const r1 = await runOnce({
      db: d,
      client: c1,
      now: new Date("2026-07-02T01:00:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });
    expect(r1.ran).toBe(true);

    // Force due again by clearing cadence bookkeeping.
    d.prepare("UPDATE sources SET last_polled_at = NULL").run();

    const c2 = new FakeHttpClient([response(200, "second")]);
    const r2 = await runOnce({
      db: d,
      client: c2,
      now: new Date("2026-07-02T03:00:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });
    expect(r2.ran).toBe(true);
  });

  it("writes a runs row per run", async () => {
    const d = db();
    const proto = insertProtocol(d, { key: "mcp", name: "MCP" });
    insertSource(d, {
      protocol_id: proto.id,
      kind: "http",
      url: "https://example.test/spec",
    });
    const client = new FakeHttpClient([response(200, "body")]);
    await runOnce({
      db: d,
      client,
      now: new Date("2026-07-02T01:00:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });
    const runs = listRuns(d);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.sources_polled).toBe(1);
    expect(runs[0]?.ok).toBe(1);
    expect(runs[0]?.finished_at).not.toBeNull();
  });

  it("integration: a due source with changed content yields an observation + event, verify() ok", async () => {
    const d = db();
    const proto = insertProtocol(d, { key: "mcp", name: "MCP" });
    const source = insertSource(d, {
      protocol_id: proto.id,
      kind: "http",
      url: "https://example.test/spec",
      cadence_seconds: 60,
    });

    // First poll: appears.
    await runOnce({
      db: d,
      client: new FakeHttpClient([response(200, "spec v1", { etag: 'W/"1"' })]),
      now: new Date("2026-07-02T01:00:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });
    // Second poll (past cadence): body changed => spec_change.
    await runOnce({
      db: d,
      client: new FakeHttpClient([response(200, "spec v2", { etag: 'W/"2"' })]),
      now: new Date("2026-07-02T01:05:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });

    const events = listEvents(d);
    expect(events.map((e) => e.type)).toEqual(["appeared", "spec_change"]);
    expect(verify(d)).toEqual({ ok: true });
    // etag from the latest content was stored.
    expect(getSourceById(d, source.id)?.etag).toBe('W/"2"');
  });

  it("integration: github source records version bumps and stays verifiable", async () => {
    const d = db();
    const proto = insertProtocol(d, { key: "a2a", name: "A2A" });
    insertSource(d, {
      protocol_id: proto.id,
      kind: "github",
      url: "https://api.github.test/repos/o/r/tags",
      cadence_seconds: 60,
    });

    await runOnce({
      db: d,
      client: new FakeHttpClient([
        response(200, JSON.stringify([{ name: "v1.0.0" }])),
      ]),
      now: new Date("2026-07-02T01:00:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });
    await runOnce({
      db: d,
      client: new FakeHttpClient([
        response(200, JSON.stringify([{ name: "v1.1.0" }, { name: "v1.0.0" }])),
      ]),
      now: new Date("2026-07-02T01:05:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });

    const events = listEvents(d);
    expect(events.map((e) => e.type)).toEqual(["appeared", "version_bump"]);
    expect(events[1]?.summary).toBe("version v1.0.0 -> v1.1.0");
    expect(verify(d)).toEqual({ ok: true });
  });

  it("a failing source does not abort the run (others still processed)", async () => {
    const d = db();
    const proto = insertProtocol(d, { key: "mcp", name: "MCP" });
    insertSource(d, {
      protocol_id: proto.id,
      kind: "http",
      url: "https://example.test/a",
    });
    insertSource(d, {
      protocol_id: proto.id,
      kind: "http",
      url: "https://example.test/b",
    });

    // First source: fetch core exhausts retries then returns error (no throw); second: ok.
    const client = new FakeHttpClient([
      response(500),
      response(500),
      response(500),
      response(200, "b body"),
    ]);
    const result = await runOnce({
      db: d,
      client,
      now: new Date("2026-07-02T01:00:00.000Z"),
      sleep: noSleep,
      logger: createMemoryLogger(),
    });
    expect(result.ran).toBe(true);
    expect(result.sourcesPolled).toBe(2);
    // Only source b produced an event (appeared).
    expect(listEvents(d).map((e) => e.type)).toEqual(["appeared"]);
  });
});

describe("F-005 worker refuses to start without the ledger key", () => {
  it("assertSecretPresent throws when the secret is unset", () => {
    delete process.env.PROTOCOL_RADAR_HMAC_SECRET;
    expect(() => assertSecretPresent()).toThrow(/refuses to start/);
  });

  it("assertSecretPresent passes when the secret is set", () => {
    process.env.PROTOCOL_RADAR_HMAC_SECRET = "present";
    expect(() => assertSecretPresent()).not.toThrow();
  });
});
