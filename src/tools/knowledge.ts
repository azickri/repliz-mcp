/**
 * Knowledge tools: what the AI replies know about the business (products,
 * prices, shipping, FAQs), set up once and picked in any AI reply with
 * `knowledgeIds`.
 *
 * A knowledge holds sources. Each source is read in the background: it starts
 * as `process`, then turns `ready` (with its `chars`) or `error` (with
 * `errorMessage`).
 */

import { z } from "zod";
import { registerTool, type ToolContext } from "./helpers.js";

const SOURCE_TYPE = ["text", "faq", "url", "file"] as const;

const faqSchema = z
  .array(
    z.object({
      question: z.string().min(1).max(500).describe("The question, up to 500 characters."),
      answer: z.string().min(1).max(5000).describe("The answer, up to 5000 characters."),
    })
  )
  .min(1)
  .max(300);

const knowledgeId = z.string().describe("The knowledge id, the _id from repliz_list_knowledge.");
const sourceId = z.string().describe("The source id, the _id of an item in sources from repliz_get_knowledge.");

const path = (id: string, source?: string) =>
  `/public/knowledge/${encodeURIComponent(id)}` + (source ? `/source/${encodeURIComponent(source)}` : "");

export function registerKnowledgeTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    "repliz_list_knowledge",
    {
      title: "List Knowledge",
      effect: "read",
      description:
        "List every knowledge of the account owner, newest first. A knowledge is information about the business that the AI reads before it answers. " +
        "Use its _id in knowledgeIds (up to 5) of an AI reply, message, chat, story or storyMention config in repliz_update_account_automation, automations or templates. " +
        "Each item has name, description, chars (characters of its ready sources) and sourceCount.",
      inputSchema: {},
    },
    async () => ctx.client.get("/public/knowledge")
  );

  registerTool(
    ctx,
    "repliz_get_knowledge",
    {
      title: "Get Knowledge",
      effect: "read",
      description:
        "Get a knowledge with its sources (without their full text) and usage: how many accounts, post automations and templates use it.",
      inputSchema: { knowledgeId },
    },
    async (args) => ctx.client.get(path(args.knowledgeId))
  );

  registerTool(
    ctx,
    "repliz_create_knowledge",
    {
      title: "Create Knowledge",
      effect: "additive",
      description:
        "Create an empty knowledge (up to 100 per account), then add its content with repliz_create_knowledge_source.",
      inputSchema: {
        name: z.string().min(1).max(100).describe("Name, up to 100 characters, e.g. 'Product catalog'."),
        description: z.string().max(500).optional().describe("What the knowledge is about, up to 500 characters."),
      },
    },
    async (args) => ctx.client.post("/public/knowledge", { name: args.name, description: args.description })
  );

  registerTool(
    ctx,
    "repliz_update_knowledge",
    {
      title: "Update Knowledge",
      effect: "destructive",
      description: "Change the name and description of a knowledge. Both are replaced; a left out description becomes empty.",
      inputSchema: {
        knowledgeId,
        name: z.string().min(1).max(100).describe("Name, up to 100 characters."),
        description: z.string().max(500).optional().describe("What the knowledge is about, up to 500 characters."),
      },
    },
    async (args) => ctx.client.put(path(args.knowledgeId), { name: args.name, description: args.description })
  );

  registerTool(
    ctx,
    "repliz_delete_knowledge",
    {
      title: "Delete Knowledge",
      effect: "destructive",
      description:
        "Delete a knowledge and all its sources. It is taken out of every account, post automation and template that uses it. Files picked from Repliz storage stay in storage.",
      inputSchema: { knowledgeId },
    },
    async (args) => ctx.client.delete(path(args.knowledgeId))
  );

  registerTool(
    ctx,
    "repliz_create_knowledge_source",
    {
      title: "Create Knowledge Source",
      effect: "additive",
      description:
        "Add a source to a knowledge. type 'text' needs text (up to 200,000 characters); 'faq' needs faqs (1-300 question/answer pairs); " +
        "'url' needs url, one public web page read once without its links (up to 2 MB); 'file' needs fileId, a PDF, DOCX, TXT or MD of up to 10 MB in Repliz storage " +
        "(upload it first with repliz_init_file, repliz_upload_file and repliz_complete_file, then pass the id). " +
        "The source is read in the background: it starts with status 'process'; check repliz_get_knowledge_source until it is 'ready' or 'error' (see errorMessage). " +
        "Up to 100 sources per knowledge and 5,000,000 characters across all knowledge.",
      inputSchema: {
        knowledgeId,
        type: z.enum(SOURCE_TYPE).describe("text, faq, url, or file."),
        name: z
          .string()
          .max(150)
          .optional()
          .describe("Name, cut to 60 characters. Left out: the first line of the text, 'FAQ', the file name, or the page title."),
        text: z.string().max(200000).optional().describe("Required for type 'text'."),
        faqs: faqSchema.optional().describe("Required for type 'faq'."),
        url: z.string().url().optional().describe("Required for type 'url': a public http(s) page."),
        fileId: z.string().optional().describe("Required for type 'file': the id from repliz_init_file, after repliz_complete_file."),
      },
    },
    async (args) =>
      ctx.client.post(`${path(args.knowledgeId)}/source`, {
        type: args.type,
        name: args.name,
        text: args.text,
        faqs: args.faqs,
        url: args.url,
        fileId: args.fileId,
      })
  );

  registerTool(
    ctx,
    "repliz_get_knowledge_source",
    {
      title: "Get Knowledge Source",
      effect: "read",
      description:
        "Get a source with its full text or faqs and its status: 'process' (still being read), 'ready' (with chars), or 'error' (with errorMessage).",
      inputSchema: { knowledgeId, sourceId },
    },
    async (args) => ctx.client.get(path(args.knowledgeId, args.sourceId))
  );

  registerTool(
    ctx,
    "repliz_update_knowledge_source",
    {
      title: "Update Knowledge Source",
      effect: "destructive",
      description:
        "Rename a source, or replace the text of a 'text' source or the faqs of a 'faq' source. New text or faqs are read again, so the source goes back to 'process'. " +
        "A source still in 'process' can't be changed. To change a 'url' source use repliz_refresh_knowledge_source; to change a file, delete the source and add a new one.",
      inputSchema: {
        knowledgeId,
        sourceId,
        name: z.string().max(150).optional().describe("New name, cut to 60 characters."),
        text: z.string().max(200000).optional().describe("New text of a 'text' source."),
        faqs: faqSchema.optional().describe("New questions and answers of a 'faq' source; replaces them all."),
      },
    },
    async (args) =>
      ctx.client.put(path(args.knowledgeId, args.sourceId), {
        name: args.name,
        text: args.text,
        faqs: args.faqs,
      })
  );

  registerTool(
    ctx,
    "repliz_refresh_knowledge_source",
    {
      title: "Refresh Knowledge Source",
      effect: "destructive",
      description:
        "Read a 'url' source again, for example after the page changed. Its text is replaced and it goes back to 'process' until read. Only for 'url' sources.",
      inputSchema: { knowledgeId, sourceId },
    },
    async (args) => ctx.client.post(`${path(args.knowledgeId, args.sourceId)}/refresh`)
  );

  registerTool(
    ctx,
    "repliz_delete_knowledge_source",
    {
      title: "Delete Knowledge Source",
      effect: "destructive",
      description: "Delete a source from a knowledge. The AI stops using its content right away.",
      inputSchema: { knowledgeId, sourceId },
    },
    async (args) => ctx.client.delete(path(args.knowledgeId, args.sourceId))
  );
}
