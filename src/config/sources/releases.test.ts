import { describe, expect, it } from "vitest";
import {
  GITHUB_RELEASE_REPOS,
  RELEASE_SOURCE_KIND,
  releasesUrl,
} from "./releases";
import { PROTOCOL_DEFS } from "./protocols";

/**
 * A1 — monitored-protocol expansion.
 *
 * Pure-data assertions on the releases registry (no network): the newly added AI-agent
 * protocols are wired with the expected key / display name / real repo, the observed-releases
 * URL is generated correctly, and every releases feed attaches to a protocol that is ALSO
 * registered in PROTOCOL_DEFS (so its display name resolves at seed time, before the observer
 * first polls it). These lock the config shape without invoking the network observer.
 */
describe("A1 releases registry — monitored-protocol expansion", () => {
  const byKey = new Map(GITHUB_RELEASE_REPOS.map((r) => [r.protocolKey, r]));

  it("generates the public unauthenticated GitHub Releases endpoint", () => {
    expect(releasesUrl("langchain-ai/langgraph")).toBe(
      "https://api.github.com/repos/langchain-ai/langgraph/releases?per_page=30",
    );
    expect(RELEASE_SOURCE_KIND).toBe("github");
  });

  it("adds the five new real AI-agent protocol release feeds", () => {
    const expected: Record<string, { name: string; repo: string }> = {
      langgraph: { name: "LangGraph", repo: "langchain-ai/langgraph" },
      "openai-agents": {
        name: "OpenAI Agents SDK",
        repo: "openai/openai-agents-python",
      },
      acp: { name: "Agent Communication Protocol", repo: "i-am-bee/acp" },
      autogen: { name: "Microsoft AutoGen", repo: "microsoft/autogen" },
      crewai: { name: "CrewAI", repo: "crewAIInc/crewAI" },
    };

    for (const [key, { name, repo }] of Object.entries(expected)) {
      const entry = byKey.get(key);
      expect(entry, `release feed for ${key} must exist`).toBeDefined();
      expect(entry!.protocolName).toBe(name);
      expect(entry!.repo).toBe(repo);
      expect(entry!.cadenceSeconds).toBeGreaterThan(0);
    }
  });

  it("keeps every release repo unique (no duplicate feeds)", () => {
    const repos = GITHUB_RELEASE_REPOS.map((r) => r.repo.toLowerCase());
    expect(new Set(repos).size).toBe(repos.length);
    const keys = GITHUB_RELEASE_REPOS.map((r) => r.protocolKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("attaches each releases feed to a protocol registered in PROTOCOL_DEFS with a matching name", () => {
    const defByKey = new Map(PROTOCOL_DEFS.map((d) => [d.key, d]));
    for (const feed of GITHUB_RELEASE_REPOS) {
      const def = defByKey.get(feed.protocolKey);
      expect(
        def,
        `release feed ${feed.repo} must attach to a registered protocol (${feed.protocolKey})`,
      ).toBeDefined();
      // Name must agree so the card shows the same display name whether the row is created by
      // the seed engine or (fallback) by the releases observer's insertProtocol.
      expect(def!.name).toBe(feed.protocolName);
    }
  });

  it("registers each new protocol with a real GitHub tags source and a homepage", () => {
    const newKeys = ["langgraph", "openai-agents", "acp", "autogen", "crewai"];
    for (const key of newKeys) {
      const def = PROTOCOL_DEFS.find((d) => d.key === key);
      expect(def, `PROTOCOL_DEFS must register ${key}`).toBeDefined();
      const gh = def!.sources.find(
        (s) => s.kind === "github" && s.url.includes("/tags"),
      );
      const home = def!.sources.find((s) => s.kind === "http");
      expect(gh, `${key} needs a GitHub tags source`).toBeDefined();
      expect(home, `${key} needs an http homepage source`).toBeDefined();
      // Real, active sources only — the expansion never ships a fabricated/inactive URL.
      for (const s of def!.sources) {
        expect(s.active).not.toBe(false);
        expect(s.url).toMatch(/^https:\/\//);
      }
    }
  });
});
