import { describe, it, expect } from "vitest";
import {
  buildHistoryCsv,
  escapeCsvField,
  HISTORY_CSV_HEADER,
  type HistoryCsvEvent,
} from "./csv";

const HEADER = "seq,observed_at,kind,severity,summary,hash";

function event(overrides: Partial<HistoryCsvEvent> = {}): HistoryCsvEvent {
  return {
    seq: 1,
    observed_at: "2026-01-01T00:00:00.000Z",
    kind: "appeared",
    severity: "meta",
    summary: "first appearance",
    hash: "abc123",
    ...overrides,
  };
}

/** Split a CSV document into its CRLF-terminated lines (drops the trailing empty). */
function lines(csv: string): string[] {
  return csv.split("\r\n").slice(0, -1);
}

describe("HISTORY_CSV_HEADER", () => {
  it("has the documented stable column order", () => {
    expect(HISTORY_CSV_HEADER.join(",")).toBe(HEADER);
  });
});

describe("escapeCsvField", () => {
  it("leaves plain fields untouched", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField("")).toBe("");
  });

  it("quotes fields containing a comma", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
  });

  it("quotes and doubles interior quotes", () => {
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
  });

  it("quotes fields containing newlines or carriage returns", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
});

describe("buildHistoryCsv", () => {
  it("emits the header as the first line", () => {
    const csv = buildHistoryCsv({ key: "acme", events: [] });
    expect(lines(csv)[0]).toBe(HEADER);
  });

  it("empty history is header only (still CRLF-terminated)", () => {
    const csv = buildHistoryCsv({ key: "acme", events: [] });
    expect(csv).toBe(`${HEADER}\r\n`);
    expect(lines(csv)).toHaveLength(1);
  });

  it("renders one row per event with the mapped columns", () => {
    const csv = buildHistoryCsv({
      key: "acme",
      events: [
        event({ seq: 1, kind: "appeared", severity: "meta", hash: "h1" }),
        event({
          seq: 2,
          observed_at: "2026-02-02T00:00:00.000Z",
          kind: "version_bump",
          severity: "minor",
          summary: "1.0 -> 1.1",
          hash: "h2",
        }),
      ],
    });
    const rows = lines(csv);
    expect(rows).toEqual([
      HEADER,
      "1,2026-01-01T00:00:00.000Z,appeared,meta,first appearance,h1",
      "2,2026-02-02T00:00:00.000Z,version_bump,minor,1.0 -> 1.1,h2",
    ]);
  });

  it("escapes commas, quotes and newlines inside a field", () => {
    const csv = buildHistoryCsv({
      key: "acme",
      events: [
        event({
          seq: 7,
          summary: 'renamed "foo", added\nline',
          hash: "h7",
        }),
      ],
    });
    const rows = lines(csv);
    // The embedded newline lives INSIDE the quoted field, so line-splitting on \r\n
    // must not have torn the record apart at the header + one data record.
    expect(rows[0]).toBe(HEADER);
    expect(csv).toContain('"renamed ""foo"", added\nline"');
  });

  it("renders a null summary as an empty field", () => {
    const csv = buildHistoryCsv({
      key: "acme",
      events: [event({ seq: 3, summary: null, hash: "h3" })],
    });
    expect(lines(csv)[1]).toBe(
      "3,2026-01-01T00:00:00.000Z,appeared,meta,,h3",
    );
  });

  it("preserves the caller's row order exactly (no internal sort)", () => {
    const csv = buildHistoryCsv({
      key: "acme",
      events: [
        event({ seq: 30, hash: "h30" }),
        event({ seq: 10, hash: "h10" }),
        event({ seq: 20, hash: "h20" }),
      ],
    });
    const seqs = lines(csv)
      .slice(1)
      .map((row) => row.split(",")[0]);
    expect(seqs).toEqual(["30", "10", "20"]);
  });

  it("is deterministic — same input yields byte-identical output", () => {
    const input = {
      key: "acme",
      events: [event({ seq: 1, hash: "h1" }), event({ seq: 2, hash: "h2" })],
    };
    expect(buildHistoryCsv(input)).toBe(buildHistoryCsv(input));
  });
});
