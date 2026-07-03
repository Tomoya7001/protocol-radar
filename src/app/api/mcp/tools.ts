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
    case "get_events": {
      const limit = parseLimit(args);
      const protocol = args.protocol;
      let protocolKey: string | null = null;
      if (protocol !== undefined && protocol !== null) {
        if (typeof protocol !== "string" || protocol.length === 0) {
          throw new ToolError("protocol must be a non-empty string", "invalid_argument");
        }
        if (!protocolExists(db, protocol)) {
          throw new ToolError(`protocol not found: ${protocol}`, "protocol_not_found");
        }
        protocolKey = protocol;
      }
      const events = listEventsDto(db, { protocolKey, limit });
      return { events, count: events.length };
    }
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
    default:
      throw new ToolError(`unknown tool: ${name}`, "unknown_tool");
  }
}
