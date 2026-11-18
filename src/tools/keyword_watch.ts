/** Keyword watch tools: find new Threads posts by a keyword and a description, and reply to them. */

import { z } from "zod";
import { registerTool, type ToolContext } from "./helpers.js";

const replySchema = z.object({
  type: z
    .enum(["none", "text", "ai"])
    .describe("none only collects the posts (and sends the keyword_match webhook), text replies with text, ai writes a reply from prompt."),
  text: z
    .string()
    .max(500)
    .optional()
    .describe("Required when type is text. Up to 500 characters; {name} becomes the author's username and {Hi|Hello} picks one at random."),
  prompt: z
    .string()
    .max(2000)
    .optional()
    .describe("Required when type is ai. How the AI writes the reply; it uses the user's AI setting and answers in the post's language."),
  knowledgeIds: z
    .array(z.string())
    .max(5)
    .optional()
    .describe("Up to 5 knowledge _id from repliz_list_knowledge the AI reads when type is ai."),
  approval: z
    .enum(["auto", "review"])
    .optional()
    .describe("Required unless type is none: review keeps each reply as a draft (kept 90 days) to send with repliz_send_keyword_watch_reply, auto sends it by itself. No default: ask the user."),
});

const watchShape = {
  keyword: z.string().min(1).max(100).describe("One keyword or phrase to search Threads for. In KEYWORD mode a post must contain every word of it (text, image description, article, or topic tag)."),
  filter: z
    .object({
      mode: z.enum(["", "KEYWORD", "TAG"]).optional().describe("KEYWORD (default) searches the text, TAG topic tags."),
      type: z.enum(["", "TEXT", "IMAGE", "VIDEO"]).optional().describe("Only this media type. Empty for every type."),
      username: z.string().optional().describe("Only posts by this Threads username. Empty for everyone."),
      isIncludeReplies: z
        .boolean()
        .optional()
        .describe("true also keeps posts that are replies inside someone else's thread. false (default) keeps only main posts."),
    })
    .optional()
    .describe("Narrows the search. The newest posts are always used."),
  excludes: z
    .array(z.string().max(50))
    .max(20)
    .optional()
    .describe("Words or phrases that skip a post containing any of them, case-insensitive, without AI. Up to 20."),
  criteria: z
    .string()
    .max(1000)
    .optional()
    .describe(
      "Which of the found posts to keep, in plain words, e.g. 'People asking for a coffee shop recommendation in Jakarta, not ads or news.' Read by the user's AI setting (own key or Repliz tokens, must be set up: 400 otherwise), up to 2,000 posts per account a day. Empty keeps every post with the keyword, and then approval auto is not allowed (400)."
    ),
  accountId: z
    .string()
    .describe(
      "The Threads account _id from repliz_list_accounts that searches and replies. One account per watch: to watch the same keyword with another account, create another watch."
    ),
  reply: replySchema.describe("What the account does with the posts it finds."),
};

const PACING_NOTE =
  "Replies are paced per account: at most 10 an hour and 50 a day, 3 to 10 minutes apart, and the same person isn't replied to again by that account for 7 days. A reply counts when queued and gives its place back if it is cancelled, skipped, or fails before it is sent.";

export function registerKeywordWatchTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    "repliz_list_keyword_watches",
    {
      title: "List Keyword Watches",
      effect: "read",
      description:
        "List the keyword watches with keyword, filter, excludes, criteria, status (active or paused), token (AI tokens the criteria filter used), draftCount (replies waiting for review), and per account: reply setting, checkedAt, nextAt, totalMatched, totalReplied, errorMessage, and heldUntil/heldReason when waiting for a limit.",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        limit: z.number().int().min(1).max(100).default(20).describe("Items per page."),
        accountIds: z.array(z.string()).optional().describe("Only watches that use one of these account ids."),
        search: z.string().optional().describe("Matches the keyword or the criteria."),
      },
    },
    async (args) =>
      ctx.client.get("/public/watcher", {
        page: args.page,
        limit: args.limit,
        accountIds: args.accountIds,
        search: args.search,
      })
  );

  registerTool(
    ctx,
    "repliz_get_keyword_watch",
    {
      title: "Get Keyword Watch",
      effect: "read",
      description: "Get one keyword watch, in the same shape as an item of repliz_list_keyword_watches.",
      inputSchema: {
        watcherId: z.string().describe("The keyword watch id (watcherId)."),
      },
    },
    async (args) => ctx.client.get(`/public/watcher/${encodeURIComponent(args.watcherId)}`)
  );

  registerTool(
    ctx,
    "repliz_create_keyword_watch",
    {
      title: "Create Keyword Watch",
      effect: "additive",
      description:
        "Watch Threads for new posts by other people that contain one keyword and fit a description, from one Threads account. " +
        "The account searches every 5 to 60 minutes (less often when it is used by many active watches) for posts published after it was set; posts with an excludes word are skipped, posts that fit criteria are kept (with a reason; every post when criteria is empty) and send the keyword_match webhook, then the account does what reply says. " +
        PACING_NOTE +
        " Replying to strangers can look like spam to Threads: suggest approval review and varied replies. Threads accounts only (400), limited per plan (403). Returns watcherId.",
      inputSchema: watchShape,
    },
    async (args) => ctx.client.post("/public/watcher", args)
  );

  registerTool(
    ctx,
    "repliz_update_keyword_watch",
    {
      title: "Update Keyword Watch",
      effect: "destructive",
      description:
        "Replace every setting of a keyword watch: send all fields, as for repliz_create_keyword_watch (a field left out is cleared, e.g. knowledgeIds). Get the watch first and change only what the user asked. " +
        "Keeping the same accountId keeps the progress; changing it starts over: the previous account's found posts and drafts are deleted, and the new account only picks up posts published from now.",
      inputSchema: {
        watcherId: z.string().describe("The keyword watch id (watcherId)."),
        ...watchShape,
      },
    },
    async ({ watcherId, ...body }) =>
      ctx.client.put(`/public/watcher/${encodeURIComponent(watcherId)}`, body)
  );

  registerTool(
    ctx,
    "repliz_update_keyword_watch_status",
    {
      title: "Update Keyword Watch Status",
      effect: "destructive",
      description:
        "Pause (paused) or resume (active) a keyword watch. While paused nothing is searched and automatic replies still waiting are skipped. Resuming searches right away.",
      inputSchema: {
        watcherId: z.string().describe("The keyword watch id (watcherId)."),
        status: z.enum(["active", "paused"]).describe("active to resume, paused to pause."),
      },
    },
    async (args) =>
      ctx.client.put(`/public/watcher/${encodeURIComponent(args.watcherId)}/status`, {
        status: args.status,
      })
  );

  registerTool(
    ctx,
    "repliz_delete_keyword_watch",
    {
      title: "Delete Keyword Watch",
      effect: "destructive",
      description:
        "Remove a keyword watch with the posts it found and their drafts. Replies already sent stay on Threads. To stop it for a while, pause it instead. Confirm before calling.",
      inputSchema: {
        watcherId: z.string().describe("The keyword watch id (watcherId)."),
      },
    },
    async (args) => ctx.client.delete(`/public/watcher/${encodeURIComponent(args.watcherId)}`)
  );

  registerTool(
    ctx,
    "repliz_list_keyword_watch_posts",
    {
      title: "List Keyword Watch Posts",
      effect: "read",
      description:
        "List the posts a keyword watch found, newest first: the post (content), what the AI read it as (reason), the account, status, and reply (text, id once sent, sendAt while queued, sentAt). " +
        "status: found (kept without a reply), draft (waiting for review), queued, replied, failed (see errorMessage), or skipped (see skipReason).",
      inputSchema: {
        watcherId: z.string().describe("The keyword watch id (watcherId)."),
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        limit: z.number().int().min(1).max(100).default(20).describe("Items per page."),
        status: z
          .enum(["", "found", "draft", "queued", "replied", "failed", "skipped"])
          .optional()
          .describe("Only posts with this status. Every status when empty."),
      },
    },
    async (args) =>
      ctx.client.get(`/public/watcher/${encodeURIComponent(args.watcherId)}/match`, {
        page: args.page,
        limit: args.limit,
        status: args.status,
      })
  );

  registerTool(
    ctx,
    "repliz_update_keyword_watch_draft",
    {
      title: "Update Keyword Watch Draft",
      effect: "destructive",
      description:
        "Change the reply text of a found post without sending it. Works on found, draft, failed, and skipped posts (409 otherwise).",
      inputSchema: {
        watcherId: z.string().describe("The keyword watch id (watcherId)."),
        matchId: z.string().describe("The found post _id from repliz_list_keyword_watch_posts."),
        text: z.string().min(1).max(500).describe("The reply, up to 500 characters."),
      },
    },
    async (args) =>
      ctx.client.put(
        `/public/watcher/${encodeURIComponent(args.watcherId)}/match/${encodeURIComponent(args.matchId)}`,
        { text: args.text }
      )
  );

  registerTool(
    ctx,
    "repliz_send_keyword_watch_reply",
    {
      title: "Send Keyword Watch Reply",
      effect: "additive",
      description:
        "Send the reply of a found post on Threads: a draft after review, a failed or skipped reply again, or a reply to a post kept without one. Works on found, draft, failed, and skipped posts (409 otherwise). " +
        "The reply is queued and goes out at sendAt. " +
        PACING_NOTE +
        " Over a limit it fails with 429 and retryAt. Show the user the text before sending.",
      inputSchema: {
        watcherId: z.string().describe("The keyword watch id (watcherId)."),
        matchId: z.string().describe("The found post _id from repliz_list_keyword_watch_posts."),
        text: z
          .string()
          .max(500)
          .optional()
          .describe("Replaces the reply before sending. Left out, the saved draft is sent."),
      },
    },
    async (args) =>
      ctx.client.post(
        `/public/watcher/${encodeURIComponent(args.watcherId)}/match/${encodeURIComponent(args.matchId)}/send`,
        args.text === undefined ? {} : { text: args.text }
      )
  );

  registerTool(
    ctx,
    "repliz_skip_keyword_watch_post",
    {
      title: "Skip Keyword Watch Post",
      effect: "destructive",
      description:
        "Skip a found post so it gets no reply (status skipped, skipReason manual). It can still be sent later. Works on found, draft, and failed posts (409 otherwise).",
      inputSchema: {
        watcherId: z.string().describe("The keyword watch id (watcherId)."),
        matchId: z.string().describe("The found post _id from repliz_list_keyword_watch_posts."),
      },
    },
    async (args) =>
      ctx.client.post(
        `/public/watcher/${encodeURIComponent(args.watcherId)}/match/${encodeURIComponent(args.matchId)}/skip`,
        {}
      )
  );
}
