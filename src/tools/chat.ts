/** Chat / direct-message tools. */

import { z } from "zod";
import { registerTool, type ToolContext } from "./helpers.js";
import { buttonObjectSchema, carouselObjectSchema, quickReplyObjectSchema } from "./message.js";

const CHAT_STATUS = ["unread", "unreplied"] as const;
const SENDER_ACTION = ["typing_on", "typing_off", "mark_seen"] as const;
const MESSAGE_TYPE = [
  "text",
  "image",
  "video",
  "audio",
  "document",
  "button",
  "carousel",
  "quick_reply",
] as const;

export function registerChatTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    "repliz_list_chats",
    {
      title: "List Chats",
      effect: "read",
      description:
        "List direct-message conversations across connected accounts. Supports pagination and filtering by status (unread/unreplied), account(s), and search.",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        limit: z.number().int().min(1).max(100).default(20).describe("Items per page."),
        status: z.enum(CHAT_STATUS).optional().describe("Filter by chat status."),
        accountIds: z.array(z.string()).optional().describe("Filter by account id(s)."),
        search: z.string().optional().describe("Search conversations."),
      },
    },
    async (args) =>
      ctx.client.get("/public/chat", {
        page: args.page,
        limit: args.limit,
        status: args.status,
        accountIds: args.accountIds,
        search: args.search,
      })
  );

  registerTool(
    ctx,
    "repliz_get_chat",
    {
      title: "Get Chat",
      effect: "read",
      description:
        "Get the details of a single conversation by its chat id. pausedUntil is set when the DM automation of the chat is or was paused; it is paused while pausedUntil is in the future.",
      inputSchema: { chatId: z.string().describe("The chat id.") },
    },
    async (args) => ctx.client.get(`/public/chat/${encodeURIComponent(args.chatId)}`)
  );

  registerTool(
    ctx,
    "repliz_list_messages",
    {
      title: "List Chat Messages",
      effect: "read",
      description:
        "List the messages within a conversation, paginated (newest first). A message that replies to another has `quoted`, a copy of the message it answers (only `messageId` when that message is older than Repliz keeps).",
      inputSchema: {
        chatId: z.string().describe("The chat id."),
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        limit: z.number().int().min(1).max(100).default(20).describe("Items per page."),
      },
    },
    async (args) =>
      ctx.client.get(`/public/chat/${encodeURIComponent(args.chatId)}/message`, {
        page: args.page,
        limit: args.limit,
      })
  );

  registerTool(
    ctx,
    "repliz_send_message",
    {
      title: "Send Chat Message",
      effect: "additive",
      description:
        "Send a message in a conversation. Set `type` and provide the matching field:\n" +
        "- text: provide `text`\n" +
        "- image: provide `image` { url, mimetype, thumbnail? }\n" +
        "- video: provide `video` { url, duration, mimetype, thumbnail? }\n" +
        "- audio: provide `audio` { url, duration, mimetype }\n" +
        "- document: provide `document` { url, name, size, mimetype }\n" +
        "- button: provide `button` { text, image?, buttons: [1-3 of { type: web_url, title, url } or { type: postback, title, payload }] }\n" +
        "- carousel: provide `carousel` { elements: [1-10 of { title, subtitle?, image?, url?, buttons?: [0-3 buttons] }] }\n" +
        "- quick_reply: provide `quickReply` { text, buttons: [1-13 of { title, payload }] }\n" +
        "button, carousel and quick_reply work on Facebook and Instagram only. A tapped postback button reaches the user's webhook as a `postback` event and a tapped quick reply as a `chat` event, both with `message.payload`.\n" +
        "To answer one specific message, set `replyToMessageId` to its `messageId` (not `_id`) from repliz_list_messages; the platform shows it quoted. TikTok replies are text only.",
      inputSchema: {
        chatId: z.string().describe("The chat id to send to."),
        type: z.enum(MESSAGE_TYPE).describe("The message type."),
        text: z.string().optional().describe("Text content (for type 'text')."),
        replyToMessageId: z
          .string()
          .optional()
          .describe(
            "messageId of a message in this chat to reply to. Returns 404 when it isn't in the chat."
          ),
        image: z
          .object({
            url: z.string(),
            thumbnail: z.string().optional(),
            mimetype: z.string().describe("e.g. image/jpeg"),
          })
          .optional(),
        video: z
          .object({
            url: z.string(),
            thumbnail: z.string().optional(),
            duration: z.number().describe("Duration in seconds."),
            mimetype: z.string().describe("e.g. video/mp4"),
          })
          .optional(),
        audio: z
          .object({
            url: z.string(),
            duration: z.number().describe("Duration in seconds."),
            mimetype: z.string().describe("e.g. audio/mp3"),
          })
          .optional(),
        document: z
          .object({
            url: z.string(),
            name: z.string(),
            size: z.number().describe("File size in bytes."),
            mimetype: z.string().describe("e.g. application/pdf"),
          })
          .optional(),
        button: buttonObjectSchema.optional(),
        carousel: carouselObjectSchema.optional(),
        quickReply: quickReplyObjectSchema.optional(),
      },
    },
    async (args) => {
      const { chatId, ...body } = args;
      return ctx.client.post(`/public/chat/${encodeURIComponent(chatId)}/message`, body);
    }
  );

  registerTool(
    ctx,
    "repliz_read_chat",
    {
      title: "Mark Chat as Read",
      effect: "additive",
      description: "Mark a conversation as read.",
      inputSchema: { chatId: z.string().describe("The chat id to mark read.") },
    },
    async (args) => ctx.client.post(`/public/chat/${encodeURIComponent(args.chatId)}/read`)
  );

  registerTool(
    ctx,
    "repliz_send_chat_action",
    {
      title: "Send Chat Action",
      effect: "additive",
      description:
        "Send a sender action to a conversation on Facebook, Instagram, TikTok, or Telegram. typing_on shows the person a typing indicator (about 20 seconds on Facebook/Instagram, 5 seconds on TikTok/Telegram, or until a message is sent), typing_off hides it (not on TikTok), and mark_seen shows the person their messages as seen and clears the chat's unread count in Repliz. Use repliz_read_chat instead to clear the unread count without the person seeing it.",
      inputSchema: {
        chatId: z.string().describe("The chat id."),
        action: z.enum(SENDER_ACTION).describe("typing_on, typing_off, or mark_seen."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/chat/${encodeURIComponent(args.chatId)}/action`, { action: args.action })
  );

  registerTool(
    ctx,
    "repliz_pause_chat",
    {
      title: "Pause Chat Automation",
      effect: "destructive",
      description:
        "Pause the DM automation (Reply DM, Reply Story, Reply Story Mention) of one conversation, so a person can take over. Messages you send still go out. " +
        "Pausing again replaces the current pause. Returns pausedUntil; 9999-12-31T00:00:00.000Z means until resumed. " +
        "repliz_get_chat shows pausedUntil while a chat is or was paused; it is paused while pausedUntil is in the future.",
      inputSchema: {
        chatId: z.string().describe("The chat id."),
        value: z
          .union([z.literal(0), z.literal(1800), z.literal(3600), z.literal(21600), z.literal(86400)])
          .describe("Seconds to pause: 1800 (30 min), 3600 (1 h), 21600 (6 h), 86400 (24 h), or 0 until resumed."),
      },
    },
    async (args) =>
      ctx.client.post(`/public/chat/${encodeURIComponent(args.chatId)}/pause`, { value: args.value })
  );

  registerTool(
    ctx,
    "repliz_resume_chat",
    {
      title: "Resume Chat Automation",
      effect: "destructive",
      description: "Resume the DM automation of a paused conversation right away. Returns pausedUntil: null.",
      inputSchema: { chatId: z.string().describe("The chat id.") },
    },
    async (args) => ctx.client.post(`/public/chat/${encodeURIComponent(args.chatId)}/resume`)
  );
}
