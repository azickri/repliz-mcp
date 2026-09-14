/** Scheduled-post tools: create, list, update, retry, and delete posts. */

import { z } from 'zod';
import { registerTool, type ToolContext } from './helpers.js';

const POST_TYPE = [
  'text',
  'image',
  'video',
  'reel',
  'album',
  'link',
  'story',
] as const;
const SCHEDULE_STATUS = ['pending', 'process', 'error', 'success'] as const;

const mediaSchema = z
  .object({
    type: z.enum(['image', 'video']).describe('Media type.'),
    url: z.string().describe('Public URL of the media file.'),
    thumbnail: z
      .string()
      .optional()
      .describe('Public URL of the thumbnail image.'),
    alt: z
      .string()
      .optional()
      .describe('Alt text / accessibility description.'),
    customThumbnail: z
      .boolean()
      .optional()
      .describe('Whether a custom thumbnail is used.'),
  })
  .describe('A single media item attached to the post.');

const metaSchema = z
  .object({
    title: z.string().default(''),
    description: z.string().default(''),
    url: z.string().default(''),
  })
  .describe(
    "Link preview metadata. Used for 'link' posts; otherwise leave empty.",
  );

const musicVolumeSchema = z
  .object({
    video: z.number().default(50).describe('Video volume level (e.g. 50).'),
    music: z.number().default(100).describe('Music volume level (e.g. 100).'),
  })
  .describe('Volume settings for video and background music.');

const musicSchema = z
  .object({
    id: z.string().describe('Music track ID.'),
    artist: z.string().describe('Music artist name.'),
    name: z.string().describe('Music track name/title.'),
    thumbnail: z.string().describe('Music track thumbnail URL.'),
    volume: musicVolumeSchema
      .optional()
      .default({ video: 50, music: 100 })
      .describe('Volume settings for video and music.'),
  })
  .describe('Background music attached to the post.');

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  thumbnail: z.string(),
  currency: z.string(),
  price: z.number(),
});

const additionalInfoSchema = z
  .object({
    isAiGenerated: z.boolean().default(false),
    isDraft: z.boolean().default(false),
    isAutoAddMusic: z.boolean().default(false),
    isShareToFeed: z
      .boolean()
      .default(false)
      .describe(
        "Whether to share to Instagram main feed. Only applicable for Instagram scheduled posts with type 'video'.",
      ),
    collaborators: z.array(z.string()).default([]),
    music: musicSchema.optional(),
    products: z.array(productSchema).default([]),
    tags: z.array(z.string()).default([]),
    mentions: z.array(z.string()).default([]),
    targetCountries: z.array(z.string()).default([]),
  })
  .describe(
    'Optional extras: collaborators, music, tagged products, hashtags, mentions, isShareToFeed (Instagram video), target countries.',
  );

const replySchema = z.object({
  title: z.string().default(''),
  description: z.string().default(''),
  topic: z.string().default(''),
  type: z.enum(POST_TYPE),
  medias: z.array(mediaSchema).default([]),
});

// Default values matching the API's required (but often empty) sub-objects.
const DEFAULT_META = { title: '', description: '', url: '' };
const DEFAULT_ADDITIONAL_INFO = {
  isAiGenerated: false,
  isDraft: false,
  isAutoAddMusic: false,
  isShareToFeed: false,
  collaborators: [] as string[],
  music: {
    id: '',
    artist: '',
    name: '',
    thumbnail: '',
    volume: { video: 50, music: 100 },
  },
  products: [] as unknown[],
  tags: [] as string[],
  mentions: [] as string[],
  targetCountries: [] as string[],
};

function buildSchedulePayload(args: {
  title?: string;
  description: string;
  topic?: string;
  type: (typeof POST_TYPE)[number];
  medias?: unknown[];
  meta?: Record<string, unknown>;
  additionalInfo?: Record<string, unknown>;
  replies?: unknown[];
  scheduleAt: string;
  templateId?: string;
  accountId?: string; // required for create, not used for update
}) {
  const mergedAdditionalInfo = {
    ...DEFAULT_ADDITIONAL_INFO,
    ...(args.additionalInfo ?? {}),
  };
  if (args.additionalInfo?.music) {
    mergedAdditionalInfo.music = {
      ...DEFAULT_ADDITIONAL_INFO.music,
      ...(args.additionalInfo.music as Record<string, unknown>),
      volume: {
        ...DEFAULT_ADDITIONAL_INFO.music.volume,
        ...(((args.additionalInfo.music as Record<string, unknown>)
          .volume as Record<string, unknown>) ?? {}),
      },
    };
  }

  return {
    title: args.title ?? '',
    description: args.description,
    topic: args.topic ?? '',
    type: args.type,
    medias: args.medias ?? [],
    meta: { ...DEFAULT_META, ...(args.meta ?? {}) },
    additionalInfo: mergedAdditionalInfo,
    replies: args.replies ?? [],
    scheduleAt: args.scheduleAt,
    ...(args.accountId ? { accountId: args.accountId } : {}),
    ...(args.templateId ? { templateId: args.templateId } : {}),
  };
}

export function registerScheduleTools(ctx: ToolContext): void {
  registerTool(
    ctx,
    'repliz_list_schedules',
    {
      title: 'List Scheduled Posts',
      description:
        'List scheduled and published posts. Supports pagination and filtering by account(s), status, and date range.',
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
        accountIds: z
          .array(z.string())
          .optional()
          .describe('Filter by account id(s).'),
        status: z
          .enum(SCHEDULE_STATUS)
          .optional()
          .describe('Filter by post status.'),
        fromDate: z
          .string()
          .optional()
          .describe('ISO 8601 start of date range filter.'),
        toDate: z
          .string()
          .optional()
          .describe('ISO 8601 end of date range filter.'),
      },
    },
    async (args) =>
      ctx.client.get('/public/schedule', {
        page: args.page,
        limit: args.limit,
        accountIds: args.accountIds,
        status: args.status,
        fromDate: args.fromDate,
        toDate: args.toDate,
      }),
  );

  registerTool(
    ctx,
    'repliz_get_schedule',
    {
      title: 'Get Scheduled Post',
      description: 'Get the full details of a single scheduled post by its id.',
      inputSchema: { scheduleId: z.string().describe('The schedule id.') },
    },
    async (args) =>
      ctx.client.get(`/public/schedule/${encodeURIComponent(args.scheduleId)}`),
  );

  registerTool(
    ctx,
    'repliz_create_schedule',
    {
      title: 'Create Scheduled Post',
      description:
        'Schedule a post to be published to a connected account at a specific time.\n\n' +
        'Post type support by platform:\n' +
        '- text: Facebook, Threads\n' +
        '- image: Facebook, Instagram, Threads, TikTok, LinkedIn\n' +
        '- video: Facebook, Instagram, Threads, TikTok, YouTube, LinkedIn\n' +
        '- reel: Facebook\n' +
        '- album: Facebook, Instagram, Threads, TikTok, LinkedIn\n' +
        '- link: Facebook (provide `meta` for the link preview)\n' +
        '- story: Facebook, Instagram\n\n' +
        'For media posts, attach `medias`. For threaded/multi-part posts, attach `replies`. ' +
        '`scheduleAt` must be a future ISO 8601 timestamp (UTC).',
      inputSchema: {
        accountId: z.string().describe('The target account id to publish to.'),
        type: z.enum(POST_TYPE).describe('The kind of post to create.'),
        description: z
          .string()
          .describe("The post caption/body text. Use '' if not needed."),
        scheduleAt: z
          .string()
          .describe(
            'When to publish, as an ISO 8601 UTC timestamp, e.g. 2026-06-20T09:00:00.000Z.',
          ),
        title: z
          .string()
          .optional()
          .describe('Post title (used by some platforms, e.g. YouTube).'),
        topic: z.string().optional().describe('Optional internal topic/label.'),
        medias: z
          .array(mediaSchema)
          .optional()
          .describe('Media items for image/video/reel/album/story/link posts.'),
        meta: metaSchema
          .optional()
          .describe("Link preview metadata (for 'link' posts)."),
        additionalInfo: additionalInfoSchema
          .optional()
          .describe(
            'Optional extras: collaborators, music, products, tags, mentions, isShareToFeed (Instagram video), targetCountries.',
          ),
        replies: z
          .array(replySchema)
          .optional()
          .describe(
            'Follow-up posts in a thread/chain (e.g. nested Threads posts).',
          ),
        templateId: z
          .string()
          .optional()
          .describe('Optional automation template id to apply to this post.'),
      },
    },
    async (args) =>
      ctx.client.post('/public/schedule', buildSchedulePayload(args)),
    // note: accountId is picked up by buildSchedulePayload from args and sent in the request body.
  );

  registerTool(
    ctx,
    'repliz_update_schedule',
    {
      title: 'Update Scheduled Post',
      description:
        'Update an existing scheduled post. The account cannot be changed; provide the new content fields. `scheduleAt` must be a future ISO 8601 timestamp.',
      inputSchema: {
        scheduleId: z.string().describe('The schedule id to update.'),
        type: z.enum(POST_TYPE).describe('The kind of post.'),
        description: z.string().describe('The post caption/body text.'),
        scheduleAt: z
          .string()
          .describe('New publish time as ISO 8601 UTC timestamp.'),
        title: z.string().optional(),
        topic: z.string().optional(),
        medias: z.array(mediaSchema).optional(),
        meta: metaSchema.optional(),
        additionalInfo: additionalInfoSchema.optional(),
        replies: z.array(replySchema).optional(),
        templateId: z.string().optional(),
      },
    },
    async (args) => {
      const { scheduleId, ...rest } = args;
      return ctx.client.put(
        `/public/schedule/${encodeURIComponent(scheduleId)}`,
        buildSchedulePayload(rest),
      );
    },
  );

  registerTool(
    ctx,
    'repliz_retry_schedule',
    {
      title: 'Retry Scheduled Post',
      description:
        "Retry publishing a scheduled post that previously failed (status 'error').",
      inputSchema: {
        scheduleId: z.string().describe('The schedule id to retry.'),
      },
    },
    async (args) =>
      ctx.client.put(
        `/public/schedule/${encodeURIComponent(args.scheduleId)}/retry`,
      ),
  );

  registerTool(
    ctx,
    'repliz_delete_schedule',
    {
      title: 'Delete Scheduled Post',
      description:
        'Delete a single scheduled post by id. Irreversible — confirm before calling.',
      inputSchema: {
        scheduleId: z.string().describe('The schedule id to delete.'),
      },
    },
    async (args) =>
      ctx.client.delete(
        `/public/schedule/${encodeURIComponent(args.scheduleId)}`,
      ),
  );

  registerTool(
    ctx,
    'repliz_delete_schedules',
    {
      title: 'Delete Multiple Scheduled Posts',
      description:
        'Delete several scheduled posts at once by their ids. Irreversible — confirm before calling.',
      inputSchema: {
        scheduleIds: z
          .array(z.string())
          .min(1)
          .describe('The schedule ids to delete.'),
      },
    },
    // scheduleIds is a query parameter (not body) per the API spec
    async (args) =>
      ctx.client.delete('/public/schedule/mass', {
        scheduleIds: args.scheduleIds,
      }),
  );
}
