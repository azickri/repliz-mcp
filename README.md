# Repliz MCP Server

A hosted [Model Context Protocol](https://modelcontextprotocol.io) server for the
**Repliz Public API**. It gives an AI assistant 146 tools for managing a Repliz
workspace in plain language: listing and replying to comments, scheduling posts,
handling DMs, browsing content and stats, researching Threads and TikTok, managing
automations and templates, and more.

Users connect by pointing their MCP client at one URL — then either click
"Connect" and sign in with their Repliz Access Key and Secret Key (OAuth), or
send those keys as headers. There is nothing for them to install, build, or
keep updated.

```
https://mcp.repliz.com/mcp
```

This repository is the server that serves that URL.

---

## How it works

One process serves everyone. It holds **no credentials of its own** and **no
sessions** — each request carries the caller's keys, which are verified against
the Repliz API, and is answered by a fresh MCP server built for those keys and
discarded with the response. No two users ever share an API client, and a
thousand connected users cost no more memory than ten.

```
MCP client ──(URL + keys)──► this server ──(Basic auth)──► api.repliz.com
```

Users authenticate in one of three ways. Keys come from the Repliz dashboard
under **Settings > API**.

**OAuth** — for Claude.ai, ChatGPT, and any client with a "Connect" button.
The user adds `https://mcp.repliz.com/mcp` as a connector, a sign-in page opens,
and they paste their keys there once. Enabled when `REPLIZ_OAUTH_SECRET` is set;
see [OAuth](#oauth).

**Headers** — for API integrations (the Anthropic Messages API, the OpenAI
Responses API) and clients with custom-header support (Cursor and most desktop
clients):

```http
Authorization: Basic base64(accessKey:secretKey)
```

```http
X-Repliz-Access-Key: <accessKey>
X-Repliz-Secret-Key: <secretKey>
```

---

## Running it

Requires **Node.js 18+** (Node 20.12+ to auto-load `.env`).

```bash
npm ci
npm run build
cp .env.example .env
npm start
```

The endpoint is `POST /mcp`, plus `GET /health` for monitoring. `GET` and
`DELETE /mcp` answer `405`: with no sessions there is no stream to open or
session to end, and MCP clients carry on without either.
With OAuth on, the server also answers `/.well-known/oauth-protected-resource/mcp`,
`/.well-known/oauth-authorization-server`, `/register`, `/authorize`, `/token`,
and `/oauth/login` (the sign-in form). Serve it over HTTPS in production, behind
a reverse proxy or platform TLS.

### Configuration

Everything is optional; the defaults suit a 1 GB VPS.

| Variable                         | Default                  | Description                                                        |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| `PORT`                           | `3000`                   | Port to listen on                                                  |
| `REPLIZ_BASE_URL`                | `https://api.repliz.com` | Repliz API base URL                                                |
| `REPLIZ_MAX_CONCURRENT_REQUESTS` | `500`                    | Cap on `/mcp` requests handled at once; beyond it they get `503`   |
| `REPLIZ_RATE_LIMIT_PER_MINUTE`   | `120`                    | `/mcp` requests allowed per user (key pair) per minute             |
| `REPLIZ_VERIFY_LIMIT_PER_MINUTE` | `300`                    | Checks of not-yet-verified keys against Repliz, per IP per minute  |
| `REPLIZ_TRUST_PROXY`             | `loopback`               | Which proxies may set `X-Forwarded-For`                            |
| `REPLIZ_REQUEST_TIMEOUT_SECONDS` | `30`                     | Timeout for outbound calls to the Repliz API                       |
| `REPLIZ_AUTH_CACHE_MINUTES`      | `5`                      | How long a verified credential pair is cached                      |
| `REPLIZ_MAX_UPLOAD_MB`           | `100`                    | Largest file `repliz_upload_file` will stream through the server    |
| `REPLIZ_ALLOWED_ORIGINS`         | —                        | Browser origins allowed to call `/mcp`; unset means no CORS headers |
| `REPLIZ_UPLOAD_HOSTS`            | R2 + Repliz storage      | Hosts accepted as presigned-upload targets                         |
| `REPLIZ_OAUTH_SECRET`            | —                        | Turns OAuth on; seals every token. At least 32 characters          |
| `REPLIZ_PUBLIC_URL`              | —                        | Public origin, e.g. `https://mcp.repliz.com`; required with OAuth  |
| `REPLIZ_OAUTH_ACCESS_TOKEN_MINUTES` | `60`                  | Access token lifetime                                              |
| `REPLIZ_OAUTH_REFRESH_TOKEN_DAYS`   | `30`                  | How long an unused connection stays signed in                      |

There is deliberately **no variable for the server's own Repliz credentials**.
A fallback like that would quietly lend the operator's workspace to any caller
who omitted their keys.

### OAuth

The Repliz API has no OAuth of its own, so this server acts as the
authorization server and wraps the user's keys:

```
Claude.ai ──► /mcp: 401 ──► discovery ──► /register ──► /authorize (sign-in page)
          ◄── code ◄── keys checked against Repliz ◄── user pastes keys
          ──► /token (PKCE) ──► access + refresh token ──► /mcp with Bearer
```

To turn it on, add two lines to `.env` and restart:

```bash
REPLIZ_PUBLIC_URL=https://mcp.repliz.com
REPLIZ_OAUTH_SECRET=<output of: openssl rand -base64 32>
```

There is **no token database**. Every client id, authorization code, and token
is the user's keys (plus expiry and client binding) encrypted with AES-256-GCM
under `REPLIZ_OAUTH_SECRET`. Only this server can open them, they survive a
restart, and nothing new needs deploying or backing up. What follows from that:

- **Keep `REPLIZ_OAUTH_SECRET` stable and private.** Changing it signs every
  OAuth user out — which is also the emergency switch if it leaks.
- **One token cannot be revoked early.** Instead, access tokens live an hour;
  each tool call still presents the sealed keys to Repliz, so a key rotated in
  the Repliz dashboard stops working at once; and a refresh re-checks the keys,
  sending the client back to the sign-in page. No revocation endpoint is
  advertised, because it could only pretend.
- **Refreshing extends the connection.** Each refresh issues a new refresh
  token, so a connection in regular use stays signed in; one left unused for
  `REPLIZ_OAUTH_REFRESH_TOKEN_DAYS` has to sign in again.

Clients identify themselves in either of two ways, and need no setup on this
side for either:

- **Client ID Metadata Documents** (what Claude and ChatGPT prefer). The
  `client_id` is an HTTPS URL, such as `https://chatgpt.com/oauth/client.json`,
  serving a JSON document that names the client and its redirect URIs. The
  server fetches it on first use and caches it as its `Cache-Control` says
  (between one minute and a day; an hour without the header). Only public
  clients are accepted: the document must allow `token_endpoint_auth_method`
  `none`, as both Claude's and ChatGPT's do.
- **Dynamic Client Registration** (RFC 7591), for everything else. The client
  id it hands out is the registration itself, sealed.

Accepted redirect URIs are any `https://` URL, `http://` on localhost only, and
a native app's own scheme such as `cursor://`. Every authorization response
carries the issuer (`iss`, RFC 9207), which ChatGPT needs to use its stable
redirect URI. Header authentication keeps working alongside OAuth.

### PM2 + Nginx on a VPS

```bash
npm ci && npm run build
cp .env.example .env           # PORT and the limits live here
pm2 start dist/index.js --name repliz-mcp --node-args="--max-old-space-size=192"
pm2 save && pm2 startup        # survive a reboot
```

**Keep `--max-old-space-size`.** Every request leaves its short-lived MCP server
behind as garbage, and without a ceiling V8 prefers growing the heap to
collecting it — after a burst the process can sit at 500 MB of mostly garbage
and never give it back. With the flag it collects sooner and stays near
330 MB even at hundreds of requests a second. What is actually live is small
(~30 MB plus ~0.16 MB per request in flight), so 192 leaves ample headroom.

Fork mode (no `-i`) serves well over a thousand users from one core. Because
nothing is kept between requests, cluster mode (`-i max`) also works if one
core is ever not enough: any worker can answer any request. Each worker keeps
its own rate-limit counters and auth cache, though, so every limit becomes per
worker, and the check that an OAuth authorization code is redeemed only once is
per worker too (harmless: a code is useless without the PKCE verifier only the
client holds, and it expires in five minutes).

Nginx needs two non-default settings, because each response is streamed as
Server-Sent Events and Nginx would otherwise buffer it:

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:5301;
    proxy_http_version 1.1;
    proxy_set_header Connection "";

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;   # generous: a large repliz_upload_file can take minutes

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# OAuth discovery, sign-in, and token endpoints live at the root.
location / {
    proxy_pass http://127.0.0.1:5301;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`$proxy_add_x_forwarded_for` is correct here: the server trusts only loopback,
so it reads the rightmost untrusted entry and a client cannot forge its way into
a fresh rate-limit bucket. Most limits follow the user, but a few are per
address — checks of unfamiliar keys, the sign-in form, and with OAuth on,
`/register` (20 registrations per IP per hour) — and without `X-Forwarded-For`
every user looks like `127.0.0.1` and shares those budgets.

### What a restart does

Nothing is lost: there are no sessions to drop, and nothing is queued or
half-written, since every tool call is a single synchronous call to the Repliz
API.

| | |
| --- | --- |
| **Mid-request** | That one call fails; retrying works. |
| **Everyone else** | Notices nothing. Their next request is served like any other. |
| **After the restart** | One extra verification call per user, because the auth cache is empty again. |
| **OAuth users** | Stay signed in. Their tokens are sealed, not stored, so they open again after a restart. |

On `SIGTERM` the server stops accepting connections and exits once the requests
in flight have finished, or after 5 seconds at most.

---

## Sizing

The server is a thin proxy — every tool call is one outbound HTTPS request with
no computation in between. Each request builds a fresh MCP server with all 146
tools, which takes about 1.2 ms of CPU and 0.16 MB of memory that becomes
garbage as soon as the response is sent. What costs resources is the request
rate, not how many users are connected: an idle connection costs nothing.

Measured against a stub API, with 1500 distinct users each sending
`initialize`, `tools/list` and two tool calls, 100 at a time:

| | |
| --- | --- |
| Idle | ~96 MB RSS |
| Sustained ~330 requests/s, with `--max-old-space-size=192` | ~330 MB RSS at peak, no errors |
| Live heap once the burst is over | ~32 MB |

That burst is far heavier than real traffic — a thousand users each calling a
tool every 20 seconds is 50 requests a second — and it fits a 1 GB VPS. The 146
tool input schemas are built once and shared by every request; only the MCP
server object, the transport and the Repliz client, which holds that user's
credentials, are per request.

`GET /health` reports requests in flight, the cap, RSS, heap in use, and uptime.

---

## Security

Because `/mcp` is open to the internet:

- **Credentials are verified before any work is done.** Every request's keys
  are checked with `GET /public/account/count`, and the request gets `401` if
  Repliz rejects them, so an anonymous caller cannot make the server build
  anything. Successes are cached for `REPLIZ_AUTH_CACHE_MINUTES`, so a user
  costs at most one verification call per five minutes by default.
- **Each request runs as exactly the keys it carries.** With no sessions there
  is no session id to leak into a proxy access log and replay. A request with no
  credentials gets `401`, and an `Mcp-Session-Id` header that a client still
  sends from an earlier version is ignored, never trusted.
- **Requests in flight are capped** by `REPLIZ_MAX_CONCURRENT_REQUESTS`, so
  memory stays bounded however many users connect. Past the cap a request gets
  `503` with `Retry-After`.
- **Rate limits follow the user, not the address.** Claude.ai and ChatGPT call
  from a few shared addresses on behalf of all their users, so a per-address
  budget would let one busy user throttle everyone behind the same IP. `/mcp`
  is limited per key pair (`REPLIZ_RATE_LIMIT_PER_MINUTE`), and `/token` per
  user by the keys sealed in the code or refresh token (60 a minute) — the
  SDK's own `/token` limit of 50 per address per 15 minutes would start
  refusing refreshes at a few hundred users. What an unverified caller can
  trigger is still counted per address, as chosen by `REPLIZ_TRUST_PROXY`:
  each check of keys not already known costs a Repliz call, so an address may
  make `REPLIZ_VERIFY_LIMIT_PER_MINUTE` of them, and rejected keys are
  remembered for a minute so a client retrying them costs one check, not one
  per request. A `/token` grant that does not open counts against its address.
- **The OAuth sign-in page guards the keys typed into it.** It cannot be framed
  (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), so a clickjacking
  overlay cannot trick a user into submitting. Any client can register itself,
  so the page escapes the client's chosen name and states where the user will be
  sent next — a client calling itself "Claude" still cannot hide its own
  redirect host. The form carries the authorization request sealed, so its
  redirect target cannot be altered, and there is no session cookie for a
  cross-site request to ride. Sign-in attempts are limited to 10 per IP per
  minute, and PKCE (S256) is mandatory. For a client identified by a metadata
  document, the page also names the host that published it.
- **Client metadata documents are fetched like untrusted URLs** — because the
  `client_id` is whatever the caller sends. The fetch refuses private and
  loopback addresses and redirects, times out after 5 seconds, and reads at most
  5 KB. A document whose `client_id` differs from its URL, that carries a client
  secret, or that lists a disallowed redirect URI is refused, and nothing
  fetched is ever relayed back to the caller.
- **Outbound calls time out**, so a stalled Repliz request cannot hold its slot
  forever.
- **Uploads never touch the host's disk.** See [File uploads](#file-uploads).
- **Clean shutdown** on `SIGTERM` / `SIGINT`.

Two things to be aware of:

- A revoked key keeps working for up to `REPLIZ_AUTH_CACHE_MINUTES` (default 5)
  after it is revoked. Shorten it if that matters, at the cost of more
  verification calls.
- Each user's keys are checked again once per `REPLIZ_AUTH_CACHE_MINUTES`, and
  those checks count against the address they arrive from. Behind a shared
  address, the default of 300 a minute covers about 1500 active users at the
  default 5-minute cache; raise `REPLIZ_VERIFY_LIMIT_PER_MINUTE` beyond that.

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
to the presigned URL themselves and then call `repliz_complete_file`. That path
has no file size limit beyond the user's free storage; `REPLIZ_MAX_UPLOAD_MB`
caps only `repliz_upload_file`, which buffers the file on this server. A code
sandbox that PUTs a file attached to the chat must be allowed to reach the R2
host (Claude: Settings → Capabilities); the tool descriptions tell the model
what to tell the user when it is not.

---

## Tools

146 tools across the Repliz Public API:

| Group               | Count | Tools                                                                                       |
| ------------------- | ----- | ------------------------------------------------------------------------------------------- |
| **Accounts**        | 10    | list, count, get, statistics, update automation, list tags, update tags, rename tag, delete tag, delete |
| **Account Connect** | 42    | OAuth authorize / exchange / list / connect / reconnect for Facebook, Instagram, Threads, YouTube, LinkedIn, TikTok, Shopee, Twitter/X, Pinterest; QR session / connect / reconnect for WhatsApp; QR session / two-step password / connect / reconnect for Telegram |
| **Comments**        | 5     | list, get, reply, update status, delete                                                     |
| **Contacts**        | 10    | list, count, list tags, get, get by comment, get by chat, update, set follow-up, remove follow-up, delete |
| **Knowledge**       | 10    | list, get, create, update, delete; add source (text, FAQ, web page, file from storage), get source, update source, refresh web page, delete source |
| **Schedule**        | 7     | list, get, create, update, retry, delete, bulk delete                                       |
| **Chat**            | 8     | list, get, list messages, send message, mark read, send action (typing / seen), pause / resume automation |
| **Content**         | 9     | list, get, list comments, comment, statistics, DM commenter, like comment, delete comment, delete content |
| **Automation**      | 5     | list, get, create, update, delete                                                           |
| **Comment Sync**    | 4     | list, create, pause / resume, delete                                                        |
| **Templates**       | 5     | list, get, create, update, delete                                                           |
| **Storage**         | 8     | statistics, list, get, init upload, upload, complete, delete, bulk delete                   |
| **Reports**         | 3     | list, get, retry                                                                            |
| **Research**        | 9     | Threads content, user content, user profile; TikTok hashtags, videos, photo posts, user content, comments, comment replies (TikWM key) |
| **Add-ons**         | 11    | TikTok trending music, Shopee products, WhatsApp and Telegram channels & groups, Pinterest boards (list, create, update, delete), Instagram profile (follow check), link metadata, addon allocation |

Tool availability follows the caller's Repliz plan; calling one above your tier
returns a clear error.

Every tool declares what it does, as MCP tool annotations: 64 only read
(`readOnlyHint`), 49 create or send something without touching what exists
(`destructiveHint: false`), and 33 change or delete (`destructiveHint: true`).
Clients use these to decide what to confirm first; ChatGPT asks before any tool
not marked read-only. A new tool must state its `effect` to compile.

---

## Development

```bash
npm run dev     # run from TypeScript source, no build step
npm test        # unit tests (no network, no credentials)
npm run smoke   # end-to-end: boots the real server against a stub Repliz API
npm run build   # compile to dist/
```

`npm test` covers the parts where a quiet mistake becomes a security hole: the
SSRF and upload-host guards, credential parsing, the auth cache, the limits that
bound memory, and OAuth token sealing, single-use codes, and client binding.
`npm run smoke` covers the wiring — that two users stay apart, that every
request runs as exactly the keys it carries, that the in-flight cap holds, that
the full OAuth flow works over HTTP, and that the upload guards are reachable
through the tool surface. Neither needs
credentials or network access, and CI runs both.

```
src/
  index.ts     # entry point: load .env, start the server
  http.ts      # the HTTP transport, auth, and request lifecycle
  guards.ts    # auth caches, credential fingerprints, rate limiter, in-flight cap
  server.ts    # createReplizServer(client)
  config.ts    # env config + per-request credential parsing
  client.ts    # Repliz API client (Basic auth, timeouts, errors)
  oauth.ts     # OAuth provider: sealed clients, codes, and tokens
  oauth-page.ts  # the sign-in page and its security headers
  net.ts       # upload-host allowlist and SSRF guards
  tools/       # one module per API domain, registered via tools/index.ts
test/          # unit tests for config, guards, oauth, and net
scripts/
  smoke-test.mjs   # end-to-end check against a stub API
api.json           # the source OpenAPI spec, kept as reference
```

---

## License

MIT — see [LICENSE](LICENSE).
