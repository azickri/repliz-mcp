/** Comment inbox tools (the cross-platform comment management inbox). */

import { z } from "zod";
import { registerTool, type ToolContext } from "./helpers.js";

const COMMENT_STATUS = ["pending", "resolved", "ignored"] as const;

const imageObjectSchema = z
  .object({
    url: z.string().describe("Public URL of the image file."),
    thumbnail: z.string().optional(),
    mimetype: z.string().describe("e.g. image/jpeg"),
  })
  .describe(
    "Optional image sent along with the reply text. Supported on Facebook, Threads, TikTok, LinkedIn and X (Twitter), ignored on other platforms."
  );

export function registerCommentTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    "repliz_list_comments",
    {
      title: "List Comments",
      effect: "read",
      description:
        "List comments in your Repliz inbox across connected accounts. Supports pagination and filtering by status, account(s), and search term.",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        limit: z.number().int().min(1).max(100).default(20).describe("Items per page."),
        status: z
          .enum(COMMENT_STATUS)
          .optional()
          .describe("Filter by handling status."),
        accountIds: z
          .array(z.string())
          .optional()
          .describe("Filter to comments belonging to these account id(s)."),
        search: z.string().optional().describe("Search within comment text."),
      },
    },
    async (args) =>
      ctx.client.get("/public/comment", {
        page: args.page,
        limit: args.limit,
        status: args.status,
        accountIds: args.accountIds,
        search: args.search,
      })
  );

  registerTool(
    ctx,
    "repliz_get_comment",
    {
      title: "Get Comment",
      effect: "read",
      description: "Get the full details of a single comment by its id.",
      inputSchema: {
        commentId: z.string().describe("The comment id."),
      },
    },
    async (args) => ctx.client.get(`/public/comment/${encodeURIComponent(args.commentId)}`)
  );

  registerTool(
    ctx,
    "repliz_reply_comment",
    {
      title: "Reply to Comment",
      effect: "additive",
      description:
        "Post a public reply to a comment. The reply is published to the original platform (Facebook, Instagram, etc.). " +
        "Add `image` { url, mimetype, thumbnail? } to send a picture with the text on Facebook, Threads, TikTok, LinkedIn and X (Twitter).",
      inputSchema: {
        commentId: z.string().describe("The comment id to reply to."),
        text: z.string().describe("The reply text to publish."),
        image: imageObjectSchema.optional(),
      },
    },
    async (args) =>
      ctx.client.post(`/public/comment/${encodeURIComponent(args.commentId)}`, {
        text: args.text,
        ...(args.image ? { image: args.image } : {}),
      })
  );

  registerTool(
    ctx,
    "repliz_update_comment_status",
    {
      title: "Update Comment Status",
      effect: "destructive",
      description:
        "Update the handling status of a comment in your Repliz inbox (pending, resolved, or ignored).",
      inputSchema: {
        commentId: z.string().describe("The comment id."),
        status: z.enum(COMMENT_STATUS).describe("The new status."),
      },
    },
    async (args) =>
      ctx.client.put(`/public/comment/${encodeURIComponent(args.commentId)}/status`, {
        status: args.status,
      })
  );

  registerTool(
    ctx,
    "repliz_delete_comment",
    {
      title: "Delete Comment",
      effect: "destructive",
      description:
        "Delete a comment from the social media platform by its id. Irreversible — confirm with the user before calling.",
      inputSchema: {
        commentId: z.string().describe("The comment id to delete."),
      },
    },
    async (args) =>
      ctx.client.delete(`/public/comment/${encodeURIComponent(args.commentId)}`)
  );
}
