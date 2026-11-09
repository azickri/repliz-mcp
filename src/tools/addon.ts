/** Add-on tools: TikTok trending music, Shopee products, WhatsApp and Telegram channels, Pinterest boards (list, create, update, delete), Instagram profile, and link metadata. */

import { z } from "zod";
import { registerTool, withoutInlinePicture, type ToolContext } from "./helpers.js";

const DATE_RANGE = ["1DAY", "7DAY", "30DAY", "90DAY"] as const;

type ChannelList = { docs?: { picture?: string }[] } & Record<string, unknown>;
type BoardList = { docs?: { id: string; name: string; description?: string }[] };

export function registerAddonTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    "repliz_tiktok_trending_music",
    {
      title: "TikTok Trending Music",
      effect: "read",
      description:
        "Get trending TikTok music for a given genre, country, and time window. Useful for picking a `music` track when scheduling a TikTok post.",
      inputSchema: {
        genre: z
          .string()
          .default("ALL")
          .describe(
            "Music genre. Use 'ALL' for everything, or a specific genre such as POP, ROCK, EDM, HIP_HOP/RAP, K-POP, LO-FI, etc."
          ),
        countryCode: z
          .string()
          .length(2)
          .describe("ISO 3166-1 alpha-2 country code, e.g. 'ID', 'US', 'GB'."),
        dateRange: z.enum(DATE_RANGE).default("7DAY").describe("Trending window."),
      },
    },
    async (args) =>
      ctx.client.get("/public/addon/tiktok/music", {
        genre: args.genre,
        countryCode: args.countryCode,
        dateRange: args.dateRange,
      })
  );

  registerTool(
    ctx,
    "repliz_shopee_products",
    {
      title: "List Shopee Products",
      effect: "read",
      description:
        "List Shopee products for a connected Shopee account. Useful for tagging products on posts. Uses cursor pagination via `nextToken`.",
      inputSchema: {
        accountId: z.string().describe("The connected Shopee account id."),
        nextToken: z.string().optional().describe("Pagination cursor from a previous response."),
      },
    },
    async (args) =>
      ctx.client.get("/public/addon/shopee/product", {
        accountId: args.accountId,
        nextToken: args.nextToken,
      })
  );

  registerTool(
    ctx,
    "repliz_whatsapp_channels",
    {
      title: "List WhatsApp Channels",
      effect: "read",
      description:
        "List the WhatsApp channels a connected WhatsApp account owns and the groups it belongs to. Pass the chosen item as `additionalInfo.channel` when scheduling a WhatsApp post to it.",
      inputSchema: {
        accountId: z.string().describe("The connected WhatsApp account id."),
      },
    },
    async (args) => ctx.client.get("/public/addon/whatsapp/channel", { accountId: args.accountId })
  );

  registerTool(
    ctx,
    "repliz_telegram_channels",
    {
      title: "List Telegram Channels",
      effect: "read",
      description:
        "List the Telegram channels a connected Telegram account owns and the groups it belongs to. Pass the chosen item as `additionalInfo.channel` when scheduling a Telegram post to it. Pictures come inline as base64, so they are left empty here.",
      inputSchema: {
        accountId: z.string().describe("The connected Telegram account id."),
      },
    },
    async (args) => {
      const list = await ctx.client.get<ChannelList>("/public/addon/telegram/channel", {
        accountId: args.accountId,
      });
      if (!Array.isArray(list?.docs)) return list;
      return { ...list, docs: list.docs.map(withoutInlinePicture) };
    }
  );

  registerTool(
    ctx,
    "repliz_pinterest_boards",
    {
      title: "List Pinterest Boards",
      effect: "read",
      description:
        "List the boards of a connected Pinterest account. A Pinterest post always goes to a board: pass the chosen item as `additionalInfo.channel` when scheduling (one schedule per board), or its id as `channelId` in repliz_list_content.",
      inputSchema: {
        accountId: z.string().describe("The connected Pinterest account id."),
      },
    },
    async (args) => ctx.client.get("/public/addon/pinterest/board", { accountId: args.accountId })
  );

  registerTool(
    ctx,
    "repliz_create_pinterest_board",
    {
      title: "Create Pinterest Board",
      effect: "additive",
      description:
        "Create a public board on a connected Pinterest account. The returned item can be passed right away as `additionalInfo.channel` when scheduling a Pinterest post.",
      inputSchema: {
        accountId: z.string().describe("The connected Pinterest account id."),
        name: z
          .string()
          .min(1)
          .max(100)
          .describe("Board name, up to 100 characters, not used by another board of the account."),
        description: z.string().max(800).optional().describe("Board description, up to 800 characters."),
      },
    },
    async (args) =>
      ctx.client.post("/public/addon/pinterest/board", {
        accountId: args.accountId,
        name: args.name,
        description: args.description,
      })
  );

  registerTool(
    ctx,
    "repliz_update_pinterest_board",
    {
      title: "Update Pinterest Board",
      effect: "destructive",
      description:
        "Rename a Pinterest board or change its description. Fields you leave out keep their current value; an empty `description` clears it. Its pins and schedules stay as they are.",
      inputSchema: {
        accountId: z.string().describe("The connected Pinterest account id."),
        boardId: z.string().describe("The board id from repliz_pinterest_boards."),
        name: z.string().min(1).max(100).optional().describe("New board name, up to 100 characters."),
        description: z.string().max(800).optional().describe("New description, up to 800 characters."),
      },
    },
    async (args) => {
      const isPartial = args.name === undefined || args.description === undefined;
      const list = isPartial
        ? await ctx.client.get<BoardList>("/public/addon/pinterest/board", { accountId: args.accountId })
        : undefined;
      const current = list?.docs?.find((item) => item.id == args.boardId);
      if (isPartial && !current) throw new Error(`Board ${args.boardId} not found on this account.`);

      return ctx.client.put(`/public/addon/pinterest/board/${encodeURIComponent(args.boardId)}`, {
        accountId: args.accountId,
        name: args.name ?? current?.name,
        description: args.description ?? current?.description ?? "",
      });
    }
  );

  registerTool(
    ctx,
    "repliz_delete_pinterest_board",
    {
      title: "Delete Pinterest Board",
      effect: "destructive",
      description:
        "Delete a Pinterest board. Pinterest deletes every pin in it too. Irreversible — confirm before calling. Schedules that still post to the board fail when they run.",
      inputSchema: {
        accountId: z.string().describe("The connected Pinterest account id."),
        boardId: z.string().describe("The board id from repliz_pinterest_boards."),
      },
    },
    async (args) =>
      ctx.client.delete(`/public/addon/pinterest/board/${encodeURIComponent(args.boardId)}`, {
        accountId: args.accountId,
      })
  );

  registerTool(
    ctx,
    "repliz_get_instagram_profile",
    {
      title: "Get Instagram Profile",
      effect: "read",
      description:
        "Get the profile of an Instagram user who has messaged a connected Instagram account: name, username, picture, follower count, `isFollower` (the user follows the account) and `isFollowing` (the account follows the user). Use it to check whether someone follows before replying. Pass the `senderId` of a chat from repliz_list_chats or repliz_get_chat. Instagram only returns users who have sent a message to the account; anyone else fails with Instagram's error.",
      inputSchema: {
        accountId: z.string().describe("The connected Instagram account id."),
        senderId: z
          .string()
          .regex(/^\d+$/)
          .describe("Instagram-scoped ID of the user, the `senderId` of a chat."),
      },
    },
    async (args) =>
      ctx.client.get("/public/addon/instagram/profile", {
        accountId: args.accountId,
        senderId: args.senderId,
      })
  );

  registerTool(
    ctx,
    "repliz_link_metadata",
    {
      title: "Get Link Metadata",
      effect: "read",
      description:
        "Fetch Open Graph / link-preview metadata (title, description, image) for a URL. Useful for building the `meta` field of a 'link' post.",
      inputSchema: {
        url: z.string().describe("The URL to fetch metadata for."),
      },
    },
    async (args) => ctx.client.get("/public/addon/link/metadata", { url: args.url })
  );

  registerTool(
    ctx,
    "repliz_get_me_addon",
    {
      title: "Get Account Addon Limits",
      effect: "read",
      description:
        "Retrieve addon information and resource allocations (accounts, operators, storage, Twitter/X addon) for your Repliz account.",
      inputSchema: {},
    },
    async () => ctx.client.get("/public/me/addon")
  );
}
