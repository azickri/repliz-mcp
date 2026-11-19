/** Builds an MCP server instance with all Repliz tools registered. */

import { AsyncLocalStorage } from "node:async_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ListToolsRequestSchema, type ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
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

type ToolHandler = (args: unknown, extra: unknown) => unknown;

interface ToolDefinition {
  name: string;
  config: unknown;
  handler: ToolHandler;
}

/**
 * The client of the request being served. Tool handlers are written against
 * `ctx.client`; this is how one set of handlers, built once, still calls the
 * Repliz API as exactly the user whose request is running.
 */
const requestClient = new AsyncLocalStorage<ReplizClient>();

/**
 * Stands in for `ctx.client` while the tools are defined. It holds no
 * credentials of its own: every use is forwarded to the client of the current
 * request, and fails outright when there is none.
 */
const boundClient = new Proxy({} as ReplizClient, {
  get(_target, property) {
    const client = requestClient.getStore();
    if (!client) throw new Error("No Repliz client is bound to this call.");
    const value: unknown = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/**
 * Every tool, defined once for the life of the process.
 *
 * Running the register functions builds each tool's Zod schemas, about 250 KB
 * of objects in all. Done per request, that was the bulk of what a request
 * allocated: at a few requests a second it kept the heap several times larger
 * than what the server actually holds. The definitions depend on nothing but
 * the code, so they are recorded here and each request's server is given the
 * same ones.
 */
const toolDefinitions: ToolDefinition[] = (() => {
  const definitions: ToolDefinition[] = [];
  const recorder = {
    registerTool(name: string, config: unknown, handler: ToolHandler) {
      definitions.push({ name, config, handler });
    },
  } as unknown as McpServer;
  registerAllTools({ server: recorder, client: boundClient });
  return definitions;
})();

function newServer(): McpServer {
  return new McpServer({ ...SERVER_INFO }, { jsonSchemaValidator: sharedValidator });
}

function registerTools(server: McpServer, client: ReplizClient | null): void {
  for (const tool of toolDefinitions) {
    const handler: ToolHandler = client
      ? (args, extra) => requestClient.run(client, () => tool.handler(args, extra))
      : tool.handler;
    server.registerTool(tool.name, tool.config as never, handler as never);
  }
}

/**
 * What tools/list answers. It is the same for every user, and producing it
 * converts all the Zod schemas to JSON Schema, so it is produced once by
 * prepareToolList and handed to every server.
 */
let toolList: ListToolsResult | undefined;

/**
 * Ask a server built the usual way for its tool list and keep the answer.
 * The SDK produces it, so it is exactly what a client would have been sent.
 * Call once at startup; until it has run, servers answer tools/list themselves.
 */
export async function prepareToolList(): Promise<number> {
  const server = newServer();
  registerTools(server, null);

  const result = await new Promise<ListToolsResult>((resolve, reject) => {
    const transport: Transport = {
      async start() {},
      async close() {},
      async send(message) {
        if ("result" in message) resolve(message.result as ListToolsResult);
        else if ("error" in message) reject(new Error(message.error.message));
      },
    };
    server
      .connect(transport)
      .then(() => transport.onmessage?.({ jsonrpc: "2.0", id: 0, method: "tools/list" }))
      .catch(reject);
  });
  await server.close();

  toolList = result;
  return result.tools.length;
}

/**
 * Create a fresh MCP server bound to one user's Repliz client. A new instance
 * is built per request, so no two users ever share a client or its credentials.
 */
export function createReplizServer(client: ReplizClient): McpServer {
  const server = newServer();
  registerTools(server, client);
  const list = toolList;
  if (list) server.server.setRequestHandler(ListToolsRequestSchema, () => list);
  return server;
}
