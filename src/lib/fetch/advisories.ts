/**
 * A3 — Security/CVE advisory watch (read-only, additive).
 *
 * Queries a REAL security-advisory source for a monitored protocol's upstream repository and
 * normalizes the payload into a stable, machine-readable shape. Nothing here touches the
 * ledger, the DB, or the filesystem: it is a pure transport + parse layer built on the same
 * injectable {@link HttpClient} abstraction the watchers use, so it is fully testable offline.
 *
 * Source: GitHub Security Advisories REST API —
 *   `GET https://api.github.com/repos/{owner}/{repo}/security-advisories`
 * This is a real, GET-based endpoint (fits the existing conditional-GET/retry transport) that
 * lists a repository's PUBLISHED security advisories (GHSA/CVE). A repo with none returns an
 * empty array, which we surface gracefully as `advisories: []`. We NEVER fabricate an endpoint
 * (docs/spec/99_EXECUTION.md source-URL integrity rule).
 */
import { fetchSource, type RetryOptions } from "./fetchCore";
import type { HttpClient } from "./types";

/** A normalized, source-agnostic advisory record. */
export interface NormalizedAdvisory {
  /** Stable advisory id (GHSA id, falling back to CVE id). */
  id: string;
  summary: string;
  /** Upstream severity label (e.g. low/medium/high/critical); null when not provided. */
  severity: string | null;
  /** ISO publication timestamp; null when not provided. */
  published: string | null;
  /** Canonical human-readable advisory URL. */
  url: string;
  /** Affected version ranges, when the source lists them. Omitted when empty. */
  affected_versions?: string[];
}

/** A single advisory-lookup target for a protocol. */
export type AdvisoryQuery = {
  kind: "github";
  owner: string;
  repo: string;
};

/** Outcome of one advisory lookup. `error` is set (and advisories empty) on upstream failure. */
export interface AdvisoryResult {
  advisories: NormalizedAdvisory[];
  error?: string;
}

/** Build the GitHub Security Advisories REST URL for a repository. */
export function githubAdvisoryUrl(owner: string, repo: string): string {
  const o = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  return `https://api.github.com/repos/${o}/${r}/security-advisories?per_page=100`;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Normalize a GitHub Security Advisories JSON array into {@link NormalizedAdvisory}[].
 * Pure and total: returns [] on any parse failure and skips malformed items — a bad upstream
 * payload can never throw or abort a request.
 */
export function normalizeGithubAdvisories(body: string): NormalizedAdvisory[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: NormalizedAdvisory[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;

    const id = asString(rec["ghsa_id"]) ?? asString(rec["cve_id"]);
    if (id === null) continue; // no stable id => not machine-referenceable, skip.

    const affected: string[] = [];
    const vulns = rec["vulnerabilities"];
    if (Array.isArray(vulns)) {
      for (const v of vulns) {
        if (v && typeof v === "object") {
          const range = asString(
            (v as Record<string, unknown>)["vulnerable_version_range"],
          );
          if (range !== null) affected.push(range);
        }
      }
    }

    const advisory: NormalizedAdvisory = {
      id,
      summary: asString(rec["summary"]) ?? "",
      severity: asString(rec["severity"]),
      published: asString(rec["published_at"]),
      url:
        asString(rec["html_url"]) ??
        `https://github.com/advisories/${encodeURIComponent(id)}`,
    };
    if (affected.length > 0) advisory.affected_versions = affected;
    out.push(advisory);
  }
  return out;
}

/**
 * Look up advisories for one target via the injectable HttpClient. Never throws — resolves to
 * an {@link AdvisoryResult}. A 404/410 (repo missing or advisories disabled) and a 304 are
 * treated as "no advisories" (empty, no error); network/5xx/other errors surface `error` with
 * an empty list so the caller can degrade gracefully per protocol.
 */
export async function fetchAdvisories(
  client: HttpClient,
  query: AdvisoryQuery,
  options: RetryOptions = {},
): Promise<AdvisoryResult> {
  const url = githubAdvisoryUrl(query.owner, query.repo);
  const outcome = await fetchSource(client, { url, kind: "github" }, options);

  switch (outcome.kind) {
    case "content":
      return { advisories: normalizeGithubAdvisories(outcome.body) };
    case "not_modified":
    case "absent":
      return { advisories: [] };
    case "error":
      return {
        advisories: [],
        error:
          outcome.httpStatus !== null
            ? `upstream_${outcome.httpStatus}`
            : `fetch_error: ${outcome.message}`,
      };
  }
}
