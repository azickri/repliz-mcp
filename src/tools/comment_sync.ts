/** Comment sync tools: run the automation on a post's old and missed top-level comments. */

import { z } from "zod";
import { registerTool, type ToolContext } from "./helpers.js";

export function registerCommentSyncTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    "repliz_list_comment_syncs",
    {
      title: "List Comment Syncs",
      effect: "read",
      description:
        "List the comment syncs with their status (active or paused), progress (cursor.isSwept, cursor.scanned), totalSynced, last and next check, errorMessage, and heldUntil/heldReason when waiting for a limit.",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        limit: z.number().int().min(1).max(100).default(20).describe("Items per page."),
        accountIds: z
          .array(z.string())
          .optional()
          .describe("Filter comment syncs by account id(s)."),
        search: z.string().optional().describe("Matches the title, caption, or URL of the post."),
      },
    },
    async (args) =>
      ctx.client.get("/public/listener", {
        page: args.page,
        limit: args.limit,
        accountIds: args.accountIds,
        search: args.search,
      })
  );

  registerTool(
    ctx,
    "repliz_create_comment_sync",
    {
      title: "Create Comment Sync",
      effect: "additive",
      description:
        "Run the automation on a post's old comments, including the ones from before the account was connected, on comments the platform never sent, and on pending inbox comments the automation never ran on. Top-level comments only, at least 5 minutes old, paced per platform. Instagram, Facebook, Threads, TikTok, YouTube, and LinkedIn. One sync per post (409), limited per plan (403). Returns listenerId.",
      inputSchema: {
        contentId: z.string().describe("The post id on the platform, the id from list content."),
        accountId: z.string().describe("The account id that published the post."),
      },
    },
    async (args) =>
      ctx.client.post("/public/listener", {
        contentId: args.contentId,
        accountId: args.accountId,
      })
  );

  registerTool(
    ctx,
    "repliz_update_comment_sync_status",
    {
      title: "Update Comment Sync Status",
      effect: "destructive",
      description:
        "Pause (paused) or resume (active) a comment sync. Pausing keeps its progress.",
      inputSchema: {
        listenerId: z.string().describe("The comment sync id (listenerId)."),
        status: z.enum(["active", "paused"]).describe("active to resume, paused to pause."),
      },
    },
    async (args) =>
      ctx.client.put(`/public/listener/${encodeURIComponent(args.listenerId)}/status`, {
        status: args.status,
      })
  );

  registerTool(
    ctx,
    "repliz_delete_comment_sync",
    {
      title: "Delete Comment Sync",
      effect: "destructive",
      description:
        "Remove a comment sync. Synced comments stay in the inbox. To stop it for a while, pause it instead. Confirm before calling.",
      inputSchema: {
        listenerId: z.string().describe("The comment sync id (listenerId)."),
      },
    },
    async (args) => ctx.client.delete(`/public/listener/${encodeURIComponent(args.listenerId)}`)
  );
}
