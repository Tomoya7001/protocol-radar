import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/connection";
import { runMigrations } from "../db/migrate";
import {
  getProtocolById,
  getSourceById,
  insertProtocol,
  insertSource,
  listDiffsForEvent,
  listEvents,
} from "../db/repo";
import type { Db } from "../db/connection";
import { verify } from "../ledger/ledger";
import { contentHash } from "../fetch/hash";
import type { FetchOutcome } from "../fetch/fetchCore";
import { classifyAndAppend } from "./engine";
import { compareVersions, parseSemver } from "./version";
import { summarizeBodyDiff } from "./bodyDiff";

function setup(): { db: Db; protocolId: number; sourceId: number } {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const protocol = insertProtocol(db, { key: "mcp", name: "MCP" });
  const source = insertSource(db, {
    protocol_id: protocol.id,
    kind: "http",
    url: "https://example.test/spec",
  });
  return { db, protocolId: protocol.id, sourceId: source.id };
}

function content(body: string): Extract<FetchOutcome, { kind: "content" }> {
  return {
    kind: "content",
    httpStatus: 200,
    body,
    contentHash: contentHash(body),
    etag: null,
    lastModified: null,
  };
}

const T0 = "2026-07-02T00:00:00.000Z";
const T1 = "2026-07-02T01:00:00.000Z";
const T2 = "2026-07-02T02:00:00.000Z";

describe("F-004 diff engine — classification", () => {
  it("first observation => 'appeared' with an appear diff row", () => {
    const { db, protocolId, sourceId } = setup();
    const result = classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T0,
      outcome: content("v1 body"),
    });
    expect(result.eventType).toBe("appeared");
    expect(result.event).not.toBeNull();
    const diffs = listDiffsForEvent(db, result.event!.id);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.kind).toBe("appear");
    expect(verify(db).ok).toBe(true);
  });

  it("unchanged body => NO event, NO observation", () => {
    const { db, protocolId, sourceId } = setup();
    classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T0,
      outcome: content("same body"),
    });
    const before = listEvents(db).length;

    const result = classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T1,
      outcome: content("same body"),
    });
    expect(result.eventType).toBeNull();
    expect(result.event).toBeNull();
    expect(listEvents(db)).toHaveLength(before);
  });

  it("changed body (no version) => 'spec_change' with a body diff row", () => {
    const { db, protocolId, sourceId } = setup();
    classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T0,
      outcome: content("line a\nline b"),
    });
    const result = classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T1,
      outcome: content("line a\nline c\nline d"),
    });
    expect(result.eventType).toBe("spec_change");
    const diffs = listDiffsForEvent(db, result.event!.id);
    expect(diffs[0]?.kind).toBe("body");
    expect(diffs[0]?.detail).toMatch(/body changed/);
    expect(verify(db).ok).toBe(true);
  });

  it("version bump => 'version_bump' with a version diff row (even if body differs)", () => {
    const { db, protocolId, sourceId } = setup();
    classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T0,
      outcome: content("tags payload v1"),
      version: "v1.0.0",
      prevVersion: null,
    });
    const result = classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T1,
      outcome: content("tags payload v2"),
      version: "v2.0.0",
      prevVersion: "v1.0.0",
    });
    expect(result.eventType).toBe("version_bump");
    const diffs = listDiffsForEvent(db, result.event!.id);
    expect(diffs[0]?.kind).toBe("version");
    expect(diffs[0]?.detail).toBe("v1.0.0 -> v2.0.0");
    expect(verify(db).ok).toBe(true);
  });

  it("absent after present => 'vanished' + sets protocol/source status", () => {
    const { db, protocolId, sourceId } = setup();
    classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T0,
      outcome: content("present body"),
    });
    const result = classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T1,
      outcome: { kind: "absent", httpStatus: 404 },
    });
    expect(result.eventType).toBe("vanished");
    expect(getProtocolById(db, protocolId)?.status).toBe("vanished");
    expect(getSourceById(db, sourceId)?.active).toBe(0);
    const diffs = listDiffsForEvent(db, result.event!.id);
    expect(diffs[0]?.kind).toBe("vanish");
    expect(verify(db).ok).toBe(true);
  });

  it("absent with no prior presence => NO event", () => {
    const { db, protocolId, sourceId } = setup();
    const result = classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T0,
      outcome: { kind: "absent", httpStatus: 404 },
    });
    expect(result.eventType).toBeNull();
    expect(listEvents(db)).toHaveLength(0);
  });

  it("reappearance after vanish => 'appeared' + reactivates", () => {
    const { db, protocolId, sourceId } = setup();
    classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T0,
      outcome: content("body"),
    });
    classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T1,
      outcome: { kind: "absent", httpStatus: 404 },
    });
    const result = classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T2,
      outcome: content("body again"),
    });
    expect(result.eventType).toBe("appeared");
    expect(getProtocolById(db, protocolId)?.status).toBe("active");
    expect(getSourceById(db, sourceId)?.active).toBe(1);
    expect(verify(db).ok).toBe(true);
  });

  it("not_modified / error => nothing recorded", () => {
    const { db, protocolId, sourceId } = setup();
    classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T0,
      outcome: content("body"),
    });
    const before = listEvents(db).length;
    classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T1,
      outcome: { kind: "not_modified", httpStatus: 304 },
    });
    classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T2,
      outcome: { kind: "error", httpStatus: 500, message: "boom" },
    });
    expect(listEvents(db)).toHaveLength(before);
  });

  it("ledger stays verifiable across a mixed sequence of diff-driven appends", () => {
    const { db, protocolId, sourceId } = setup();
    classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T0,
      outcome: content("v1"),
      version: "v1.0.0",
    });
    classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T1,
      outcome: content("v2"),
      version: "v1.1.0",
      prevVersion: "v1.0.0",
    });
    classifyAndAppend({
      db,
      protocolId,
      sourceId,
      fetchedAt: T2,
      outcome: content("v2 edited"),
      version: "v1.1.0",
      prevVersion: "v1.1.0",
    });
    expect(listEvents(db).length).toBe(3);
    expect(verify(db)).toEqual({ ok: true });
  });
});

describe("F-004 version comparison", () => {
  it("orders semver correctly", () => {
    expect(compareVersions("v1.0.0", "v2.0.0")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.0", "v1.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
  });

  it("handles non-semver tags gracefully (deterministic, differs => nonzero)", () => {
    expect(parseSemver("2026-07-02")).toBeNull();
    expect(compareVersions("2026-07-01", "2026-07-02")).toBeLessThan(0);
    expect(compareVersions("draft-a", "draft-a")).toBe(0);
    expect(compareVersions("main", "release")).not.toBe(0);
  });
});

describe("F-004 body diff summary", () => {
  it("counts added/removed lines", () => {
    const s = summarizeBodyDiff("a\nb\nc", "a\nx\nc\nd");
    expect(s.addedLines).toBe(2);
    expect(s.removedLines).toBe(1);
  });
});
