/**
 * C2 — schema.org JSON-LD builder.
 *
 * Pure functions that turn the monitored-protocol summaries into schema.org structured data
 * (an ItemList of protocols, wrapped as a Dataset) so search engines and AI agents can ingest
 * Protocol Radar as first-class structured data. Same read-only thesis as the rest of C2: it
 * only reshapes values already produced by the shared read layer — no DB access, no writes,
 * and it never recomputes any provenance value (hashes are not touched here at all).
 */

import type { ProtocolSummaryDto } from "@/app/_data/queries";
import { normalizeBaseUrl } from "@/lib/discovery/manifest";

/** A single schema.org ListItem entry describing one monitored protocol. */
export interface JsonLdListItem {
  "@type": "ListItem";
  position: number;
  name: string;
  url: string;
  /** Protocol observation status (e.g. active/stale/vanished), copied verbatim from the DTO. */
  status: string;
  /** ISO timestamp of the last observed change, or null when the protocol has no events. */
  dateModified: string | null;
}

export interface JsonLdItemList {
  "@type": "ItemList";
  name: string;
  numberOfItems: number;
  itemListElement: JsonLdListItem[];
}

/** Top-level schema.org Dataset document embedding the protocol ItemList. */
export interface JsonLdDataset {
  "@context": "https://schema.org";
  "@type": "Dataset";
  name: string;
  description: string;
  url: string;
  keywords: string[];
  mainEntity: JsonLdItemList;
}

/**
 * Build the schema.org JSON-LD Dataset document for the monitored protocols.
 * Pure: derives everything from `protocols` and the request-origin `baseUrl`.
 */
export function buildProtocolsJsonLd(
  protocols: ReadonlyArray<ProtocolSummaryDto>,
  baseUrl: string,
): JsonLdDataset {
  const base = normalizeBaseUrl(baseUrl);

  const itemListElement: JsonLdListItem[] = protocols.map((p, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: p.name,
    url: `${base}/protocols/${p.key}`,
    status: p.status,
    dateModified: p.last_event?.created_at ?? null,
  }));

  const itemList: JsonLdItemList = {
    "@type": "ItemList",
    name: "Monitored AI-agent protocols",
    numberOfItems: itemListElement.length,
    itemListElement,
  };

  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "Protocol Radar — monitored AI-agent protocols",
    description:
      "Structured index of AI-agent protocols continuously monitored by Protocol Radar, each " +
      "backed by an HMAC hash-chained, tamper-evident ledger.",
    url: `${base}/`,
    keywords: ["AI agents", "protocols", "MCP", "A2A", "x402", "provenance", "ledger"],
    mainEntity: itemList,
  };
}
