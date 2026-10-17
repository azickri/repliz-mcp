/**
 * OAuth 2.1 for clients that connect with a "Connect" button (Claude.ai,
 * ChatGPT) instead of custom headers.
 *
 * The Repliz API has no OAuth of its own — only an Access Key and Secret Key —
 * so this server is the authorization server. Its sign-in page asks for the
 * user's keys, checks them against Repliz, and seals them into the tokens it
 * issues. Every authorization code and token, and the client id of every
 * client that registers itself, is AES-256-GCM ciphertext under
 * REPLIZ_OAUTH_SECRET, which keeps the server storage-free: a token carries
 * everything needed to serve it, survives a restart, and is unreadable to
 * anyone but this server. Clients that identify themselves with a metadata
 * document URL instead (CIMD) are looked up from that URL.
 *
 * The price of holding no state is that a single token cannot be revoked
 * early. That is bounded three ways: access tokens are short-lived; every tool
 * call still presents the sealed keys to Repliz, so rotating a key in the
 * Repliz dashboard stops the connection working at once; and a refresh
 * re-checks the keys, so the client is sent back to sign in. Changing
 * REPLIZ_OAUTH_SECRET signs every user out.
 *
 * The MCP SDK's mcpAuthRouter does the protocol work — discovery metadata,
 * request validation, PKCE — and calls into the provider defined here.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import type { Response } from "express";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { ReplizCredentials } from "./config.js";
import { assertPublicUrl } from "./net.js";
import { renderMessagePage, renderSignInPage, sendPage } from "./oauth-page.js";

// ─── Sealing ────────────────────────────────────────────────────────────────

/** What a sealed value is for. Bound into the ciphertext, so one kind can never be replayed as another. */
export type SealKind = "client" | "signin" | "code" | "access" | "refresh";

const SEAL_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Far above any token this server mints; refuses absurd input before decoding it. */
const MAX_SEALED_CHARS = 16_384;
const HKDF_SALT = "repliz-mcp/oauth/v1";

/**
 * Authenticated encryption of small JSON payloads into URL-safe strings.
 *
 * Format: base64url(version · iv · tag · ciphertext), with the kind as
 * additional authenticated data. Any tampering, a wrong kind, or a different
 * secret fails authentication and opens to null.
 */
export class Sealer {
  private readonly encryptionKey: Buffer;
  private readonly macKey: Buffer;

  constructor(secret: string) {
    // Separate keys per purpose, so a value computed with one can never pass as the other.
    const derive = (info: string) => Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, info, 32));
    this.encryptionKey = derive("seal");
    this.macKey = derive("client-secret");
  }

  /** Seal a payload. With `ttlMs`, it stops opening once that much time has passed. */
  seal(kind: SealKind, payload: object, ttlMs?: number, now = Date.now()): string {
    const body = ttlMs === undefined ? payload : { ...payload, exp: now + ttlMs };
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(kind));
    const data = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
    return Buffer.concat([Buffer.from([SEAL_VERSION]), iv, cipher.getAuthTag(), data]).toString("base64url");
  }

  /** Open a sealed value, or null if it is forged, of another kind, or expired. */
  open<T extends object>(kind: SealKind, sealed: unknown, now = Date.now()): (T & { exp?: number }) | null {
    if (typeof sealed !== "string" || sealed.length === 0 || sealed.length > MAX_SEALED_CHARS) return null;
    const buf = Buffer.from(sealed, "base64url");
    if (buf.length <= 1 + IV_BYTES + TAG_BYTES || buf[0] !== SEAL_VERSION) return null;

    let payload: unknown;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, buf.subarray(1, 1 + IV_BYTES));
      decipher.setAAD(Buffer.from(kind));
      decipher.setAuthTag(buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES));
      const plain = Buffer.concat([decipher.update(buf.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
      payload = JSON.parse(plain.toString("utf8"));
    } catch {
      return null;
    }
    if (typeof payload !== "object" || payload === null) return null;
    const exp = (payload as { exp?: unknown }).exp;
    if (exp !== undefined && (typeof exp !== "number" || exp <= now)) return null;
    return payload as T & { exp?: number };
  }

  /** A keyed hash, for values that must be recomputable but unforgeable. */
  mac(value: string): string {
    return createHmac("sha256", this.macKey).update(value).digest("base64url");
  }
}

// ─── Redirect URIs ──────────────────────────────────────────────────────────

const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 512;
const MAX_CLIENT_NAME_LENGTH = 100;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:", "about:", "filesystem:"]);

/**
 * Why a client may not register this redirect URI, or null if it may.
 *
 * Allowed: any https URL (Claude.ai, ChatGPT), plain http only on loopback
 * (CLI and desktop clients listening on a local port), and a native app's own
 * scheme such as cursor:// (RFC 8252 §7.1). The sign-in page names the
 * destination, so a user can see when a client would send them somewhere odd.
 */
export function redirectUriProblem(uri: string): string | null {
  if (uri.length > MAX_REDIRECT_URI_LENGTH) return `longer than ${MAX_REDIRECT_URI_LENGTH} characters`;
  if (uri.includes("#")) return "must not contain a fragment";
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:") {
    return LOOPBACK_HOSTS.has(url.hostname) ? null : "plain http is only allowed for localhost";
  }
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return `the ${url.protocol} scheme is not allowed`;
  return null;
}

function withParams(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.href;
}

/**
 * Add the issuer to an authorization response (RFC 9207), so a client talking
 * to several servers can tell which one answered. Advertising support promises
 * it on every response, errors included.
 */
export function withIssuer(location: string, issuer: string): string {
  const url = new URL(location);
  if (!url.searchParams.has("iss")) url.searchParams.set("iss", issuer);
  return url.href;
}

// ─── Client ID Metadata Documents ───────────────────────────────────────────
// A client may use an HTTPS URL as its client_id; the document at that URL
// describes it (draft-ietf-oauth-client-id-metadata-document). Claude and
// ChatGPT prefer this to registering, and it costs this server nothing to
// store: the document is fetched when needed and cached briefly.

const CIMD_MAX_BYTES = 5 * 1024;
const CIMD_TIMEOUT_MS = 5_000;
const CIMD_CACHE_DEFAULT_MS = 60 * 60_000;
const CIMD_CACHE_MIN_MS = 60_000;
const CIMD_CACHE_MAX_MS = 24 * 60 * 60_000;
const CIMD_CACHE_ENTRIES = 500;

/** A fetched metadata document and how long it may be cached. */
export interface FetchedMetadata {
  body: unknown;
  maxAgeMs?: number;
}

export type MetadataFetcher = (url: URL) => Promise<FetchedMetadata>;

/** True when a client_id is a metadata document URL rather than one this server issued. */
export function isMetadataDocumentUrl(clientId: string): boolean {
  return clientId.startsWith("https://");
}

/** Why a URL cannot serve as a client_id, or null if it can. */
export function clientIdUrlProblem(clientId: string): string | null {
  if (clientId.length > MAX_REDIRECT_URI_LENGTH) return `longer than ${MAX_REDIRECT_URI_LENGTH} characters`;
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol !== "https:") return "must use https";
  if (url.username || url.password) return "must not contain credentials";
  if (clientId.includes("#")) return "must not contain a fragment";
  if (url.pathname === "/") return "must have a path";
  // Exact comparison with the document's own client_id only works on one
  // spelling, so dot segments, an uppercase host and the like are refused.
  if (url.href !== clientId) return "must be in canonical form";
  return null;
}

function cacheLifetime(cacheControl: string | null): number | undefined {
  const maxAge = cacheControl?.match(/max-age=(\d+)/i);
  return maxAge ? Number(maxAge[1]) * 1000 : undefined;
}

async function readCapped(response: globalThis.Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new Error(`larger than ${limit} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetch a metadata document from the internet. The client_id is chosen by
 * whoever starts an authorization, so this is the same guarded fetch as an
 * upload source: public addresses only, no redirects, a short timeout and a
 * small size cap. Nothing fetched is ever relayed back to the caller.
 */
export async function fetchClientMetadata(url: URL): Promise<FetchedMetadata> {
  await assertPublicUrl(url.href, "client metadata document");
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "error", // a redirect could land on a private address
    signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await readCapped(response, CIMD_MAX_BYTES);
  return { body: JSON.parse(text), maxAgeMs: cacheLifetime(response.headers.get("cache-control")) };
}

/** What a valid metadata document says, reduced to what this server uses. */
interface MetadataClient {
  redirectUris: string[];
  name: string;
}

/** Check a fetched document against its URL; throws with the reason it is refused. */
export function validateClientMetadata(clientId: string, document: unknown): MetadataClient {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new Error("not a JSON object");
  }
  const doc = document as Record<string, unknown>;
  if (doc.client_id !== clientId) throw new Error("its client_id does not match the URL it was fetched from");
  if (doc.client_secret !== undefined || doc.client_secret_expires_at !== undefined) {
    throw new Error("it contains a client secret, which a public document must not");
  }

  const uris = doc.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    uris.length > MAX_REDIRECT_URIS ||
    !uris.every((uri): uri is string => typeof uri === "string")
  ) {
    throw new Error(`redirect_uris must list between 1 and ${MAX_REDIRECT_URIS} URIs`);
  }
  for (const uri of uris) {
    const problem = redirectUriProblem(uri);
    if (problem) throw new Error(`redirect_uri ${JSON.stringify(uri)} is not allowed: ${problem}`);
  }

  // Of the methods the client can use, this server takes only "none": a
  // public client, protected by PKCE. ChatGPT lists several in the plural
  // field; a client that can only authenticate another way is refused.
  const methods = Array.isArray(doc.token_endpoint_auth_methods_supported)
    ? doc.token_endpoint_auth_methods_supported
    : typeof doc.token_endpoint_auth_method === "string"
      ? [doc.token_endpoint_auth_method]
      : ["none"];
  if (!methods.includes("none")) {
    throw new Error("it doesn't allow token_endpoint_auth_method 'none', the only one this server accepts");
  }

  const name = typeof doc.client_name === "string" ? doc.client_name.trim().slice(0, MAX_CLIENT_NAME_LENGTH) : "";
  return { redirectUris: uris, name: name || new URL(clientId).hostname };
}

// ─── Single-use codes ───────────────────────────────────────────────────────

/**
 * Remembers which authorization codes have been redeemed, until they expire.
 *
 * This is the one piece of state, and losing it on restart is harmless: a
 * code lives a few minutes and is useless without the PKCE verifier that only
 * the client that started the flow holds.
 */
export class UsedCodes {
  private readonly used = new Map<string, number>();

  /** Returns true the first time a code id is seen, false on any replay. */
  consume(id: string, expiresAt: number): boolean {
    if (this.used.has(id)) return false;
    this.used.set(id, expiresAt);
    return true;
  }

  sweep(now = Date.now()): void {
    for (const [id, expiresAt] of this.used) {
      if (expiresAt <= now) this.used.delete(id);
    }
  }

  get size(): number {
    return this.used.size;
  }
}

// ─── Provider ───────────────────────────────────────────────────────────────

/** How long the sign-in page stays usable — time to go and find the keys. */
export const SIGN_IN_TTL_MS = 15 * 60_000;
/** Authorization codes are redeemed by the client immediately; this is slack. */
export const CODE_TTL_MS = 5 * 60_000;

/** A registered client, sealed into its own client_id. */
interface ClientRecord {
  /** redirect_uris */
  r: string[];
  /** client_name */
  n?: string;
  /** public client (no secret) */
  pub: boolean;
  /** issued at, seconds */
  iat: number;
}

/** An authorization request waiting on the sign-in form. */
interface SignInRequest {
  /** hash of the client_id — client ids carry metadata and can be long */
  c: string;
  n?: string;
  /** host that published the client's metadata document, for CIMD clients */
  h?: string;
  /** redirect_uri */
  r: string;
  /** PKCE code_challenge */
  ch: string;
  /** state */
  st?: string;
  /** scopes */
  sc: string[];
  /** RFC 8707 resource */
  rs?: string;
}

/** What a client was granted: whose keys, for which client. */
interface Grant {
  c: string;
  sc: string[];
  rs?: string;
  ak: string;
  sk: string;
}

interface CodeGrant extends Grant {
  r: string;
  ch: string;
  /** unique id, for single use */
  j: string;
}

export interface ReplizOAuthOptions {
  secret: string;
  /** This authorization server's issuer, exactly as its metadata states it. */
  issuer: string;
  /** The protected MCP endpoint, e.g. https://mcp.repliz.com/mcp. */
  resourceUrl: URL;
  accessTokenMs: number;
  refreshTokenMs: number;
  /** Check keys against Repliz: false when rejected, throws when Repliz is unreachable. */
  verifyCredentials: (creds: ReplizCredentials) => Promise<boolean>;
  /** Fetch a client metadata document; defaults to a guarded fetch from the internet. */
  fetchClientMetadata?: MetadataFetcher;
}

export type SignInResult =
  | { type: "redirect"; location: string }
  | { type: "page"; status: number; html: string };

function clientHash(clientId: string): string {
  return createHash("sha256").update(clientId).digest("base64url");
}

function formField(form: Record<string, unknown>, name: string): string {
  const value = form[name];
  return typeof value === "string" ? value : "";
}

export class ReplizOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  private readonly sealer: Sealer;
  private readonly usedCodes = new UsedCodes();
  private readonly metadataCache = new Map<string, { client: MetadataClient; expiresAt: number }>();
  private readonly metadataInFlight = new Map<string, Promise<MetadataClient | undefined>>();

  constructor(private readonly options: ReplizOAuthOptions) {
    this.sealer = new Sealer(options.secret);
    this.clientsStore = {
      getClient: (clientId) => this.getClient(clientId),
      registerClient: (client) => this.registerClient(client),
    };
  }

  // ── Clients (RFC 7591 dynamic registration, with nothing stored) ──────────

  private registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
    now = Date.now()
  ): OAuthClientInformationFull {
    const redirectUris = client.redirect_uris;
    if (redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS) {
      throw new InvalidClientMetadataError(`redirect_uris must list between 1 and ${MAX_REDIRECT_URIS} URIs.`);
    }
    for (const uri of redirectUris) {
      const problem = redirectUriProblem(uri);
      if (problem) throw new InvalidClientMetadataError(`redirect_uri ${uri} is not allowed: ${problem}.`);
    }

    const record: ClientRecord = {
      r: redirectUris,
      n: client.client_name?.trim().slice(0, MAX_CLIENT_NAME_LENGTH) || undefined,
      pub: client.token_endpoint_auth_method === "none",
      iat: Math.floor(now / 1000),
    };
    const clientId = this.sealer.seal("client", record);
    // Echo the submitted metadata, overridden by what this server actually enforces.
    return { ...client, ...this.clientInfo(clientId, record) };
  }

  private async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    if (isMetadataDocumentUrl(clientId)) {
      const client = await this.metadataClient(clientId);
      return client
        ? {
            client_id: clientId,
            client_name: client.name,
            redirect_uris: client.redirectUris,
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          }
        : undefined;
    }
    const record = this.sealer.open<ClientRecord>("client", clientId);
    return record ? this.clientInfo(clientId, record) : undefined;
  }

  /**
   * The client a metadata document describes, from the cache or fetched now.
   * Concurrent requests for one URL share a single fetch. A refused document
   * is logged and treated as an unknown client, which the SDK reports as
   * invalid_client.
   */
  private async metadataClient(clientId: string, now = Date.now()): Promise<MetadataClient | undefined> {
    const cached = this.metadataCache.get(clientId);
    if (cached && cached.expiresAt > now) return cached.client;

    const pending = this.metadataInFlight.get(clientId);
    if (pending) return pending;

    const load = (async () => {
      try {
        const problem = clientIdUrlProblem(clientId);
        if (problem) throw new Error(`the client_id URL ${problem}`);
        const fetched = await (this.options.fetchClientMetadata ?? fetchClientMetadata)(new URL(clientId));
        const client = validateClientMetadata(clientId, fetched.body);
        const lifetime = Math.min(
          CIMD_CACHE_MAX_MS,
          Math.max(CIMD_CACHE_MIN_MS, fetched.maxAgeMs ?? CIMD_CACHE_DEFAULT_MS)
        );
        if (this.metadataCache.size >= CIMD_CACHE_ENTRIES) {
          const oldest = this.metadataCache.keys().next().value;
          if (oldest !== undefined) this.metadataCache.delete(oldest);
        }
        this.metadataCache.delete(clientId);
        this.metadataCache.set(clientId, { client, expiresAt: Date.now() + lifetime });
        return client;
      } catch (err) {
        console.error(
          `[oauth] refused client metadata document ${clientId}: ${err instanceof Error ? err.message : err}`
        );
        return undefined;
      } finally {
        this.metadataInFlight.delete(clientId);
      }
    })();
    this.metadataInFlight.set(clientId, load);
    return load;
  }

  private clientInfo(clientId: string, record: ClientRecord): OAuthClientInformationFull {
    return {
      client_id: clientId,
      client_id_issued_at: record.iat,
      client_name: record.n,
      redirect_uris: record.r,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // The SDK checks secrets sent in the body only, so that is the method on offer.
      token_endpoint_auth_method: record.pub ? "none" : "client_secret_post",
      // Derived rather than stored: the same id always yields the same secret,
      // and only this server can compute it.
      client_secret: record.pub ? undefined : this.sealer.mac(clientId),
      // Never expires (0): with nothing stored, there is no way to issue a replacement.
      client_secret_expires_at: record.pub ? undefined : 0,
    };
  }

  // ── Authorization ─────────────────────────────────────────────────────────

  /** Tokens are only ever minted for this server's own MCP endpoint. */
  private checkResource(resource: URL | undefined): void {
    if (resource !== undefined && resource.origin !== this.options.resourceUrl.origin) {
      throw new InvalidTargetError(`This server only issues tokens for ${this.options.resourceUrl.href}.`);
    }
  }

  /** Show the sign-in page. The SDK has already checked the client, redirect URI, and PKCE parameters. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    this.checkResource(params.resource);
    const request: SignInRequest = {
      c: clientHash(client.client_id),
      n: client.client_name,
      h: isMetadataDocumentUrl(client.client_id) ? new URL(client.client_id).host : undefined,
      r: params.redirectUri,
      ch: params.codeChallenge,
      st: params.state,
      sc: params.scopes ?? [],
      rs: params.resource?.href,
    };
    const sealed = this.sealer.seal("signin", request, SIGN_IN_TTL_MS);
    sendPage(
      res,
      200,
      renderSignInPage({ request: sealed, clientName: request.n, clientHost: request.h, redirectUri: request.r })
    );
  }

  /**
   * Handle the sign-in form: on valid keys, redirect back to the client with
   * an authorization code; otherwise show the form again with the reason.
   *
   * The sealed request in the form is what ties this POST to a genuine
   * authorization request, and it cannot be altered to change the redirect
   * target. There is no session cookie for a cross-site request to ride: the
   * keys exist only in what the user types, so no separate CSRF token is needed.
   */
  async completeSignIn(form: Record<string, unknown>): Promise<SignInResult> {
    const sealedRequest = formField(form, "request");
    const request = this.sealer.open<SignInRequest>("signin", sealedRequest);
    if (!request) {
      return {
        type: "page",
        status: 400,
        html: renderMessagePage(
          "This sign-in link has expired",
          "Go back to the app you were connecting from and start connecting again."
        ),
      };
    }

    if (formField(form, "action") === "cancel") {
      return {
        type: "redirect",
        location: withParams(request.r, {
          error: "access_denied",
          error_description: "The user declined to connect their Repliz workspace.",
          state: request.st,
          iss: this.options.issuer,
        }),
      };
    }

    const accessKey = formField(form, "access_key").trim();
    const secretKey = formField(form, "secret_key").trim();
    const retry = (status: number, error: string): SignInResult => ({
      type: "page",
      status,
      html: renderSignInPage({
        request: sealedRequest,
        clientName: request.n,
        clientHost: request.h,
        redirectUri: request.r,
        accessKey,
        error,
      }),
    });

    if (!accessKey || !secretKey) return retry(400, "Enter both your Access Key and your Secret Key.");

    let valid: boolean;
    try {
      valid = await this.options.verifyCredentials({ accessKey, secretKey });
    } catch {
      return retry(503, "Couldn't reach Repliz to check these keys. Try again in a moment.");
    }
    if (!valid) {
      return retry(401, "Repliz didn't accept these keys. Copy them again from Settings > API in your Repliz workspace.");
    }

    const grant: CodeGrant = {
      c: request.c,
      sc: request.sc,
      rs: request.rs,
      ak: accessKey,
      sk: secretKey,
      r: request.r,
      ch: request.ch,
      j: randomBytes(16).toString("base64url"),
    };
    const code = this.sealer.seal("code", grant, CODE_TTL_MS);
    return {
      type: "redirect",
      location: withParams(request.r, { code, state: request.st, iss: this.options.issuer }),
    };
  }

  // ── Tokens ────────────────────────────────────────────────────────────────

  private openCode(client: OAuthClientInformationFull, code: string): CodeGrant & { exp?: number } {
    const grant = this.sealer.open<CodeGrant>("code", code);
    if (!grant) throw new InvalidGrantError("Invalid or expired authorization code.");
    if (grant.c !== clientHash(client.client_id)) {
      throw new InvalidGrantError("This authorization code was issued to another client.");
    }
    return grant;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    return this.openCode(client, authorizationCode).ch;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    // PKCE has already been verified by the SDK against challengeForAuthorizationCode.
    const grant = this.openCode(client, authorizationCode);
    if (redirectUri !== undefined && redirectUri !== grant.r) {
      throw new InvalidGrantError("redirect_uri does not match the one used to authorize.");
    }
    this.checkResource(resource);
    if (!this.usedCodes.consume(grant.j, grant.exp ?? Date.now() + CODE_TTL_MS)) {
      throw new InvalidGrantError("This authorization code has already been used.");
    }
    return this.issueTokens(grant);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const grant = this.sealer.open<Grant>("refresh", refreshToken);
    if (!grant || grant.c !== clientHash(client.client_id)) {
      throw new InvalidGrantError("Invalid or expired refresh token.");
    }
    this.checkResource(resource);

    // The one point where a long-lived grant meets Repliz again: keys rotated
    // or revoked since sign-in end the connection here, and the client is
    // sent back to the sign-in page.
    let valid: boolean;
    try {
      valid = await this.options.verifyCredentials({ accessKey: grant.ak, secretKey: grant.sk });
    } catch {
      throw new ServerError("Could not reach the Repliz API to re-check this connection. Try again shortly.");
    }
    if (!valid) {
      throw new InvalidGrantError("Repliz no longer accepts the keys this connection was made with. Connect again.");
    }
    return this.issueTokens(grant);
  }

  /**
   * A fresh access token, and a fresh refresh token so that a connection in
   * regular use never expires — only one left idle for the refresh lifetime.
   */
  private issueTokens({ c, sc, rs, ak, sk }: Grant, now = Date.now()): OAuthTokens {
    const grant: Grant = { c, sc, rs, ak, sk };
    return {
      access_token: this.sealer.seal("access", grant, this.options.accessTokenMs, now),
      token_type: "Bearer",
      expires_in: Math.floor(this.options.accessTokenMs / 1000),
      refresh_token: this.sealer.seal("refresh", grant, this.options.refreshTokenMs, now),
      scope: sc.length > 0 ? sc.join(" ") : undefined,
    };
  }

  /** The Repliz keys behind an access token, or null if it is invalid or expired. */
  credentialsFromAccessToken(token: string): ReplizCredentials | null {
    const grant = this.sealer.open<Grant>("access", token);
    return grant ? { accessKey: grant.ak, secretKey: grant.sk } : null;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const grant = this.sealer.open<Grant>("access", token);
    if (!grant) throw new InvalidTokenError("Invalid or expired access token.");
    return {
      token,
      // A hash of the client id: the id itself is sealed client metadata.
      clientId: grant.c,
      scopes: grant.sc,
      expiresAt: grant.exp === undefined ? undefined : Math.floor(grant.exp / 1000),
      resource: grant.rs ? new URL(grant.rs) : undefined,
    };
  }

  // No revokeToken: with nothing stored, a revoke endpoint could only pretend.
  // Leaving it out keeps the metadata honest about that.

  /** Drop expired single-use bookkeeping and stale metadata documents. */
  sweep(now = Date.now()): void {
    this.usedCodes.sweep(now);
    for (const [clientId, entry] of this.metadataCache) {
      if (entry.expiresAt <= now) this.metadataCache.delete(clientId);
    }
  }
}
