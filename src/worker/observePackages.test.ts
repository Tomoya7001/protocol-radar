import { describe, expect, it } from "vitest";
import { openDatabase } from "../lib/db/connection";
import { runMigrations } from "../lib/db/migrate";
import type { Db } from "../lib/db/connection";
import {
  getLatestObservation,
  listEvents,
  listSources,
} from "../lib/db/repo";
import { verify, verifyFromRaw } from "../lib/ledger/ledger";
import { contentHash } from "../lib/fetch/hash";
import {
  normalizePackageBody,
  packageContentHash,
} from "../lib/fetch/packageRegistry";
import { FakeHttpClient, response } from "../lib/fetch/fakeClient";
import { observePackages } from "./observePackages";
import { packageSourceUrl, type PackageSource } from "../config/sources/packages";

function db(): Db {
  const d = openDatabase(":memory:");
  runMigrations(d);
  return d;
}

const NPM_PKG: PackageSource = {
  protocolKey: "mcp",
  protocolName: "Model Context Protocol",
  registry: "npm",
  packageName: "@modelcontextprotocol/sdk",
  label: "MCP TypeScript SDK (npm latest)",
  cadenceSeconds: 3600,
};

const PYPI_PKG: PackageSource = {
  protocolKey: "crewai",
  protocolName: "CrewAI",
  registry: "pypi",
  packageName: "crewai",
  label: "CrewAI Python package (PyPI latest)",
  cadenceSeconds: 3600,
};

/** A minimal npm registry document exposing dist-tags.latest. */
function npmDoc(version: string): string {
  return JSON.stringify({
    name: "@modelcontextprotocol/sdk",
    "dist-tags": { latest: version, next: "0.0.0-next" },
    versions: { [version]: { version } },
  });
}

/** A minimal PyPI JSON document exposing info.version. */
function pypiDoc(version: string): string {
  return JSON.stringify({ info: { name: "crewai", version }, releases: {} });
}

const NOW = new Date("2026-07-23T00:00:00.000Z");
const LATER = new Date("2026-07-23T12:00:00.000Z");

function sourceFor(d: Db, pkg: PackageSource) {
  const url = packageSourceUrl(pkg);
  return listSources(d).find((s) => s.url === url)!;
}

describe("F1 observePackages — npm + PyPI SDK version observation", () => {
  it("records a first-seen npm package as 'appeared' and stays raw-verifiable", async () => {
    const d = db();
    const client = new FakeHttpClient([response(200, npmDoc("1.29.0"))]);

    const result = await observePackages({
      db: d,
      client,
      now: NOW,
      sources: [NPM_PKG],
    });

    expect(result.packagesPolled).toBe(1);
    expect(result.eventsCreated).toBe(1);
    expect(result.packagesWithoutVersion).toBe(0);

    const events = listEvents(d);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("appeared");
    expect(events[0]!.summary).toBe("appeared at 1.29.0");

    // Provenance invariant: stored content_hash === sha256(stored body), and body is the
    // deterministic normalization encoding the parsed version.
    const obs = getLatestObservation(d, sourceFor(d, NPM_PKG).id)!;
    expect(obs.body).toBe(
      normalizePackageBody("npm", "@modelcontextprotocol/sdk", "1.29.0"),
    );
    expect(obs.content_hash).toBe(contentHash(obs.body!));
    expect(obs.content_hash).toBe(
      packageContentHash("npm", "@modelcontextprotocol/sdk", "1.29.0"),
    );

    expect(verify(d)).toEqual({ ok: true });
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("parses PyPI info.version (distinct payload shape from npm)", async () => {
    const d = db();
    await observePackages({
      db: d,
      client: new FakeHttpClient([response(200, pypiDoc("1.15.5"))]),
      now: NOW,
      sources: [PYPI_PKG],
    });

    const obs = getLatestObservation(d, sourceFor(d, PYPI_PKG).id)!;
    expect(obs.body).toBe(normalizePackageBody("pypi", "crewai", "1.15.5"));
    expect(listEvents(d)[0]!.summary).toBe("appeared at 1.15.5");
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("records a newer published version as 'version_bump'", async () => {
    const d = db();
    await observePackages({
      db: d,
      client: new FakeHttpClient([response(200, npmDoc("1.29.0"))]),
      now: NOW,
      sources: [NPM_PKG],
    });
    const bumped = await observePackages({
      db: d,
      client: new FakeHttpClient([response(200, npmDoc("1.30.0"))]),
      now: LATER,
      sources: [NPM_PKG],
    });

    expect(bumped.eventsCreated).toBe(1);
    const events = listEvents(d);
    expect(events).toHaveLength(2);
    expect(events[1]!.type).toBe("version_bump");
    expect(events[1]!.summary).toBe("version 1.29.0 -> 1.30.0");
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("is idempotent: an unchanged version adds no new event", async () => {
    const d = db();
    await observePackages({
      db: d,
      client: new FakeHttpClient([response(200, npmDoc("1.29.0"))]),
      now: NOW,
      sources: [NPM_PKG],
    });
    // Second poll returns the SAME latest version (even with extra JSON noise the parser ignores).
    const again = await observePackages({
      db: d,
      client: new FakeHttpClient([
        response(
          200,
          JSON.stringify({
            "dist-tags": { latest: "1.29.0" },
            noise: Math.floor(1) /* stable */,
          }),
        ),
      ]),
      now: LATER,
      sources: [NPM_PKG],
    });

    expect(again.eventsCreated).toBe(0);
    expect(listEvents(d)).toHaveLength(1);
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("handles a registry 404 gracefully: no event for a never-seen package", async () => {
    const d = db();
    const result = await observePackages({
      db: d,
      client: new FakeHttpClient([response(404)]),
      now: NOW,
      sources: [NPM_PKG],
    });

    expect(result.eventsCreated).toBe(0);
    expect(listEvents(d)).toHaveLength(0);
    // Source row is still created + bookkeeping advanced.
    expect(sourceFor(d, NPM_PKG)?.last_polled_at).toBe(NOW.toISOString());
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("records a 404 as 'vanished' after the package was present", async () => {
    const d = db();
    await observePackages({
      db: d,
      client: new FakeHttpClient([response(200, npmDoc("1.29.0"))]),
      now: NOW,
      sources: [NPM_PKG],
    });
    const gone = await observePackages({
      db: d,
      client: new FakeHttpClient([response(404)]),
      now: LATER,
      sources: [NPM_PKG],
    });

    expect(gone.eventsCreated).toBe(1);
    const events = listEvents(d);
    expect(events).toHaveLength(2);
    expect(events[1]!.type).toBe("vanished");
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("counts a 200 with no parseable version without fabricating one", async () => {
    const d = db();
    const result = await observePackages({
      db: d,
      // Payload has no dist-tags.latest at all.
      client: new FakeHttpClient([response(200, JSON.stringify({ name: "x" }))]),
      now: NOW,
      sources: [NPM_PKG],
    });

    expect(result.packagesWithoutVersion).toBe(1);
    expect(result.eventsCreated).toBe(0);
    expect(listEvents(d)).toHaveLength(0);
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("is deterministic: the same registry payload yields the same stored hash", async () => {
    const runHash = async (): Promise<string> => {
      const d = db();
      await observePackages({
        db: d,
        client: new FakeHttpClient([response(200, npmDoc("2.0.0"))]),
        now: NOW,
        sources: [NPM_PKG],
      });
      return getLatestObservation(d, sourceFor(d, NPM_PKG).id)!.content_hash!;
    };

    const [a, b] = await Promise.all([runHash(), runHash()]);
    expect(a).toBe(b);
    expect(a).toBe(
      packageContentHash("npm", "@modelcontextprotocol/sdk", "2.0.0"),
    );
  });

  it("observes npm and PyPI packages together into one raw-verifiable ledger", async () => {
    const d = db();
    const result = await observePackages({
      db: d,
      // NPM_PKG polled first, then PYPI_PKG — order matches the sources array.
      client: new FakeHttpClient([
        response(200, npmDoc("1.29.0")),
        response(200, pypiDoc("1.15.5")),
      ]),
      now: NOW,
      sources: [NPM_PKG, PYPI_PKG],
    });

    expect(result.packagesPolled).toBe(2);
    expect(result.eventsCreated).toBe(2);
    expect(listEvents(d).every((e) => e.type === "appeared")).toBe(true);
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });
});
