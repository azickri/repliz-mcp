# Repliz MCP Server

A hosted [Model Context Protocol](https://modelcontextprotocol.io) server for the
**Repliz Public API**. It gives an AI assistant 90 tools for managing a Repliz
workspace in plain language: listing and replying to comments, scheduling posts,
handling DMs, browsing content and stats, researching Threads, managing
automations and templates, and more.

Users connect by pointing their MCP client at one URL and sending their own
Repliz Access Key and Secret Key. There is nothing for them to install, build,
or keep updated.

```
https://mcp.repliz.com/mcp
```

This repository is the server that serves that URL.

---

## How it works

One process serves everyone. It holds **no credentials of its own** — each
request carries the caller's keys, which are verified against the Repliz API and
bound to that caller's session. A session owns its own API client, so no two
users ever share one.

```
MCP client ──(URL + keys)──► this server ──(Basic auth)──► api.repliz.com
```

Users authenticate in either of two ways:

```http
Authorization: Basic base64(accessKey:secretKey)
```

```http
X-Repliz-Access-Key: <accessKey>
X-Repliz-Secret-Key: <secretKey>
```

Keys come from the Repliz dashboard under **Settings > API**.

> **Which clients can send these?**
> API integrations (the Anthropic Messages API, the OpenAI Responses API) and
> clients with custom-header support (Cursor and most desktop clients) work
> directly. The "add custom connector" screens in Claude.ai and ChatGPT are
> built around OAuth and may not accept arbitrary headers — see [Roadmap](#roadmap).

---

## Running it

Requires **Node.js 18+** (Node 20.12+ to auto-load `.env`).

```bash
npm ci
npm run build
cp .env.example .env
npm start
```

The endpoint is `POST/GET/DELETE /mcp`, plus `GET /health` for monitoring.
Serve it over HTTPS in production, behind a reverse proxy or platform TLS.

### Configuration

Everything is optional; the defaults suit a 1 GB VPS.

| Variable                         | Default                  | Description                                                        |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| `PORT`                           | `3000`                   | Port to listen on                                                  |
| `REPLIZ_BASE_URL`                | `https://api.repliz.com` | Repliz API base URL                                                |
| `REPLIZ_MAX_SESSIONS`            | `300`                    | Cap on concurrent sessions; beyond it new connects get `503`       |
| `REPLIZ_SESSION_IDLE_MINUTES`    | `30`                     | Close a session after this long without a request                  |
| `REPLIZ_RATE_LIMIT_PER_MINUTE`   | `120`                    | Requests allowed per IP per minute                                 |
| `REPLIZ_TRUST_PROXY`             | `loopback`               | Which proxies may set `X-Forwarded-For`                            |
| `REPLIZ_REQUEST_TIMEOUT_SECONDS` | `30`                     | Timeout for outbound calls to the Repliz API                       |
| `REPLIZ_AUTH_CACHE_MINUTES`      | `5`                      | How long a verified credential pair is cached                      |
| `REPLIZ_MAX_UPLOAD_MB`           | `100`                    | Largest file `repliz_upload_file` will stream through the server    |
| `REPLIZ_ALLOWED_ORIGINS`         | —                        | Browser origins allowed to call `/mcp`; unset means no CORS headers |
| `REPLIZ_UPLOAD_HOSTS`            | R2 + Repliz storage      | Hosts accepted as presigned-upload targets                         |

There is deliberately **no variable for the server's own Repliz credentials**.
A fallback like that would quietly lend the operator's workspace to any caller
who omitted their keys.

### PM2 + Nginx on a VPS

```bash
npm ci && npm run build
cp .env.example .env           # PORT and the limits live here
pm2 start dist/index.js --name repliz-mcp
pm2 save && pm2 startup        # survive a reboot
```

**Do not add `-i` / `--instances`.** PM2's default fork mode is what you want.
Sessions live in this process's memory, so cluster mode would spread a user's
requests across workers that know nothing about each other, and every follow-up
request would be told its session does not exist. Scale by raising
`REPLIZ_MAX_SESSIONS` on a bigger box, not by adding instances.

Nginx needs two non-default settings, because the transport holds a
Server-Sent Events stream open and Nginx would otherwise buffer it and cut it
after 60 seconds:

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:5301;
    proxy_http_version 1.1;
    proxy_set_header Connection "";

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;   # keep above REPLIZ_SESSION_IDLE_MINUTES

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`$proxy_add_x_forwarded_for` is correct here: the server trusts only loopback,
so it reads the rightmost untrusted entry and a client cannot forge its way into
a fresh rate-limit bucket.

### What a restart does

`pm2 restart` drops every live session — they exist only in this process's
memory. Nothing is queued or half-written, since every tool call is a single
synchronous call to the Repliz API, so the cost is small:

| | |
| --- | --- |
| **Mid-request** | That one call fails; retrying works. |
| **Idle** | The next request gets `404 Session not found`, which the MCP spec defines as "start a new session" — compliant clients re-initialize silently. |
| **After reconnecting** | Normal. One extra verification call, because the auth cache is empty again. |

Shutdown on `SIGTERM` closes sessions and stops listening in about 0.1s, well
inside PM2's default `kill_timeout`.

---

## Sizing

The server is a thin proxy — every tool call is one outbound HTTPS request with
no computation in between — so CPU is effectively idle and memory is the only
thing to plan for. Measured:

| Live sessions | Process RSS |
| ------------- | ----------- |
| 0 (baseline)  | ~93 MB      |
| 10            | ~108 MB     |
| 50            | ~173 MB     |
| 100           | ~270 MB     |

That is roughly **1.8 MB per live session** on top of a ~93 MB baseline, most of
it the 90 tool schemas, which are instantiated per session so that credentials
stay isolated. A 1 GB VPS comfortably holds the default cap of 300; use ~1000 on
2 GB. Sessions are only live while a client is connected and idle ones are
reclaimed after 30 minutes, so the steady-state number is far below the total
user count.

`GET /health` reports live sessions, the cap, RSS, and uptime.

---

## Security

Because `/mcp` is open to the internet:

- **Credentials are verified before a session exists.** On `initialize` the
  server calls `GET /public/account/count` with the supplied keys and returns
  `401` if Repliz rejects them, so an anonymous caller cannot make the server
  allocate memory. Successes are cached briefly so reconnects stay cheap.
- **Sessions are bound to the credentials that opened them.** Every later
  request is re-checked against a fingerprint of those keys, in constant time.
  The session id travels as a plain header and can end up in a proxy access log
  or a client's debug output; without this check, replaying it would hand over
  the owner's workspace with no credentials at all. A mismatch gets `403`, a
  request with no credentials gets `401`.
- **Sessions expire and are capped.** Idle sessions are swept, because MCP
  clients routinely disappear without sending `DELETE` — the SDK's own
  `client.close()` does not send one. At capacity the server sweeps first, then
  evicts the least recently used session if it has been quiet for over a minute,
  so dead sessions cannot lock out real users; if every session is genuinely
  active, the new connect gets `503` rather than cutting someone off.
- **Requests are rate limited** per IP, counted against the address chosen by
  `REPLIZ_TRUST_PROXY`.
- **Outbound calls time out**, so a stalled Repliz request cannot pin a session.
- **Uploads never touch the host's disk.** See [File uploads](#file-uploads).
- **Clean shutdown** on `SIGTERM` / `SIGINT`.

Two things to be aware of:

- Credentials are verified when a session opens, not on every call. A revoked
  key keeps working until its session goes idle; shorten
  `REPLIZ_SESSION_IDLE_MINUTES` if that matters.
- Sessions live in memory, so this is a single-instance server. Horizontal
  scaling needs a shared session store — see [Roadmap](#roadmap).

### File uploads

Uploading is three steps: `repliz_init_file` returns a one-time presigned URL,
`repliz_upload_file` sends the bytes, `repliz_complete_file` finalizes.

The middle step takes a **`sourceUrl`**, never a local path. This server is
shared, so its filesystem belongs to the operator: a path parameter would let
any connected user read the server's own files and ship them anywhere. Two
guards apply:

- the presigned PUT target must be a Repliz storage host (`REPLIZ_UPLOAD_HOSTS`)
- `sourceUrl` must resolve to a public address — loopback, private LAN ranges,
  and cloud metadata endpoints such as `169.254.169.254` are refused, as are
  redirects

Clients that would rather not route media through the server can `PUT` straight
to the presigned URL themselves and then call `repliz_complete_file`.

---

## Tools

90 tools across the Repliz Public API:

| Group               | Count | Tools                                                                                       |
| ------------------- | ----- | ------------------------------------------------------------------------------------------- |
| **Accounts**        | 6     | list, count, get, statistics, update automation, delete                                     |
| **Account Connect** | 30    | OAuth authorize / exchange / list / connect / reconnect for Facebook, Instagram, Threads, YouTube, LinkedIn, TikTok, Shopee, Twitter/X |
| **Comments**        | 5     | list, get, reply, update status, delete                                                     |
| **Schedule**        | 7     | list, get, create, update, retry, delete, bulk delete                                       |
| **Chat**            | 5     | list, get, list messages, send message, mark read                                           |
| **Content**         | 9     | list, get, list comments, comment, statistics, DM commenter, like comment, delete comment, delete content |
| **Automation**      | 5     | list, get, create, update, delete                                                           |
| **Templates**       | 5     | list, get, create, update, delete                                                           |
| **Storage**         | 8     | statistics, list, get, init upload, upload, complete, delete, bulk delete                   |
| **Reports**         | 3     | list, get, retry                                                                            |
| **Research**        | 3     | Threads content, user content, user profile                                                 |
| **Add-ons**         | 4     | TikTok trending music, Shopee products, link metadata, addon allocation                     |

Tool availability follows the caller's Repliz plan; calling one above your tier
returns a clear error.

---

## Development

```bash
npm run dev     # run from TypeScript source, no build step
npm test        # unit tests (no network, no credentials)
npm run smoke   # end-to-end: boots the real server against a stub Repliz API
npm run build   # compile to dist/
```

`npm test` covers the parts where a quiet mistake becomes a security hole: the
SSRF and upload-host guards, credential parsing, the session credential binding,
and the limits that bound memory. `npm run smoke` covers the wiring — that two
users stay apart, that a session id alone opens nothing, and that the upload
guards are reachable through the tool surface. Neither needs credentials or
network access, and CI runs both.

```
src/
  index.ts     # entry point: load .env, start the server
  http.ts      # the HTTP transport, auth, and request lifecycle
  session.ts   # session store, credential fingerprints, rate limiter, auth cache
  server.ts    # createReplizServer(client)
  config.ts    # env config + per-request credential parsing
  client.ts    # Repliz API client (Basic auth, timeouts, errors)
  net.ts       # upload-host allowlist and SSRF guards
  tools/       # one module per API domain, registered via tools/index.ts
test/          # unit tests for config, session, and net
scripts/
  smoke-test.mjs   # end-to-end check against a stub API
api.json           # the source OpenAPI spec, kept as reference
```

---

## Roadmap

- **OAuth** so users can click "Connect" in Claude.ai and ChatGPT instead of
  pasting headers. Those consumer UIs favour OAuth; header auth already covers
  API and custom-header clients.
- **Shared session store** (Redis) so several replicas can run behind a load
  balancer without sticky sessions.

## License

MIT — see [LICENSE](LICENSE).
