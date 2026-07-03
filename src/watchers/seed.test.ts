import { describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db/connection";
import { runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/db/connection";
import {
  getProtocolByKey,
  getSourceById,
  listSources,
} from "@/lib/db/repo";
import { FakeHttpClient, response } from "@/lib/fetch/fakeClient";
import { createMemoryLogger } from "@/lib/fetch/logger";
import {
  P0_PROTOCOL_KEYS,
  PROTOCOL_DEFS,
  WATCHLIST,
} from "@/config/sources";
import type { ProtocolDef } from "@/config/sources";
import { seedSources } from "./seed";

function db(): Db {
  const d = openDatabase(":memory:");
  runMigrations(d);
  return d;
}

describe("F-010..F-020 seed engine — idempotent upsert", () => {
  it("re-running the seed does NOT duplicate protocols or sources", async () => {
    const d = db();

    const first = await seedSources({ db: d, logger: createMemoryLogger() });
    expect(first.protocolsInserted).toBeGreaterThan(0);
    expect(first.sourcesInserted).toBeGreaterThan(0);

    const protocolsAfterFirst = getProtocolCount(d);
    const sourcesAfterFirst = listSources(d).length;

    // Second run over the SAME db: everything already exists → zero inserts.
    const second = await seedSources({ db: d, logger: createMemoryLogger() });
    expect(second.protocolsInserted).toBe(0);
    expect(second.sourcesInserted).toBe(0);
    expect(second.protocolsExisting).toBe(first.protocolsInserted);
    expect(second.sourcesExisting).toBe(first.sourcesInserted);

    // Row counts are unchanged after the re-run.
    expect(getProtocolCount(d)).toBe(protocolsAfterFirst);
    expect(listSources(d).length).toBe(sourcesAfterFirst);
  });

  it("registers each P0 protocol with at least one source (per-protocol registration AC)", async () => {
    const d = db();
    await seedSources({ db: d, logger: createMemoryLogger() });

    // F-010 MCP, F-011 A2A, F-012 x402, F-013 AP2, F-019 W3C are all P0.
    expect(P0_PROTOCOL_KEYS).toEqual(
      expect.arrayContaining(["mcp", "a2a", "x402", "ap2", "w3c-agent-protocol"]),
    );

    for (const key of P0_PROTOCOL_KEYS) {
      const proto = getProtocolByKey(d, key);
      expect(proto, `P0 protocol '${key}' must be registered`).toBeDefined();
      const sources = listSources(d).filter(
        (s) => s.protocol_id === proto!.id,
      );
      expect(
        sources.length,
        `P0 protocol '${key}' must have >= 1 source`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("F-010..F-020 seed engine — startup URL validation", () => {
  it("marks a 404 source INACTIVE and raises a TODO, keeping a healthy source active", async () => {
    const d = db();
    const logger = createMemoryLogger();

    // Two active http sources; validation HEADs them in insertion (id asc) order.
    const defs: ProtocolDef[] = [
      {
        key: "good",
        name: "Good Protocol",
        feature: "F-000",
        priority: "P0",
        sources: [
          {
            kind: "http",
            url: "https://good.test/spec",
            label: "good",
            cadenceSeconds: 3600,
          },
        ],
      },
      {
        key: "gone",
        name: "Gone Protocol",
        feature: "F-000",
        priority: "P0",
        sources: [
          {
            kind: "http",
            url: "https://gone.test/spec",
            label: "gone",
            cadenceSeconds: 3600,
          },
        ],
      },
    ];

    // HEAD good => 200 (stays active); HEAD gone => 404 (flip inactive + TODO).
    const client = new FakeHttpClient([response(200), response(404)]);

    const result = await seedSources({
      db: d,
      defs,
      watchlist: [], // isolate: only the two http sources get validated
      client,
      logger,
    });

    expect(result.sourcesValidated).toBe(2);
    expect(result.sourcesDeactivated).toBe(1);

    const good = getSourceById(d, sourceIdByUrl(d, "https://good.test/spec"));
    const gone = getSourceById(d, sourceIdByUrl(d, "https://gone.test/spec"));
    expect(good?.active).toBe(1);
    expect(gone?.active).toBe(0);

    // A TODO was recorded AND logged (never invent a replacement URL).
    expect(result.todos.some((t) => t.includes("https://gone.test/spec"))).toBe(
      true,
    );
    expect(
      logger.lines.some(
        (l) => l.startsWith("[TODO]") && l.includes("gone.test"),
      ),
    ).toBe(true);

    // Validation is idempotent: re-running keeps the 404 source inactive (skipped, not
    // revalidated) and does not resurrect it.
    const rerun = await seedSources({
      db: d,
      defs,
      watchlist: [],
      client: new FakeHttpClient([response(200)]), // only the still-active source is checked
      logger: createMemoryLogger(),
    });
    expect(rerun.sourcesValidated).toBe(1);
    expect(getSourceById(d, gone!.id)?.active).toBe(0);
  });

  it("ships config-inactive sources inactive with a TODO (never fabricates a URL)", async () => {
    const d = db();
    const logger = createMemoryLogger();
    // Real config includes sources whose canonical URL is unverified (A2A site, FIDO WG,
    // W3C CG, UCP, A2UI, TAP, ANP, both watchlist entries). They must ship inactive + TODO.
    const result = await seedSources({ db: d, logger });

    const inactive = listSources(d).filter((s) => s.active === 0);
    expect(inactive.length).toBeGreaterThan(0);
    expect(result.todos.length).toBeGreaterThan(0);

    // Every config source flagged active:false is seeded inactive. URLs are NOT unique across
    // protocols (a watchlist placeholder may reuse a real site), so scope the lookup by the
    // owning protocol key + url.
    const inactiveByKey: { key: string; url: string }[] = [
      ...PROTOCOL_DEFS.flatMap((defn) =>
        defn.sources
          .filter((s) => s.active === false)
          .map((s) => ({ key: defn.key, url: s.url })),
      ),
      ...WATCHLIST.filter((w) => w.active === false).map((w) => ({
        key: w.key,
        url: w.url,
      })),
    ];
    for (const { key, url } of inactiveByKey) {
      const proto = getProtocolByKey(d, key);
      const src = listSources(d).find(
        (s) => s.protocol_id === proto!.id && s.url === url,
      );
      expect(src?.active, `${key} source ${url} must ship inactive`).toBe(0);
    }

    // Config integrity: any inactive-by-config source declares a reason (TODO).
    for (const defn of PROTOCOL_DEFS) {
      for (const s of defn.sources) {
        if (s.active === false) {
          expect(s.todo, `${s.url} inactive source needs a TODO`).toBeTruthy();
        }
      }
    }
    for (const w of WATCHLIST) {
      if (w.active === false) {
        expect(w.todo, `${w.url} inactive watch entry needs a TODO`).toBeTruthy();
      }
    }
  });
});

function getProtocolCount(d: Db): number {
  const row = d
    .prepare("SELECT COUNT(*) AS n FROM protocols")
    .get() as { n: number };
  return row.n;
}

function sourceIdByUrl(d: Db, url: string): number {
  const src = listSources(d).find((s) => s.url === url);
  if (!src) throw new Error(`no source seeded for ${url}`);
  return src.id;
}
