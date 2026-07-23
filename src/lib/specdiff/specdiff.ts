/**
 * Section-level spec diff — pure, deterministic core (feature F2).
 *
 * WHAT THIS IS. Given two spec-page body snapshots (the normalized text the spec observer
 * already stored on `observations.body`, see src/lib/fetch/specPage.ts), classify — for each
 * document *section* — whether it was added / removed / modified / unchanged between the two
 * time points. No DB, no network, no clock, no LLM: the same inputs always yield the same
 * output, so the result is byte-reproducible and cheap to verify.
 *
 * HONEST DATA LIMITATION (read before trusting `granularity`). The spec observer stores a
 * DETERMINISTICALLY NORMALIZED body where every run of whitespace — including newlines — is
 * collapsed to a single space (normalizeSpecPage). That normalization is what keeps the
 * content-hash provenance invariant intact, but it also means the stored body has NO line
 * structure to recover. Two consequences:
 *
 *   1. For a raw-Markdown spec the ATX heading MARKERS ('#'..'######') survive normalization
 *      (they are text, not whitespace/markup), so we CAN segment the document at those markers
 *      and diff genuine sections. `granularity` is then "section".
 *
 *   2. For an HTML page normalized to plain prose there are no surviving heading markers, so
 *      there is no section boundary to honestly recover. We fall back to a line-level diff of
 *      the snapshots (the whole normalized body is effectively one line) and report the change
 *      as hunks. `granularity` is then "line".
 *
 * Because newlines are gone, a section's heading text cannot be cleanly separated from the
 * prose that follows it. We therefore key a section by its heading level plus the first few
 * words after the marker (a best-effort, deterministic heading signature). A change confined to
 * later prose within a section reads as "modified"; a change to those first few words reads as
 * a removed+added pair. This is an explicit, documented approximation of true section identity
 * — NOT a fabricated data source. Every byte compared here was really observed and stored.
 */

/** How a section (or hunk) changed between the two snapshots. */
export type ChangeKind = "added" | "removed" | "modified" | "unchanged";

/** Whether the diff resolved real document sections or fell back to line hunks. */
export type Granularity = "section" | "line";

/** One entry of the diff: a section (granularity "section") or a hunk (granularity "line"). */
export interface SectionDiff {
  /** Section heading signature, or a synthetic "hunk-N"/"(document)" label in line mode. */
  section: string;
  change: ChangeKind;
  /** Bounded preview of the section/hunk content in the `from` snapshot (null if absent). */
  from_excerpt: string | null;
  /** Bounded preview of the section/hunk content in the `to` snapshot (null if absent). */
  to_excerpt: string | null;
}

/** A contiguous line-level change region (only produced in line-granularity mode). */
export interface DiffHunk {
  op: "add" | "del" | "replace";
  from: string[];
  to: string[];
}

export interface SpecDiffSummary {
  /** added + removed + modified (i.e. everything that is not "unchanged"). */
  changed_count: number;
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

export interface SpecDiffResult {
  granularity: Granularity;
  sections: SectionDiff[];
  /** Line hunks; populated only in "line" granularity, otherwise an empty array. */
  hunks: DiffHunk[];
  summary: SpecDiffSummary;
}

const EXCERPT_MAX = 160;
const HEADING_WORDS = 6;

/** Collapse all whitespace to single spaces and trim — mirrors the observer's normalization. */
function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The first `n` whitespace-separated words of `s` (used to build a heading signature). */
function firstWords(s: string, n: number): string {
  const words = normalizeSpaces(s)
    .split(" ")
    .filter((w) => w.length > 0);
  return words.slice(0, n).join(" ");
}

/** A bounded, single-line preview of a chunk of text (never throws on empty input). */
function excerpt(s: string, max = EXCERPT_MAX): string {
  const t = normalizeSpaces(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** True when the body contains a surviving ATX heading marker ('#'..'######' + space). */
export function hasHeadings(body: string): boolean {
  return /(?:^|\s)#{1,6}\s+/.test(body);
}

interface RawSection {
  key: string;
  label: string;
  content: string;
}

/**
 * Segment a normalized body into sections at surviving ATX heading markers. Any text before the
 * first marker becomes a "(preamble)" section. Deterministic and pure. Sections are split at
 * each whitespace boundary that precedes a heading marker, keeping the marker with its section.
 */
export function segmentSections(body: string): RawSection[] {
  const trimmed = normalizeSpaces(body);
  if (trimmed.length === 0) return [];

  const parts = trimmed
    .split(/\s+(?=#{1,6}\s)/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const sections: RawSection[] = [];
  const keyCounts = new Map<string, number>();

  for (const part of parts) {
    const headed = /^(#{1,6})\s+([\s\S]*)$/.exec(part);
    let base: RawSection;
    if (headed) {
      const level = (headed[1] ?? "").length;
      const rest = headed[2] ?? "";
      const head = firstWords(rest, HEADING_WORDS);
      const label = `${"#".repeat(level)} ${head}`.trim();
      base = { key: `h${level}:${head.toLowerCase()}`, label, content: rest };
    } else {
      base = { key: "(preamble)", label: "(preamble)", content: part };
    }
    // Disambiguate duplicate keys deterministically so distinct sections never collide.
    const seen = keyCounts.get(base.key) ?? 0;
    keyCounts.set(base.key, seen + 1);
    sections.push(seen === 0 ? base : { ...base, key: `${base.key}~${seen}` });
  }

  return sections;
}

function emptyResult(granularity: Granularity): SpecDiffResult {
  return {
    granularity,
    sections: [],
    hunks: [],
    summary: { changed_count: 0, added: 0, removed: 0, modified: 0, unchanged: 0 },
  };
}

function diffSections(fromBody: string, toBody: string): SpecDiffResult {
  const fromSections = segmentSections(fromBody);
  const toSections = segmentSections(toBody);
  const fromMap = new Map(fromSections.map((s) => [s.key, s]));
  const toMap = new Map(toSections.map((s) => [s.key, s]));

  // Ordered union of keys: from-order first, then to-only keys in to-order.
  const order: string[] = [];
  const seen = new Set<string>();
  for (const s of [...fromSections, ...toSections]) {
    if (!seen.has(s.key)) {
      seen.add(s.key);
      order.push(s.key);
    }
  }

  const sections: SectionDiff[] = [];
  let added = 0;
  let removed = 0;
  let modified = 0;
  let unchanged = 0;

  for (const key of order) {
    const f = fromMap.get(key);
    const t = toMap.get(key);
    if (f && t) {
      const same = normalizeSpaces(f.content) === normalizeSpaces(t.content);
      if (same) {
        unchanged++;
        sections.push({
          section: t.label,
          change: "unchanged",
          from_excerpt: excerpt(f.content),
          to_excerpt: excerpt(t.content),
        });
      } else {
        modified++;
        sections.push({
          section: t.label,
          change: "modified",
          from_excerpt: excerpt(f.content),
          to_excerpt: excerpt(t.content),
        });
      }
    } else if (f) {
      removed++;
      sections.push({
        section: f.label,
        change: "removed",
        from_excerpt: excerpt(f.content),
        to_excerpt: null,
      });
    } else if (t) {
      added++;
      sections.push({
        section: t.label,
        change: "added",
        from_excerpt: null,
        to_excerpt: excerpt(t.content),
      });
    }
  }

  return {
    granularity: "section",
    sections,
    hunks: [],
    summary: {
      changed_count: added + removed + modified,
      added,
      removed,
      modified,
      unchanged,
    },
  };
}

/** Split a body into non-empty trimmed lines (the normalized body is usually a single line). */
function splitLines(body: string): string[] {
  const t = body.replace(/\r\n?/g, "\n").trim();
  if (t.length === 0) return [];
  return t
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Longest-common-subsequence line diff → contiguous hunks. Deterministic. */
function lineHunks(a: string[], b: string[]): DiffHunk[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i] ?? [];
    const next = dp[i + 1] ?? [];
    const ai = a[i] ?? "";
    for (let j = m - 1; j >= 0; j--) {
      const bj = b[j] ?? "";
      row[j] =
        ai === bj ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  type Op = { t: "eq" | "del" | "add"; v: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ai = a[i] ?? "";
    const bj = b[j] ?? "";
    if (ai === bj) {
      ops.push({ t: "eq", v: ai });
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      ops.push({ t: "del", v: ai });
      i++;
    } else {
      ops.push({ t: "add", v: bj });
      j++;
    }
  }
  while (i < n) {
    ops.push({ t: "del", v: a[i] ?? "" });
    i++;
  }
  while (j < m) {
    ops.push({ t: "add", v: b[j] ?? "" });
    j++;
  }

  const hunks: DiffHunk[] = [];
  let dels: string[] = [];
  let adds: string[] = [];
  const flush = (): void => {
    if (dels.length === 0 && adds.length === 0) return;
    const op =
      dels.length > 0 && adds.length > 0 ? "replace" : dels.length > 0 ? "del" : "add";
    hunks.push({ op, from: dels, to: adds });
    dels = [];
    adds = [];
  };
  for (const o of ops) {
    if (o.t === "eq") {
      flush();
    } else if (o.t === "del") {
      dels.push(o.v);
    } else {
      adds.push(o.v);
    }
  }
  flush();
  return hunks;
}

function diffLines(fromBody: string, toBody: string): SpecDiffResult {
  const a = splitLines(fromBody);
  const b = splitLines(toBody);
  const hunks = lineHunks(a, b);

  const sections: SectionDiff[] = [];
  let added = 0;
  let removed = 0;
  let modified = 0;
  let unchanged = 0;

  if (hunks.length === 0) {
    if (a.length > 0 || b.length > 0) {
      unchanged = 1;
      sections.push({
        section: "(document)",
        change: "unchanged",
        from_excerpt: excerpt(fromBody),
        to_excerpt: excerpt(toBody),
      });
    }
  } else {
    hunks.forEach((h, idx) => {
      const change: ChangeKind =
        h.op === "add" ? "added" : h.op === "del" ? "removed" : "modified";
      if (change === "added") added++;
      else if (change === "removed") removed++;
      else modified++;
      sections.push({
        section: `hunk-${idx + 1}`,
        change,
        from_excerpt: h.from.length > 0 ? excerpt(h.from.join(" ")) : null,
        to_excerpt: h.to.length > 0 ? excerpt(h.to.join(" ")) : null,
      });
    });
  }

  return {
    granularity: "line",
    sections,
    hunks,
    summary: {
      changed_count: added + removed + modified,
      added,
      removed,
      modified,
      unchanged,
    },
  };
}

/**
 * Diff two spec-page body snapshots. `null` means "no snapshot at that time point" (e.g. the
 * page had not appeared yet), treated as an empty document — so a first appearance reads as an
 * all-"added" diff and a vanish as all-"removed".
 *
 * Chooses section granularity when either snapshot carries surviving heading markers; otherwise
 * falls back to a line diff (see the module header for why the fallback is honest, not lossy-by-
 * choice). Pure and deterministic: no DB, network, or clock.
 */
export function diffSpecBodies(
  fromBody: string | null,
  toBody: string | null,
): SpecDiffResult {
  const from = fromBody ?? "";
  const to = toBody ?? "";
  if (normalizeSpaces(from).length === 0 && normalizeSpaces(to).length === 0) {
    return emptyResult(hasHeadings(from) || hasHeadings(to) ? "section" : "line");
  }
  if (hasHeadings(from) || hasHeadings(to)) {
    return diffSections(from, to);
  }
  return diffLines(from, to);
}
