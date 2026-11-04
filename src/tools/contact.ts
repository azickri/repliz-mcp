/** Contact tools (the light CRM of people who comment on or message the connected accounts). */

import { z } from "zod";
import { registerTool, type ToolContext } from "./helpers.js";

const CONTACT_STAGE = ["new", "contacted", "interested", "won", "lost"] as const;
const FOLLOW_UP = ["scheduled", "due"] as const;

type Contact = { stage: string; tags?: string[]; note?: string };

const filterSchema = {
  search: z.string().optional().describe("Search in contact name and note."),
  tag: z.string().optional().describe("Only contacts with this exact tag (see repliz_list_contact_tags)."),
  followUp: z
    .enum(FOLLOW_UP)
    .optional()
    .describe("'scheduled' for contacts with a follow-up, 'due' for follow-ups whose time has passed."),
  accountIds: z.array(z.string()).optional().describe("Only contacts of these account id(s)."),
};

export function registerContactTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    "repliz_list_contacts",
    {
      title: "List Contacts",
      effect: "read",
      description:
        "List contacts: people who commented on or messaged your connected accounts, created automatically by Repliz. " +
        "Each has a funnel stage (new, contacted, interested, won, lost), tags, a note, an optional follow-up reminder and the last comment or message. " +
        "Sorted by latest interaction, or by nearest follow-up when followUp is set.",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        limit: z.number().int().min(1).max(100).default(20).describe("Items per page."),
        stage: z.enum(CONTACT_STAGE).optional().describe("Filter by funnel stage."),
        ...filterSchema,
      },
    },
    async (args) =>
      ctx.client.get("/public/contact", {
        page: args.page,
        limit: args.limit,
        stage: args.stage,
        search: args.search,
        tag: args.tag,
        followUp: args.followUp,
        accountIds: args.accountIds,
      })
  );

  registerTool(
    ctx,
    "repliz_count_contacts",
    {
      title: "Count Contacts",
      effect: "read",
      description:
        "Count contacts per funnel stage with the same filters as repliz_list_contacts, plus how many follow-ups are due.",
      inputSchema: { ...filterSchema },
    },
    async (args) =>
      ctx.client.get("/public/contact/count", {
        search: args.search,
        tag: args.tag,
        followUp: args.followUp,
        accountIds: args.accountIds,
      })
  );

  registerTool(
    ctx,
    "repliz_list_contact_tags",
    {
      title: "List Contact Tags",
      effect: "read",
      description: "List every tag used on your contacts, sorted by name.",
      inputSchema: {},
    },
    async () => ctx.client.get("/public/contact/tag")
  );

  registerTool(
    ctx,
    "repliz_get_contact",
    {
      title: "Get Contact",
      effect: "read",
      description: "Get one contact with its stage, tags, note, follow-up and last interaction.",
      inputSchema: {
        contactId: z.string().describe("The contact id."),
      },
    },
    async (args) => ctx.client.get(`/public/contact/${encodeURIComponent(args.contactId)}`)
  );

  registerTool(
    ctx,
    "repliz_get_contact_by_comment",
    {
      title: "Get Contact by Comment",
      effect: "additive",
      description:
        "Get the contact of the person who wrote a comment in your inbox, to tag them or plan a follow-up. " +
        "Creates the contact when the comment came in before contacts existed; an existing contact is not changed.",
      inputSchema: {
        commentId: z.string().describe("The comment id from repliz_list_comments."),
      },
    },
    async (args) => ctx.client.put(`/public/contact/comment/${encodeURIComponent(args.commentId)}`)
  );

  registerTool(
    ctx,
    "repliz_get_contact_by_chat",
    {
      title: "Get Contact by Chat",
      effect: "additive",
      description:
        "Get the contact of the person in a direct message chat, to tag them or plan a follow-up. " +
        "Creates the contact when the chat started before contacts existed; an existing contact only gets the chat linked.",
      inputSchema: {
        chatId: z.string().describe("The chat id from repliz_list_chats."),
      },
    },
    async (args) => ctx.client.put(`/public/contact/chat/${encodeURIComponent(args.chatId)}`)
  );

  registerTool(
    ctx,
    "repliz_update_contact",
    {
      title: "Update Contact",
      effect: "destructive",
      description:
        "Change the funnel stage, tags or note of a contact. Fields you leave out keep their current value. " +
        "`tags` replaces the whole list, so include the existing tags (from repliz_get_contact) when adding one.",
      inputSchema: {
        contactId: z.string().describe("The contact id."),
        stage: z.enum(CONTACT_STAGE).optional().describe("New funnel stage."),
        tags: z
          .array(z.string().max(30))
          .max(20)
          .optional()
          .describe("Every tag of the contact, at most 20 of up to 30 characters."),
        note: z.string().max(2000).optional().describe("New note, replacing the current one."),
      },
    },
    async (args) => {
      const path = `/public/contact/${encodeURIComponent(args.contactId)}`;
      const isPartial = args.stage === undefined || args.tags === undefined || args.note === undefined;
      const current = isPartial ? await ctx.client.get<Contact>(path) : undefined;

      return ctx.client.put(path, {
        stage: args.stage ?? current?.stage,
        tags: args.tags ?? current?.tags ?? [],
        note: args.note ?? current?.note ?? "",
      });
    }
  );

  registerTool(
    ctx,
    "repliz_set_contact_follow_up",
    {
      title: "Set Contact Follow-up",
      effect: "destructive",
      description:
        "Plan a follow-up reminder for a contact, replacing the current one. It only reminds the user in Repliz and sends nothing to the contact. " +
        "`at` must be a future ISO 8601 timestamp.",
      inputSchema: {
        contactId: z.string().describe("The contact id."),
        at: z.string().describe("When to follow up, ISO 8601 in the future, e.g. 2026-11-05T09:00:00+07:00."),
        note: z.string().max(500).optional().describe("What to do, e.g. send the price list."),
        message: z
          .string()
          .max(1000)
          .optional()
          .describe(
            "Optional message drafted for the follow-up. Repliz doesn't send it by itself: send it with repliz_send_message (chatId) or repliz_reply_comment (lastCommentId) when the time comes."
          ),
      },
    },
    async (args) =>
      ctx.client.put(`/public/contact/${encodeURIComponent(args.contactId)}/follow-up`, {
        at: args.at,
        note: args.note ?? "",
        ...(args.message ? { message: args.message } : {}),
      })
  );

  registerTool(
    ctx,
    "repliz_remove_contact_follow_up",
    {
      title: "Remove Contact Follow-up",
      effect: "destructive",
      description: "Clear the follow-up of a contact, when it is done or no longer needed.",
      inputSchema: {
        contactId: z.string().describe("The contact id."),
      },
    },
    async (args) => ctx.client.delete(`/public/contact/${encodeURIComponent(args.contactId)}/follow-up`)
  );

  registerTool(
    ctx,
    "repliz_delete_contact",
    {
      title: "Delete Contact",
      effect: "destructive",
      description:
        "Delete a contact with its stage, tags, note and follow-up. Irreversible — confirm with the user before calling. " +
        "A new comment or message from the person creates the contact again from the `new` stage.",
      inputSchema: {
        contactId: z.string().describe("The contact id."),
      },
    },
    async (args) => ctx.client.delete(`/public/contact/${encodeURIComponent(args.contactId)}`)
  );
}
