import { fetchSource, type FetchOutcome, type RetryOptions } from "./fetchCore";
import { contentHash } from "./hash";
import type { HttpClient } from "./types";

/**
 * SDK package-version source (F1 — npm + PyPI パッケージバージョン観測ソース).
 *
 * This mirrors github.ts's pollGithub() and specPage.ts's pollSpecPage() but for PACKAGE
 * REGISTRIES: it reuses the same conditional-GET / retry transport (fetchSource, kind "http"),
 * then reads the single field each registry exposes as "the current release":
 *   - npm  : GET https://registry.npmjs.org/<pkg>  ->  `dist-tags.latest`
 *   - PyPI : GET https://pypi.org/pypi/<pkg>/json   ->  `info.version`
 *
 * The observer folds a new version into the EXISTING diff engine, so a first-seen package
 * becomes `appeared` and a newer published version becomes `version_bump` — no new ledger
 * logic. We never fabricate a version: a payload that does not expose one yields version=null
 * and the observer records nothing.
 *
 * Provenance invariant — the rule that keeps verifyFromRaw() (the default /api/verify mode)
 * green — is that a stored observation's `content_hash` MUST equal sha256(its body). The
 * observer therefore stores the DETERMINISTIC normalizePackageBody() string and derives the
 * hash from those SAME bytes; this module only fetches + parses.
 */

/** The registries we read a "latest version" from. */
export type PackageRegistry = "npm" | "pypi";

/** The npm registry document URL for a package (scoped names keep their `/`). */
export function npmPackageUrl(pkg: string): string {
  return `https://registry.npmjs.org/${pkg}`;
}

/** The PyPI JSON API URL for a package. */
export function pypiPackageUrl(pkg: string): string {
  return `https://pypi.org/pypi/${pkg}/json`;
}

/** Registry document URL for a (registry, package) pair. */
export function packageUrl(registry: PackageRegistry, pkg: string): string {
  return registry === "npm" ? npmPackageUrl(pkg) : pypiPackageUrl(pkg);
}

/**
 * Parse the latest version from an npm registry document (`dist-tags.latest`). Returns null on
 * any parse failure or a missing/empty field (never throws) so a malformed payload cannot abort
 * a run.
 */
export function parseNpmVersion(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const distTags = (parsed as Record<string, unknown>)["dist-tags"];
  if (!distTags || typeof distTags !== "object") return null;
  const latest = (distTags as Record<string, unknown>)["latest"];
  return typeof latest === "string" && latest.length > 0 ? latest : null;
}

/**
 * Parse the current version from a PyPI JSON document (`info.version`). Returns null on any
 * parse failure or a missing/empty field (never throws).
 */
export function parsePyPiVersion(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const info = (parsed as Record<string, unknown>)["info"];
  if (!info || typeof info !== "object") return null;
  const version = (info as Record<string, unknown>)["version"];
  return typeof version === "string" && version.length > 0 ? version : null;
}

/** Parse the current version from a registry payload for the given registry. */
export function parsePackageVersion(
  registry: PackageRegistry,
  body: string,
): string | null {
  return registry === "npm" ? parseNpmVersion(body) : parsePyPiVersion(body);
}

/**
 * Deterministic, hashable body for a package observation. Encodes ONLY the fields the diff
 * engine needs (registry, package, version), so an unchanged version re-serializes to the exact
 * same bytes — hence the same content_hash and NO spurious event — while a new version changes
 * both the parsed `version` and the hash. Storing this exact string as the observation body and
 * deriving content_hash from it keeps verifyFromRaw() green.
 */
export function normalizePackageBody(
  registry: PackageRegistry,
  pkg: string,
  version: string,
): string {
  return JSON.stringify({ registry, package: pkg, version });
}

/** The version recorded in a prior observation's normalized body, or null. */
export function previousPackageVersion(body: string | null): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const version = parsed["version"];
    return typeof version === "string" && version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

/** SHA-256 of a normalized package body — the value stored as an observation's content_hash. */
export function packageContentHash(
  registry: PackageRegistry,
  pkg: string,
  version: string,
): string {
  return contentHash(normalizePackageBody(registry, pkg, version));
}

export interface PackagePollResult {
  /** The raw FetchOutcome (content/not_modified/absent/error), passed through unchanged. */
  outcome: FetchOutcome;
  /** Parsed current version when outcome.kind === "content" and the payload exposed one. */
  version?: string | null;
}

/**
 * Poll a package registry once. Reuses the conditional-GET / retry transport (so tests never hit
 * the network — the HttpClient is injectable), then, for a 2xx body, parses the registry's
 * "current version" field. Never throws — always resolves to a PackagePollResult. The caller
 * (observePackages) normalizes the body + hash before persisting.
 */
export async function pollPackageVersion(
  client: HttpClient,
  input: {
    registry: PackageRegistry;
    url: string;
    etag?: string | null;
    lastModified?: string | null;
    timeoutMs?: number;
  },
  options: RetryOptions = {},
): Promise<PackagePollResult> {
  const outcome: FetchOutcome = await fetchSource(
    client,
    {
      url: input.url,
      kind: "http",
      etag: input.etag,
      lastModified: input.lastModified,
      timeoutMs: input.timeoutMs,
    },
    options,
  );

  if (outcome.kind !== "content") {
    return { outcome };
  }

  const version = parsePackageVersion(input.registry, outcome.body);
  return { outcome, version };
}
