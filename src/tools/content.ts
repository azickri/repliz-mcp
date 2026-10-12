/** Content tools: published posts on connected accounts, their comments and stats. */

import { z } from "zod";
import { registerTool, type ToolContext } from "./helpers.js";

const buttonObjectSchema = z
  .object({
    text: z.string(),
    image: z.string().optional(),
    buttons: z.object({
      type: z.literal("web_url").default("web_url"),
      title: z.string(),
      url: z.string(),
    }),
  })
  .describe("An interactive button payload.");

export function registerContentTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    "repliz_list_content",
    {
      title: "List Content",
      description:
        "List published content (posts/media or stories) for a connected account. Uses cursor pagination via `nextToken`. WhatsApp and Telegram accounts list the posts of one of their channels, so pass `channelId`.",
      inputSchema: {
        accountId: z.string().describe("The account id whose content to list."),
        type: z.enum(["media", "story"]).optional().describe("Content type to list."),
        channelId: z
          .string()
          .optional()
          .describe(
            "Required for WhatsApp and Telegram accounts: the id of a channel (type 'channel', not a group) from repliz_whatsapp_channels or repliz_telegram_channels."
          ),
        nextToken: z.string().optional().describe("Pagination cursor from a previous response."),
      },
    },
    async (args) =>
      ctx.client.get("/public/content", {
        accountId: args.accountId,
        type: args.type,
        channelId: args.channelId,
        nextToken: args.nextToken,
      })
  );

  registerTool(
    ctx,
    "repliz_get_content",
    {
      title: "Get Content",
      description: "Get the details of a single piece of content.",
      inputSchema: {
        contentId: z.string().describe("The content id."),
        accountId: z.string().describe("The account id that owns the content."),
      },
    },
    async (args) =>
      ctx.client.get(`/public/content/${encodeURIComponent(args.contentId)}`, {
        accountId: args.accountId,
      })
  );

  registerTool(
    ctx,
    "repliz_get_content_comments",
    {
      title: "Get Content Comments",
      description:
        "List comments on a piece of content. Pass `commentId` to fetch replies to a specific comment. Uses cursor pagination via `nextToken`.",
      inputSchema: {
        contentId: z.string().describe("The content id."),
        accountId: z.string().describe("The account id that owns the content."),
        commentId: z.string().optional().describe("Fetch replies under this comment id."),
        nextToken: z.string().optional().describe("Pagination cursor from a previous response."),
      },
    },
    async (args) =>
      ctx.client.get(`/public/content/${encodeURIComponent(args.contentId)}/comment`, {
        accountId: args.accountId,
        commentId: args.commentId,
        nextToken: args.nextToken,
      })
  );

  registerTool(
    ctx,
    "repliz_create_content_comment",
    {
      title: "Comment on Content",
      description:
        "Post a comment on a piece of content, or reply to an existing comment by passing `commentId`.",
      inputSchema: {
        contentId: z.string().describe("The content id to comment on."),
        accountId: z.string().describe("The account id posting the comment."),
        text: z.string().describe("The comment text."),
        commentId: z.string().optional().describe("Reply to this comment id instead of the post."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/content/${encodeURIComponent(args.contentId)}/comment`, {
        accountId: args.accountId,
        text: args.text,
        ...(args.commentId ? { commentId: args.commentId } : {}),
      })
  );

  registerTool(
    ctx,
    "repliz_get_content_statistic",
    {
      title: "Get Content Statistics",
      description: "Get engagement statistics/insights for a piece of content.",
      inputSchema: {
        contentId: z.string().describe("The content id."),
        accountId: z.string().describe("The account id that owns the content."),
      },
    },
    async (args) =>
      ctx.client.get(`/public/content/${encodeURIComponent(args.contentId)}/statistic`, {
        accountId: args.accountId,
      })
  );

  registerTool(
    ctx,
    "repliz_message_content_comment",
    {
      title: "Send DM to Content Commenter",
      description:
        "Send a private message (DM) to the author of a comment on your content. Provide `text` and/or a `button` payload.",
      inputSchema: {
        contentId: z.string().describe("The content id."),
        accountId: z.string().describe("The account id sending the message."),
        commentId: z.string().describe("The comment id whose author will be messaged."),
        text: z.string().optional().describe("The message text."),
        button: buttonObjectSchema.optional().describe("Optional interactive button payload."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/content/${encodeURIComponent(args.contentId)}/message`, {
        accountId: args.accountId,
        commentId: args.commentId,
        ...(args.text !== undefined ? { text: args.text } : {}),
        ...(args.button !== undefined ? { button: args.button } : {}),
      })
  );

  registerTool(
    ctx,
    "repliz_delete_content_comment",
    {
      title: "Delete Content Comment",
      description:
        "Delete a comment on a piece of content. Irreversible — confirm before calling.",
      inputSchema: {
        contentId: z.string().describe("The content id."),
        commentId: z.string().describe("The comment id to delete."),
        accountId: z.string().describe("The account id that owns the content."),
      },
    },
    async (args) =>
      ctx.client.delete(
        `/public/content/${encodeURIComponent(args.contentId)}/comment/${encodeURIComponent(
          args.commentId
        )}`,
        { accountId: args.accountId }
      )
  );

  registerTool(
    ctx,
    "repliz_delete_content",
    {
      title: "Delete Content",
      description:
        "Remove/delete a published post/content from a connected account. Irreversible — confirm before calling.",
      inputSchema: {
        contentId: z.string().describe("The content id to remove."),
        accountId: z.string().describe("The account id that owns the content."),
      },
    },
    async (args) =>
      ctx.client.delete(`/public/content/${encodeURIComponent(args.contentId)}`, {
        accountId: args.accountId,
      })
  );

  registerTool(
    ctx,
    "repliz_like_content_comment",
    {
      title: "Like Content Comment",
      description:
        "Like or add a reaction to a specific comment on a piece of content using a connected account.",
      inputSchema: {
        contentId: z.string().describe("The content id containing the comment."),
        commentId: z.string().describe("The comment id to like."),
        accountId: z.string().describe("The account id used to perform the like action."),
      },
    },
    async (args) =>
      ctx.client.post(
        `/public/content/${encodeURIComponent(args.contentId)}/like/${encodeURIComponent(
          args.commentId
        )}`,
        undefined,
        { accountId: args.accountId }
      )
  );
}
