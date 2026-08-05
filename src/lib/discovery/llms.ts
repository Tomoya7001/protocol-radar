/**
 * G3 — PURE builder for the `/llms.txt` AI-crawler discoverability document.
 *
 * Emits the [llms.txt](https://llmstxt.org) convention: an H1 title, a one-line blockquote
 * summary, then Markdown-link sections (`## Docs`, `## Agent endpoints`, `## Protocols`). It is
 * the prose sibling of the JSON discovery manifest (`@/lib/discovery/manifest`): same read-only
 * thesis — be the source AI agents cite — expressed as links a crawler can follow.
 *
 * STRICTLY PURE & DETERMINISTIC: given the same input it returns byte-identical output. It reads
 * NO `process.env`, performs NO I/O, and never touches the DB. The caller injects the resolved
 * site origin, the tracked-protocol list, and the endpoint/doc catalogues; this module only
 * renders them. Origin normalisation (trailing-slash strip) is a plain string op, kept here so
 * `${origin}${path}` never yields a double slash.
 */

/** A single Markdown link rendered in a `## Docs` / `## Agent endpoints` section. */
export interface LlmsLink {
  /** Path relative to the site origin, e.g. `/api/answer` (may contain a `{key}` template). */
  path: string;
  /** Human/agent-facing link label. */
  label: string;
  /** One-line description shown after the link. */
  description: string;
}

/** One tracked protocol, projected from `getProtocolSummaries` by the caller. */
export interface LlmsProtocol {
  key: string;
  name: string;
}

/** Everything the builder needs — all injected, nothing discovered. */
export interface BuildLlmsTxtInput {
  /** Resolved site origin, e.g. `https://protocol-radar.dev` (trailing slash tolerated). */
  origin: string;
  /** H1 title line (without the leading `# `). */
  title: string;
  /** One-line blockquote summary (without the leading `> `). */
  summary: string;
  /** Documentation / spec links (`## Docs`). */
  docs: readonly LlmsLink[];
  /** Read-only agent-facing API endpoints (`## Agent endpoints`). */
  endpoints: readonly LlmsLink[];
  /** Tracked protocols (`## Protocols`), linked to their per-protocol detail endpoint. */
  protocols: readonly LlmsProtocol[];
}

/** Strip a single trailing slash so `${origin}${path}` never doubles up. */
function normalizeOrigin(origin: string): string {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}

/** Render one `- [label](url): description` bullet. */
function linkLine(origin: string, link: LlmsLink): string {
  return `- [${link.label}](${origin}${link.path}): ${link.description}`;
}

/**
 * Build the full `/llms.txt` body. Sections with no entries are still emitted (heading + blank)
 * so the document shape is stable and greppable.
 */
export function buildLlmsTxt(input: BuildLlmsTxtInput): string {
  const origin = normalizeOrigin(input.origin);

  const protocolLines = input.protocols.map(
    (p) =>
      `- [${p.name}](${origin}/api/protocols/${p.key}): tracked protocol (${p.key}).`,
  );

  const lines: string[] = [
    `# ${input.title}`,
    "",
    `> ${input.summary}`,
    "",
    "## Docs",
    "",
    ...input.docs.map((l) => linkLine(origin, l)),
    "",
    "## Agent endpoints",
    "",
    ...input.endpoints.map((l) => linkLine(origin, l)),
    "",
    "## Protocols",
    "",
    ...protocolLines,
    "",
  ];

  return lines.join("\n");
}
