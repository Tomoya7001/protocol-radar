import { afterEach, describe, expect, it } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { openDatabase, type Db } from "@/lib/db/connection";
import { runMigrations } from "@/lib/db/migrate";
import { FakeHttpClient, response } from "@/lib/fetch/fakeClient";
import { observePackages } from "@/worker/observePackages";
import type { PackageSource } from "@/config/sources/packages";
import { handleSdkVersions } from "./handler";

const NOW = Date.parse("2026-07-23T00:00:00.000Z");

const NPM_PKG: PackageSource = {
  protocolKey: "mcp",
  protocolName: "Model Context Protocol",
  registry: "npm",
  packageName: "@modelcontextprotocol/sdk",
  label: "MCP TypeScript SDK (npm latest)",
  cadenceSeconds: 3600,
};

function migratedDb(): Db {
  const d = openDatabase(":memory:");
  runMigrations(d);
  return d;
}

function req(path: string): Request {
  const sep = path.includes("?") ? "&" : "?";
  return new Request(`http://test.local${path}${sep}now=${NOW}`);
}

afterEach(() => {
  __setDbForTests(null);
});

interface Body {
  generated_at: string;
  protocol_count: number;
  package_count: number;
  protocols: Array<{
    key: string;
    name: string;
    packages: Array<{
      registry: string;
      package: string;
      url: string;
      latest_version: string | null;
      observed_at: string | null;
    }>;
  }>;
}

describe("F1 GET /api/sdk-versions", () => {
  it("returns the observed latest version per protocol/package", async () => {
    const d = migratedDb();
    await observePackages({
      db: d,
      client: new FakeHttpClient([
        response(200, JSON.stringify({ "dist-tags": { latest: "1.29.0" } })),
      ]),
      now: new Date(NOW),
      sources: [NPM_PKG],
    });
    __setDbForTests(d);

    const res = handleSdkVersions(req("/api/sdk-versions?protocol=mcp"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as Body;
    expect(body.generated_at).toBe(new Date(NOW).toISOString());
    expect(body.protocol_count).toBe(1);
    expect(body.package_count).toBe(1);

    const mcp = body.protocols[0]!;
    expect(mcp.key).toBe("mcp");
    const pkg = mcp.packages[0]!;
    expect(pkg.registry).toBe("npm");
    expect(pkg.package).toBe("@modelcontextprotocol/sdk");
    expect(pkg.url).toBe("https://registry.npmjs.org/@modelcontextprotocol/sdk");
    expect(pkg.latest_version).toBe("1.29.0");
    expect(pkg.observed_at).toBe(new Date(NOW).toISOString());
  });

  it("reports null latest_version for a package never observed yet", async () => {
    const d = migratedDb();
    __setDbForTests(d);

    const res = handleSdkVersions(req("/api/sdk-versions?protocol=mcp"));
    const body = (await res.json()) as Body;
    expect(body.protocol_count).toBe(1);
    const pkg = body.protocols[0]!.packages[0]!;
    expect(pkg.latest_version).toBeNull();
    expect(pkg.observed_at).toBeNull();
  });

  it("is deterministic: protocols and packages are key-sorted", async () => {
    const d = migratedDb();
    __setDbForTests(d);

    const res = handleSdkVersions(req("/api/sdk-versions"));
    const body = (await res.json()) as Body;
    const keys = body.protocols.map((p) => p.key);
    expect(keys).toEqual([...keys].sort());
    for (const p of body.protocols) {
      const labels = p.packages.map((k) => `${k.registry}:${k.package}`);
      expect(labels).toEqual([...labels].sort());
    }
  });
});
