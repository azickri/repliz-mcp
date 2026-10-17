/**
 * The sign-in page shown during OAuth: the one place a user types their Repliz
 * keys into this server.
 *
 * Everything shown here that a client chose — its name, its redirect URI — is
 * attacker-controlled, because any client can register itself. So every value
 * is escaped, and the page names where the user will be sent next: a client
 * that calls itself "Claude" still cannot hide that it redirects to its own
 * host.
 */

import type { Response } from "express";

/** Where the sign-in form posts. */
export const SIGN_IN_PATH = "/oauth/login";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Plain-language name for where a redirect URI leads. */
export function describeDestination(redirectUri: string): string {
  const url = new URL(redirectUri);
  if (url.protocol === "https:") return url.host;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) {
    return `${url.host} (an app on this computer)`;
  }
  return `${url.protocol}// (an app on this computer)`;
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #f5f6f8; --card: #ffffff; --text: #16181d; --muted: #5b6170;
  --border: #d9dce3; --accent: #2f5bea; --on-accent: #ffffff;
  --error-bg: #fdecec; --error-text: #9b1c1c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1115; --card: #181b21; --text: #e8eaef; --muted: #9aa1b0;
    --border: #2c313b; --accent: #6c8cf5; --on-accent: #0f1115;
    --error-bg: #3a1a1c; --error-text: #f5b4b4;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 24px 16px; background: var(--bg); color: var(--text);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
main { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 28px; }
.brand { font-weight: 700; color: var(--accent); margin: 0 0 16px; }
h1 { font-size: 20px; line-height: 1.3; margin: 0 0 8px; }
p { margin: 0 0 16px; color: var(--muted); }
strong { color: var(--text); overflow-wrap: anywhere; }
label { display: block; font-weight: 600; margin: 16px 0 6px; }
input {
  width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg); color: var(--text); font: inherit;
}
input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.hint { font-size: 13px; margin: 8px 0 0; }
.error { background: var(--error-bg); color: var(--error-text); border-radius: 8px; padding: 10px 12px; margin: 0 0 8px; }
/* Connect comes first in the markup so that Enter submits it, not Cancel. */
.actions { display: flex; flex-direction: row-reverse; gap: 12px; margin-top: 24px; }
button {
  flex: 1; padding: 11px 14px; border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer;
  border: 1px solid var(--border); background: transparent; color: var(--text);
}
button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.note { font-size: 13px; margin: 20px 0 0; }
`;

function layout(body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Connect to Repliz</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="brand">Repliz</p>
${body}
</main>
</body>
</html>`;
}

export interface SignInPageInput {
  /** The sealed authorization request, posted back with the form. */
  request: string;
  clientName?: string;
  redirectUri: string;
  /** Re-filled after a failed attempt so the user only retypes the secret. */
  accessKey?: string;
  error?: string;
}

export function renderSignInPage(input: SignInPageInput): string {
  const name = escapeHtml(input.clientName?.trim() || "An app");
  const destination = escapeHtml(describeDestination(input.redirectUri));
  const accessKey = escapeHtml(input.accessKey ?? "");
  const error = input.error ? `<p class="error" role="alert">${escapeHtml(input.error)}</p>` : "";
  const focusSecret = accessKey !== "";

  return layout(`<h1>Connect ${name} to Repliz</h1>
<p>${name} will be able to work in your Repliz workspace on your behalf — reading and replying to comments, scheduling posts, and sending messages.</p>
${error}
<form method="post" action="${SIGN_IN_PATH}">
<input type="hidden" name="request" value="${escapeHtml(input.request)}">
<label for="access_key">Access Key</label>
<input id="access_key" name="access_key" autocomplete="username" spellcheck="false" required value="${accessKey}"${focusSecret ? "" : " autofocus"}>
<label for="secret_key">Secret Key</label>
<input id="secret_key" name="secret_key" type="password" autocomplete="current-password" required${focusSecret ? " autofocus" : ""}>
<p class="hint">Find both in your Repliz workspace under Settings &gt; API.</p>
<div class="actions">
<button type="submit" name="action" value="connect" class="primary">Connect</button>
<button type="submit" name="action" value="cancel" formnovalidate>Cancel</button>
</div>
</form>
<p class="note">You'll be sent back to <strong>${destination}</strong>. Only continue if you started connecting from ${name} yourself.</p>`);
}

export function renderMessagePage(title: string, message: string): string {
  return layout(`<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>`);
}

/**
 * Send one of these pages with headers that keep it from being framed (a
 * clickjacking overlay could trick a user into submitting their keys), cached,
 * or leaked through the Referer header.
 *
 * There is deliberately no `form-action` directive: browsers apply it to the
 * redirect that follows a form submission too, which would block the hop back
 * to the client's redirect URI.
 */
export function sendPage(res: Response, status: number, html: string): void {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"
  );
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).type("html").send(html);
}
