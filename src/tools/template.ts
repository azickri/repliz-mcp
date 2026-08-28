/** Template tools: manage reusable automation templates. */

import { z } from 'zod';
import { registerTool, type ToolContext } from './helpers.js';

export function registerTemplateTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    'repliz_list_templates',
    {
      title: 'List Automation Templates',
      description:
        'Retrieve a list of automation templates. Useful for browsing and selecting templates before creating or configuring automations.',
      inputSchema: {
        page: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe('Page number (1-based).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Items per page.'),
        search: z.string().optional().describe('Search query string.'),
      },
    },
    async (args) =>
      ctx.client.get('/public/template', {
        page: args.page,
        limit: args.limit,
        search: args.search,
      }),
  );

  registerTool(
    ctx,
    'repliz_create_template',
    {
      title: 'Create Automation Template',
      description:
        'Create a new reusable automation template containing configuration and content rules for content automations.',
      inputSchema: {
        name: z
          .string()
          .describe("Name of the automation template (e.g. 'Auto Comment')."),
        config: z
          .record(z.unknown())
          .describe(
            'Automation template configuration object containing rules (delete, reply, like, message, chat, story).',
          ),
      },
    },
    async (args) =>
      ctx.client.post('/public/template', {
        name: args.name,
        config: args.config,
      }),
  );

  registerTool(
    ctx,
    'repliz_get_template',
    {
      title: 'Get Automation Template',
      description:
        'Retrieve detailed information and configuration of a specific automation template by its id.',
      inputSchema: {
        templateId: z.string().describe('The template id.'),
      },
    },
    async (args) =>
      ctx.client.get(`/public/template/${encodeURIComponent(args.templateId)}`),
  );

  registerTool(
    ctx,
    'repliz_update_template',
    {
      title: 'Update Automation Template',
      description:
        'Update the configuration or rules of an existing automation template.',
      inputSchema: {
        templateId: z.string().describe('The template id to update.'),
        name: z.string().describe('Updated template name.'),
        config: z
          .record(z.unknown())
          .describe(
            'Updated automation template configuration object containing rules (delete, reply, like, message, chat, story).',
          ),
      },
    },
    async (args) =>
      ctx.client.put(
        `/public/template/${encodeURIComponent(args.templateId)}`,
        {
          name: args.name,
          config: args.config,
        },
      ),
  );

  registerTool(
    ctx,
    'repliz_delete_template',
    {
      title: 'Delete Automation Template',
      description:
        'Delete an automation template. Irreversible — confirm before calling.',
      inputSchema: {
        templateId: z.string().describe('The template id to delete.'),
      },
    },
    async (args) =>
      ctx.client.delete(
        `/public/template/${encodeURIComponent(args.templateId)}`,
      ),
  );
}
