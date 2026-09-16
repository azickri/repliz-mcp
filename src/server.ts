/** Builds an MCP server instance with all Repliz tools registered. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReplizClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";

export const SERVER_INFO = { name: "repliz-mcp", version: "2.0.0" } as const;

/**
 * Create a fresh MCP server bound to one user's Repliz client. A new instance
 * is built per session, so no two users ever share a client or its credentials.
 */
export function createReplizServer(client: ReplizClient): McpServer {
  const server = new McpServer({ ...SERVER_INFO });
  registerAllTools({ server, client });
  return server;
}
