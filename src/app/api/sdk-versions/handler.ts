import { getDb } from "@/app/_data/db";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import {
  getLatestObservation,
  getProtocolByKey,
  listSources,
} from "@/lib/db/repo";
import type { Db } from "@/lib/db/connection";
import {
  PACKAGE_SOURCES,
  packageSourceUrl,
  type PackageSource,
} from "@/config/sources/packages";
import { previousPackageVersion } from "@/lib/fetch/packageRegistry";

/** One observed SDK package's current version within a protocol block. */
interface PackageVersion {
  registry: PackageSource["registry"];
  package: string;
  url: string;
  /** Latest observed version, or null if never successfully observed yet. */
  latest_version: string | null;
  /** ISO time of the observation the version came from, or null. */
  observed_at: string | null;
}

/** One protocol's SDK package versions. */
interface ProtocolPackages {
  key: string;
  name: string;
  packages: PackageVersion[];
}

/**
 * Resolve the current observed version for a single configured package by reading the ledger DB
 * (never the network): find the protocol + its source row, then the latest observation's
 * normalized body. Returns nulls when the protocol/source/observation does not exist yet — the
 * read endpoint reports "not observed yet" rather than fabricating a value.
 */
function resolvePackage(db: Db, pkg: PackageSource): PackageVersion {
  const url = packageSourceUrl(pkg);
  const base: PackageVersion = {
    registry: pkg.registry,
    package: pkg.packageName,
    url,
    latest_version: null,
    observed_at: null,
  };

  const protocol = getProtocolByKey(db, pkg.protocolKey);
  if (protocol === undefined) return base;

  const source = listSources(db).find(
    (s) => s.protocol_id === protocol.id && s.url === url,
  );
  if (source === undefined) return base;

  const observation = getLatestObservation(db, source.id);
  if (observation === undefined || observation.is_present === 0) return base;

  return {
    ...base,
    latest_version: previousPackageVersion(observation.body),
    observed_at: observation.fetched_at,
  };
}

/**
 * F1 — GET /api/sdk-versions
 *
 * Read-only view of the current observed latest version per protocol/package, sourced entirely
 * from the ledger DB the observer wrote (no network I/O here). Deterministic: packages are
 * grouped by protocol and both are key-sorted so the payload is stable for snapshots/tests.
 *
 * All logic lives here; route.ts exports only GET/runtime/dynamic (Next.js forbids other route
 * exports — this bit us before in /api/security).
 */
export function handleSdkVersions(req: Request): Response {
  const url = new URL(req.url);
  const now = parseNow(url);
  const db = getDb();

  const optionalKey = url.searchParams.get("protocol");

  // Group configured packages by protocol key, preserving a deterministic order.
  const byProtocol = new Map<string, ProtocolPackages>();
  for (const pkg of PACKAGE_SOURCES) {
    if (optionalKey !== null && pkg.protocolKey !== optionalKey) continue;
    let block = byProtocol.get(pkg.protocolKey);
    if (block === undefined) {
      block = { key: pkg.protocolKey, name: pkg.protocolName, packages: [] };
      byProtocol.set(pkg.protocolKey, block);
    }
    block.packages.push(resolvePackage(db, pkg));
  }

  const protocols = [...byProtocol.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  for (const block of protocols) {
    block.packages.sort((a, b) => {
      if (a.registry !== b.registry) return a.registry < b.registry ? -1 : 1;
      return a.package < b.package ? -1 : a.package > b.package ? 1 : 0;
    });
  }

  const packageCount = protocols.reduce((n, p) => n + p.packages.length, 0);

  return jsonResponse({
    generated_at: new Date(now).toISOString(),
    protocols,
    protocol_count: protocols.length,
    package_count: packageCount,
  });
}
