/**
 * Shared helpers for defining MCP tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { ReplizApiError, type ReplizClient } from "../client.js";

export interface ToolContext {
  server: McpServer;
  client: ReplizClient;
}

type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type McpResult = {
  content: McpContent[];
  isError?: boolean;
};

/**
 * Handler output that is sent as-is instead of being serialized to JSON
 * text — for results the client should render, such as an image.
 */
export class ContentResult {
  constructor(readonly content: McpContent[]) {}
}

function textResult(text: string, isError = false): McpResult {
  return { content: [{ type: "text", text }], isError };
}

/** Pretty-print any JSON-serializable value for the model to read. */
function formatData(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/**
 * Register a tool that calls the Repliz API. The handler returns raw data,
 * which is serialized to text, or a ContentResult sent unchanged. Errors (including API errors) are caught and
 * returned as an error result so the model can react instead of crashing.
 */
export function registerTool<TShape extends ZodRawShape>(
  ctx: ToolContext,
  name: string,
  meta: { title: string; description: string; inputSchema: TShape },
  handler: (args: { [K in keyof TShape]: ReturnTypeOf<TShape[K]> }) => Promise<unknown>
): void {
  ctx.server.registerTool(
    name,
    {
      title: meta.title,
      description: meta.description,
      inputSchema: meta.inputSchema,
    },
    // The SDK validates args against inputSchema before calling us.
    (async (args: any) => {
      try {
        const data = await handler(args);
        if (data instanceof ContentResult) return { content: data.content };
        return textResult(formatData(data));
      } catch (err) {
        if (err instanceof ReplizApiError) {
          return textResult(
            `Error (HTTP ${err.status}): ${formatData(err.body)}`,
            true
          );
        }
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`Error: ${message}`, true);
      }
    }) as any
  );
}

// Helper type: infer the parsed output of a Zod type in a raw shape.
type ReturnTypeOf<T> = T extends { _output: infer O } ? O : unknown;
