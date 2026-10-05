/** Add-on tools: TikTok trending music, Shopee products, WhatsApp channels, and link metadata. */

import { z } from "zod";
import { registerTool, type ToolContext } from "./helpers.js";

const DATE_RANGE = ["1DAY", "7DAY", "30DAY", "90DAY"] as const;

export function registerAddonTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    "repliz_tiktok_trending_music",
    {
      title: "TikTok Trending Music",
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
    "repliz_link_metadata",
    {
      title: "Get Link Metadata",
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
      description:
        "Retrieve addon information and resource allocations (accounts, operators, storage, Twitter/X addon) for your Repliz account.",
      inputSchema: {},
    },
    async () => ctx.client.get("/public/me/addon")
  );
}
