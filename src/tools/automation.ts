/** Automation tools: manage content automations (reply, like, message, story, delete). */

import { z } from "zod";
import { KEYWORD_OPENING_NOTE, registerTool, type ToolContext } from "./helpers.js";

export function registerAutomationTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    "repliz_list_automations",
    {
      title: "List Automations",
      effect: "read",
      description:
        "List configured content automations. Supports pagination and filtering by account id(s) and search query.",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        limit: z.number().int().min(1).max(100).default(20).describe("Items per page."),
        accountIds: z
          .array(z.string())
          .optional()
          .describe("Filter automations by account id(s)."),
        search: z.string().optional().describe("Search query string."),
      },
    },
    async (args) =>
      ctx.client.get("/public/automation", {
        page: args.page,
        limit: args.limit,
        accountIds: args.accountIds,
        search: args.search,
      })
  );

  registerTool(
    ctx,
    "repliz_create_automation",
    {
      title: "Create Automation",
      effect: "additive",
      description: "Create a new content automation rule for a specific post/content.",
      inputSchema: {
        contentId: z.string().describe("The content id to attach automation to."),
        accountId: z.string().describe("The account id that owns the content."),
        config: z
          .record(z.unknown())
          .describe(`Automation configuration object (delete, reply, like, message, story). ${KEYWORD_OPENING_NOTE}`),
      },
    },
    async (args) =>
      ctx.client.post("/public/automation", {
        contentId: args.contentId,
        accountId: args.accountId,
        config: args.config,
      })
  );

  registerTool(
    ctx,
    "repliz_get_automation",
    {
      title: "Get Automation",
      effect: "read",
      description: "Get full details of a single content automation by its automation id.",
      inputSchema: {
        automationId: z.string().describe("The automation id."),
      },
    },
    async (args) => ctx.client.get(`/public/automation/${encodeURIComponent(args.automationId)}`)
  );

  registerTool(
    ctx,
    "repliz_update_automation",
    {
      title: "Update Automation",
      effect: "destructive",
      description: "Update the configuration of an existing content automation.",
      inputSchema: {
        automationId: z.string().describe("The automation id to update."),
        config: z
          .record(z.unknown())
          .describe(`Updated automation configuration object (delete, reply, like, message, story). ${KEYWORD_OPENING_NOTE}`),
      },
    },
    async (args) =>
      ctx.client.put(`/public/automation/${encodeURIComponent(args.automationId)}`, {
        config: args.config,
      })
  );

  registerTool(
    ctx,
    "repliz_delete_automation",
    {
      title: "Delete Automation",
      effect: "destructive",
      description: "Remove/delete a content automation rule. Irreversible — confirm before calling.",
      inputSchema: {
        automationId: z.string().describe("The automation id to remove."),
      },
    },
    async (args) => ctx.client.delete(`/public/automation/${encodeURIComponent(args.automationId)}`)
  );
}
