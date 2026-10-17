/**
 * OAuth: every token this server issues is a sealed copy of a user's Repliz
 * keys, so the sealing and the checks around it are what stand between one
 * user's workspace and everyone else. Pinned here without network or Express.
 */

import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import {
  ReplizOAuthProvider,
  Sealer,
  UsedCodes,
  clientIdUrlProblem,
  redirectUriProblem,
  validateClientMetadata,
  withIssuer,
  type FetchedMetadata,
  type MetadataFetcher,
  type SignInResult,
} from "../src/oauth.js";
import { describeDestination, escapeHtml } from "../src/oauth-page.js";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const ISSUER = "https://mcp.repliz.com/";
const RESOURCE = new URL("https://mcp.repliz.com/mcp");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const KEYS = { accessKey: "ak-123", secretKey: "sk-456" };

describe("Sealer", () => {
  const sealer = new Sealer(SECRET);

  test("round-trips a payload", () => {
    const sealed = sealer.seal("access", { a: 1, b: "two" });
    assert.deepEqual(sealer.open("access", sealed), { a: 1, b: "two" });
  });

  test("hides the payload", () => {
    const sealed = sealer.seal("access", { ak: "visible-access-key" });
    assert.ok(!Buffer.from(sealed, "base64url").toString("latin1").includes("visible-access-key"));
    assert.ok(!sealed.includes("visible"));
  });

  test("will not open one kind as another", () => {
    // Otherwise a refresh token, or an authorization code, could be used as an access token.
    const refresh = sealer.seal("refresh", { a: 1 });
    assert.equal(sealer.open("access", refresh), null);
    assert.equal(sealer.open("code", refresh), null);
  });

  test("rejects anything altered", () => {
    const sealed = sealer.seal("access", { a: 1 });
    const bytes = Buffer.from(sealed, "base64url");
    for (const index of [0, 5, 20, bytes.length - 1]) {
      const flipped = Buffer.from(bytes);
      flipped[index] ^= 0x01;
      assert.equal(sealer.open("access", flipped.toString("base64url")), null, `byte ${index}`);
    }
  });

  test("rejects values sealed under another secret", () => {
    const other = new Sealer("another-secret-that-is-also-32-characters");
    assert.equal(sealer.open("access", other.seal("access", { a: 1 })), null);
  });

  test("honours the time to live", () => {
    const sealed = sealer.seal("code", { a: 1 }, 1_000, 10_000);
    assert.ok(sealer.open("code", sealed, 10_999));
    assert.equal(sealer.open("code", sealed, 11_000), null);
  });

  test("returns null for junk instead of throwing", () => {
    for (const junk of [undefined, null, 42, "", "abc", "!!!", "x".repeat(20_000)]) {
      assert.equal(sealer.open("access", junk), null);
    }
  });

  test("derives a stable, secret-dependent MAC", () => {
    assert.equal(sealer.mac("id"), sealer.mac("id"));
    assert.notEqual(sealer.mac("id"), sealer.mac("id2"));
    assert.notEqual(sealer.mac("id"), new Sealer("another-secret-that-is-also-32-characters").mac("id"));
  });
});

describe("redirectUriProblem", () => {
  const allowed = [
    "https://claude.ai/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "http://localhost:33418/callback",
    "http://127.0.0.1:8080/",
    "http://[::1]:9000/cb",
    "cursor://anysphere.cursor-retrieval/oauth/callback",
  ];
  for (const uri of allowed) {
    test(`allows ${uri}`, () => assert.equal(redirectUriProblem(uri), null));
  }

  const refused = [
    "http://evil.example.com/callback",
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "https://claude.ai/cb#fragment",
    "not a url",
    `https://example.com/${"a".repeat(600)}`,
  ];
  for (const uri of refused) {
    test(`refuses ${uri.slice(0, 40)}`, () => assert.notEqual(redirectUriProblem(uri), null));
  }
});

describe("sign-in page helpers", () => {
  test("escape markup", () => {
    assert.equal(escapeHtml(`<script>"x"&'y'</script>`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
  });

  test("name the destination in plain terms", () => {
    assert.equal(describeDestination("https://claude.ai/api/mcp/auth_callback"), "claude.ai");
    assert.match(describeDestination("http://localhost:3000/cb"), /this computer/);
    assert.match(describeDestination("cursor://x/y"), /^cursor:\/\/ /);
  });
});

describe("UsedCodes", () => {
  test("accepts a code once", () => {
    const used = new UsedCodes();
    assert.equal(used.consume("a", 1_000), true);
    assert.equal(used.consume("a", 1_000), false);
    assert.equal(used.consume("b", 1_000), true);
  });

  test("forgets codes once they have expired", () => {
    const used = new UsedCodes();
    used.consume("a", 1_000);
    used.sweep(999);
    assert.equal(used.size, 1);
    used.sweep(1_000);
    assert.equal(used.size, 0);
  });
});

// ─── The full flow ─────────────────────────────────────────────────────────

type Verify = (creds: { accessKey: string; secretKey: string }) => Promise<boolean>;
const acceptKeys: Verify = async (c) => c.accessKey === KEYS.accessKey && c.secretKey === KEYS.secretKey;

function makeProvider(verify: Verify = acceptKeys, fetchClientMetadata?: MetadataFetcher) {
  return new ReplizOAuthProvider({
    secret: SECRET,
    issuer: ISSUER,
    resourceUrl: RESOURCE,
    accessTokenMs: 60 * 60_000,
    refreshTokenMs: 30 * 86_400_000,
    verifyCredentials: (creds) => verify(creds),
    fetchClientMetadata,
  });
}

/** Registers a client the way the SDK's /register handler would. */
async function register(
  provider: ReplizOAuthProvider,
  metadata: Partial<OAuthClientInformationFull> = {}
): Promise<OAuthClientInformationFull> {
  const registerClient = provider.clientsStore.registerClient!;
  return registerClient({
    redirect_uris: [REDIRECT],
    client_name: "Claude",
    token_endpoint_auth_method: "none",
    ...metadata,
  } as OAuthClientInformationFull);
}

/** Just enough of an Express response to capture a rendered page. */
function fakeResponse() {
  const captured = { status: 0, html: "", headers: {} as Record<string, string> };
  const res = {
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      captured.status = code;
      return res;
    },
    type() {
      return res;
    },
    send(body: string) {
      captured.html = body;
      return res;
    },
  };
  return { res: res as unknown as Response, captured };
}

const sealedRequestFrom = (html: string) => {
  const match = html.match(/name="request" value="([^"]+)"/);
  assert.ok(match, "the page carries a sealed request");
  return match[1];
};

/** Walks a client through /authorize and the sign-in form; returns the redirect. */
async function signIn(
  provider: ReplizOAuthProvider,
  client: OAuthClientInformationFull,
  form: Record<string, string> = { access_key: KEYS.accessKey, secret_key: KEYS.secretKey },
  redirectUri = REDIRECT
): Promise<SignInResult> {
  const { res, captured } = fakeResponse();
  await provider.authorize(
    client,
    { redirectUri, codeChallenge: "challenge-abc", state: "state-xyz", scopes: [], resource: RESOURCE },
    res
  );
  return provider.completeSignIn({ request: sealedRequestFrom(captured.html), ...form });
}

async function codeFor(provider: ReplizOAuthProvider, client: OAuthClientInformationFull): Promise<string> {
  const result = await signIn(provider, client);
  assert.equal(result.type, "redirect");
  const url = new URL((result as { location: string }).location);
  assert.equal(url.searchParams.get("state"), "state-xyz");
  assert.equal(url.searchParams.get("iss"), ISSUER, "the issuer rides along (RFC 9207)");
  return url.searchParams.get("code")!;
}

describe("client registration", () => {
  test("a client id opens back to the registered metadata", async () => {
    const provider = makeProvider();
    const client = await register(provider);
    const found = await provider.clientsStore.getClient(client.client_id);
    assert.deepEqual(found?.redirect_uris, [REDIRECT]);
    assert.equal(found?.client_name, "Claude");
    assert.equal(found?.client_secret, undefined, "public clients get no secret");
  });

  test("survives a restart: a new provider with the same secret knows the client", async () => {
    const client = await register(makeProvider());
    assert.ok(await makeProvider().clientsStore.getClient(client.client_id));
  });

  test("a confidential client's secret is reproducible and never expires", async () => {
    const provider = makeProvider();
    const client = await register(provider, { token_endpoint_auth_method: "client_secret_post" });
    assert.ok(client.client_secret);
    assert.equal(client.client_secret_expires_at, 0);
    const found = await provider.clientsStore.getClient(client.client_id);
    assert.equal(found?.client_secret, client.client_secret);
  });

  test("a forged or altered client id is unknown", async () => {
    const provider = makeProvider();
    const client = await register(provider);
    assert.equal(await provider.clientsStore.getClient("made-up"), undefined);
    assert.equal(await provider.clientsStore.getClient(client.client_id.slice(0, -2) + "AA"), undefined);
  });

  test("refuses a disallowed redirect URI", async () => {
    await assert.rejects(
      register(makeProvider(), { redirect_uris: ["http://evil.example.com/cb"] }),
      InvalidClientMetadataError
    );
  });

  test("refuses too many redirect URIs", async () => {
    const uris = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`);
    await assert.rejects(register(makeProvider(), { redirect_uris: uris }), InvalidClientMetadataError);
  });
});

describe("sign-in", () => {
  test("the page escapes the client's chosen name and shows where it redirects", async () => {
    const provider = makeProvider();
    const client = await register(provider, { client_name: `<img src=x onerror=alert(1)>` });
    const { res, captured } = fakeResponse();
    await provider.authorize(client, { redirectUri: REDIRECT, codeChallenge: "c", scopes: [] }, res);
    assert.equal(captured.status, 200);
    assert.ok(!captured.html.includes("<img"), "client name must be escaped");
    assert.ok(captured.html.includes("claude.ai"), "destination is named");
    assert.equal(captured.headers["x-frame-options"], "DENY");
    assert.match(captured.headers["content-security-policy"], /frame-ancestors 'none'/);
  });

  test("refuses to authorize for another server's resource", async () => {
    const provider = makeProvider();
    const client = await register(provider);
    const { res } = fakeResponse();
    await assert.rejects(
      provider.authorize(
        client,
        { redirectUri: REDIRECT, codeChallenge: "c", scopes: [], resource: new URL("https://other.example.com/mcp") },
        res
      ),
      InvalidTargetError
    );
  });

  test("valid keys redirect back with a code and the state", async () => {
    const provider = makeProvider();
    const code = await codeFor(provider, await register(provider));
    assert.ok(code.length > 0);
    assert.ok(!code.includes(KEYS.secretKey));
  });

  test("rejected keys show the form again, keeping the access key but never the secret", async () => {
    const provider = makeProvider();
    const result = await signIn(provider, await register(provider), { access_key: "ak-123", secret_key: "wrong" });
    assert.equal(result.type, "page");
    const page = result as { status: number; html: string };
    assert.equal(page.status, 401);
    assert.match(page.html, /didn&#39;t accept these keys/);
    assert.match(page.html, /value="ak-123"/);
    assert.ok(!page.html.includes("wrong"));
  });

  test("a Repliz outage is reported as such, not as bad keys", async () => {
    const provider = makeProvider(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await signIn(provider, await register(provider));
    assert.equal(result.type === "page" && result.status, 503);
  });

  test("blank fields are caught before calling Repliz", async () => {
    let calls = 0;
    const provider = makeProvider(async () => {
      calls += 1;
      return true;
    });
    const result = await signIn(provider, await register(provider), { access_key: " ", secret_key: "" });
    assert.equal(result.type === "page" && result.status, 400);
    assert.equal(calls, 0);
  });

  test("cancel redirects back with access_denied", async () => {
    const provider = makeProvider();
    const result = await signIn(provider, await register(provider), { action: "cancel" });
    assert.equal(result.type, "redirect");
    const url = new URL((result as { location: string }).location);
    assert.equal(url.searchParams.get("error"), "access_denied");
    assert.equal(url.searchParams.get("state"), "state-xyz");
    assert.equal(url.searchParams.get("iss"), ISSUER, "errors carry the issuer too");
    assert.equal(url.searchParams.get("code"), null);
  });

  test("a forged or missing request shows an error page and redirects nowhere", async () => {
    const provider = makeProvider();
    for (const request of [undefined, "", "forged"]) {
      const result = await provider.completeSignIn({ request, ...{ access_key: "a", secret_key: "b" } });
      assert.equal(result.type === "page" && result.status, 400);
    }
  });
});

describe("tokens", () => {
  test("a code is bound to its client and its PKCE challenge", async () => {
    const provider = makeProvider();
    const client = await register(provider);
    const other = await register(provider, { client_name: "Other" });
    const code = await codeFor(provider, client);
    assert.equal(await provider.challengeForAuthorizationCode(client, code), "challenge-abc");
    await assert.rejects(provider.challengeForAuthorizationCode(other, code), InvalidGrantError);
  });

  test("a code buys tokens that carry the user's keys, exactly once", async () => {
    const provider = makeProvider();
    const client = await register(provider);
    const code = await codeFor(provider, client);
    const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT, RESOURCE);
    assert.equal(tokens.token_type, "Bearer");
    assert.equal(tokens.expires_in, 3600);
    assert.deepEqual(provider.credentialsFromAccessToken(tokens.access_token), KEYS);
    await assert.rejects(provider.exchangeAuthorizationCode(client, code), InvalidGrantError, "replayed code");
  });

  test("a code cannot be redeemed with a different redirect URI", async () => {
    const provider = makeProvider();
    const client = await register(provider);
    const code = await codeFor(provider, client);
    await assert.rejects(
      provider.exchangeAuthorizationCode(client, code, undefined, "https://claude.ai/elsewhere"),
      InvalidGrantError
    );
  });

  test("a refresh token is not an access token, and vice versa", async () => {
    const provider = makeProvider();
    const client = await register(provider);
    const tokens = await provider.exchangeAuthorizationCode(client, await codeFor(provider, client));
    assert.equal(provider.credentialsFromAccessToken(tokens.refresh_token!), null);
    await assert.rejects(provider.exchangeRefreshToken(client, tokens.access_token), InvalidGrantError);
  });

  test("refresh issues new tokens for the same keys", async () => {
    const provider = makeProvider();
    const client = await register(provider);
    const first = await provider.exchangeAuthorizationCode(client, await codeFor(provider, client));
    const second = await provider.exchangeRefreshToken(client, first.refresh_token!);
    assert.notEqual(second.access_token, first.access_token);
    assert.deepEqual(provider.credentialsFromAccessToken(second.access_token), KEYS);
  });

  test("refresh is refused to another client", async () => {
    const provider = makeProvider();
    const client = await register(provider);
    const other = await register(provider, { client_name: "Other" });
    const tokens = await provider.exchangeAuthorizationCode(client, await codeFor(provider, client));
    await assert.rejects(provider.exchangeRefreshToken(other, tokens.refresh_token!), InvalidGrantError);
  });

  test("refresh ends the connection once Repliz stops accepting the keys", async () => {
    let accepted = true;
    const provider = makeProvider(async () => accepted);
    const client = await register(provider);
    const tokens = await provider.exchangeAuthorizationCode(client, await codeFor(provider, client));
    accepted = false;
    await assert.rejects(provider.exchangeRefreshToken(client, tokens.refresh_token!), InvalidGrantError);
  });

  test("refresh during a Repliz outage fails as a server error, so the client retries", async () => {
    let down = false;
    const provider = makeProvider(async () => {
      if (down) throw new Error("ECONNREFUSED");
      return true;
    });
    const client = await register(provider);
    const tokens = await provider.exchangeAuthorizationCode(client, await codeFor(provider, client));
    down = true;
    await assert.rejects(provider.exchangeRefreshToken(client, tokens.refresh_token!), ServerError);
  });

  test("verifyAccessToken reports expiry and rejects junk", async () => {
    const provider = makeProvider();
    const client = await register(provider);
    const tokens = await provider.exchangeAuthorizationCode(client, await codeFor(provider, client));
    const info = await provider.verifyAccessToken(tokens.access_token);
    assert.ok(info.expiresAt && info.expiresAt > Date.now() / 1000);
    assert.equal(info.resource?.href, RESOURCE.href);
    await assert.rejects(provider.verifyAccessToken("junk"), InvalidTokenError);
  });

  test("tokens from a server with a different secret are worthless here", async () => {
    const elsewhere = new ReplizOAuthProvider({
      secret: "a-completely-different-secret-of-32-chars",
      issuer: ISSUER,
      resourceUrl: RESOURCE,
      accessTokenMs: 60_000,
      refreshTokenMs: 60_000,
      verifyCredentials: acceptKeys,
    });
    const client = await register(elsewhere);
    const tokens = await elsewhere.exchangeAuthorizationCode(client, await codeFor(elsewhere, client));
    assert.equal(makeProvider().credentialsFromAccessToken(tokens.access_token), null);
  });
});

// ─── RFC 9207 and Client ID Metadata Documents ────────────────────────────

describe("withIssuer", () => {
  test("adds the issuer to a redirect", () => {
    const url = new URL(withIssuer("https://claude.ai/cb?error=access_denied&state=s", ISSUER));
    assert.equal(url.searchParams.get("iss"), ISSUER);
    assert.equal(url.searchParams.get("state"), "s");
  });

  test("leaves an issuer that is already there", () => {
    const url = new URL(withIssuer(`https://claude.ai/cb?iss=${encodeURIComponent(ISSUER)}`, "https://other/"));
    assert.equal(url.searchParams.getAll("iss").length, 1);
    assert.equal(url.searchParams.get("iss"), ISSUER);
  });
});

// The documents Claude Code and ChatGPT publish, as fetched in October 2026.
const CLAUDE_CODE_ID = "https://claude.ai/oauth/claude-code-client-metadata";
const CLAUDE_CODE_DOC = {
  client_id: CLAUDE_CODE_ID,
  client_name: "Claude Code",
  client_uri: "https://claude.ai",
  redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};
const CHATGPT_ID = "https://chatgpt.com/oauth/client.json";
const CHATGPT_DOC = {
  client_id: CHATGPT_ID,
  client_uri: "https://chatgpt.com/",
  redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  client_name: "ChatGPT",
  token_endpoint_auth_signing_alg: "RS256",
  jwks_uri: "https://chatgpt.com/oauth/jwks.json",
};

describe("clientIdUrlProblem", () => {
  for (const id of [CLAUDE_CODE_ID, CHATGPT_ID, "https://example.com:8443/client.json"]) {
    test(`accepts ${id}`, () => assert.equal(clientIdUrlProblem(id), null));
  }
  const refused = [
    "http://example.com/client.json",
    "https://example.com",
    "https://example.com/",
    "https://user:pass@example.com/client.json",
    "https://example.com/client.json#x",
    "https://example.com/a/../client.json",
    "https://EXAMPLE.com/client.json",
  ];
  for (const id of refused) {
    test(`refuses ${id}`, () => assert.notEqual(clientIdUrlProblem(id), null));
  }
});

describe("validateClientMetadata", () => {
  test("accepts Claude Code's document", () => {
    const client = validateClientMetadata(CLAUDE_CODE_ID, CLAUDE_CODE_DOC);
    assert.equal(client.name, "Claude Code");
    assert.deepEqual(client.redirectUris, CLAUDE_CODE_DOC.redirect_uris);
  });

  test("accepts ChatGPT's document, which allows 'none' among its methods", () => {
    assert.equal(validateClientMetadata(CHATGPT_ID, CHATGPT_DOC).name, "ChatGPT");
  });

  test("falls back to the host when there is no client_name", () => {
    const { client_name: _, ...doc } = CLAUDE_CODE_DOC;
    assert.equal(validateClientMetadata(CLAUDE_CODE_ID, doc).name, "claude.ai");
  });

  const refused: Array<[string, unknown]> = [
    ["a document for another URL", { ...CLAUDE_CODE_DOC, client_id: "https://evil.example.com/client.json" }],
    ["a document with a client secret", { ...CLAUDE_CODE_DOC, client_secret: "s" }],
    ["a client that can only use private_key_jwt", { ...CLAUDE_CODE_DOC, token_endpoint_auth_method: "private_key_jwt" }],
    ["a disallowed redirect URI", { ...CLAUDE_CODE_DOC, redirect_uris: ["http://evil.example.com/cb"] }],
    ["no redirect URIs", { ...CLAUDE_CODE_DOC, redirect_uris: [] }],
    ["an array", [CLAUDE_CODE_DOC]],
    ["a string", "hello"],
  ];
  for (const [name, doc] of refused) {
    test(`refuses ${name}`, () => assert.throws(() => validateClientMetadata(CLAUDE_CODE_ID, doc)));
  }
});

/** A fetcher serving fixed documents, counting how often it is asked. */
function fakeFetcher(documents: Record<string, unknown>, maxAgeMs?: number) {
  const calls: string[] = [];
  const fetcher: MetadataFetcher = async (url): Promise<FetchedMetadata> => {
    calls.push(url.href);
    await new Promise((resolve) => setImmediate(resolve));
    if (!(url.href in documents)) throw new Error("HTTP 404");
    return { body: documents[url.href], maxAgeMs };
  };
  return { fetcher, calls };
}

describe("metadata document clients", () => {
  // Refused documents are logged; keep the test output clean.
  beforeEach(() => mock.method(console, "error", () => {}));
  afterEach(() => mock.restoreAll());

  test("a URL client_id resolves to the client its document describes", async () => {
    const { fetcher } = fakeFetcher({ [CLAUDE_CODE_ID]: CLAUDE_CODE_DOC });
    const client = await makeProvider(acceptKeys, fetcher).clientsStore.getClient(CLAUDE_CODE_ID);
    assert.equal(client?.client_name, "Claude Code");
    assert.deepEqual(client?.redirect_uris, CLAUDE_CODE_DOC.redirect_uris);
    assert.equal(client?.token_endpoint_auth_method, "none");
    assert.equal(client?.client_secret, undefined, "a public client, protected by PKCE");
  });

  test("documents are cached, and concurrent lookups share one fetch", async () => {
    const { fetcher, calls } = fakeFetcher({ [CHATGPT_ID]: CHATGPT_DOC });
    const provider = makeProvider(acceptKeys, fetcher);
    await Promise.all([1, 2, 3].map(() => provider.clientsStore.getClient(CHATGPT_ID)));
    await provider.clientsStore.getClient(CHATGPT_ID);
    assert.equal(calls.length, 1);
  });

  test("the cache expires, and sweep drops what has", async () => {
    const { fetcher, calls } = fakeFetcher({ [CHATGPT_ID]: CHATGPT_DOC });
    const provider = makeProvider(acceptKeys, fetcher);
    await provider.clientsStore.getClient(CHATGPT_ID);
    provider.sweep(Date.now() + 2 * 60 * 60_000);
    await provider.clientsStore.getClient(CHATGPT_ID);
    assert.equal(calls.length, 2);
  });

  test("an unreachable or refused document means an unknown client", async () => {
    const { fetcher } = fakeFetcher({ [CLAUDE_CODE_ID]: { ...CLAUDE_CODE_DOC, client_id: "https://evil.example.com/x" } });
    const provider = makeProvider(acceptKeys, fetcher);
    assert.equal(await provider.clientsStore.getClient(CLAUDE_CODE_ID), undefined);
    assert.equal(await provider.clientsStore.getClient("https://missing.example.com/client.json"), undefined);
  });

  test("a malformed client_id URL is refused without fetching anything", async () => {
    const { fetcher, calls } = fakeFetcher({});
    const provider = makeProvider(acceptKeys, fetcher);
    assert.equal(await provider.clientsStore.getClient("https://example.com/a/../client.json"), undefined);
    assert.equal(calls.length, 0);
  });

  test("the sign-in page names the host that published the document", async () => {
    const { fetcher } = fakeFetcher({ [CLAUDE_CODE_ID]: CLAUDE_CODE_DOC });
    const provider = makeProvider(acceptKeys, fetcher);
    const client = (await provider.clientsStore.getClient(CLAUDE_CODE_ID))!;
    const { res, captured } = fakeResponse();
    await provider.authorize(client, { redirectUri: "http://localhost:53682/callback", codeChallenge: "c", scopes: [] }, res);
    assert.match(captured.html, /App details come from <strong>claude\.ai<\/strong>/);
    assert.match(captured.html, /Connect Claude Code to Repliz/);
  });

  test("the full flow works for a metadata document client", async () => {
    const { fetcher } = fakeFetcher({ [CHATGPT_ID]: CHATGPT_DOC });
    const provider = makeProvider(acceptKeys, fetcher);
    const client = (await provider.clientsStore.getClient(CHATGPT_ID))!;
    const result = await signIn(provider, client, undefined, CHATGPT_DOC.redirect_uris[0]);
    assert.equal(result.type, "redirect");
    const code = new URL((result as { location: string }).location).searchParams.get("code")!;
    const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, CHATGPT_DOC.redirect_uris[0], RESOURCE);
    assert.deepEqual(provider.credentialsFromAccessToken(tokens.access_token), KEYS);
    const refreshed = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
    assert.deepEqual(provider.credentialsFromAccessToken(refreshed.access_token), KEYS);
  });

  test("registered clients are untouched", async () => {
    const { fetcher, calls } = fakeFetcher({});
    const provider = makeProvider(acceptKeys, fetcher);
    const client = await register(provider);
    assert.ok(await provider.clientsStore.getClient(client.client_id));
    assert.equal(calls.length, 0);
  });
});
