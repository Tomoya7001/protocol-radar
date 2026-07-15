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
import { FakeHttpClient, response } from "../lib/fetch/fakeClient";
import { observeReleases } from "./observeReleases";
import type { GithubReleaseRepo } from "../config/sources/releases";

function db(): Db {
  const d = openDatabase(":memory:");
  runMigrations(d);
  return d;
}

const REPO: GithubReleaseRepo = {
  protocolKey: "mcp",
  protocolName: "Model Context Protocol",
  repo: "modelcontextprotocol/modelcontextprotocol",
  label: "MCP spec repo releases",
  cadenceSeconds: 3600,
};

/** A minimal GitHub Releases API payload (only the field we consume). */
function releasesJson(tags: string[]): string {
  return JSON.stringify(tags.map((t) => ({ tag_name: t, name: t })));
}

const NOW = new Date("2026-07-12T00:00:00.000Z");

describe("残② observeReleases — real-source GitHub Releases observation", () => {
  it("records a first release as 'appeared' and stays raw-verifiable", async () => {
    const d = db();
    const client = new FakeHttpClient([
      response(200, releasesJson(["v1.2.0", "v1.1.0"])),
    ]);

    const result = await observeReleases({
      db: d,
      client,
      now: NOW,
      repos: [REPO],
    });

    expect(result.reposPolled).toBe(1);
    expect(result.eventsCreated).toBe(1);
    expect(result.reposWithoutReleases).toBe(0);

    const events = listEvents(d);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("appeared");

    // Provenance invariant: stored content_hash === sha256(stored body).
    const src = listSources(d).find((s) => s.url.includes("/releases"))!;
    const obs = getLatestObservation(d, src.id)!;
    expect(obs.content_hash).toBe(contentHash(obs.body!));

    // Both proofs pass — including verifyFromRaw (the default /api/verify mode).
    expect(verify(d)).toEqual({ ok: true });
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("is idempotent: an unchanged release list adds no new event", async () => {
    const d = db();
    const body = releasesJson(["v1.2.0", "v1.1.0"]);

    await observeReleases({
      db: d,
      client: new FakeHttpClient([response(200, body)]),
      now: NOW,
      repos: [REPO],
    });
    const second = await observeReleases({
      db: d,
      client: new FakeHttpClient([response(200, body)]),
      now: new Date("2026-07-12T06:00:00.000Z"),
      repos: [REPO],
    });

    expect(second.eventsCreated).toBe(0);
    expect(listEvents(d)).toHaveLength(1);
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("records a new release as 'version_bump' and stays verifiable", async () => {
    const d = db();
    await observeReleases({
      db: d,
      client: new FakeHttpClient([response(200, releasesJson(["v1.2.0"]))]),
      now: NOW,
      repos: [REPO],
    });
    const bump = await observeReleases({
      db: d,
      client: new FakeHttpClient([
        response(200, releasesJson(["v1.3.0", "v1.2.0"])),
      ]),
      now: new Date("2026-07-12T06:00:00.000Z"),
      repos: [REPO],
    });

    expect(bump.eventsCreated).toBe(1);
    const events = listEvents(d);
    expect(events).toHaveLength(2);
    expect(events[1]!.type).toBe("version_bump");
    expect(events[1]!.summary).toContain("v1.2.0 -> v1.3.0");
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("a repo with no releases yet produces no event (first-appearance rule)", async () => {
    const d = db();
    const result = await observeReleases({
      db: d,
      client: new FakeHttpClient([response(200, "[]")]),
      now: NOW,
      repos: [REPO],
    });

    expect(result.reposWithoutReleases).toBe(1);
    expect(result.eventsCreated).toBe(0);
    expect(listEvents(d)).toHaveLength(0);
    // Source row is still created + bookkeeping advanced.
    const src = listSources(d).find((s) => s.url.includes("/releases"));
    expect(src?.last_polled_at).toBe(NOW.toISOString());
  });

  it("a 304 not_modified poll adds no event", async () => {
    const d = db();
    await observeReleases({
      db: d,
      client: new FakeHttpClient([response(200, releasesJson(["v1.0.0"]))]),
      now: NOW,
      repos: [REPO],
    });
    const again = await observeReleases({
      db: d,
      client: new FakeHttpClient([response(304)]),
      now: new Date("2026-07-12T06:00:00.000Z"),
      repos: [REPO],
    });

    expect(again.eventsCreated).toBe(0);
    expect(listEvents(d)).toHaveLength(1);
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });
});
