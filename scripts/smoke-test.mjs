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
 * stay apart, that every request runs as exactly the keys it carries, that the
 * cap on requests in flight holds, and that the upload guards are actually
 * reachable through the tool surface.
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
/** A workspace whose API calls take SLOW_MS, to hold requests in flight. */
const S = { "X-Repliz-Access-Key": "keyS", "X-Repliz-Secret-Key": "secretS" };
const SLOW_MS = 400;
const MAX_IN_FLIGHT = 3;

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
  "keyS:secretS": { owner: "USER-S", total: 33, secretNote: "S-private" },
};
const api = createServer(async (req, res) => {
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
  if (workspace.owner === "USER-S") await sleep(SLOW_MS);
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
    REPLIZ_MAX_CONCURRENT_REQUESTS: String(MAX_IN_FLIGHT),
    REPLIZ_PUBLIC_URL: ORIGIN,
    REPLIZ_OAUTH_SECRET: "smoke-test-oauth-secret-0123456789abcdef",
    REPLIZ_ACCESS_KEY: "should-be-ignored",
    REPLIZ_SECRET_KEY: "should-be-ignored",
  },
  stdio: ["ignore", "inherit", "pipe"],
});
server.stderr.on("data", () => {}); // the server logs to stderr

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
/** Like raw, but waits for the whole body, which for a tool call is an SSE stream. */
const rawText = async (headers, body, method = "POST") => {
  const res = await raw(headers, body, method);
  return { status: res.status, headers: res.headers, text: await res.text() };
};
const health = async () => (await fetch(HEALTH_URL)).json();
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
  pass("invalid credentials are rejected, before any server is built");
}
{
  const h = await health();
  check(h.stateless === true && h.inFlight === 0, "rejected attempts hold nothing", `inFlight=${h.inFlight}`);
  check(
    h.baseUrl === `http://127.0.0.1:${API_PORT}`,
    "env credentials are ignored entirely (no single-tenant fallback)"
  );
}

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
  check(as.client_id_metadata_document_supported === true, "Client ID Metadata Documents are advertised");
  check(as.authorization_response_iss_parameter_supported === true, "RFC 9207 issuer identification is advertised");
  check(prm.authorization_servers[0] === as.issuer, "resource and server metadata agree on the issuer");

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
  check(location.searchParams.get("iss") === as.issuer, "the redirect carries the issuer (RFC 9207)");

  // An error the SDK's handler redirects with itself must carry the issuer too.
  const foreign = new URL(as.authorization_endpoint);
  foreign.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: "x".repeat(43),
    code_challenge_method: "S256",
    state: "s2",
    resource: "https://elsewhere.example.com/mcp",
  }).toString();
  res = await fetch(foreign, { redirect: "manual" });
  const errorLocation = new URL(res.headers.get("location") ?? "http://invalid/");
  check(
    errorLocation.searchParams.get("error") === "invalid_target" && errorLocation.searchParams.get("iss") === as.issuer,
    "an error redirect carries the issuer too",
    errorLocation.search
  );

  // A metadata-document client_id is fetched, but never from a private address.
  const cimd = new URL(as.authorization_endpoint);
  cimd.search = new URLSearchParams({
    response_type: "code",
    client_id: "https://127.0.0.1/client.json",
    redirect_uri: "https://127.0.0.1/cb",
    code_challenge: "x".repeat(43),
    code_challenge_method: "S256",
  }).toString();
  res = await fetch(cimd, { redirect: "manual" });
  check(res.status === 400 && /invalid_client/.test(await res.text()), "a metadata document on a private address is refused", `got ${res.status}`);

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
  const fallback = await rawText({ Authorization: "Bearer not-a-real-token", ...A }, toolCall("repliz_count_accounts"));
  check(fallback.status === 200 && fallback.text.includes("USER-A"),
    "header keys still work beside an unrecognised Bearer token", `got ${fallback.status}`);

  res = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  const refreshed = await res.json();
  check(res.status === 200 && refreshed.access_token !== tokens.access_token, "a refresh token buys a new access token");
  const afterRefresh = await rawText({ Authorization: `Bearer ${refreshed.access_token}` }, toolCall("repliz_count_accounts"));
  check(afterRefresh.status === 200 && afterRefresh.text.includes("USER-A"),
    "the refreshed token reaches the same workspace", `got ${afterRefresh.status}`);

  await oauthA.client.close();
}

console.log("\nIsolation");
const a = await connect(A);
const b = await connect(B);
check(a.transport.sessionId === undefined && b.transport.sessionId === undefined, "no session id is issued");
const [ra, rb] = [await callCount(a.client), await callCount(b.client)];
check(ra.includes("USER-A") && !ra.includes("USER-B"), "user A sees only their own workspace");
check(rb.includes("USER-B") && !rb.includes("USER-A"), "user B sees only their own workspace");
let interleaved = true;
for (let i = 0; i < 5; i += 1) {
  const [x, y] = await Promise.all([callCount(a.client), callCount(b.client)]);
  if (!x.includes("USER-A") || !y.includes("USER-B")) interleaved = false;
}
check(interleaved, "five interleaved rounds show no cross-talk");

console.log("\nStateless");
const OLD_SID = "11111111-2222-3333-4444-555555555555";
let res = await raw({ "Mcp-Session-Id": OLD_SID }, toolCall("repliz_count_accounts"));
check(res.status === 401, "a session id alone grants nothing", `got ${res.status}`);
{
  const init = await rawText(A, initialize);
  check(init.status === 200 && init.headers.get("mcp-session-id") === null,
    "initialize answers without issuing a session id", `got ${init.status}`);
  const cold = await rawText(B, toolCall("repliz_count_accounts"));
  check(cold.status === 200 && cold.text.includes("USER-B"), "a tool call needs no initialize first", `got ${cold.status}`);
  // A client still holding an id from before the switch must keep working, and
  // the id must not decide whose workspace it reaches — only the keys do.
  const leftover = await rawText({ "Mcp-Session-Id": OLD_SID, ...B }, toolCall("repliz_count_accounts"));
  check(leftover.status === 200 && leftover.text.includes("USER-B") && !leftover.text.includes("USER-A"),
    "a leftover session id is ignored; the call runs as the keys it carries", `got ${leftover.status}`);
}
res = await fetch(MCP_URL, { method: "GET", headers: { Accept: "text/event-stream", ...A } });
check(res.status === 405 && res.headers.get("allow") === "POST", "GET answers 405, with nothing to stream", `got ${res.status}`);
await res.body?.cancel().catch(() => {});
res = await raw(A, undefined, "DELETE");
check(res.status === 405, "DELETE answers 405, with no session to end", `got ${res.status}`);

console.log("\nTool surface");
const { tools } = await a.client.listTools();
check(tools.length === 146, `all 146 tools are registered`, `got ${tools.length}`);
const annotated = (name) => tools.find((t) => t.name === name)?.annotations ?? {};
check(tools.every((t) => typeof t.annotations?.readOnlyHint === "boolean"), "every tool says whether it only reads");
check(annotated("repliz_list_accounts").readOnlyHint === true, "listing accounts is read-only");
check(
  annotated("repliz_reply_comment").readOnlyHint === false && annotated("repliz_reply_comment").destructiveHint === false,
  "replying to a comment is a write, but additive"
);
check(annotated("repliz_delete_account").destructiveHint === true, "deleting an account is destructive");
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
await a.client.close();
await b.client.close();
{
  // Warm the auth cache, so the burst below waits only on the slow tool call.
  await rawText(S, toolCall("repliz_count_accounts"));
  const burst = await Promise.all(
    Array.from({ length: MAX_IN_FLIGHT + 1 }, () => rawText(S, toolCall("repliz_count_accounts")))
  );
  const served = burst.filter((r) => r.status === 200 && r.text.includes("USER-S")).length;
  const refused = burst.filter((r) => r.status === 503 && /too many requests in progress/.test(r.text)).length;
  check(served === MAX_IN_FLIGHT && refused === 1,
    `${MAX_IN_FLIGHT} requests in flight are served and one more is refused`, `served=${served} refused=${refused}`);
  const h = await health();
  check(h.inFlight === 0, "every slot is given back once responses are sent", `inFlight=${h.inFlight}`);
  const after = await rawText(S, toolCall("repliz_count_accounts"));
  check(after.status === 200, "a request after the burst is served again", `got ${after.status}`);
}

console.log(failures === 0 ? "\nSmoke test OK.\n" : `\nSmoke test FAILED (${failures}).\n`);
cleanup();
process.exit(failures === 0 ? 0 : 1);
