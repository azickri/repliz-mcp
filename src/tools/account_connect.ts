/** Account OAuth and Connection tools for Facebook, Instagram, Threads, YouTube, LinkedIn, TikTok, Shopee, Twitter, Pinterest, WhatsApp, and Telegram. */

import { z } from "zod";
import { ContentResult, registerTool, withoutInlinePicture, type ToolContext } from "./helpers.js";

type QrSession = { qrcode?: string; picture?: string } & Record<string, unknown>;

/**
 * Attach a session's QR code as an image block, so the client can show it to
 * the user to scan rather than handing the model a wall of base64.
 */
function qrSessionResult(raw: QrSession): unknown {
  const session = withoutInlinePicture(raw);
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
      effect: "read",
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
      effect: "additive",
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
      effect: "read",
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
      effect: "additive",
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
      effect: "additive",
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
      effect: "read",
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
      effect: "additive",
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
      effect: "additive",
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
      effect: "read",
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
      effect: "additive",
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
      effect: "additive",
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
      effect: "read",
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
      effect: "additive",
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
      effect: "read",
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
      effect: "additive",
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
      effect: "additive",
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
      effect: "read",
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
      effect: "additive",
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
      effect: "read",
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
      effect: "additive",
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
      effect: "additive",
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
      effect: "read",
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
      effect: "additive",
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
      effect: "additive",
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
      effect: "read",
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
      effect: "additive",
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
      effect: "additive",
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
      effect: "read",
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
      effect: "additive",
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
      effect: "additive",
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

  // ─── Pinterest ────────────────────────────────────────────────────────────
  //
  // One Repliz account is one Pinterest user. Its boards are not separate
  // accounts: they come later, from the repliz_pinterest_boards add-on, when
  // scheduling a pin.

  registerTool(
    ctx,
    "repliz_authorize_pinterest",
    {
      title: "Authorize Pinterest",
      effect: "read",
      description:
        "Get the Pinterest OAuth authorization URL. After the user approves, Pinterest redirects to `redirect` with a `code` to pass to repliz_connect_pinterest or repliz_reconnect_pinterest.",
      inputSchema: {
        redirect: z.string().describe("Redirect URL after authorization."),
      },
    },
    async (args) => ctx.client.get("/public/account/pinterest/authorize", { redirect: args.redirect })
  );

  registerTool(
    ctx,
    "repliz_connect_pinterest",
    {
      title: "Connect Pinterest",
      effect: "additive",
      description:
        "Connect a Pinterest account to Repliz using the OAuth code. Returns the new accountId. Boards are picked per schedule with repliz_pinterest_boards, not connected as accounts.",
      inputSchema: {
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) => ctx.client.post("/public/account/pinterest/connect", { code: args.code })
  );

  registerTool(
    ctx,
    "repliz_reconnect_pinterest",
    {
      title: "Reconnect Pinterest",
      effect: "additive",
      description:
        "Reconnect an existing Pinterest account. The OAuth code must come from the same Pinterest account.",
      inputSchema: {
        accountId: z.string().describe("Repliz account ID."),
        code: z.string().describe("OAuth authorization code."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/account/pinterest/connect/${encodeURIComponent(args.accountId)}`, {
        code: args.code,
      })
  );

  // ─── WhatsApp ─────────────────────────────────────────────────────────────
  //
  // Linked by scanning a QR code rather than an OAuth redirect:
  //   1. repliz_create_whatsapp_session — starts a session and returns its token
  //   2. repliz_get_whatsapp_session    — polled for the latest QR code until isConnected
  //   3. repliz_connect_whatsapp / repliz_reconnect_whatsapp — connects the session's number
  //
  // The channels and groups an account posts to come later, from the
  // repliz_whatsapp_channels add-on, when scheduling.

  registerTool(
    ctx,
    "repliz_create_whatsapp_session",
    {
      title: "Create WhatsApp Session",
      effect: "additive",
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
      effect: "read",
      description:
        "Get a WhatsApp session's status and latest QR code (step 2). The QR code expires quickly, so call this every few seconds and show the user the newest one to scan in WhatsApp > Linked devices, until isConnected is true. Then call repliz_connect_whatsapp, or repliz_reconnect_whatsapp, with the same token.",
      inputSchema: {
        token: z.string().describe("WhatsApp session token from repliz_create_whatsapp_session."),
      },
    },
    async (args) =>
      qrSessionResult(
        await ctx.client.get<QrSession>("/public/account/whatsapp/session", { token: args.token })
      )
  );

  registerTool(
    ctx,
    "repliz_connect_whatsapp",
    {
      title: "Connect WhatsApp",
      effect: "additive",
      description:
        "Connect the WhatsApp number linked to a session to Repliz (step 3). Call once repliz_get_whatsapp_session reports isConnected true. Returns the new accountId.",
      inputSchema: {
        token: z.string().describe("WhatsApp session token from repliz_create_whatsapp_session."),
      },
    },
    async (args) => ctx.client.post("/public/account/whatsapp/connect", { token: args.token })
  );

  registerTool(
    ctx,
    "repliz_reconnect_whatsapp",
    {
      title: "Reconnect WhatsApp",
      effect: "additive",
      description:
        "Reconnect an existing WhatsApp account using a new session (step 3, instead of connecting). Call once repliz_get_whatsapp_session reports isConnected true; the QR code must be scanned with the same WhatsApp number as the account.",
      inputSchema: {
        accountId: z.string().describe("Repliz account ID."),
        token: z.string().describe("WhatsApp session token from repliz_create_whatsapp_session."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/account/whatsapp/connect/${encodeURIComponent(args.accountId)}`, {
        token: args.token,
      })
  );

  // ─── Telegram ─────────────────────────────────────────────────────────────
  //
  // Linked by QR code like WhatsApp, with one extra step for accounts that
  // have two-step verification:
  //   1. repliz_create_telegram_session — starts a session and returns its token
  //   2. repliz_get_telegram_session    — polled for the latest QR code until isConnected;
  //      when it reports isPasswordRequired, repliz_send_telegram_password, then keep polling
  //   3. repliz_connect_telegram / repliz_reconnect_telegram — connects the session's account
  //
  // The channels and groups an account posts to come later, from the
  // repliz_telegram_channels add-on, when scheduling.

  registerTool(
    ctx,
    "repliz_create_telegram_session",
    {
      title: "Create Telegram Session",
      effect: "additive",
      description:
        "Start a new Telegram session (step 1 of connecting Telegram). Returns a session token; pass it to repliz_get_telegram_session to get the QR code.",
      inputSchema: {},
    },
    async () => ctx.client.post("/public/account/telegram/session")
  );

  registerTool(
    ctx,
    "repliz_get_telegram_session",
    {
      title: "Get Telegram Session",
      effect: "read",
      description:
        "Get a Telegram session's status and latest QR code (step 2). Show the user the newest QR code to scan in Telegram > Settings > Devices > Link Desktop Device; it changes every 30 seconds and the session stops waiting after about 3 minutes, so call this every few seconds until isConnected is true. " +
        "If isPasswordRequired is true, the account has two-step verification: ask the user for their password (passwordHint is their hint), send it with repliz_send_telegram_password, and keep polling. " +
        "Once connected, call repliz_connect_telegram, or repliz_reconnect_telegram, with the same token.",
      inputSchema: {
        token: z.string().describe("Telegram session token from repliz_create_telegram_session."),
      },
    },
    async (args) =>
      qrSessionResult(
        await ctx.client.get<QrSession>("/public/account/telegram/session", { token: args.token })
      )
  );

  registerTool(
    ctx,
    "repliz_send_telegram_password",
    {
      title: "Send Telegram Password",
      effect: "additive",
      description:
        "Finish a Telegram login that needs the account's two-step verification password. Only valid while repliz_get_telegram_session reports isPasswordRequired true. A wrong password returns an error; ask the user again. Never store or repeat the password.",
      inputSchema: {
        token: z.string().describe("Telegram session token from repliz_create_telegram_session."),
        password: z.string().describe("The account's two-step verification password, as the user typed it."),
      },
    },
    async (args) =>
      ctx.client.post("/public/account/telegram/session/password", {
        token: args.token,
        password: args.password,
      })
  );

  registerTool(
    ctx,
    "repliz_connect_telegram",
    {
      title: "Connect Telegram",
      effect: "additive",
      description:
        "Connect the Telegram account linked to a session to Repliz (step 3). Call once repliz_get_telegram_session reports isConnected true. Returns the new accountId.",
      inputSchema: {
        token: z.string().describe("Telegram session token from repliz_create_telegram_session."),
      },
    },
    async (args) => ctx.client.post("/public/account/telegram/connect", { token: args.token })
  );

  registerTool(
    ctx,
    "repliz_reconnect_telegram",
    {
      title: "Reconnect Telegram",
      effect: "additive",
      description:
        "Reconnect an existing Telegram account using a new session (step 3, instead of connecting). Call once repliz_get_telegram_session reports isConnected true; the QR code must be scanned from the same Telegram account.",
      inputSchema: {
        accountId: z.string().describe("Repliz account ID."),
        token: z.string().describe("Telegram session token from repliz_create_telegram_session."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/account/telegram/connect/${encodeURIComponent(args.accountId)}`, {
        token: args.token,
      })
  );
}
