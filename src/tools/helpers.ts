/**
 * Shared helpers for defining MCP tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { objectFromShape, type AnyObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ZodRawShape } from "zod";
import { ReplizApiError, type ReplizClient } from "../client.js";

/**
 * A tool's input schema, built from its raw shape.
 *
 * The tools are defined once per process (see server.ts), so this runs once per
 * tool and every request's server is given the same schema object. Handing the
 * SDK the raw shape instead would make it build a new object schema each time
 * the tool is registered, which is once per request.
 *
 * Built with the SDK's own objectFromShape, so tools/list is exactly what the
 * SDK would have produced from the raw shape.
 */
function inputSchemaFromShape(shape: ZodRawShape): AnyObjectSchema {
  return objectFromShape(shape);
}

/**
 * Appended to the automation config fields. Keywords can answer with an
 * opening DM, which a model can't tell from the field names alone, and an
 * update that drops a keyword's id breaks the buttons already sent.
 */
export const KEYWORD_OPENING_NOTE =
  "Keywords in message, story and chat (Instagram and Facebook) can answer with buttons: a keyword.values item " +
  '{ "keyword", "type": "opening", "opening": { postback, additional, webUrl } } instead of { "keyword", "text" }. ' +
  'Send the "id" Repliz returns on such a keyword back unchanged, or the buttons in DMs already sent stop working. ' +
  'Set opening.webUrl.isTrackLink to true to send the links of an opening as rplz.link short links and count their clicks. ' +
  'Set opening.webUrl.followUp { isActive, delay, text } to send one reminder with the same links when none was tapped after delay seconds ' +
  '(600, 1800, 3600, 10800, 21600, 43200 or 82800; needs isTrackLink, Instagram and Facebook only; a DM to a commenter needs a first message with a button). ' +
  'Set opening.input { isActive, type: "email" | "phone", text, retryText, tag } to ask for an email or phone number after a button tap and before webUrl ' +
  '(Instagram and Facebook only; needs postback or additional active): a valid answer is saved to the contact (plus tag), then webUrl is sent; after 3 invalid answers webUrl is sent anyway. ' +
  "Schema: https://docs.repliz.com/api/guides/automation-config#keyword-with-buttons";

/**
 * Appended to the automation config fields too. Both fields are optional and
 * kept when left out, so a model that copies a config from a GET and drops
 * them doesn't wipe what was set in the dashboard.
 */
export const LIMIT_KNOWLEDGE_NOTE =
  "reply, message, chat, story and storyMention also take limit { isActive, value, count } to answer the same person at most count times " +
  "(1-100, default 1) per value seconds, counted from their first answer (value: 3600, 21600, 86400, 604800 or 2592000; " +
  "per post for comments, per account for DMs), and knowledgeIds, " +
  "up to 5 knowledge _id from repliz_list_knowledge that the AI reads when type is 'ai'. Left out, the saved limit and knowledgeIds are kept.";

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
      inputSchema: inputSchemaFromShape(meta.inputSchema),
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
