/** Account management tools. */

import { z } from "zod";
import { registerTool, type ToolContext } from "./helpers.js";

const PLATFORMS = [
  "facebook",
  "instagram",
  "threads",
  "tiktok",
  "linkedin",
  "youtube",
  "shopee",
  "twitter",
  "whatsapp",
  "telegram",
  "pinterest",
] as const;

export function registerAccountTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    "repliz_list_accounts",
    {
      title: "List Accounts",
      effect: "read",
      description:
        "List the social accounts connected to your Repliz workspace. Returns each account's id, platform, username, picture, and status. Supports pagination and filtering by platform type or search term.",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        limit: z.number().int().min(1).max(100).default(20).describe("Items per page."),
        types: z
          .array(z.enum(PLATFORMS))
          .optional()
          .describe("Filter by platform(s), e.g. [\"facebook\", \"instagram\"]."),
        search: z.string().optional().describe("Search by account name or username."),
      },
    },
    async (args) =>
      ctx.client.get("/public/account", {
        page: args.page,
        limit: args.limit,
        types: args.types,
        search: args.search,
      })
  );

  registerTool(
    ctx,
    "repliz_count_accounts",
    {
      title: "Count Accounts",
      effect: "read",
      description:
        "Get the number of accounts connected to your Repliz workspace, per platform, with the plan's account limit. With an operator's API key, `operator` holds the same per-platform count for the accounts assigned to that operator; otherwise it is null.",
      inputSchema: {},
    },
    async () => ctx.client.get("/public/account/count")
  );

  registerTool(
    ctx,
    "repliz_get_account",
    {
      title: "Get Account",
      effect: "read",
      description: "Get details of a single connected account by its Repliz account id.",
      inputSchema: {
        accountId: z.string().describe("The Repliz account id (e.g. 680affa5ce12f2f72916f67e)."),
      },
    },
    async (args) => ctx.client.get(`/public/account/${encodeURIComponent(args.accountId)}`)
  );

  registerTool(
    ctx,
    "repliz_get_account_statistics",
    {
      title: "Get Account Statistics",
      effect: "read",
      description:
        "Retrieve aggregated statistics and activity metrics for a specific connected account, including platform-specific overview metrics. Available for Instagram, Threads, TikTok and Pinterest.",
      inputSchema: {
        accountId: z.string().describe("The Repliz account id (e.g. 680affa5ce12f2f72916f67e)."),
      },
    },
    async (args) => ctx.client.get(`/public/account/${encodeURIComponent(args.accountId)}/statistic`)
  );

  registerTool(
    ctx,
    "repliz_update_account_automation",
    {
      title: "Update Account Automation",
      effect: "destructive",
      description:
        "Update the default automation configurations (delete, reply, like, message, chat, story) for a connected account.",
      inputSchema: {
        accountId: z.string().describe("The Repliz account id."),
        delete: z.record(z.unknown()).describe("Delete automation configuration object."),
        reply: z.record(z.unknown()).describe("Reply automation configuration object."),
        like: z.record(z.unknown()).describe("Like automation configuration object."),
        message: z.record(z.unknown()).describe("Message automation configuration object."),
        chat: z.record(z.unknown()).describe("Chat automation configuration object."),
        story: z.record(z.unknown()).describe("Story automation configuration object."),
      },
    },
    async (args) =>
      ctx.client.put(`/public/account/${encodeURIComponent(args.accountId)}/automation`, {
        delete: args.delete,
        reply: args.reply,
        like: args.like,
        message: args.message,
        chat: args.chat,
        story: args.story,
      })
  );

  registerTool(
    ctx,
    "repliz_delete_account",
    {
      title: "Delete Account",
      effect: "destructive",
      description:
        "Disconnect and remove an account from your Repliz workspace. This is irreversible — confirm with the user before calling.",
      inputSchema: {
        accountId: z.string().describe("The Repliz account id to remove."),
      },
    },
    async (args) => ctx.client.delete(`/public/account/${encodeURIComponent(args.accountId)}`)
  );
}
