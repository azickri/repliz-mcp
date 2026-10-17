/** Chat / direct-message tools. */

import { z } from "zod";
import { registerTool, type ToolContext } from "./helpers.js";

const CHAT_STATUS = ["unread", "unreplied"] as const;
const MESSAGE_TYPE = ["text", "image", "video", "audio", "document", "button"] as const;

const buttonObjectSchema = z
  .object({
    text: z.string().describe("Body text shown above the button(s)."),
    image: z.string().optional().describe("Optional image URL."),
    buttons: z
      .object({
        type: z.literal("web_url").default("web_url"),
        title: z.string().describe("Button label."),
        url: z.string().describe("URL the button opens."),
      })
      .describe("The button definition."),
  })
  .describe("An interactive button message.");

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
      description: "Get the details of a single conversation by its chat id.",
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
      description: "List the messages within a conversation, paginated (newest first).",
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
        "- button: provide `button` { text, buttons:{ title, url }, image? }",
      inputSchema: {
        chatId: z.string().describe("The chat id to send to."),
        type: z.enum(MESSAGE_TYPE).describe("The message type."),
        text: z.string().optional().describe("Text content (for type 'text')."),
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
}
