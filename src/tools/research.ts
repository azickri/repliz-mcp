/** Research tools: search Threads and TikTok content and users. */

import { z } from 'zod';
import { registerTool, type ToolContext } from './helpers.js';

export function registerResearchTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    'repliz_search_threads_content',
    {
      title: 'Search Threads Content',
      effect: 'read',
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
      effect: 'read',
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
      effect: 'read',
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

  const tikwm =
    'Runs through TikWM with the TikWM API key saved in Repliz (Setting → TikWM key); without one it fails with 400 `invalid tikwm key`, and a 403 carries TikWM\'s own error, for example when the key is out of quota.';

  registerTool(
    ctx,
    'repliz_search_tiktok_hashtag',
    {
      title: 'Search TikTok Hashtags',
      effect: 'read',
      description: `Search TikTok hashtags by keyword. Returns up to 30 per page with id, name, users, and views. Uses cursor pagination via \`nextToken\`. ${tikwm}`,
      inputSchema: {
        keywords: z.string().describe('Hashtag keyword to search for.'),
        nextToken: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response.'),
      },
    },
    async (args) =>
      ctx.client.get('/public/research/tiktok/hashtag/search', {
        keywords: args.keywords,
        nextToken: args.nextToken,
      }),
  );

  registerTool(
    ctx,
    'repliz_search_tiktok_video',
    {
      title: 'Search TikTok Videos',
      effect: 'read',
      description: `Search public TikTok videos by keyword, optionally only recent ones and sorted. Returns up to 30 per page with description, owner, media, url, publish time, and play/like/comment/share/download counts. Uses cursor pagination via \`nextToken\`. ${tikwm}`,
      inputSchema: {
        keywords: z.string().describe('Keyword to search videos for.'),
        publishTime: z
          .union([
            z.literal(0),
            z.literal(1),
            z.literal(7),
            z.literal(30),
            z.literal(90),
            z.literal(180),
          ])
          .optional()
          .describe(
            'Only videos published within this many days: 0 (any time), 1, 7, 30, 90, or 180.',
          ),
        sortType: z
          .union([z.literal(0), z.literal(1), z.literal(3)])
          .optional()
          .describe('0 relevance, 1 most liked, or 3 newest.'),
        nextToken: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response.'),
      },
    },
    async (args) =>
      ctx.client.get('/public/research/tiktok/content/video', {
        keywords: args.keywords,
        publishTime: args.publishTime,
        sortType: args.sortType,
        nextToken: args.nextToken,
      }),
  );

  registerTool(
    ctx,
    'repliz_search_tiktok_photo',
    {
      title: 'Search TikTok Photo Posts',
      effect: 'read',
      description: `Search public TikTok photo posts by keyword. Returns up to 30 per page with description, owner, images, url, publish time, and counts. Uses cursor pagination via \`nextToken\`. ${tikwm}`,
      inputSchema: {
        keywords: z.string().describe('Keyword to search photo posts for.'),
        nextToken: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response.'),
      },
    },
    async (args) =>
      ctx.client.get('/public/research/tiktok/content/photo', {
        keywords: args.keywords,
        nextToken: args.nextToken,
      }),
  );

  registerTool(
    ctx,
    'repliz_search_tiktok_user_content',
    {
      title: 'Get TikTok User Content',
      effect: 'read',
      description: `List the public posts (videos and photo posts) of a TikTok user by username. Returns up to 30 per page with description, media, url, publish time, and counts. Uses cursor pagination via \`nextToken\`. ${tikwm}`,
      inputSchema: {
        uniqueId: z
          .string()
          .describe('The TikTok username whose posts to list, without @.'),
        nextToken: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response.'),
      },
    },
    async (args) =>
      ctx.client.get('/public/research/tiktok/content/user', {
        uniqueId: args.uniqueId,
        nextToken: args.nextToken,
      }),
  );

  registerTool(
    ctx,
    'repliz_list_tiktok_comments',
    {
      title: 'List TikTok Post Comments',
      effect: 'read',
      description: `List the comments of any public TikTok post by its id (the \`id\` from the TikTok search tools). Returns up to 50 per page with text, images, owner, publish time, like and reply counts, \`hasReplies\`, and \`total\`. Uses cursor pagination via \`nextToken\`. ${tikwm}`,
      inputSchema: {
        videoId: z.string().describe('ID of the TikTok post.'),
        nextToken: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response.'),
      },
    },
    async (args) =>
      ctx.client.get('/public/research/tiktok/comment', {
        videoId: args.videoId,
        nextToken: args.nextToken,
      }),
  );

  registerTool(
    ctx,
    'repliz_list_tiktok_comment_replies',
    {
      title: 'List TikTok Comment Replies',
      effect: 'read',
      description: `List the replies to a comment on a public TikTok post. Returns up to 50 per page with text, images, owner, publish time, and like count. Uses cursor pagination via \`nextToken\`. ${tikwm}`,
      inputSchema: {
        videoId: z.string().describe('ID of the TikTok post.'),
        commentId: z
          .string()
          .describe('ID of the comment whose replies to list.'),
        nextToken: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response.'),
      },
    },
    async (args) =>
      ctx.client.get('/public/research/tiktok/comment/reply', {
        videoId: args.videoId,
        commentId: args.commentId,
        nextToken: args.nextToken,
      }),
  );
}
