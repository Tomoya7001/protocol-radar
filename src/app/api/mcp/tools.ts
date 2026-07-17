import type { Db } from "@/lib/db";
import {
  getProtocolDetail,
  getProtocolSummaries,
  listEventsDto,
  protocolExists,
} from "@/app/_data/queries";
import { parseVerifyMode, runVerify } from "@/app/_data/verify";

/**
 * F-040 — MCP tool implementations.
 *
 * Each tool is a thin, read-only adapter over the committed `_data` query layer (the same
 * code that backs the public REST API F-032), so the agent surface and the web surface can
 * never disagree. No business logic is duplicated here.
 *
 * Tools are transport-agnostic: {@link callTool} takes a validated arg object and returns a
 * plain JSON-serialisable value (or throws {@link ToolError}). The JSON-RPC layer wraps this.
 */

const DEFAULT_EVENT_LIMIT = 100;
const MAX_EVENT_LIMIT = 500;

/** A tool-level failure that maps to an MCP `isError` result (not a protocol error). */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
}

/** The advertised tool catalogue (returned by `tools/list`). */
export const TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "list_protocols",
    description:
      "List every tracked agent protocol with its status, freshness and last-change event.",
    inputSchema: {
      type: "object",
      properties: {
        now: {
          type: "number",
          description: "Epoch ms used for freshness; defaults to server time.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_protocol",
    description:
      "Get a single protocol with its full event timeline (diffs + ledger hashes).",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Protocol key, e.g. \"mcp\"." },
        now: { type: "number", description: "Epoch ms used for freshness." },
      },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "get_events",
    description:
      "Cross-protocol change feed, newest first. Optionally filter by protocol key.",
    inputSchema: {
      type: "object",
      properties: {
        protocol: { type: "string", description: "Optional protocol-key filter." },
        limit: {
          type: "number",
          description: `Max events (1..${MAX_EVENT_LIMIT}); default ${DEFAULT_EVENT_LIMIT}.`,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "verify",
    description:
      "Re-verify the hash-chain ledger. mode=\"raw\" (default) recomputes hashes from raw bodies; mode=\"chain\" runs the field-level chain check.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["raw", "chain"],
          description: "Verification mode.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "latest_change",
    description:
      "Get the single most recent change event for one protocol (type, summary, timestamp). Unknown protocol ⇒ error.",
    inputSchema: {
      type: "object",
      properties: {
        protocol: { type: "string", description: "Protocol key, e.g. \"mcp\"." },
      },
      required: ["protocol"],
      additionalProperties: false,
    },
  },
  {
    name: "list_changes",
    description:
      "Recent change events, newest first. Optionally filter by protocol key. Agent-friendly alias of the change feed.",
    inputSchema: {
      type: "object",
      properties: {
        protocol: { type: "string", description: "Optional protocol-key filter." },
        limit: {
          type: "number",
          description: `Max events (1..${MAX_EVENT_LIMIT}); default ${DEFAULT_EVENT_LIMIT}.`,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "verify_ledger",
    description:
      "Re-verify the hash-chain ledger (raw mode) and return the outcome (ok, mode, checked). Takes no arguments.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "protocol_status",
    description:
      "Get the current status, freshness and last-change time for one protocol. Unknown protocol ⇒ error.",
    inputSchema: {
      type: "object",
      properties: {
        protocol: { type: "string", description: "Protocol key, e.g. \"mcp\"." },
        now: { type: "number", description: "Epoch ms used for freshness." },
      },
      required: ["protocol"],
      additionalProperties: false,
    },
  },
];

export const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.name));

type Args = Record<string, unknown>;

function optionalNow(args: Args, fallback: number): number {
  const raw = args.now;
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new ToolError("now must be a finite number (epoch ms)", "invalid_argument");
  }
  return raw;
}

function requireString(args: Args, name: string): string {
  const raw = args[name];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ToolError(`${name} is required and must be a non-empty string`, "invalid_argument");
  }
  return raw;
}

function parseLimit(args: Args): number {
  const raw = args.limit;
  if (raw === undefined || raw === null) return DEFAULT_EVENT_LIMIT;
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > MAX_EVENT_LIMIT
  ) {
    throw new ToolError(
      `limit must be an integer between 1 and ${MAX_EVENT_LIMIT}`,
      "invalid_argument",
    );
  }
  return raw;
}

/**
 * Validate an optional `protocol` filter argument. Returns the key when present (after
 * confirming it exists — unknown ⇒ protocol_not_found), or null when omitted.
 */
function optionalProtocolFilter(db: Db, args: Args): string | null {
  const protocol = args.protocol;
  if (protocol === undefined || protocol === null) return null;
  if (typeof protocol !== "string" || protocol.length === 0) {
    throw new ToolError("protocol must be a non-empty string", "invalid_argument");
  }
  if (!protocolExists(db, protocol)) {
    throw new ToolError(`protocol not found: ${protocol}`, "protocol_not_found");
  }
  return protocol;
}

/** Shared change-feed reader for `get_events` and `list_changes` (newest first). */
function readChangeFeed(db: Db, args: Args): { events: unknown[]; count: number } {
  const limit = parseLimit(args);
  const protocolKey = optionalProtocolFilter(db, args);
  const events = listEventsDto(db, { protocolKey, limit });
  return { events, count: events.length };
}

/**
 * Execute a tool by name. `now` is the default clock (deterministic in tests). Throws
 * {@link ToolError} for bad input or unknown protocol keys; returns a JSON value otherwise.
 */
export function callTool(
  db: Db,
  name: string,
  args: Args,
  now: number,
): unknown {
  switch (name) {
    case "list_protocols": {
      const protocols = getProtocolSummaries(db, optionalNow(args, now));
      return { protocols, count: protocols.length };
    }
    case "get_protocol": {
      const key = requireString(args, "key");
      const detail = getProtocolDetail(db, key, optionalNow(args, now));
      if (detail === null) {
        throw new ToolError(`protocol not found: ${key}`, "protocol_not_found");
      }
      return detail;
    }
    case "get_events":
    case "list_changes":
      return readChangeFeed(db, args);
    case "verify": {
      const rawMode = args.mode;
      if (
        rawMode !== undefined &&
        rawMode !== null &&
        rawMode !== "raw" &&
        rawMode !== "chain"
      ) {
        throw new ToolError("mode must be \"raw\" or \"chain\"", "invalid_argument");
      }
      const mode = parseVerifyMode(typeof rawMode === "string" ? rawMode : null);
      return runVerify(db, mode);
    }
    case "verify_ledger":
      return runVerify(db, parseVerifyMode(null));
    case "latest_change": {
      const key = requireString(args, "protocol");
      if (!protocolExists(db, key)) {
        throw new ToolError(`protocol not found: ${key}`, "protocol_not_found");
      }
      const [latest] = listEventsDto(db, { protocolKey: key, limit: 1 });
      return {
        protocol: key,
        change:
          latest === undefined
            ? null
            : {
                type: latest.type,
                summary: latest.summary,
                timestamp: latest.created_at,
                seq: latest.seq,
              },
      };
    }
    case "protocol_status": {
      const key = requireString(args, "protocol");
      const detail = getProtocolDetail(db, key, optionalNow(args, now));
      if (detail === null) {
        throw new ToolError(`protocol not found: ${key}`, "protocol_not_found");
      }
      const p = detail.protocol;
      return {
        key: p.key,
        name: p.name,
        status: p.status,
        freshness: p.freshness,
        stale_warning: p.stale_warning,
        last_change_at: p.last_event?.created_at ?? null,
        last_change_type: p.last_event?.type ?? null,
      };
    }
    default:
      throw new ToolError(`unknown tool: ${name}`, "unknown_tool");
  }
}
