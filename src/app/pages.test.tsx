import { describe, it, expect, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb, tamperRawBody } from "@/app/_data/fixtures";
import DashboardPage from "./page";
import ProtocolDetailPage from "./protocols/[key]/page";
import VerifyPage from "./verify/page";

/**
 * F-030/F-031/F-033/F-034 (+ F-035) page-render proofs. Each test seeds the deterministic
 * fixture ledger (seedSampleData via seededDb), injects it as the shared read connection,
 * renders the real async page component to static markup, and asserts the seeded data is
 * present. `?now=` pins freshness so classification is reproducible offline.
 */

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const NOW_S = String(NOW);
const SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;

/** Await an async server component and render it to a static HTML string. */
async function render(el: Promise<ReactElement>): Promise<string> {
  return renderToStaticMarkup(await el);
}

afterEach(() => {
  __setDbForTests(null);
  process.env.PROTOCOL_RADAR_HMAC_SECRET = SECRET;
});

describe("F-030 / F-033 dashboard page", () => {
  it("renders every seeded protocol with its freshness (ja)", async () => {
    __setDbForTests(seededDb(NOW));
    const html = await render(
      DashboardPage({ searchParams: Promise.resolve({ now: NOW_S }) }),
    );

    // F-030: every protocol from the fixture is listed.
    expect(html).toContain("プロトコル一覧");
    expect(html).toContain("Model Context Protocol");
    expect(html).toContain("Agent2Agent");
    expect(html).toContain("Universal Commerce Protocol");
    expect(html).toContain("Deprecated Protocol");

    // F-033: freshness surfaced — the stale protocol shows the decay label and warning.
    expect(html).toContain("最新"); // mcp is fresh
    expect(html).toContain("更新停滞"); // a2a is stale (decay warning)
    expect(html).toContain("消失"); // oldproto vanished
  });

  it("renders english strings when ?lang=en (F-035)", async () => {
    __setDbForTests(seededDb(NOW));
    const html = await render(
      DashboardPage({
        searchParams: Promise.resolve({ now: NOW_S, lang: "en" }),
      }),
    );
    expect(html).toContain("Protocols");
    expect(html).toContain("Stale");
    expect(html).not.toContain("プロトコル一覧");
  });
});

describe("F-031 protocol detail page", () => {
  it("renders the full event timeline with ledger hashes for a known protocol", async () => {
    __setDbForTests(seededDb(NOW));
    const html = await render(
      ProtocolDetailPage({
        params: Promise.resolve({ key: "mcp" }),
        searchParams: Promise.resolve({ now: NOW_S }),
      }),
    );

    expect(html).toContain("Model Context Protocol");
    expect(html).toContain("イベント時系列");
    // The three seeded event types (appeared -> version_bump -> spec_change).
    expect(html).toContain("出現");
    expect(html).toContain("バージョン更新");
    expect(html).toContain("仕様変更");
    // Ledger hashes are surfaced (hash + prev hash labels present three times over).
    expect(html).toContain("ハッシュ");
    expect(html).toContain("前ハッシュ");
    // F-031: link to the ledger verify page.
    expect(html).toContain("この台帳を検証する");
    expect(html).toContain('href="/verify"');
  });

  it("surfaces the stale-source decay warning on a stale protocol (F-033)", async () => {
    __setDbForTests(seededDb(NOW));
    const html = await render(
      ProtocolDetailPage({
        params: Promise.resolve({ key: "a2a" }),
        searchParams: Promise.resolve({ now: NOW_S }),
      }),
    );
    expect(html).toContain("Agent2Agent");
    expect(html).toContain("更新停滞");
    expect(html).toContain("監視ソース");
  });

  it("renders a not-found state for an unknown key", async () => {
    __setDbForTests(seededDb(NOW));
    const html = await render(
      ProtocolDetailPage({
        params: Promise.resolve({ key: "nope" }),
        searchParams: Promise.resolve({ now: NOW_S }),
      }),
    );
    expect(html).toContain("指定されたプロトコルは見つかりませんでした。");
  });
});

describe("F-034 verify page", () => {
  it("shows an intact ledger for the untampered fixture chain", async () => {
    __setDbForTests(seededDb(NOW));
    const html = await render(
      VerifyPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("台帳検証");
    expect(html).toContain("台帳は無改ざんです。");
    expect(html).toContain("件のイベントを検証しました");
  });

  it("detects tampering when a raw observation body is corrupted", async () => {
    const db = seededDb(NOW);
    const seq = tamperRawBody(db);
    __setDbForTests(db);
    const html = await render(
      VerifyPage({ searchParams: Promise.resolve({ mode: "raw" }) }),
    );
    expect(html).toContain("改ざんを検知しました");
    expect(html).toContain(String(seq));
  });

  it("reports unavailable when the ledger secret is unset", async () => {
    __setDbForTests(seededDb(NOW));
    delete process.env.PROTOCOL_RADAR_HMAC_SECRET;
    const html = await render(
      VerifyPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("台帳の鍵（HMAC）が未設定のため検証できません。");
  });
});
