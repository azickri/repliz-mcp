# Repliz MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for the
**Repliz Public API**. It lets any MCP-compatible AI client — Claude Desktop,
Claude Code, Cursor, and others — manage your Repliz workspace through natural
language: list and reply to comments, schedule posts, handle DMs, browse
content and stats, research Threads, and more.

> **What is MCP, and where is it used?**
> MCP is an open standard that lets AI assistants call external tools. Your AI
> client connects to this server and gains a set of "tools" (one per Repliz
> action). You can then say things like _"reply to the latest pending comment"_
> or _"schedule this image to Instagram tomorrow at 9am"_, and the assistant
> calls the right Repliz API for you.

### Two ways to run

| Mode       | Transport                                 | For                               | Clients                                                        |
| ---------- | ----------------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| **Local**  | stdio (a subprocess on your machine)      | yourself / per-user setups        | Claude Desktop, Claude Code, Cursor, VS Code, Gemini CLI, …    |
| **Remote** | Streamable HTTP (a hosted HTTPS endpoint) | many users via web/hosted clients | Claude.ai connectors, ChatGPT developer mode, API integrations |

> **Important:** web chat apps (Claude.ai, ChatGPT, the Gemini app) only accept
> **remote** servers — they cannot launch a local process. ChatGPT in particular
> supports _only_ remote MCP servers. Use **Local** mode for desktop/dev tools;
> use **Remote** mode to serve many users through the web apps.

---

## Features

`90` tools across the Repliz Public API, grouped by domain:

| Group                       | Tools                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accounts**                | list, count, get, statistics, update automation, delete                                                                                               |
| **Account Connect (OAuth)** | authorize, exchange code, list pages/channels, connect & reconnect for Facebook, Instagram, Threads, YouTube, LinkedIn, TikTok, Shopee, and Twitter/X |
| **Comments** (inbox)        | list, get, reply, update status, delete                                                                                                               |
| **Schedule** (posts)        | list, get, create, update, retry, delete, bulk delete                                                                                                 |
| **Chat** (DMs)              | list, get, list messages, send message, mark read                                                                                                     |
| **Content**                 | list, get, list comments, comment, statistics, DM commenter, delete comment, delete content, like comment                                             |
| **Research** (Threads)      | search content, user content, user profile                                                                                                            |
| **Add-ons & Limits**        | TikTok trending music, Shopee products, link metadata, account addon allocation                                                                       |
| **Storage**                 | statistics, list files, get file, init upload, upload file to presigned URL, complete upload, delete file, bulk delete files                          |
| **Reports**                 | list, get, retry                                                                                                                                      |
| **Automation**              | list, get, create, update, delete                                                                                                                     |
| **Templates**               | list, get, create, update, delete                                                                                                                     |

---

## Prerequisites

- **Node.js 18+** (uses the built-in `fetch`)
- A **Repliz API Access Key and Secret Key** (from your Repliz workspace →
  Developer / API settings)

The Repliz Public API authenticates with **HTTP Basic Auth**: the Access Key is
the username, the Secret Key is the password.

---

## Installation

### Option A — from source (recommended while developing)

```bash
git clone <your-repo-url> repliz-mcp
cd repliz-mcp
npm install
npm run build
```

This produces `dist/index.js`, the runnable server.

### Option B — via npx (after you publish to npm)

```bash
npx repliz-mcp
```

---

## Local mode (stdio)

Run the server as a subprocess from a desktop or developer client. Credentials
come from environment variables:

| Variable            | Required | Default                  | Description                               |
| ------------------- | -------- | ------------------------ | ----------------------------------------- |
| `REPLIZ_ACCESS_KEY` | ✅       | —                        | Your API Access Key (Basic Auth username) |
| `REPLIZ_SECRET_KEY` | ✅       | —                        | Your API Secret Key (Basic Auth password) |
| `REPLIZ_BASE_URL`   | ❌       | `https://api.repliz.com` | API base URL; override only if needed     |

Copy `.env.example` to `.env` for local testing (it is auto-loaded on startup
for `npm start` / `npm run dev`), but **never commit `.env`**. When launched by
an MCP client, credentials come from the client's `env` config block (below);
real environment variables always take precedence over `.env`.

### Claude Desktop

Edit `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`,
Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "repliz": {
      "command": "node",
      "args": ["/absolute/path/to/repliz-mcp/dist/index.js"],
      "env": {
        "REPLIZ_ACCESS_KEY": "your_access_key",
        "REPLIZ_SECRET_KEY": "your_secret_key"
      }
    }
  }
}
```

Restart Claude Desktop; the Repliz tools appear in the tools menu.

### Claude Code (CLI)

```bash
claude mcp add repliz \
  --env REPLIZ_ACCESS_KEY=your_access_key \
  --env REPLIZ_SECRET_KEY=your_secret_key \
  -- node /absolute/path/to/repliz-mcp/dist/index.js
```

### Cursor

In `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "repliz": {
      "command": "node",
      "args": ["/absolute/path/to/repliz-mcp/dist/index.js"],
      "env": {
        "REPLIZ_ACCESS_KEY": "your_access_key",
        "REPLIZ_SECRET_KEY": "your_secret_key"
      }
    }
  }
}
```

> Any MCP client works — point its `command`/`args` at `node dist/index.js`
> (or `npx repliz-mcp` once published) and pass the two env vars.

---

## Remote mode (HTTP) — for web clients & multiple users

Run a hosted server that many users connect to over HTTPS. Each user supplies
**their own** Repliz credentials per request, so one deployment serves everyone.

### Run it

```bash
npm run build
npm run start:http          # or: REPLIZ_TRANSPORT=http node dist/index.js
```

| Variable                                  | Required | Default                  | Description                                                                        |
| ----------------------------------------- | -------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `REPLIZ_BASE_URL`                         | ❌       | `https://api.repliz.com` | API base URL (shared by all users)                                                 |
| `PORT`                                    | ❌       | `3000`                   | Port to listen on                                                                  |
| `REPLIZ_ACCESS_KEY` / `REPLIZ_SECRET_KEY` | ❌       | —                        | Optional fallback creds for **single-tenant** hosting. Leave unset for multi-user. |

The MCP endpoint is `POST/GET/DELETE  https://<your-host>/mcp`, plus a
`GET /health` check. The server **must be served over HTTPS** in production
(put it behind a reverse proxy / platform TLS — Railway, Fly.io, Render,
Cloudflare, Nginx, etc.).

### Per-user authentication (header)

Each user passes their Repliz credentials on the request, in either form:

```http
Authorization: Basic base64(accessKey:secretKey)
```

```http
X-Repliz-Access-Key: <accessKey>
X-Repliz-Secret-Key: <secretKey>
```

Credentials are captured when the MCP session is initialized and bound to that
session only — users are isolated from one another. Requests with no valid
credentials are rejected with `401`.

> **Which clients can send these headers?**
>
> - ✅ **API integrations** — the Anthropic Messages API and OpenAI Responses
>   API let you attach an auth token / headers to a remote MCP server. This is
>   the smoothest path for header auth.
> - ✅ **MCP clients that allow custom headers** (many desktop clients, Cursor's
>   remote server config, etc.).
> - ⚠️ **Consumer web UIs (Claude.ai, ChatGPT)** — their "add custom connector"
>   screens are built around **OAuth**, and may not let users paste arbitrary
>   headers. For a frictionless "click Connect" experience there, add an OAuth
>   layer (see _Roadmap_ below). Header auth still works for everything else.

### Connect from the web apps

**Claude.ai** (Pro/Max/Team/Enterprise): _Settings → Connectors → Add custom
connector_ → enter `https://<your-host>/mcp`. (Team/Enterprise: an owner adds it
under _Organization settings → Connectors_ first.)

**ChatGPT** (Plus/Pro/Business/Enterprise): _Settings → Connectors → Advanced →
enable Developer mode_, then add a connector pointing at `https://<your-host>/mcp`.
(Connectors are now labelled "Apps".)

**Anthropic API** (programmatic): pass the server under `mcp_servers` with
`type: "url"`, `url: "https://<your-host>/mcp"`, and your Repliz Basic token in
the connector's `authorization_token`.

### Security notes

- Always serve over HTTPS; credentials travel in headers.
- Session ids are random UUIDs held in memory; this server is single-instance.
  For horizontal scaling use sticky sessions or a shared session store.
- Treat write tools (reply, schedule, delete) as powerful — review actions, and
  beware prompt-injection from untrusted content the model reads.

---

## Usage examples

Once connected, ask your assistant things like:

- "List my connected accounts."
- "Show pending comments and reply to the newest one with a thank-you."
- "Schedule this video to Instagram on 2026-06-20 at 09:00 UTC."
- "What are the trending POP songs on TikTok in Indonesia this week?"
- "Get engagement stats for my latest post on account `<id>`."

---

## Development

```bash
npm run dev          # stdio server from TS source via tsx (no build step)
npm run dev:http     # HTTP server from TS source
npm run build        # compile to dist/
npm run start        # run built stdio server
npm run start:http   # run built HTTP server
node scripts/smoke-test.mjs        # stdio: spawn server and list tools
node scripts/http-smoke-test.mjs   # http: needs server on :3344 (header auth)
```

Source layout:

```
src/
  index.ts          # entry point: dispatches stdio vs http
  server.ts         # createReplizServer(client) — shared by both transports
  config.ts         # env config + per-request header credential parsing
  client.ts         # HTTP client (Basic auth, query/body handling, errors)
  transports/
    stdio.ts        # local stdio transport (env credentials)
    http.ts         # remote Streamable HTTP transport (per-user header auth)
  tools/
    helpers.ts      # registerTool() wrapper + error formatting
    account.ts account_connect.ts addon.ts automation.ts chat.ts comment.ts
    content.ts report.ts research.ts schedule.ts storage.ts template.ts
    index.ts        # registers all tool groups
api.json            # the source OpenAPI spec (reference)
```

## Roadmap

- **OAuth for web connectors** — add an OAuth authorization layer so users can
  click "Connect" in Claude.ai / ChatGPT without pasting credentials. Today
  those consumer UIs favor OAuth; header auth covers API and custom-header clients.

---

## Security & publishing the repository

**Yes, this repository is safe to make public** — it contains no secrets.
Credentials are supplied at runtime via environment variables, never hard-coded.
Before pushing, double-check:

- ✅ `.env` is git-ignored (it is, via `.gitignore`) and not committed.
- ✅ No Access/Secret keys are pasted into README, configs, or code.
- ✅ `api.json` contains only API definitions and example data (no live keys).

Each user supplies **their own** Repliz API keys in their own client config, so
publishing the code is the normal, expected way to distribute an MCP server.

To publish on npm so anyone can run `npx repliz-mcp`:

```bash
npm login
npm publish --access public
```

---

## License

MIT — see [LICENSE](LICENSE).
