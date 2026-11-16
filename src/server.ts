/** Builds an MCP server instance with all Repliz tools registered. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { ReplizClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";

export const SERVER_INFO = { name: "repliz-mcp", version: "2.0.0" } as const;

/**
 * Left to itself, every McpServer builds its own Ajv instance — a third of the
 * cost of a server, rebuilt on each request. The SDK uses it only to check
 * elicitation replies, which this server never asks for, and holds nothing
 * user-specific in it, so one instance serves every server.
 */
const sharedValidator = new AjvJsonSchemaValidator();

/**
 * Create a fresh MCP server bound to one user's Repliz client. A new instance
 * is built per request, so no two users ever share a client or its credentials.
 */
export function createReplizServer(client: ReplizClient): McpServer {
  const server = new McpServer({ ...SERVER_INFO }, { jsonSchemaValidator: sharedValidator });
  registerAllTools({ server, client });
  return server;
}
