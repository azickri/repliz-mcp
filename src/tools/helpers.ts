/**
 * Shared helpers for defining MCP tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import { ReplizApiError, type ReplizClient } from "../client.js";

/**
 * Appended to the automation config fields. Keywords can answer with an
 * opening DM, which a model can't tell from the field names alone, and an
 * update that drops a keyword's id breaks the buttons already sent.
 */
export const KEYWORD_OPENING_NOTE =
  "Keywords in message, story and chat (Instagram and Facebook) can answer with buttons: a keyword.values item " +
  '{ "keyword", "type": "opening", "opening": { postback, additional, webUrl } } instead of { "keyword", "text" }. ' +
  'Send the "id" Repliz returns on such a keyword back unchanged, or the buttons in DMs already sent stop working. ' +
  "Schema: https://docs.repliz.com/api/guides/automation-config#keyword-with-buttons";

export interface ToolContext {
  server: McpServer;
  client: ReplizClient;
}

/**
 * What a tool does to the user's workspace. Clients decide what to ask before
 * running a tool from the annotations this maps to — ChatGPT, for one, asks
 * for confirmation before every tool not marked read-only.
 *
 *   read         only reads
 *   additive     creates or sends something, leaving what exists as it was
 *   destructive  changes or removes something that exists
 */
export type ToolEffect = "read" | "additive" | "destructive";

const ANNOTATIONS: Record<ToolEffect, ToolAnnotations> = {
  read: { readOnlyHint: true },
  additive: { readOnlyHint: false, destructiveHint: false },
  destructive: { readOnlyHint: false, destructiveHint: true },
};

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

/**
 * Blank a picture sent inline as a base64 data URI (Telegram's are). Each one
 * costs the model thousands of tokens and is no use to it as text.
 */
export function withoutInlinePicture<T extends { picture?: unknown }>(item: T): T {
  if (typeof item?.picture === "string" && item.picture.startsWith("data:")) {
    return { ...item, picture: "" };
  }
  return item;
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
  meta: { title: string; effect: ToolEffect; description: string; inputSchema: TShape },
  handler: (args: { [K in keyof TShape]: ReturnTypeOf<TShape[K]> }) => Promise<unknown>
): void {
  ctx.server.registerTool(
    name,
    {
      title: meta.title,
      description: meta.description,
      inputSchema: meta.inputSchema,
      annotations: ANNOTATIONS[meta.effect],
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
