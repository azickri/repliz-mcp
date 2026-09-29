/** Account OAuth and Connection tools for Facebook, Instagram, Threads, YouTube, LinkedIn, TikTok, Shopee, Twitter, and WhatsApp. */

import { z } from "zod";
import { ContentResult, registerTool, type ToolContext } from "./helpers.js";

type WhatsAppSession = { qrcode?: string } & Record<string, unknown>;

/**
 * Attach a session's QR code as an image block, so the client can show it to
 * the user to scan rather than handing the model a wall of base64.
 */
function whatsAppSessionResult(session: WhatsAppSession): unknown {
  if (!session?.qrcode) return session;
  return new ContentResult([
    {
      type: "text",
      text: JSON.stringify({ ...session, qrcode: "(attached as a PNG image)" }, null, 2),
    },
    { type: "image", data: session.qrcode, mimeType: "image/png" },
  ]);
}

export function registerAccountConnectTools(ctx: ToolContext): void {
  // ─── Facebook ─────────────────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_authorize_facebook",
    {
      title: "Authorize Facebook",
      description: "Get Facebook OAuth authorization URL.",
      inputSchema: {
        redirect: z.string().describe("Redirect URL after authorization."),
      },
    },
    async (args) => ctx.client.get("/public/account/facebook/authorize", { redirect: args.redirect })
  );

  registerTool(
    ctx,
    "repliz_exchange_facebook",
    {
      title: "Exchange Facebook Code",
      description: "Exchange Facebook OAuth code for access token.",
      inputSchema: {
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) => ctx.client.post("/public/account/facebook/exchange", { code: args.code })
  );

  registerTool(
    ctx,
    "repliz_get_facebook_pages",
    {
      title: "Get Facebook Pages",
      description: "List Facebook pages accessible with the provided token.",
      inputSchema: {
        token: z.string().describe("Facebook access token."),
      },
    },
    async (args) => ctx.client.get("/public/account/facebook/page", { token: args.token })
  );

  registerTool(
    ctx,
    "repliz_connect_facebook",
    {
      title: "Connect Facebook Page",
      description: "Connect a Facebook Page account to Repliz.",
      inputSchema: {
        pageId: z.string().describe("Facebook Page ID."),
        token: z.string().describe("Facebook Access Token."),
      },
    },
    async (args) =>
      ctx.client.post("/public/account/facebook/connect", {
        pageId: args.pageId,
        token: args.token,
      })
  );

  registerTool(
    ctx,
    "repliz_reconnect_facebook",
    {
      title: "Reconnect Facebook Page",
      description: "Reconnect an existing Facebook Page account.",
      inputSchema: {
        accountId: z.string().describe("Repliz account ID."),
        pageId: z.string().describe("Facebook Page ID."),
        token: z.string().describe("Facebook Access Token."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/account/facebook/connect/${encodeURIComponent(args.accountId)}`, {
        pageId: args.pageId,
        token: args.token,
      })
  );

  // ─── Instagram ────────────────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_authorize_instagram",
    {
      title: "Authorize Instagram",
      description: "Get Instagram OAuth authorization URL.",
      inputSchema: {
        redirect: z.string().describe("Redirect URL after authorization."),
      },
    },
    async (args) => ctx.client.get("/public/account/instagram/authorize", { redirect: args.redirect })
  );

  registerTool(
    ctx,
    "repliz_connect_instagram",
    {
      title: "Connect Instagram",
      description: "Connect an Instagram account to Repliz using OAuth code.",
      inputSchema: {
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) => ctx.client.post("/public/account/instagram/connect", { code: args.code })
  );

  registerTool(
    ctx,
    "repliz_reconnect_instagram",
    {
      title: "Reconnect Instagram",
      description: "Reconnect an existing Instagram account.",
      inputSchema: {
        accountId: z.string().describe("Repliz account ID."),
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/account/instagram/connect/${encodeURIComponent(args.accountId)}`, {
        code: args.code,
      })
  );

  // ─── Threads ──────────────────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_authorize_threads",
    {
      title: "Authorize Threads",
      description: "Get Threads OAuth authorization URL.",
      inputSchema: {
        redirect: z.string().describe("Redirect URL after authorization."),
      },
    },
    async (args) => ctx.client.get("/public/account/threads/authorize", { redirect: args.redirect })
  );

  registerTool(
    ctx,
    "repliz_connect_threads",
    {
      title: "Connect Threads",
      description: "Connect a Threads account to Repliz using OAuth code.",
      inputSchema: {
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) => ctx.client.post("/public/account/threads/connect", { code: args.code })
  );

  registerTool(
    ctx,
    "repliz_reconnect_threads",
    {
      title: "Reconnect Threads",
      description: "Reconnect an existing Threads account.",
      inputSchema: {
        accountId: z.string().describe("Repliz account ID."),
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/account/threads/connect/${encodeURIComponent(args.accountId)}`, {
        code: args.code,
      })
  );

  // ─── YouTube ──────────────────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_authorize_youtube",
    {
      title: "Authorize YouTube",
      description: "Get YouTube OAuth authorization URL.",
      inputSchema: {
        redirect: z.string().describe("Redirect URL after authorization."),
      },
    },
    async (args) => ctx.client.get("/public/account/youtube/authorize", { redirect: args.redirect })
  );

  registerTool(
    ctx,
    "repliz_exchange_youtube",
    {
      title: "Exchange YouTube Code",
      description: "Exchange YouTube OAuth code for access token.",
      inputSchema: {
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) => ctx.client.post("/public/account/youtube/exchange", { code: args.code })
  );

  registerTool(
    ctx,
    "repliz_get_youtube_channels",
    {
      title: "Get YouTube Channels",
      description: "List YouTube channels accessible with the provided token.",
      inputSchema: {
        token: z.string().describe("YouTube access token."),
      },
    },
    async (args) => ctx.client.get("/public/account/youtube/channel", { token: args.token })
  );

  registerTool(
    ctx,
    "repliz_connect_youtube",
    {
      title: "Connect YouTube Channel",
      description: "Connect a YouTube channel account to Repliz.",
      inputSchema: {
        channelId: z.string().describe("YouTube channel ID."),
        token: z.string().describe("YouTube access token."),
      },
    },
    async (args) =>
      ctx.client.post("/public/account/youtube/connect", {
        channelId: args.channelId,
        token: args.token,
      })
  );

  registerTool(
    ctx,
    "repliz_reconnect_youtube",
    {
      title: "Reconnect YouTube Channel",
      description: "Reconnect an existing YouTube channel account.",
      inputSchema: {
        accountId: z.string().describe("Repliz account ID."),
        channelId: z.string().describe("YouTube channel ID."),
        token: z.string().describe("YouTube access token."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/account/youtube/connect/${encodeURIComponent(args.accountId)}`, {
        channelId: args.channelId,
        token: args.token,
      })
  );

  // ─── LinkedIn ─────────────────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_authorize_linkedin",
    {
      title: "Authorize LinkedIn",
      description: "Get LinkedIn OAuth authorization URL.",
      inputSchema: {
        redirect: z.string().describe("Redirect URL after authorization."),
      },
    },
    async (args) => ctx.client.get("/public/account/linkedin/authorize", { redirect: args.redirect })
  );

  registerTool(
    ctx,
    "repliz_exchange_linkedin",
    {
      title: "Exchange LinkedIn Code",
      description: "Exchange LinkedIn OAuth code for access token.",
      inputSchema: {
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) => ctx.client.post("/public/account/linkedin/exchange", { code: args.code })
  );

  registerTool(
    ctx,
    "repliz_get_linkedin_organizations",
    {
      title: "Get LinkedIn Organizations",
      description: "List LinkedIn organizations accessible with the provided token.",
      inputSchema: {
        token: z.string().describe("LinkedIn access token."),
      },
    },
    async (args) => ctx.client.get("/public/account/linkedin/organization", { token: args.token })
  );

  registerTool(
    ctx,
    "repliz_connect_linkedin",
    {
      title: "Connect LinkedIn Organization",
      description: "Connect a LinkedIn organization/profile account to Repliz.",
      inputSchema: {
        organizationId: z.string().describe("LinkedIn organization ID."),
        token: z.string().describe("LinkedIn access token."),
      },
    },
    async (args) =>
      ctx.client.post("/public/account/linkedin/connect", {
        organizationId: args.organizationId,
        token: args.token,
      })
  );

  registerTool(
    ctx,
    "repliz_reconnect_linkedin",
    {
      title: "Reconnect LinkedIn Organization",
      description: "Reconnect an existing LinkedIn organization/profile account.",
      inputSchema: {
        accountId: z.string().describe("Repliz account ID."),
        organizationId: z.string().describe("LinkedIn organization ID."),
        token: z.string().describe("LinkedIn access token."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/account/linkedin/connect/${encodeURIComponent(args.accountId)}`, {
        organizationId: args.organizationId,
        token: args.token,
      })
  );

  // ─── TikTok ───────────────────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_authorize_tiktok",
    {
      title: "Authorize TikTok",
      description: "Get TikTok OAuth authorization URL.",
      inputSchema: {
        redirect: z.string().describe("Redirect URL after authorization."),
      },
    },
    async (args) => ctx.client.get("/public/account/tiktok/authorize", { redirect: args.redirect })
  );

  registerTool(
    ctx,
    "repliz_connect_tiktok",
    {
      title: "Connect TikTok",
      description: "Connect a TikTok account to Repliz using OAuth code.",
      inputSchema: {
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) => ctx.client.post("/public/account/tiktok/connect", { code: args.code })
  );

  registerTool(
    ctx,
    "repliz_reconnect_tiktok",
    {
      title: "Reconnect TikTok",
      description: "Reconnect an existing TikTok account.",
      inputSchema: {
        accountId: z.string().describe("Repliz account ID."),
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/account/tiktok/connect/${encodeURIComponent(args.accountId)}`, {
        code: args.code,
      })
  );

  // ─── Shopee ───────────────────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_authorize_shopee",
    {
      title: "Authorize Shopee",
      description: "Get Shopee OAuth authorization URL.",
      inputSchema: {
        redirect: z.string().describe("Redirect URL after authorization."),
      },
    },
    async (args) => ctx.client.get("/public/account/shopee/authorize", { redirect: args.redirect })
  );

  registerTool(
    ctx,
    "repliz_connect_shopee",
    {
      title: "Connect Shopee",
      description: "Connect a Shopee account to Repliz using OAuth code.",
      inputSchema: {
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) => ctx.client.post("/public/account/shopee/connect", { code: args.code })
  );

  registerTool(
    ctx,
    "repliz_reconnect_shopee",
    {
      title: "Reconnect Shopee",
      description: "Reconnect an existing Shopee account.",
      inputSchema: {
        accountId: z.string().describe("Repliz account ID."),
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/account/shopee/connect/${encodeURIComponent(args.accountId)}`, {
        code: args.code,
      })
  );

  // ─── Twitter ──────────────────────────────────────────────────────────────

  registerTool(
    ctx,
    "repliz_authorize_twitter",
    {
      title: "Authorize Twitter",
      description: "Get Twitter OAuth authorization URL.",
      inputSchema: {
        redirect: z.string().describe("Redirect URL after authorization."),
      },
    },
    async (args) => ctx.client.get("/public/account/twitter/authorize", { redirect: args.redirect })
  );

  registerTool(
    ctx,
    "repliz_connect_twitter",
    {
      title: "Connect Twitter",
      description: "Connect a Twitter account to Repliz using OAuth code.",
      inputSchema: {
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) => ctx.client.post("/public/account/twitter/connect", { code: args.code })
  );

  registerTool(
    ctx,
    "repliz_reconnect_twitter",
    {
      title: "Reconnect Twitter",
      description: "Reconnect an existing Twitter account.",
      inputSchema: {
        accountId: z.string().describe("Repliz account ID."),
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/account/twitter/connect/${encodeURIComponent(args.accountId)}`, {
        code: args.code,
      })
  );

  // ─── WhatsApp ─────────────────────────────────────────────────────────────
  //
  // Linked by scanning a QR code rather than an OAuth redirect:
  //   1. repliz_create_whatsapp_session — starts a session and returns its token
  //   2. repliz_get_whatsapp_session    — polled for the latest QR code until isConnected
  //   3. repliz_get_whatsapp_channels   — lists the account, channels, and groups
  //   4. repliz_connect_whatsapp / repliz_reconnect_whatsapp — connects the chosen one

  registerTool(
    ctx,
    "repliz_create_whatsapp_session",
    {
      title: "Create WhatsApp Session",
      description:
        "Start a new WhatsApp session (step 1 of connecting WhatsApp). Returns a session token; pass it to repliz_get_whatsapp_session to get the QR code.",
      inputSchema: {},
    },
    async () => ctx.client.post("/public/account/whatsapp/session")
  );

  registerTool(
    ctx,
    "repliz_get_whatsapp_session",
    {
      title: "Get WhatsApp Session",
      description:
        "Get a WhatsApp session's status and latest QR code (step 2). The QR code expires quickly, so call this every few seconds and show the user the newest one to scan in WhatsApp > Linked devices, until isConnected is true.",
      inputSchema: {
        token: z.string().describe("WhatsApp session token from repliz_create_whatsapp_session."),
      },
    },
    async (args) =>
      whatsAppSessionResult(
        await ctx.client.get<WhatsAppSession>("/public/account/whatsapp/session", { token: args.token })
      )
  );

  registerTool(
    ctx,
    "repliz_get_whatsapp_channels",
    {
      title: "Get WhatsApp Channels",
      description:
        "List the WhatsApp account, channels, and groups available to a linked session (step 3). Call once repliz_get_whatsapp_session reports isConnected true.",
      inputSchema: {
        token: z.string().describe("WhatsApp session token."),
      },
    },
    async (args) => ctx.client.get("/public/account/whatsapp/channel", { token: args.token })
  );

  registerTool(
    ctx,
    "repliz_connect_whatsapp",
    {
      title: "Connect WhatsApp",
      description: "Connect a WhatsApp account, channel, or group to Repliz (step 4).",
      inputSchema: {
        channelId: z.string().describe("Item ID from repliz_get_whatsapp_channels."),
        token: z.string().describe("That item's token from repliz_get_whatsapp_channels."),
      },
    },
    async (args) =>
      ctx.client.post("/public/account/whatsapp/connect", {
        channelId: args.channelId,
        token: args.token,
      })
  );

  registerTool(
    ctx,
    "repliz_reconnect_whatsapp",
    {
      title: "Reconnect WhatsApp",
      description: "Reconnect an existing WhatsApp account, channel, or group using a new session.",
      inputSchema: {
        accountId: z.string().describe("Repliz account ID."),
        channelId: z.string().describe("Item ID from repliz_get_whatsapp_channels."),
        token: z.string().describe("That item's token from repliz_get_whatsapp_channels."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/account/whatsapp/connect/${encodeURIComponent(args.accountId)}`, {
        channelId: args.channelId,
        token: args.token,
      })
  );
}
