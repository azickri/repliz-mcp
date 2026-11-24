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

| Field | Value |
| --- | --- |
| Server URL | `https://mcp.repliz.com/mcp` |
| Authentication | OAuth 2.0 |
| Name (≤ 100) | `Repliz` |
| URL slug (permanent) | `repliz` |
| Icon | [`plugin/logo.png`](plugin/logo.png) (192 × 192 PNG) |
| Documentation URL | `https://docs.repliz.com/tutorial/mcp` |
| Privacy policy URL | `https://repliz.com/privacy-policy` |
| Terms of service URL | `https://repliz.com/term-of-service` |
| Support contact | `cs.repliz@gmail.com` |
| Categories (1–5) | Whichever of the portal's list fit best: marketing, social media, communication, productivity |

**One-liner (≤ 200 characters)**

> Reply to comments and DMs, schedule posts, read statistics and run automations across your social accounts in Repliz.

**Description (≤ 2,000 characters)**

> Repliz brings the comments, DMs, scheduled posts and automations of Instagram, Facebook, Threads, TikTok, YouTube, LinkedIn, X (Twitter), Pinterest, WhatsApp and Telegram into one inbox. This connector lets Claude work in your Repliz workspace in plain language.
>
> What you can do:
> - Read the comment inbox, draft replies that fit the thread, reply, and mark comments resolved or ignored.
> - Read and answer DMs, see who a contact is, and pause or resume the automation on a chat.
> - Schedule text, image, video, reel, carousel, story, link and document posts, with first comments, threads and music, and retry failed ones.
> - Check account and post statistics: views, reach, engagement, watch time and follower growth.
> - Manage comment and DM automations, reply templates, AI knowledge bases, contacts and tags, and media storage.
> - Research Threads and TikTok content, hashtags and trending music.
>
> Sign in once with your Repliz Access Key and Secret Key from Settings → Public API. Tools follow your Repliz plan, and every tool is marked as read-only or as one that changes your workspace, so Claude asks before it publishes, sends or deletes anything.
>
> Requires a Repliz account (repliz.com).

### Compliance

Read all seven acknowledgements before ticking them; they are commitments on
Repliz's behalf.

---

## 2. Plugin bundle

Submit after pushing `plugin/` to `main`.

| Field | Value |
| --- | --- |
| Repository | `azickri/repliz-mcp` (public) |
| Plugin path | `plugin` |
| Branch or tag | leave empty (`main`) |
| Update checks | GitHub push webhook |

Listing details come from `plugin/.claude-plugin/plugin.json` and
`plugin/README.md`; edit those files to change them. Raise `version` in
`plugin.json` with every release.

Check locally before submitting (the portal runs more checks, including a safety
scan):

```bash
claude plugin validate --profile directory --strict ./plugin
claude plugin validate --strict .
```

### Data handling answers

| Question | Answer |
| --- | --- |
| Does it read or store personal data? | It reads personal data: comments, DMs, contact names and handles, and post content from the social accounts the user connected to Repliz. The MCP server stores none of it. Repliz itself stores workspace data as its privacy policy describes. |
| Does it send data to services other than its declared connectors? | No. Everything goes to `mcp.repliz.com`, which calls `api.repliz.com`. Uploads from a URL fetch that URL and stream it to the user's Repliz storage. |
| How long is data kept? | The MCP server keeps nothing after a request. In memory it keeps a SHA-256 fingerprint of verified keys for 5 minutes. Sign-in tokens are encrypted and held by the client, not the server; access tokens last 1 hour and an unused sign-in ends after 30 days. |
| Intended for people under 18? | No. |

---

## Privacy policy

Reviewers check that the privacy policy describes what the connector does with
data. `https://repliz.com/privacy-policy` covers it under **1. Information We
Collect → AI assistants (Repliz MCP server)**, added on Nov 24, 2026 (source:
`repliz-fe-new/src/views/legal/PrivacyPolicy.vue`). Keep that item in step with
this server: what it keeps, the token lifetime, and how a connection ends.
