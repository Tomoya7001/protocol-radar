import { describe, it, expect } from "vitest";
import { openDatabase } from "./connection";
import { runMigrations } from "./migrate";
import {
  getProtocolByKey,
  getSourceById,
  insertProtocol,
  insertSource,
  listProtocols,
} from "./repo";
import type { Db } from "./connection";

function freshDb(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

interface TableName {
  name: string;
}

function tableNames(db: Db): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as TableName[]
  ).map((r) => r.name);
}

describe("F-001 db schema + migrations", () => {
  it("creates all tables on a fresh in-memory db", () => {
    const db = freshDb();
    const names = tableNames(db);
    for (const expected of [
      "protocols",
      "sources",
      "observations",
      "events",
      "diffs",
      "runs",
      "worker_lock",
      "schema_migrations",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("is idempotent: running migrations twice is a no-op", () => {
    const db = openDatabase(":memory:");
    const first = runMigrations(db);
    expect(first.applied).toEqual([1]);

    const second = runMigrations(db);
    expect(second.applied).toEqual([]);

    const applied = db
      .prepare("SELECT COUNT(*) AS c FROM schema_migrations")
      .get() as { c: number };
    expect(applied.c).toBe(1);
  });

  it("round-trips a protocol insert/select", () => {
    const db = freshDb();
    const inserted = insertProtocol(db, {
      key: "mcp",
      name: "Model Context Protocol",
      layer: "A",
    });
    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.status).toBe("active");
    expect(inserted.created_at).toMatch(/Z$/);

    const fetched = getProtocolByKey(db, "mcp");
    expect(fetched?.name).toBe("Model Context Protocol");
    expect(listProtocols(db)).toHaveLength(1);
  });

  it("round-trips a source insert/select bound to a protocol", () => {
    const db = freshDb();
    const proto = insertProtocol(db, { key: "a2a", name: "A2A" });
    const source = insertSource(db, {
      protocol_id: proto.id,
      kind: "github",
      url: "https://example.test/a2a",
      label: "a2a spec repo",
      cadence_seconds: 1800,
    });
    expect(source.protocol_id).toBe(proto.id);
    expect(source.active).toBe(1);
    expect(source.cadence_seconds).toBe(1800);

    const fetched = getSourceById(db, source.id);
    expect(fetched?.url).toBe("https://example.test/a2a");
    expect(fetched?.kind).toBe("github");
  });

  it("enforces foreign keys (source needs a real protocol)", () => {
    const db = freshDb();
    expect(() =>
      insertSource(db, {
        protocol_id: 9999,
        kind: "http",
        url: "https://example.test/nope",
      }),
    ).toThrow();
  });

  it("enforces the unique protocol key", () => {
    const db = freshDb();
    insertProtocol(db, { key: "x402", name: "x402" });
    expect(() => insertProtocol(db, { key: "x402", name: "dup" })).toThrow();
  });
});
