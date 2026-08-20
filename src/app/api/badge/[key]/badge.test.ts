import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET as getBadge } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

const COLOR_GREEN = "#4c1";
const COLOR_YELLOW = "#dfb317";
const COLOR_GREY = "#9f9f9f";

function seedAndInject(): void {
  __setDbForTests(seededDb(NOW));
}

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

async function badge(key: string, query = ""): Promise<Response> {
  return getBadge(req(`/api/badge/${key}?now=${NOW}${query}`), {
    params: Promise.resolve({ key }),
  });
}

afterEach(() => {
  __setDbForTests(null);
});

describe("GET /api/badge/:key — upstream mirror (no target declared)", () => {
  it("renders an SVG showing the latest observed version, labelled by protocol", async () => {
    seedAndInject();
    const res = await badge("mcp");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");

    const body = await res.text();
    expect(body).toContain("<svg");
    expect(body).toContain("MCP");
    // The mcp fixture's newest version_bump is "version v1.0.0 -> v1.1.0".
    expect(body).toContain("v1.1.0");
  });

  it("prefers the version over the bare status — 'v1.1.0' informs, 'active' does not", async () => {
    seedAndInject();
    const body = await (await badge("mcp")).text();
    expect(body).not.toContain(">active<");
  });

  it("falls back to the status when no version has ever been observed", async () => {
    seedAndInject();
    // a2a is seeded with an "appeared" event only — no version_bump to parse.
    const body = await (await badge("a2a")).text();
    expect(body).toContain("A2A");
    expect(body).toContain("active");
  });

  it("colours a fresh, recently-changed protocol green", async () => {
    seedAndInject();
    expect(await (await badge("mcp")).text()).toContain(COLOR_GREEN);
  });
});

describe("GET /api/badge/:key — declared target (the reason to embed it)", () => {
  it("goes green when the declared target matches the latest observed version", async () => {
    seedAndInject();
    const body = await (await badge("mcp", "&target=v1.1.0")).text();

    expect(body).toContain(COLOR_GREEN);
    expect(body).toContain("v1.1.0");
    expect(body).toContain("matches the latest observed version");
  });

  it("goes yellow and says 'outdated' once upstream moves past the target", async () => {
    seedAndInject();
    const body = await (await badge("mcp", "&target=v1.0.0")).text();

    expect(body).toContain(COLOR_YELLOW);
    expect(body).toContain("outdated");
    // The tooltip carries the detail the 20px-tall badge cannot.
    expect(body).toContain("latest observed v1.1.0");
  });

  it("tolerates cosmetic version formatting differences", async () => {
    seedAndInject();
    // "1.1.0" vs upstream "v1.1.0" is the same release. Flagging it outdated would make
    // maintainers remove the badge.
    const body = await (await badge("mcp", "&target=1.1.0")).text();
    expect(body).toContain(COLOR_GREEN);
  });

  it("stays grey rather than claiming 'current' when nothing has been observed", async () => {
    seedAndInject();
    const body = await (await badge("a2a", "&target=v9.9.9")).text();

    expect(body).toContain(COLOR_GREY);
    expect(body).toContain("not yet observed");
  });

  it("accepts a custom label so a repo can badge its own name", async () => {
    seedAndInject();
    const body = await (await badge("mcp", "&label=my-server")).text();
    expect(body).toContain("my-server");
  });
});

describe("GET /api/badge/:key — hostile input", () => {
  it("escapes markup from the query string instead of injecting it into the SVG", async () => {
    seedAndInject();
    const body = await (
      await badge("mcp", "&label=%3Cscript%3Ealert(1)%3C%2Fscript%3E")
    ).text();

    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("truncates an over-long target so a badge cannot be bloated by its URL", async () => {
    seedAndInject();
    const body = await (await badge("mcp", `&target=${"9".repeat(500)}`)).text();
    expect(body).not.toContain("9".repeat(100));
    expect(body).toContain("…");
  });

  it("returns 404 JSON for an unknown protocol", async () => {
    seedAndInject();
    const res = await getBadge(req("/api/badge/nope"), {
      params: Promise.resolve({ key: "nope" }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe(
      "protocol_not_found",
    );
  });
});
