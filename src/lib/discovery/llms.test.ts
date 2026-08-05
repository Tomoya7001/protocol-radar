import { describe, it, expect } from "vitest";
import {
  buildLlmsTxt,
  type BuildLlmsTxtInput,
  type LlmsLink,
} from "./llms";

const DOCS: LlmsLink[] = [
  { path: "/", label: "Home", description: "Landing page." },
  {
    path: "/api/openapi.json",
    label: "OpenAPI",
    description: "OpenAPI 3.1 spec.",
  },
];

const ENDPOINTS: LlmsLink[] = [
  {
    path: "/api/protocols",
    label: "/api/protocols",
    description: "Protocol list.",
  },
  {
    path: "/api/answer",
    label: "/api/answer",
    description: "NL question answering.",
  },
];

const PROTOCOLS = [
  { key: "mcp", name: "Model Context Protocol" },
  { key: "a2a", name: "Agent2Agent" },
];

function input(overrides: Partial<BuildLlmsTxtInput> = {}): BuildLlmsTxtInput {
  return {
    origin: "https://example.test",
    title: "Protocol Radar",
    summary: "A tamper-proof monitor of AI-agent protocols.",
    docs: DOCS,
    endpoints: ENDPOINTS,
    protocols: PROTOCOLS,
    ...overrides,
  };
}

describe("buildLlmsTxt", () => {
  it("follows the llms.txt structure: H1, blockquote summary, then sections", () => {
    const out = buildLlmsTxt(input());
    const lines = out.split("\n");

    // First line is the H1 title.
    expect(lines[0]).toBe("# Protocol Radar");
    // A one-line blockquote summary follows.
    expect(out).toContain("> A tamper-proof monitor of AI-agent protocols.");
    // The three required Markdown-link sections, in order.
    const docsIdx = out.indexOf("## Docs");
    const endpointsIdx = out.indexOf("## Agent endpoints");
    const protocolsIdx = out.indexOf("## Protocols");
    expect(docsIdx).toBeGreaterThanOrEqual(0);
    expect(endpointsIdx).toBeGreaterThan(docsIdx);
    expect(protocolsIdx).toBeGreaterThan(endpointsIdx);
  });

  it("renders every endpoint as an absolute Markdown link", () => {
    const out = buildLlmsTxt(input());
    expect(out).toContain(
      "- [/api/protocols](https://example.test/api/protocols): Protocol list.",
    );
    expect(out).toContain(
      "- [/api/answer](https://example.test/api/answer): NL question answering.",
    );
    expect(out).toContain(
      "- [OpenAPI](https://example.test/api/openapi.json): OpenAPI 3.1 spec.",
    );
  });

  it("lists every tracked protocol, linked to its detail endpoint", () => {
    const out = buildLlmsTxt(input());
    expect(out).toContain(
      "- [Model Context Protocol](https://example.test/api/protocols/mcp): tracked protocol (mcp).",
    );
    expect(out).toContain(
      "- [Agent2Agent](https://example.test/api/protocols/a2a): tracked protocol (a2a).",
    );
  });

  it("normalises a trailing-slash origin so URLs never double up", () => {
    const out = buildLlmsTxt(input({ origin: "https://example.test/" }));
    expect(out).toContain("https://example.test/api/protocols");
    expect(out).not.toContain("https://example.test//");
  });

  it("is deterministic for identical input", () => {
    expect(buildLlmsTxt(input())).toBe(buildLlmsTxt(input()));
  });
});
