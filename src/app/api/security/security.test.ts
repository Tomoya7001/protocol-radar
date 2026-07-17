import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { FakeHttpClient, response, type HttpClient } from "@/lib/fetch";
import {
  normalizeGithubAdvisories,
  githubAdvisoryUrl,
} from "@/lib/fetch/advisories";
import { handleSecurity } from "./handler";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

// A realistic GitHub Security Advisories item (only the fields we consume).
const GHSA_ITEM = {
  ghsa_id: "GHSA-xxxx-yyyy-zzzz",
  cve_id: "CVE-2026-0001",
  summary: "Example advisory in the MCP spec repo",
  severity: "high",
  published_at: "2026-06-01T00:00:00Z",
  html_url:
    "https://github.com/modelcontextprotocol/modelcontextprotocol/security/advisories/GHSA-xxxx-yyyy-zzzz",
  vulnerabilities: [
    {
      package: { ecosystem: "npm", name: "mcp" },
      vulnerable_version_range: ">= 1.0.0, < 1.2.3",
    },
  ],
};

function seedAndInject(): void {
  __setDbForTests(seededDb(NOW));
}

// Append a deterministic `now` so generated_at is stable, preserving any existing query.
function req(path: string): Request {
  const sep = path.includes("?") ? "&" : "?";
  return new Request(`http://test.local${path}${sep}now=${NOW}`);
}

afterEach(() => {
  __setDbForTests(null);
});

describe("A3 GET /api/security", () => {
  it("returns normalized advisories for a protocol with a real target", async () => {
    seedAndInject();
    const client = new FakeHttpClient([
      response(200, JSON.stringify([GHSA_ITEM]), { etag: '"abc"' }),
    ]);
    const res = await handleSecurity(req("/api/security?protocol=mcp"), client);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toContain("s-maxage");

    const body = (await res.json()) as {
      generated_at: string;
      protocols: Array<{
        key: string;
        name: string;
        advisory_count: number;
        advisories: Array<Record<string, unknown>>;
      }>;
    };
    expect(body.generated_at).toBe(new Date(NOW).toISOString());
    expect(body.protocols).toHaveLength(1);
    const p = body.protocols[0];
    expect(p.key).toBe("mcp");
    expect(p.advisory_count).toBe(1);

    const adv = p.advisories[0];
    expect(adv).toMatchObject({
      id: "GHSA-xxxx-yyyy-zzzz",
      summary: "Example advisory in the MCP spec repo",
      severity: "high",
      published: "2026-06-01T00:00:00Z",
      affected_versions: [">= 1.0.0, < 1.2.3"],
    });
    expect(typeof adv.url).toBe("string");

    // The lookup hit the real GitHub Security Advisories endpoint for the mapped repo.
    expect(client.calls[0].url).toBe(
      githubAdvisoryUrl("modelcontextprotocol", "modelcontextprotocol"),
    );
  });

  it("returns advisories:[] gracefully when the repo has none (empty array)", async () => {
    seedAndInject();
    const client = new FakeHttpClient([response(200, "[]")]);
    const res = await handleSecurity(req("/api/security?protocol=x402"), client);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      protocols: Array<{
        advisories: unknown[];
        advisory_count: number;
        error?: string;
      }>;
    };
    expect(body.protocols[0].advisories).toEqual([]);
    expect(body.protocols[0].advisory_count).toBe(0);
    expect(body.protocols[0].error).toBeUndefined();
  });

  it("degrades gracefully (no 500) with advisories:[] + error note on upstream failure", async () => {
    seedAndInject();
    // 3 attempts of 500 -> fetchSource returns an error outcome.
    const client = new FakeHttpClient([
      response(500),
      response(500),
      response(500),
    ]);
    const res = await handleSecurity(req("/api/security?protocol=mcp"), client);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      protocols: Array<{ advisories: unknown[]; error?: string }>;
    };
    expect(body.protocols[0].advisories).toEqual([]);
    expect(typeof body.protocols[0].error).toBe("string");
    expect(body.protocols[0].error).toContain("upstream_500");
  });

  it("returns all protocols when no filter is given (repo-less protocols => empty)", async () => {
    seedAndInject();
    // Seeded protocols: a2a, mcp, oldproto, ucp, x402. Targets exist for a2a, mcp, x402.
    // Script empty arrays; order-independent since every target returns [].
    const client = new FakeHttpClient(
      Array.from({ length: 3 }, () => response(200, "[]")),
    );
    const res = await handleSecurity(req("/api/security"), client);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      protocols: Array<{ key: string; advisory_count: number }>;
    };
    const keys = body.protocols.map((p) => p.key);
    expect(keys).toEqual(["a2a", "mcp", "oldproto", "ucp", "x402"]);
    for (const p of body.protocols) expect(p.advisory_count).toBe(0);
    // Only the 3 protocols with real targets triggered an outbound call.
    expect(client.calls).toHaveLength(3);
  });

  it("returns 404 for an unknown protocol filter", async () => {
    seedAndInject();
    const client = new FakeHttpClient([]);
    const res = await handleSecurity(req("/api/security?protocol=nope"), client);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("protocol_not_found");
    expect(client.calls).toHaveLength(0); // validated before any network call
  });

  it("returns 400 for an invalid limit", async () => {
    seedAndInject();
    const client = new FakeHttpClient([]);
    for (const bad of ["0", "-1", "abc", "9999"]) {
      const res = await handleSecurity(
        req(`/api/security?limit=${bad}`),
        client,
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("invalid_limit");
    }
    expect(client.calls).toHaveLength(0);
  });

  it("caps advisories per protocol at ?limit=", async () => {
    seedAndInject();
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...GHSA_ITEM,
      ghsa_id: `GHSA-000${i}`,
    }));
    const client = new FakeHttpClient([response(200, JSON.stringify(many))]);
    const res = await handleSecurity(
      req("/api/security?protocol=mcp&limit=2"),
      client,
    );
    const body = (await res.json()) as {
      protocols: Array<{ advisory_count: number; advisories: unknown[] }>;
    };
    expect(body.protocols[0].advisory_count).toBe(2);
    expect(body.protocols[0].advisories).toHaveLength(2);
  });
});

describe("normalizeGithubAdvisories (pure)", () => {
  it("normalizes to the {id,summary,severity,published,url,affected_versions?} shape", () => {
    const out = normalizeGithubAdvisories(JSON.stringify([GHSA_ITEM]));
    expect(out).toEqual([
      {
        id: "GHSA-xxxx-yyyy-zzzz",
        summary: "Example advisory in the MCP spec repo",
        severity: "high",
        published: "2026-06-01T00:00:00Z",
        url: GHSA_ITEM.html_url,
        affected_versions: [">= 1.0.0, < 1.2.3"],
      },
    ]);
  });

  it("falls back to cve_id and omits affected_versions when absent", () => {
    const out = normalizeGithubAdvisories(
      JSON.stringify([
        { cve_id: "CVE-2026-9999", summary: "s", html_url: "https://x/y" },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("CVE-2026-9999");
    expect(out[0].severity).toBeNull();
    expect(out[0].published).toBeNull();
    expect(out[0].affected_versions).toBeUndefined();
  });

  it("is total: returns [] on malformed / non-array payloads and skips id-less items", () => {
    expect(normalizeGithubAdvisories("not json")).toEqual([]);
    expect(normalizeGithubAdvisories(JSON.stringify({}))).toEqual([]);
    expect(
      normalizeGithubAdvisories(JSON.stringify([{ summary: "no id here" }])),
    ).toEqual([]);
  });
});

// Guard: the exported client interface is what we inject in production.
const _typecheck: HttpClient = new FakeHttpClient([]);
void _typecheck;
