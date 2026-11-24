---
name: manage-workspace
description: How to work in a Repliz workspace with the repliz_* tools. Use when the user asks to read or reply to social media comments or DMs, schedule or publish posts, check post or account statistics, or manage Repliz automations, templates, contacts, knowledge or storage, on Instagram, Facebook, Threads, TikTok, YouTube, LinkedIn, X, Pinterest, WhatsApp or Telegram.
---

# Working in a Repliz workspace

Repliz connects a user's social accounts and handles their comments, DMs, scheduled
posts and automations. The `repliz_*` tools call the Repliz Public API as the
signed-in user. Each tool's description has the details; this skill covers how to
combine them and when to stop and ask.

## Start from the accounts

Most tools take an `accountId`. Get it with `repliz_list_accounts`, filtered by
`types` (for example `["instagram"]`), `search` or `tags`, instead of guessing. When
the user names a brand or a handle that matches several accounts, list them and
ask which one. An account with status `disconnected` must be reconnected in Repliz
before it can post or reply; say so rather than retrying.

## Ask before acting on the user's behalf

Replies, DMs and posts go out publicly under the user's name, and some tools
change or delete things that can't be restored.

- **Reading** (list, get, statistics, research): go ahead.
- **Publishing or sending** (`repliz_reply_comment`, `repliz_send_message`,
  `repliz_create_schedule`, `repliz_create_content_comment`,
  `repliz_message_content_comment`, keyword watch replies): show the exact text,
  target account and time first, unless the user already said to send it as is.
- **Changing or deleting** (every `update`, `delete`, `pause` and `resume` tool, and
  bulk deletes): name what will change and wait for a clear yes. Never delete in
  bulk on an inferred list; show the list first.

## Comments and DMs

- The comment inbox is `repliz_list_comments`, filtered by `status` (`pending`,
  `resolved`, `ignored`) and `accountIds`. After replying, mark the comment
  `resolved` with `repliz_update_comment_status` if the user wants the inbox kept
  tidy.
- Before drafting a reply, read the thread or the person's earlier messages
  (`repliz_get_comment`, `repliz_list_messages`, `repliz_get_contact_by_comment`)
  so the answer fits the conversation.
- If an automation answers a chat and the user wants to take over, pause it with
  `repliz_pause_chat` and remind them to resume it afterwards.

## Scheduling posts

- `scheduleAt` is an ISO 8601 timestamp in **UTC**. Convert from the user's time
  zone and state both times back to them, for example "09:00 WIB (02:00 UTC)". Ask
  for the time zone if you can't tell it.
- Check that the post type fits the platform; `repliz_create_schedule` lists which
  platforms take text, image, video, reel, album, link, story and document posts.
  One schedule targets one account, so posting to three accounts is three calls.
- Media must have a public URL. For a file the user gives you, upload it to Repliz
  storage first: `repliz_init_file`, then `repliz_upload_file` (for a file already
  at a public URL) or a PUT to the returned upload URL (for a file in the chat), then
  `repliz_complete_file`. Use the completed file's `url` in `medias`.
- A failed post can be retried with `repliz_retry_schedule` once the cause is fixed.

## Statistics and research

Use `repliz_get_account_statistics` for an account over a period and
`repliz_get_content_statistic` for one post. Find posts with `repliz_list_content`.
Report numbers with their period and platform, and don't compare metrics that
platforms define differently (a TikTok view and a YouTube view are not the same
thing) without saying so.

## Errors

- A tool that is not on the user's Repliz plan returns HTTP 402 (`upgrade plan to
  access this api`). Tell the user their plan doesn't include that feature, and don't
  retry or work around it.
- A `401` means the Repliz sign-in has expired or the keys were refreshed; ask the
  user to reconnect Repliz.
- On a rate-limit error, wait a moment and retry once, then tell the user.
