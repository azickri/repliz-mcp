#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 * Starts a stub Repliz API with two distinct workspaces, boots the real server
 * against it, and drives it with a real MCP client. Needs no credentials and no
 * network, so it can run anywhere:
 *
 *   npm run build && npm run smoke
 *
 * The unit tests cover the pure logic; this covers the wiring — that two users
 * stay apart, that a session id alone opens nothing, and that the upload guards
 * are actually reachable through the tool surface.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const API_PORT = 3791;
const MCP_PORT = 3792;
const ORIGIN = `http://127.0.0.1:${MCP_PORT}`;
const MCP_URL = `${ORIGIN}/mcp`;
const HEALTH_URL = `${ORIGIN}/health`;

const A = { "X-Repliz-Access-Key": "keyA", "X-Repliz-Secret-Key": "secretA" };
const B = { "X-Repliz-Access-Key": "keyB", "X-Repliz-Secret-Key": "secretB" };

let failures = 0;
const pass = (m) => console.log("  ✔", m);
const fail = (m) => {
  console.log("  ✘", m);
  failures += 1;
};
const check = (cond, m, detail = "") => (cond ? pass(m) : fail(`${m}${detail ? ` — ${detail}` : ""}`));

// ── Stub Repliz API ────────────────────────────────────────────────────────
const WORKSPACES = {
  "keyA:secretA": { owner: "USER-A", total: 11, secretNote: "A-private" },
  "keyB:secretB": { owner: "USER-B", total: 22, secretNote: "B-private" },
};
const api = createServer((req, res) => {
  const decoded = Buffer.from(
    (req.headers.authorization || "").replace(/^Basic /i, ""),
    "base64"
  ).toString();
  const workspace = WORKSPACES[decoded];
  if (!workspace) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "invalid credentials" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(workspace));
});
await new Promise((r) => api.listen(API_PORT, "127.0.0.1", r));

// ── The real server ────────────────────────────────────────────────────────
const server = spawn(process.execPath, ["dist/index.js"], {
  env: {
    ...process.env,
    PORT: String(MCP_PORT),
    REPLIZ_BASE_URL: `http://127.0.0.1:${API_PORT}`,
    REPLIZ_MAX_SESSIONS: "2",
    REPLIZ_PUBLIC_URL: ORIGIN,
    REPLIZ_OAUTH_SECRET: "smoke-test-oauth-secret-0123456789abcdef",
    REPLIZ_ACCESS_KEY: "should-be-ignored",
    REPLIZ_SECRET_KEY: "should-be-ignored",
  },
  stdio: ["ignore", "inherit", "pipe"],
});
server.stderr.on("data", () => {}); // the server logs sessions to stderr

const cleanup = () => {
  server.kill("SIGTERM");
  api.close();
};
process.on("exit", cleanup);

for (let i = 0; i < 50; i += 1) {
  try {
    await fetch(HEALTH_URL);
    break;
  } catch {
    await sleep(100);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function connect(headers) {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers },
  });
  const client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}
const callCount = async (client) =>
  (await client.callTool({ name: "repliz_count_accounts", arguments: {} })).content[0].text;
const raw = (headers, body, method = "POST") =>
  fetch(MCP_URL, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1.0.0" } },
};
const toolCall = (name, args = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

// ── Checks ─────────────────────────────────────────────────────────────────
console.log("\nAuthentication");
try {
  await connect({});
  fail("connected with no credentials");
} catch {
  pass("no credentials is rejected");
}
try {
  await connect({ "X-Repliz-Access-Key": "nope", "X-Repliz-Secret-Key": "nope" });
  fail("connected with invalid credentials");
} catch {
  pass("invalid credentials are rejected, before a session exists");
}
const health = await (await fetch(HEALTH_URL)).json();
check(health.sessions === 0, "rejected attempts allocate no session", `sessions=${health.sessions}`);
check(
  health.baseUrl === `http://127.0.0.1:${API_PORT}`,
  "env credentials are ignored entirely (no single-tenant fallback)"
);

console.log("\nOAuth");
{
  let res;
  const form = (fields) => ({
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });

  // Discovery: a bare request is pointed at the resource metadata.
  res = await raw({}, initialize);
  const challenge = res.headers.get("www-authenticate") ?? "";
  const metadataUrl = challenge.match(/resource_metadata="([^"]+)"/)?.[1];
  check(res.status === 401 && metadataUrl === `${ORIGIN}/.well-known/oauth-protected-resource/mcp`,
    "401 advertises the resource metadata", challenge);
  const prm = await (await fetch(metadataUrl)).json();
  check(prm.resource === MCP_URL && prm.authorization_servers?.length === 1, "resource metadata names this server");
  const as = await (await fetch(`${ORIGIN}/.well-known/oauth-authorization-server`)).json();
  check(as.registration_endpoint && as.authorization_endpoint && as.token_endpoint,
    "authorization server metadata lists register, authorize and token");
  check(as.revocation_endpoint === undefined, "no revocation endpoint is claimed (tokens are stateless)");

  // Registration.
  const redirectUri = "http://localhost:9999/callback";
  res = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "Smoke", token_endpoint_auth_method: "none" }),
  });
  const client = await res.json();
  check(res.status === 201 && client.client_id, "a client registers itself", `got ${res.status}`);
  res = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://evil.example.com/cb"], token_endpoint_auth_method: "none" }),
  });
  check(res.status === 400, "a plain-http, non-local redirect URI is refused", `got ${res.status}`);

  // Authorization with PKCE.
  const startSignIn = async (verifier) => {
    const authorize = new URL(as.authorization_endpoint);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: "smoke-state",
      resource: MCP_URL,
    }).toString();
    const page = await fetch(authorize);
    const html = await page.text();
    return { page, html, request: html.match(/name="request" value="([^"]+)"/)?.[1] };
  };
  const verifier = randomBytes(32).toString("base64url");
  const { page, request } = await startSignIn(verifier);
  check(page.status === 200 && request, "authorize shows the sign-in page", `got ${page.status}`);
  check(/frame-ancestors 'none'/.test(page.headers.get("content-security-policy") ?? ""), "the sign-in page cannot be framed");

  res = await fetch(`${ORIGIN}/oauth/login`, form({ request, access_key: "keyA", secret_key: "wrong" }));
  check(res.status === 401 && /accept these keys/.test(await res.text()), "wrong keys re-show the form", `got ${res.status}`);

  res = await fetch(`${ORIGIN}/oauth/login`, form({ request, access_key: "keyA", secret_key: "secretA" }));
  const location = new URL(res.headers.get("location") ?? "http://invalid/");
  const code = location.searchParams.get("code");
  check(res.status === 303 && location.href.startsWith(redirectUri) && code, "valid keys redirect back with a code", `got ${res.status}`);
  check(location.searchParams.get("state") === "smoke-state", "the state round-trips");

  const tokenRequest = (fields) =>
    fetch(as.token_endpoint, { ...form({ client_id: client.client_id, ...fields }), redirect: "follow" });
  res = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: "wrong-verifier-".repeat(4), redirect_uri: redirectUri });
  check(res.status === 400, "a wrong PKCE verifier is refused", `got ${res.status}`);
  res = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri, resource: MCP_URL });
  const tokens = await res.json();
  check(res.status === 200 && tokens.access_token && tokens.refresh_token, "the code buys access and refresh tokens", `got ${res.status}`);
  check(!JSON.stringify(tokens).includes("secretA"), "tokens do not expose the keys");
  res = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri });
  check(res.status === 400, "an authorization code works only once", `got ${res.status}`);

  // Using the token.
  const oauthA = await connect({ Authorization: `Bearer ${tokens.access_token}` });
  const viaToken = await callCount(oauthA.client);
  check(viaToken.includes("USER-A") && !viaToken.includes("USER-B"), "the access token reaches the signed-in user's workspace");

  res = await raw({ Authorization: "Bearer not-a-real-token" }, initialize);
  check(res.status === 401 && /error="invalid_token"/.test(res.headers.get("www-authenticate") ?? ""),
    "a forged token gets invalid_token", `got ${res.status}`);
  res = await raw({ Authorization: "Bearer not-a-real-token", ...A }, initialize);
  const fallbackSid = res.headers.get("mcp-session-id");
  check(res.status === 200 && fallbackSid, "header keys still work beside an unrecognised Bearer token", `got ${res.status}`);
  await res.body?.cancel().catch(() => {});
  if (fallbackSid) await raw({ "Mcp-Session-Id": fallbackSid, ...A }, undefined, "DELETE");
  res = await raw({ "Mcp-Session-Id": oauthA.transport.sessionId, ...B }, toolCall("repliz_count_accounts"));
  check(res.status === 403, "another user's keys cannot ride an OAuth session", `got ${res.status}`);

  // Refresh keeps the session: it is bound to the keys, not to one token.
  res = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  const refreshed = await res.json();
  check(res.status === 200 && refreshed.access_token !== tokens.access_token, "a refresh token buys a new access token");
  res = await raw(
    { "Mcp-Session-Id": oauthA.transport.sessionId, Authorization: `Bearer ${refreshed.access_token}` },
    toolCall("repliz_count_accounts")
  );
  check(res.status === 200, "the refreshed token keeps the existing session", `got ${res.status}`);

  await oauthA.transport.terminateSession();
  await oauthA.client.close();
}

console.log("\nIsolation");
const a = await connect(A);
const b = await connect(B);
check(a.transport.sessionId !== b.transport.sessionId, "two users get distinct session ids");
const [ra, rb] = [await callCount(a.client), await callCount(b.client)];
check(ra.includes("USER-A") && !ra.includes("USER-B"), "user A sees only their own workspace");
check(rb.includes("USER-B") && !rb.includes("USER-A"), "user B sees only their own workspace");
let interleaved = true;
for (let i = 0; i < 5; i += 1) {
  const [x, y] = await Promise.all([callCount(a.client), callCount(b.client)]);
  if (!x.includes("USER-A") || !y.includes("USER-B")) interleaved = false;
}
check(interleaved, "five interleaved rounds show no cross-talk");

console.log("\nSession binding");
let res = await raw({ "Mcp-Session-Id": a.transport.sessionId, ...B }, toolCall("repliz_count_accounts"));
check(res.status === 403, "another user's credentials cannot ride A's session", `got ${res.status}`);
res = await raw({ "Mcp-Session-Id": a.transport.sessionId }, toolCall("repliz_count_accounts"));
check(res.status === 401, "a bare session id grants nothing", `got ${res.status}`);
res = await raw({ "Mcp-Session-Id": a.transport.sessionId, ...B }, undefined, "DELETE");
check(res.status === 403, "user B cannot terminate A's session", `got ${res.status}`);
res = await fetch(MCP_URL, {
  method: "GET",
  headers: { Accept: "text/event-stream", "Mcp-Session-Id": a.transport.sessionId, ...B },
});
check(res.status === 403, "user B cannot attach to A's event stream", `got ${res.status}`);
await res.body?.cancel().catch(() => {});
res = await raw({ "Mcp-Session-Id": "11111111-2222-3333-4444-555555555555", ...A }, toolCall("repliz_count_accounts"));
check(res.status === 404, "an unknown session id returns 404 so clients re-initialize", `got ${res.status}`);

console.log("\nTool surface");
const { tools } = await a.client.listTools();
check(tools.length === 105, `all 105 tools are registered`, `got ${tools.length}`);
const upload = tools.find((t) => t.name === "repliz_upload_file");
const params = Object.keys(upload?.inputSchema?.properties ?? {});
check(!params.includes("localPath"), "the upload tool exposes no local filesystem path");
check(params.includes("sourceUrl"), "the upload tool takes a public source URL");

const foreign = await a.client.callTool({
  name: "repliz_upload_file",
  arguments: { uploadUrl: "https://evil.example.com/collect", sourceUrl: "https://example.com/a.mp4", mimetype: "video/mp4" },
});
check(/not a Repliz storage host/.test(foreign.content[0].text), "uploads to a foreign host are refused");

const ssrf = await a.client.callTool({
  name: "repliz_upload_file",
  arguments: {
    uploadUrl: "https://repliz.x.r2.cloudflarestorage.com/y?sig=1",
    sourceUrl: "http://169.254.169.254/latest/meta-data/",
    mimetype: "text/plain",
  },
});
check(/private address/.test(ssrf.content[0].text), "fetching a cloud metadata address is refused");

console.log("\nCapacity");
try {
  await connect(A);
  fail("a third session was admitted past the cap of 2");
} catch (err) {
  check(/capacity/.test(err.message), "a third session is refused while both are active");
}

console.log(failures === 0 ? "\nSmoke test OK.\n" : `\nSmoke test FAILED (${failures}).\n`);
cleanup();
process.exit(failures === 0 ? 0 : 1);
