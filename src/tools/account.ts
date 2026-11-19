/** Account management tools. */

import { z } from "zod";
import { KEYWORD_OPENING_NOTE, LIMIT_KNOWLEDGE_NOTE, registerTool, type ToolContext } from "./helpers.js";

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
        "List the social accounts connected to your Repliz workspace. Returns each account's id, platform, username, picture, status, and tags. Supports pagination and filtering by platform type, search term, connection status, or tag (e.g. the accounts of one brand).",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        limit: z.number().int().min(1).max(100).default(20).describe("Items per page."),
        types: z
          .array(z.enum(PLATFORMS))
          .optional()
          .describe("Filter by platform(s), e.g. [\"facebook\", \"instagram\"]."),
        search: z.string().optional().describe("Search by account name or username."),
        status: z
          .enum(["connected", "disconnected"])
          .optional()
          .describe(
            "Only connected accounts, or only disconnected ones that have to be reconnected first. Every account when omitted."
          ),
        tags: z
          .array(z.string().max(30))
          .optional()
          .describe(
            "Only accounts with at least one of these tags, case-insensitive. Tag names come from repliz_list_account_tags."
          ),
      },
    },
    async (args) =>
      ctx.client.get("/public/account", {
        page: args.page,
        limit: args.limit,
        types: args.types,
        search: args.search,
        status: args.status,
        tags: args.tags,
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
        "Retrieve aggregated statistics and activity metrics for a specific connected account, including platform-specific overview metrics. Available for Facebook Pages, Instagram, Threads, TikTok, Pinterest, YouTube and LinkedIn organizations. Facebook returns the Page's followers and likes, Meta's last 28 days' totals (views, reach, post engagement, page visits, new follows, unfollows, video views) and the same metrics per day; summary is null and metrics empty when the Page hasn't granted read_insights (a Page connected before November 13, 2026 must be reconnected once). Instagram returns the profile's followers, following and posts, the last 30 days' totals (reach, views, accounts engaged, interactions, likes, comments, shares, saves, replies, reposts, profile link taps, new follows and unfollows), daily reach, and the followers' age, gender, country and city as 0-1 shares (follows and demographics need at least 100 followers). Threads returns the followers, the last 30 days' views, likes, replies, reposts, quotes and link clicks, plus the followers' age, gender, country and city as 0-1 shares for profiles with at least 100 followers. TikTok returns the profile counts and the daily metrics of the last 30 days up to yesterday. YouTube returns the channel's lifetime subscribers, views, videos and likes, plus the last 28 days of YouTube Analytics (views, watch time in minutes, average view duration in seconds, subscribers gained and lost, likes, dislikes, comments, shares) as a summary and per day; the YouTube Analytics part is cached for 6 hours.",
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
        `Update the default automation configurations (delete, reply, like, message, chat, story, storyMention, pause, starter) for a connected account. ${KEYWORD_OPENING_NOTE} ${LIMIT_KNOWLEDGE_NOTE}`,
      inputSchema: {
        accountId: z.string().describe("The Repliz account id."),
        delete: z.record(z.unknown()).describe("Delete automation configuration object."),
        reply: z.record(z.unknown()).describe("Reply automation configuration object."),
        like: z.record(z.unknown()).describe("Like automation configuration object."),
        message: z.record(z.unknown()).describe("Message automation configuration object."),
        chat: z.record(z.unknown()).describe("Chat automation configuration object."),
        story: z.record(z.unknown()).describe("Story automation configuration object."),
        storyMention: z
          .record(z.unknown())
          .optional()
          .describe(
            "Instagram only: DM people who mention the account in their own story. Same shape as story without keyword and condition: { isActive, type: 'text' | 'ai' | 'opening', text, prompt, opening, delay }. The AI only knows the person's name. Left out, the saved setting is kept."
          ),
        pause: z
          .object({
            isActive: z.boolean().describe("Pause the DM automation of a chat when the account replies to it by hand."),
            value: z
              .union([z.literal(0), z.literal(1800), z.literal(3600), z.literal(21600), z.literal(86400)])
              .describe("Seconds the chat stays paused: 1800, 3600, 21600, 86400, or 0 until resumed."),
          })
          .optional()
          .describe(
            "Pauses Reply DM, Reply Story and Reply Story Mention in a chat when the account replies to it by hand, from Repliz or the platform's app. Resume a chat early with repliz_resume_chat. Left out, the saved setting is kept."
          ),
        starter: z
          .object({
            isActive: z
              .boolean()
              .describe("Turns DM Starters on. false removes the questions from the chat and stops answering the links."),
            questions: z
              .array(
                z.object({
                  id: z
                    .string()
                    .optional()
                    .describe("Send back the id Repliz returns unchanged, or questions already shown stop working."),
                  question: z.string().max(80).describe("The question shown in an empty chat, up to 80 characters."),
                  type: z
                    .enum(["text", "opening"])
                    .optional()
                    .describe("text answers with text, opening answers with the button flow in opening. Text when left out."),
                  text: z.string().describe("The answer for type text. Supports {name} and spintax. Send '' for opening."),
                  opening: z
                    .record(z.unknown())
                    .optional()
                    .describe("The answer for type opening: { postback, additional, webUrl }, like a keyword with buttons."),
                })
              )
              .max(4)
              .describe(
                "Up to 4 questions (ice breakers) shown in an empty chat in the mobile app; tapping one sends its answer. They replace the FAQ set in the Instagram or Facebook app. A question without an answer is not shown."
              ),
            links: z
              .array(
                z.object({
                  id: z
                    .string()
                    .optional()
                    .describe("Send back the id Repliz returns unchanged, or buttons already sent stop working."),
                  ref: z
                    .string()
                    .max(50)
                    .regex(/^[A-Za-z0-9_=-]*$/)
                    .describe(
                      "The ref of the link, like promo in https://ig.me/m/<username>?ref=promo (Instagram) or https://m.me/<page id>?ref=promo (Facebook). Letters, numbers, -, _ and =, unique per account, case-insensitive."
                    ),
                  type: z
                    .enum(["text", "opening"])
                    .optional()
                    .describe("text answers with text, opening answers with the button flow in opening. Text when left out."),
                  text: z.string().describe("The answer for type text. Supports {name} and spintax. Send '' for opening."),
                  opening: z
                    .record(z.unknown())
                    .optional()
                    .describe("The answer for type opening: { postback, additional, webUrl }, like a keyword with buttons."),
                })
              )
              .max(20)
              .describe(
                "Up to 20 chat links answered when someone opens the chat through them. On Instagram, a link opens the chat only when tapped inside the Instagram app (bio or DM), and a new chat through a link needs at least one question."
              ),
          })
          .optional()
          .describe(
            "Instagram and Facebook only: DM Starters, questions shown in an empty chat and chat links with a ref, each with its own answer. Left out, the saved setting is kept. Guide: https://docs.repliz.com/api/guides/automation-config#dm-starters"
          ),
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
        storyMention: args.storyMention,
        pause: args.pause,
        starter: args.starter,
      })
  );

  registerTool(
    ctx,
    "repliz_list_account_tags",
    {
      title: "List Account Tags",
      effect: "read",
      description:
        "List the tags used to group accounts (for example per brand or client), sorted by name. Each item has `tag`, `total` (accounts with the tag), and the count per platform. With an operator's API key, only the accounts assigned to that operator are counted.",
      inputSchema: {},
    },
    async () => ctx.client.get("/public/account/tag")
  );

  registerTool(
    ctx,
    "repliz_update_account_tags",
    {
      title: "Update Account Tags",
      effect: "destructive",
      description:
        "Replace every tag of one account. Send the full list: tags left out are removed, and [] removes them all. At most 10 tags of up to 30 characters; tags are case-insensitive, and a tag another account already has takes that spelling.",
      inputSchema: {
        accountId: z.string().describe("The Repliz account id."),
        tags: z
          .array(z.string().max(30))
          .max(10)
          .describe("Every tag the account should have, e.g. [\"Brand A\"]."),
      },
    },
    async (args) =>
      ctx.client.put(`/public/account/${encodeURIComponent(args.accountId)}/tag`, {
        tags: args.tags,
      })
  );

  registerTool(
    ctx,
    "repliz_rename_account_tag",
    {
      title: "Rename Account Tag",
      effect: "destructive",
      description:
        "Rename a tag on every account that has it, e.g. when a brand changes its name. If another tag already has the new name, the two are merged. Fails with 404 when no account has the tag.",
      inputSchema: {
        tag: z.string().max(30).describe("The tag to rename, case-insensitive."),
        name: z.string().max(30).describe("The new name, up to 30 characters."),
      },
    },
    async (args) => ctx.client.put("/public/account/tag", { tag: args.tag, name: args.name })
  );

  registerTool(
    ctx,
    "repliz_delete_account_tag",
    {
      title: "Delete Account Tag",
      effect: "destructive",
      description:
        "Remove a tag from every account that has it. The accounts stay connected; only the tag goes. Fails with 404 when no account has the tag.",
      inputSchema: {
        tag: z.string().max(30).describe("The tag to remove, case-insensitive."),
      },
    },
    async (args) => ctx.client.delete("/public/account/tag", { tag: args.tag })
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
