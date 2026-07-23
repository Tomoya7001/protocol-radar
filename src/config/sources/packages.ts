/**
 * SDK package-registry feeds for real-source observation
 * (F1 — npm + PyPI パッケージバージョン観測ソース).
 *
 * Distinct from `releases.ts` (GitHub *Releases* JSON), `specPages.ts` (spec/RFC page content)
 * and `protocols.ts` (declarative seed data): this file lists the SDK PACKAGES whose published
 * "latest version" we observe as a real, always-on source. Each entry attaches to an EXISTING
 * protocol by key so we reuse the same `protocols` row (no new protocol identities invented) and
 * simply add a `sources` row (kind "http") pointing at the registry document. When a source with
 * the same (protocol, url) already exists, the observer reuses it rather than duplicating.
 *
 * A new published version becomes a `version_bump` event through the existing diff engine; the
 * first successful observation becomes `appeared`; an unchanged version produces NO event. This
 * gives us a unique, continuously-observed signal: SDK release cadence per protocol.
 *
 * URL / package integrity (docs/spec/99_EXECUTION.md §"Source-URL integrity rule"):
 *  - Every package below was VERIFIED to exist by a real registry call returning HTTP 200 and a
 *    concrete version (recorded inline). We do NOT invent or guess a package name — an
 *    unverified package is simply omitted. `langgraph` on npm 404s (PyPI-only), so it is dropped
 *    here and only its PyPI package is listed.
 */
import type { SourceKind } from "@/lib/db/types";
import {
  packageUrl,
  type PackageRegistry,
} from "@/lib/fetch/packageRegistry";

const TWELVE_HOURS = 12 * 3600;

export interface PackageSource {
  /** Existing protocol key (protocols.ts / DB `protocols.key`) this package attaches to. */
  protocolKey: string;
  /** Protocol display name — used only if the protocol row does not yet exist. */
  protocolName: string;
  /** Which registry hosts the package. */
  registry: PackageRegistry;
  /** The package name as published on the registry (scoped npm names keep the leading `@`). */
  packageName: string;
  /** Human-readable English label stored on the source row. */
  label: string;
  /** Poll cadence in seconds. */
  cadenceSeconds: number;
}

/** Identity helper mirroring releasesUrl()/specPageUrl(): the observed URL is the registry doc. */
export function packageSourceUrl(source: {
  registry: PackageRegistry;
  packageName: string;
}): string {
  return packageUrl(source.registry, source.packageName);
}

/**
 * SDK packages whose latest published version we observe. Each was verified against the live
 * registry on 2026-07-23 (HTTP 200 + version shown); the versions are illustrative of "existed
 * at authoring time" — the observer always reads the CURRENT value, never a hardcoded one.
 */
export const PACKAGE_SOURCES: PackageSource[] = [
  {
    protocolKey: "mcp",
    protocolName: "Model Context Protocol",
    // npm 200, dist-tags.latest = 1.29.0
    registry: "npm",
    packageName: "@modelcontextprotocol/sdk",
    label: "MCP TypeScript SDK (npm latest)",
    cadenceSeconds: TWELVE_HOURS,
  },
  {
    protocolKey: "a2a",
    protocolName: "Agent2Agent Protocol",
    // npm 200, dist-tags.latest = 0.2.0
    registry: "npm",
    packageName: "a2a-js",
    label: "A2A JavaScript SDK (npm latest)",
    cadenceSeconds: TWELVE_HOURS,
  },
  {
    protocolKey: "a2a",
    protocolName: "Agent2Agent Protocol",
    // PyPI 200, info.version = 1.1.2
    registry: "pypi",
    packageName: "a2a-sdk",
    label: "A2A Python SDK (PyPI latest)",
    cadenceSeconds: TWELVE_HOURS,
  },
  {
    protocolKey: "langgraph",
    protocolName: "LangGraph",
    // PyPI 200, info.version = 1.2.9 (npm `langgraph` 404s — PyPI-only, so npm is dropped)
    registry: "pypi",
    packageName: "langgraph",
    label: "LangGraph Python package (PyPI latest)",
    cadenceSeconds: TWELVE_HOURS,
  },
  {
    protocolKey: "openai-agents",
    protocolName: "OpenAI Agents SDK",
    // PyPI 200, info.version = 0.18.3
    registry: "pypi",
    packageName: "openai-agents",
    label: "OpenAI Agents SDK (PyPI latest)",
    cadenceSeconds: TWELVE_HOURS,
  },
  {
    protocolKey: "crewai",
    protocolName: "CrewAI",
    // PyPI 200, info.version = 1.15.5
    registry: "pypi",
    packageName: "crewai",
    label: "CrewAI Python package (PyPI latest)",
    cadenceSeconds: TWELVE_HOURS,
  },
  {
    protocolKey: "autogen",
    protocolName: "Microsoft AutoGen",
    // PyPI 200, info.version = 0.10.0 (classic single-package line)
    registry: "pypi",
    packageName: "pyautogen",
    label: "AutoGen (pyautogen) Python package (PyPI latest)",
    cadenceSeconds: TWELVE_HOURS,
  },
  {
    protocolKey: "autogen",
    protocolName: "Microsoft AutoGen",
    // PyPI 200, info.version = 0.7.5 (v0.4+ AgentChat package line)
    registry: "pypi",
    packageName: "autogen-agentchat",
    label: "AutoGen AgentChat Python package (PyPI latest)",
    cadenceSeconds: TWELVE_HOURS,
  },
  {
    protocolKey: "acp",
    protocolName: "Agent Communication Protocol",
    // PyPI 200, info.version = 0.0.5
    registry: "pypi",
    packageName: "agentcommunicationprotocol",
    label: "ACP Python SDK (PyPI latest)",
    cadenceSeconds: TWELVE_HOURS,
  },
];

/** Source kind used for every package feed (reuses the generic HTTP transport). */
export const PACKAGE_SOURCE_KIND: SourceKind = "http";
