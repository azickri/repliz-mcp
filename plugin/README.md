# Repliz for Claude

[Repliz](https://repliz.com) manages comments, DMs, scheduled posts and automations
for Instagram, Facebook, Threads, TikTok, YouTube, LinkedIn, X (Twitter), Pinterest,
WhatsApp and Telegram from one inbox. This plugin connects Claude to your Repliz
workspace, so you can work in it in plain language:

- "Show me the pending comments on Instagram from today and draft replies."
- "Schedule this image to my TikTok and Threads accounts tomorrow at 9am."
- "Which of my posts last week got the most views?"
- "Pause the DM automation for this chat and answer it myself."

## What's inside

| Component | What it does |
| --- | --- |
| **Repliz MCP server** (`.mcp.json`) | Connects to the hosted server at `https://mcp.repliz.com/mcp`, which gives Claude 165 tools over the Repliz Public API: accounts, comments, chats, contacts, scheduled posts, content and statistics, automations, templates, knowledge, storage, reports, research and add-ons. |
| **`manage-workspace` skill** | Tells Claude how to use those tools well: find account ids first, convert times to UTC, upload media before scheduling it, and confirm before anything that publishes, changes or deletes. |

The plugin contains no code that runs on your computer, and no hooks.

## Requirements

- A [Repliz](https://repliz.com) account on the Standard
  [plan](https://repliz.com/pricing) or higher; the Free plan has no Public API.
  Standard covers accounts, comments, contacts and knowledge, Premium adds
  scheduling and add-ons, and Gold unlocks every tool. A tool above your plan
  returns an error that says so.
- Your Repliz **Access Key** and **Secret Key**, from
  [Settings → Public API](https://repliz.com/user/setting/api).

## Installing

In Claude.ai and Claude Desktop, add **Repliz** from the plugin directory. In
Claude Code (2.1.275 or later), run:

```
/plugin install repliz-social --marketplace azickri/repliz-mcp
```

## Connecting

After installing the plugin, connect the Repliz server once. In Claude Code, run
`/mcp`, choose the Repliz server and sign in; in Claude.ai and Claude Desktop, click
**Connect**. A Repliz sign-in page opens. Paste your Access Key and Secret Key,
click **Connect**, and you're sent back to Claude.

The sign-in page names the app that is asking and the address you'll be sent back
to. Only continue if you started connecting yourself.

## Where your data goes

- Claude sends each tool call to `https://mcp.repliz.com/mcp`, a server run by
  Repliz. It forwards the call to the Repliz API at `https://api.repliz.com` and
  returns the answer. It sends your data nowhere else.
- Your keys are checked against the Repliz API when you sign in. The server keeps
  no database of users or tokens: your sign-in is an encrypted token that only the
  server can open, and it expires after 30 days without use.
- Actions that reply, send or publish do so on the social accounts you connected
  to Repliz, under your name. Claude asks before running them unless you told it
  to go ahead.
- When you ask Claude to upload a file from a URL, the server fetches that URL and
  passes the bytes straight to your Repliz storage, without saving them.

To disconnect, remove the connection in Claude, or refresh your Secret Key in the
Repliz dashboard, which stops every existing connection within five minutes.

## Links

- Documentation: <https://docs.repliz.com/tutorial/mcp>
- Privacy policy: <https://repliz.com/privacy-policy>
- Terms of service: <https://repliz.com/term-of-service>
- Support: email [cs.repliz@gmail.com](mailto:cs.repliz@gmail.com) or
  [WhatsApp](https://wa.me/6281292713426)
- Server source: <https://github.com/azickri/repliz-mcp>

## License

MIT. See [LICENSE](LICENSE).
