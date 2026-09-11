/** Research tools: search Threads content and users. */

import { z } from 'zod';
import { registerTool, type ToolContext } from './helpers.js';

export function registerResearchTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    'repliz_search_threads_content',
    {
      title: 'Search Threads Content',
      description:
        'Search public Threads posts by keyword. Requires a connected Threads account id (used to authorize the search). Supports filtering by sort, search mode, media type, date range (since/until timestamps in seconds), and author username. Uses cursor pagination via `nextToken`.',
      inputSchema: {
        accountId: z
          .string()
          .describe('A connected Threads account id to search with.'),
        search: z.string().describe('The keyword or phrase to search for.'),
        sort: z
          .enum(['TOP', 'RECENT'])
          .optional()
          .describe("Sort order for search results ('TOP' or 'RECENT')."),
        mode: z
          .enum(['KEYWORD', 'TAG'])
          .optional()
          .describe(
            "Search mode ('KEYWORD' for keyword search, 'TAG' for hashtag search).",
          ),
        type: z
          .enum(['TEXT', 'IMAGE', 'VIDEO'])
          .optional()
          .describe(
            "Filter results by post media type ('TEXT', 'IMAGE', or 'VIDEO').",
          ),
        since: z
          .number()
          .int()
          .optional()
          .describe('Start timestamp filter as Unix epoch in seconds.'),
        until: z
          .number()
          .int()
          .optional()
          .describe('End timestamp filter as Unix epoch in seconds.'),
        username: z
          .string()
          .optional()
          .describe('Filter posts authored by a specific Threads username.'),
        nextToken: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response.'),
      },
    },
    async (args) =>
      ctx.client.get('/public/research/threads/content/search', {
        accountId: args.accountId,
        search: args.search,
        sort: args.sort,
        mode: args.mode,
        type: args.type,
        since: args.since,
        until: args.until,
        username: args.username,
        nextToken: args.nextToken,
      }),
  );

  registerTool(
    ctx,
    'repliz_search_threads_user_content',
    {
      title: 'Get Threads User Content',
      description:
        'Fetch public Threads posts authored by a specific username. Requires a connected Threads account id. Uses cursor pagination via `nextToken`.',
      inputSchema: {
        accountId: z
          .string()
          .describe('A connected Threads account id to search with.'),
        username: z
          .string()
          .describe('The Threads username whose posts to fetch.'),
        nextToken: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response.'),
      },
    },
    async (args) =>
      ctx.client.get('/public/research/threads/content/user', {
        accountId: args.accountId,
        username: args.username,
        nextToken: args.nextToken,
      }),
  );

  registerTool(
    ctx,
    'repliz_search_threads_user',
    {
      title: 'Get Threads User Profile',
      description:
        'Look up the public profile of a Threads user by username. Requires a connected Threads account id.',
      inputSchema: {
        accountId: z
          .string()
          .describe('A connected Threads account id to search with.'),
        username: z.string().describe('The Threads username to look up.'),
      },
    },
    async (args) =>
      ctx.client.get('/public/research/threads/user', {
        accountId: args.accountId,
        username: args.username,
      }),
  );
}
