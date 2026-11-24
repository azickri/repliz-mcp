# Claude directory submission

Everything to paste into the developer portal at <https://claude.ai/directory/manage>
(Pro, Max, Ultra, Team or Enterprise plan; on Team and Enterprise an Owner submits).

Submit twice, in this order:

1. **MCP connector**: the hosted server `https://mcp.repliz.com/mcp`. Anthropic asks
   for every remote MCP server to be submitted as a connector.
2. **Plugin bundle**: the [`plugin/`](plugin/) folder of this repository, which
   points at the same server and adds the `manage-workspace` skill.

---

## 1. MCP connector

### Before submitting

- [ ] Add `https://mcp.repliz.com/mcp` as a custom connector in Claude.ai, sign in
      with a real Repliz account, and run the tools yourself. The portal asks you to
      confirm you ran every tool (through Claude or MCP Inspector). Do not put keys in
      the portal; a test account is requested by email only if Anthropic escalates to
      Verified review.
- [ ] Privacy policy is live with the MCP server item (see
      [Privacy policy](#privacy-policy) below). A missing or incomplete policy is
      rejected outright.

Already in place: OAuth 2.0 (dynamic client registration and client ID metadata
documents, PKCE), HTTPS, and a `title` plus `readOnlyHint` / `destructiveHint` on
all 165 tools.

### Listing

| Field                | Value                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Server URL           | `https://mcp.repliz.com/mcp`                                                                  |
| Authentication       | OAuth 2.0                                                                                     |
| Name (≤ 100)         | `Repliz`                                                                                      |
| URL slug (permanent) | `repliz`                                                                                      |
| Icon                 | Leave empty: the directory shows the favicon of the server URL, which is the Repliz logo     |
| Author               | `Repliz`, `https://repliz.com`                                                                |
| Documentation URL    | `https://docs.repliz.com/tutorial/mcp`                                                        |
| Privacy policy URL   | `https://repliz.com/privacy-policy`                                                           |
| Terms of service URL | `https://repliz.com/term-of-service`                                                          |
| Support (URL or email) | `cs.repliz@gmail.com`                                                                       |
| Categories (1–5)     | Productivity, Communication, Sales and marketing                                              |

**One-liner (≤ 200 characters)**

> Reply to comments and DMs, schedule posts, read statistics and run automations across your social accounts in Repliz.

**Description (≤ 2,000 characters)**

Repliz brings the comments, DMs, scheduled posts and automations of Instagram, Facebook, Threads, TikTok, YouTube, LinkedIn, X (Twitter), Pinterest, WhatsApp and Telegram into one inbox. This connector lets Claude work in your Repliz workspace in plain language.

What you can do:

- Read the comment inbox, draft replies that fit the thread, reply, and mark comments resolved or ignored.
- Read and answer DMs, see who a contact is, and pause or resume the automation on a chat.
- Schedule text, image, video, reel, carousel, story, link and document posts, with first comments, threads and music, and retry failed ones.
- Check account and post statistics: views, reach, engagement, watch time and follower growth.
- Manage comment and DM automations, reply templates, AI knowledge bases, contacts and tags, and media storage.
- Research Threads and TikTok content, hashtags and trending music.

Sign in once with your Repliz Access Key and Secret Key from Settings → Public API. Tools follow your Repliz plan, and every tool is marked as read-only or as one that changes your workspace, so Claude asks before it publishes, sends or deletes anything.

Requires a Repliz Standard plan or higher (repliz.com/pricing); Gold unlocks every tool.

### Test & launch

Shown to reviewers only.

**Use cases**

| Use case                     | Example prompt                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Triage and reply to comments | Show me today's pending Instagram comments, draft a reply to each one, and send the replies I approve.     |
| Schedule a post              | Schedule a Threads post for tomorrow at 9am Jakarta time that says "Our new collection drops this Friday." |
| Review post performance      | Which of my TikTok videos from the last 7 days got the most views, and what was their average watch time?  |

**Prerequisites**

> A Repliz account (repliz.com) on a paid plan, with at least one social account connected. The Public API and this MCP server are not on the Free plan. Standard covers accounts, comments, contacts and knowledge; Premium adds scheduling and add-ons; Gold unlocks every tool, including chats, content and statistics, research, reports, automations and connecting new accounts. A tool outside the user's plan returns a clear error. The user signs in with the Access Key and Secret Key from Settings → Public API (repliz.com/user/setting/api).

**Read/write capabilities**: Read and write (71 tools read, 94 create, send,
change or delete).

### Data handling

| Question                      | Answer                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| API ownership                 | We own the API: the server calls only `api.repliz.com`, and uploads go to Repliz storage through presigned URLs from that API. |
| Personal health data          | No                                                                                                                             |
| Sponsored or promoted content | No. The only "upgrade" text is in HTTP 402 errors from the Repliz API, passed through unchanged: `upgrade plan to access this api` when a tool is outside the user's plan, and `upgrade to get more storage` when storage is full. They explain a refused request, carry no link or offer, and appear only when the user calls something their plan doesn't cover. |

### Compliance

Read all seven acknowledgements before ticking them; they are commitments on
Repliz's behalf. Checked against the code on Nov 24, 2026:

| Acknowledgement | Why it holds |
| --- | --- |
| Read the developer guidelines | Read <https://claude.com/docs/connectors/building/review-criteria> and the [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy). |
| Own first-party APIs | Only `api.repliz.com`. |
| No money or financial assets | No tool pays, buys, tops up or transfers anything. |
| No AI image, video or audio generation | None. Repliz AI replies (automations, keyword watch) are text. |
| No model-behavior instructions in tool descriptions | Descriptions name other Repliz tools only for where an id comes from or which step is next, ask for confirmation before irreversible actions, and explain a sandbox block on uploads. None of the rejected patterns in the review criteria; disclosed in Additional notes. If a reviewer objects, the sandbox paragraph is in `src/tools/storage.ts` (`repliz_init_file`). |
| No conversation data beyond what's needed | The server receives only tool arguments and stores nothing. |
| Public documentation live | <https://docs.repliz.com/tutorial/mcp> |

**Additional notes**

> The Repliz API authenticates with an Access Key and Secret Key, so this server is its own OAuth 2.1 authorization server: the sign-in page asks for the two keys once, checks them against the Repliz API and seals them into the tokens (AES-256-GCM, no token database). Tools follow the user's Repliz plan (Standard or higher, Gold for every tool); a tool outside the plan returns the Repliz API's HTTP 402 "upgrade plan to access this api" unchanged. Tool descriptions name other Repliz tools only to say where an id comes from or which step comes next, ask Claude to confirm with the user before irreversible actions, and, for file uploads, explain what a sandbox network block looks like and where the user can allow the Repliz storage host. They reference no other servers, external instruction sources or hidden text.

---

## 2. Plugin bundle

Submit after pushing `plugin/` to `main`.

| Field         | Value                         |
| ------------- | ----------------------------- |
| Repository    | `azickri/repliz-mcp` (public) |
| Plugin path   | `plugin`                      |
| Branch or tag | leave empty (`main`)          |
| Update checks | GitHub push webhook           |

Listing details come from `plugin/.claude-plugin/plugin.json` and
`plugin/README.md`; edit those files to change them. Raise `version` in
`plugin.json` with every release.

The plugin's `name` is `repliz-social` and its `author.name` is `PT Abdi Tawakal
Dua`, while `displayName` stays `Repliz`. With `repliz` in both, the portal refused
it as `NAME_CONFUSABLE`: one or two characters from the directory connectors
`replit`, `replin` and `replyz`. Once a version has been live, changing `name`
needs an email to directory@anthropic.com first (unless the organization is
Verified), so leave it as it is.

Check locally before submitting (the portal runs more checks, including a safety
scan):

```bash
claude plugin validate --profile directory --strict ./plugin
claude plugin validate --strict .
```

### Data handling answers

| Question                                                          | Answer                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does it read or store personal data?                              | It reads personal data: comments, DMs, contact names and handles, and post content from the social accounts the user connected to Repliz. The MCP server stores none of it. Repliz itself stores workspace data as its privacy policy describes.                |
| Does it send data to services other than its declared connectors? | No. Everything goes to `mcp.repliz.com`, which calls `api.repliz.com`. Uploads from a URL fetch that URL and stream it to the user's Repliz storage.                                                                                                            |
| How long is data kept?                                            | The MCP server keeps nothing after a request. In memory it keeps a SHA-256 fingerprint of verified keys for 5 minutes. Sign-in tokens are encrypted and held by the client, not the server; access tokens last 1 hour and an unused sign-in ends after 30 days. |
| Intended for people under 18?                                     | No.                                                                                                                                                                                                                                                             |

---

## Privacy policy

Reviewers check that the privacy policy describes what the connector does with
data. `https://repliz.com/privacy-policy` covers it under **1. Information We
Collect → AI assistants (Repliz MCP server)**, added on Nov 24, 2026 (source:
`repliz-fe-new/src/views/legal/PrivacyPolicy.vue`). Keep that item in step with
this server: what it keeps, the token lifetime, and how a connection ends.
