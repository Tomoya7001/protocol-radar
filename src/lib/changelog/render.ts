/**
 * D5 — AI-ingestible Markdown changelog rendering.
 *
 * Pure, framework-free rendering helpers for a single protocol's change history. This module
 * is owned exclusively by GET /api/changelog/[key] so that the shared read layer
 * (queries.ts / DTOs / db) is never modified. It performs no I/O and no DB writes: callers
 * pass an already-fetched `ProtocolDetailDto` plus a generation timestamp.
 */

import type { EventDto, ProtocolDetailDto } from "@/app/_data/queries";

/** Content type for the Markdown changelog document (sibling of llms.txt). */
export const CHANGELOG_CONTENT_TYPE = "text/markdown; charset=utf-8";
/** Content type for the plain-text 404 message. */
export const NOT_FOUND_CONTENT_TYPE = "text/plain; charset=utf-8";

const LINE_FEED = 0x0a;

/**
 * True for a control character we never want to emit into Markdown: C0 controls (0x00-0x1F),
 * DEL (0x7F) and the C1 controls (0x80-0x9F). Encoded via code points so no raw control byte
 * ever appears in this source file.
 */
function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/**
 * Strip control characters, replacing each with a single space. When `keepNewline` is true the
 * line feed (0x0a) is preserved so block text keeps its paragraph structure.
 */
function stripControls(value: string, keepNewline: boolean): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (keepNewline && code === LINE_FEED) {
      out += "\n";
    } else if (isControl(code)) {
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

/** Human-friendly label for an event type used in section headings. */
function typeLabel(type: EventDto["type"]): string {
  switch (type) {
    case "appeared":
      return "appeared";
    case "version_bump":
      return "version bump";
    case "spec_change":
      return "spec change";
    case "vanished":
      return "vanished";
    default:
      return type;
  }
}

/**
 * Collapse a value to a single safe inline token: strip control characters and fold all
 * whitespace (including newlines) into single spaces. Used for headings so a malicious summary
 * cannot break out of / inject extra Markdown structure.
 */
function sanitizeInline(value: string): string {
  return stripControls(value, false).replace(/\s+/g, " ").trim();
}

/**
 * Sanitize multi-line body text: normalise newlines, strip control characters other than the
 * newline, and defuse leading heading markers (`#`), blockquotes (`>`) and horizontal rules so
 * summary content cannot masquerade as document-level structure. Empty ⇒ empty string.
 */
function sanitizeBlock(value: string): string {
  const normalised = stripControls(value.replace(/\r\n?/g, "\n"), true);
  const lines = normalised.split("\n").map((line) => {
    const trimmedEnd = line.replace(/[ \t]+$/g, "");
    // Escape a leading Markdown structural marker (allowing indentation).
    return trimmedEnd.replace(/^(\s*)([#>]|-{3,}|\*{3,}|_{3,})/, "$1\\$2");
  });
  return lines.join("\n").trim();
}

/** Format a generation timestamp (epoch-ms) as an ISO-8601 UTC string, guarding NaN. */
function formatGeneratedAt(generatedAtMs: number): string {
  if (!Number.isFinite(generatedAtMs)) return "unknown";
  return new Date(generatedAtMs).toISOString();
}

/** Render one event as a `## {date} — {type}` section plus its summary body. */
function renderEvent(event: EventDto): string {
  const heading = `## ${sanitizeInline(event.created_at)} — ${typeLabel(event.type)}`;
  const body = sanitizeBlock(event.summary ?? "");
  return body.length > 0 ? `${heading}\n\n${body}` : heading;
}

/** Join sections with a blank line between each, without a leading/trailing separator. */
function interleave(sections: string[]): string[] {
  const out: string[] = [];
  sections.forEach((section, i) => {
    if (i > 0) out.push("");
    out.push(section);
  });
  return out;
}

/**
 * Render the full Markdown changelog for one protocol, newest change first.
 *
 * @param detail        Protocol detail (summary + events). `detail.events` is expected
 *                      newest-first (queries orders by `seq DESC`); re-sorted defensively here.
 * @param generatedAtMs Epoch-ms stamp for the "generated at" footer (deterministic in tests).
 */
export function renderChangelogMarkdown(
  detail: ProtocolDetailDto,
  generatedAtMs: number,
): string {
  const { protocol, events } = detail;

  const name = sanitizeInline(protocol.name) || protocol.key;
  const key = sanitizeInline(protocol.key);

  // Newest first: `seq` is the monotonic ledger append order, so descending seq is chronological.
  const ordered = events.slice().sort((a, b) => b.seq - a.seq);

  const summaryLine =
    `Status: ${protocol.status} · Freshness: ${protocol.freshness} · ` +
    `Events: ${protocol.event_count}`;

  const sections =
    ordered.length > 0
      ? ordered.map(renderEvent)
      : ["_No recorded changes yet._"];

  const lines: string[] = [
    `# ${name} changelog`,
    "",
    `Protocol key: \`${key}\``,
    "",
    summaryLine,
    "",
    ...interleave(sections),
    "",
    `_Generated at ${formatGeneratedAt(generatedAtMs)}._`,
    "",
  ];

  return lines.join("\n");
}

/** Plain-text body for an unknown protocol key (HTTP 404). */
export function notFoundMessage(key: string): string {
  return `Protocol not found: ${sanitizeInline(key)}\n`;
}
