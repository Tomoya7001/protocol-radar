import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import type { ProtocolDetailDto } from "@/app/_data/queries";
import {
  CHANGELOG_CONTENT_TYPE,
  renderChangelogMarkdown,
} from "@/lib/changelog/render";
import { GET as getChangelog } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

function seedAndInject(): void {
  __setDbForTests(seededDb(NOW));
}

function call(key: string): Promise<Response> {
  const req = new Request(`http://test.local/api/changelog/${key}?now=${NOW}`);
  return getChangelog(req, { params: Promise.resolve({ key }) });
}

/** True if the string contains a control char other than newline (0x0a). */
function hasStrayControl(value: string): boolean {
  return [...value].some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x0a) return false;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

afterEach(() => {
  __setDbForTests(null);
});

describe("GET /api/changelog/[key]", () => {
  it("returns Markdown for a known protocol with heading, status summary and footer", async () => {
    seedAndInject();
    const res = await call("mcp");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(CHANGELOG_CONTENT_TYPE);

    const body = await res.text();
    expect(body).toContain("# Model Context Protocol changelog");
    expect(body).toContain("Protocol key: `mcp`");
    expect(body).toMatch(/^Status: active · Freshness: .+ · Events: 3$/m);
    // Each event becomes a `## {iso} — {type}` section with its summary body.
    expect(body).toContain("— spec change");
    expect(body).toContain("12 lines added, 3 removed");
    expect(body).toContain("version v1.0.0 -> v1.1.0");
    expect(body).toContain("appeared at v1.0.0");
    expect(body).toMatch(/_Generated at .+Z\._\s*$/);
  });

  it("orders events newest-first", async () => {
    seedAndInject();
    const body = await (await call("mcp")).text();

    const newest = body.indexOf("12 lines added, 3 removed"); // spec_change (latest)
    const middle = body.indexOf("version v1.0.0 -> v1.1.0"); // version_bump
    const oldest = body.indexOf("appeared at v1.0.0"); // appeared (earliest)

    expect(newest).toBeGreaterThanOrEqual(0);
    expect(middle).toBeGreaterThan(newest);
    expect(oldest).toBeGreaterThan(middle);
  });

  it("returns 200 with an empty-changelog notice for a protocol with no events", async () => {
    seedAndInject();
    const res = await call("ucp");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(CHANGELOG_CONTENT_TYPE);

    const body = await res.text();
    expect(body).toContain("# Universal Commerce Protocol changelog");
    expect(body).toMatch(/^Status: active · Freshness: .+ · Events: 0$/m);
    expect(body).toContain("_No recorded changes yet._");
    expect(body).not.toContain("## ");
  });

  it("returns 404 plain text for an unknown key", async () => {
    seedAndInject();
    const res = await call("does-not-exist");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("Protocol not found: does-not-exist");
  });
});

describe("renderChangelogMarkdown (pure)", () => {
  function detail(
    events: ProtocolDetailDto["events"],
    over: Partial<ProtocolDetailDto["protocol"]> = {},
  ): ProtocolDetailDto {
    return {
      protocol: {
        key: "demo",
        name: "Demo Protocol",
        layer: "B",
        status: "active",
        freshness: "fresh",
        stale_warning: false,
        event_count: events.length,
        last_event: null,
        sources: [],
        ...over,
      },
      events,
    };
  }

  function event(
    seq: number,
    over: Partial<ProtocolDetailDto["events"][number]> = {},
  ): ProtocolDetailDto["events"][number] {
    return {
      seq,
      type: "spec_change",
      summary: "a change",
      created_at: "2026-07-01T00:00:00.000Z",
      hash: "h",
      prev_hash: "p",
      source_id: null,
      ref_observation_id: null,
      diffs: [],
      ...over,
    };
  }

  it("re-sorts events by descending seq regardless of input order", () => {
    const md = renderChangelogMarkdown(
      detail([
        event(1, { summary: "OLD change", created_at: "2026-01-01T00:00:00.000Z" }),
        event(3, { summary: "NEW change", created_at: "2026-03-01T00:00:00.000Z" }),
        event(2, { summary: "MID change", created_at: "2026-02-01T00:00:00.000Z" }),
      ]),
      NOW,
    );
    expect(md.indexOf("NEW change")).toBeLessThan(md.indexOf("MID change"));
    expect(md.indexOf("MID change")).toBeLessThan(md.indexOf("OLD change"));
  });

  it("defuses Markdown-structure injection in summaries", () => {
    const md = renderChangelogMarkdown(
      detail([event(1, { summary: "# Fake heading\n> quote\n--- rule" })]),
      NOW,
    );
    // A leading '#'/'>'/'---' from summary content must be escaped, not left as structure.
    expect(md).toContain("\\# Fake heading");
    expect(md).toContain("\\> quote");
    expect(md).toContain("\\--- rule");
    // The only real level-1 heading is the document title.
    expect(md.match(/^# /gm)?.length).toBe(1);
  });

  it("strips control characters from headings and body", () => {
    const bell = String.fromCharCode(0x07);
    const md = renderChangelogMarkdown(
      detail([
        event(1, {
          summary: `left${bell}right`,
          created_at: `2026-07-01T00:00:00.000Z${bell}`,
        }),
      ]),
      NOW,
    );
    expect(hasStrayControl(md)).toBe(false);
    // Control byte becomes a single space between the surrounding text.
    expect(md).toContain("left right");
  });

  it("emits an ISO generation footer and 'unknown' for a non-finite stamp", () => {
    expect(renderChangelogMarkdown(detail([]), NOW)).toMatch(
      /_Generated at 2026-07-02T00:00:00\.000Z\._/,
    );
    expect(renderChangelogMarkdown(detail([]), Number.NaN)).toContain(
      "_Generated at unknown._",
    );
  });
});
