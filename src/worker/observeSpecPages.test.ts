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
import { normalizeSpecPage, specPageContentHash } from "../lib/fetch/specPage";
import { FakeHttpClient, response } from "../lib/fetch/fakeClient";
import { observeSpecPages } from "./observeSpecPages";
import type { SpecPageSource } from "../config/sources/specPages";

function db(): Db {
  const d = openDatabase(":memory:");
  runMigrations(d);
  return d;
}

const PAGE: SpecPageSource = {
  protocolKey: "mcp",
  protocolName: "Model Context Protocol",
  url: "https://modelcontextprotocol.io",
  label: "MCP spec site (content hash)",
  cadenceSeconds: 3600,
};

/** A minimal HTML spec page body. */
function html(inner: string): string {
  return `<!doctype html><html><head><style>.x{color:red}</style></head>` +
    `<body><main>${inner}</main><script>track()</script></body></html>`;
}

const NOW = new Date("2026-07-12T00:00:00.000Z");
const LATER = new Date("2026-07-12T12:00:00.000Z");

function specSource(d: Db) {
  return listSources(d).find((s) => s.url === PAGE.url)!;
}

describe("A2 observeSpecPages — generic spec-page content-hash observation", () => {
  it("records a first spec page as 'appeared' and stays raw-verifiable", async () => {
    const d = db();
    const client = new FakeHttpClient([response(200, html("<h1>Spec v1</h1>"))]);

    const result = await observeSpecPages({
      db: d,
      client,
      now: NOW,
      sources: [PAGE],
    });

    expect(result.pagesPolled).toBe(1);
    expect(result.eventsCreated).toBe(1);

    const events = listEvents(d);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("appeared");

    // Provenance invariant: stored content_hash === sha256(stored body), and body is the
    // deterministic normalization of the fetched page.
    const obs = getLatestObservation(d, specSource(d).id)!;
    expect(obs.content_hash).toBe(contentHash(obs.body!));
    expect(obs.body).toBe(normalizeSpecPage(html("<h1>Spec v1</h1>")));
    expect(obs.content_hash).toBe(specPageContentHash(html("<h1>Spec v1</h1>")));

    // Both proofs pass — including verifyFromRaw (the default /api/verify mode).
    expect(verify(d)).toEqual({ ok: true });
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("records a changed page body as 'spec_change' and stays verifiable", async () => {
    const d = db();
    await observeSpecPages({
      db: d,
      client: new FakeHttpClient([response(200, html("<p>alpha</p>"))]),
      now: NOW,
      sources: [PAGE],
    });
    const changed = await observeSpecPages({
      db: d,
      client: new FakeHttpClient([response(200, html("<p>beta</p>"))]),
      now: LATER,
      sources: [PAGE],
    });

    expect(changed.eventsCreated).toBe(1);
    const events = listEvents(d);
    expect(events).toHaveLength(2);
    expect(events[1]!.type).toBe("spec_change");

    const obs = getLatestObservation(d, specSource(d).id)!;
    expect(obs.content_hash).toBe(contentHash(obs.body!));
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("is idempotent: an unchanged (markup-noise-only) page adds no new event", async () => {
    const d = db();
    // Same normalized content, but differing insignificant whitespace/markup between polls.
    const first = html("<p>Stable   spec</p>");
    const second = html("<p>Stable spec</p>\n\n");

    await observeSpecPages({
      db: d,
      client: new FakeHttpClient([response(200, first)]),
      now: NOW,
      sources: [PAGE],
    });
    const again = await observeSpecPages({
      db: d,
      client: new FakeHttpClient([response(200, second)]),
      now: LATER,
      sources: [PAGE],
    });

    expect(again.eventsCreated).toBe(0);
    expect(listEvents(d)).toHaveLength(1);
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("records a 404 as 'vanished' after the page was present", async () => {
    const d = db();
    await observeSpecPages({
      db: d,
      client: new FakeHttpClient([response(200, html("<p>here</p>"))]),
      now: NOW,
      sources: [PAGE],
    });
    const gone = await observeSpecPages({
      db: d,
      client: new FakeHttpClient([response(404)]),
      now: LATER,
      sources: [PAGE],
    });

    expect(gone.eventsCreated).toBe(1);
    const events = listEvents(d);
    expect(events).toHaveLength(2);
    expect(events[1]!.type).toBe("vanished");

    // The vanish observation carries no body/hash, so verifyFromRaw stays green.
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("a 404 for a never-seen page produces no event (first-appearance rule)", async () => {
    const d = db();
    const result = await observeSpecPages({
      db: d,
      client: new FakeHttpClient([response(404)]),
      now: NOW,
      sources: [PAGE],
    });

    expect(result.eventsCreated).toBe(0);
    expect(listEvents(d)).toHaveLength(0);
    // Source row is still created + bookkeeping advanced.
    expect(specSource(d)?.last_polled_at).toBe(NOW.toISOString());
  });

  it("preserves the content_hash === sha256(body) invariant across appeared + spec_change", async () => {
    const d = db();
    await observeSpecPages({
      db: d,
      client: new FakeHttpClient([response(200, html("<p>one</p>"))]),
      now: NOW,
      sources: [PAGE],
    });
    await observeSpecPages({
      db: d,
      client: new FakeHttpClient([response(200, html("<p>two</p>"))]),
      now: LATER,
      sources: [PAGE],
    });

    // Every content observation stored must satisfy the invariant that keeps rawverify green.
    const obs = getLatestObservation(d, specSource(d).id)!;
    expect(obs.body).not.toBeNull();
    expect(obs.content_hash).toBe(contentHash(obs.body!));
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });
});
