/**
 * The Repliz MCP server, served over Streamable HTTP for many users at once.
 *
 * A user connects by pointing their MCP client at https://<host>/mcp and
 * either sending their own Repliz Access Key and Secret Key as headers, or —
 * when OAuth is configured — clicking "Connect" and typing those keys into the
 * sign-in page once. Nothing else is installed or configured on their side.
 *
 * The server is stateless: it keeps no MCP sessions. Every request carries the
 * caller's credentials and is answered by a fresh MCP server built for them,
 * which is thrown away once the response is sent. Building one takes about a
 * millisecond, and in exchange there is nothing to cap, evict, expire, or lose
 * on restart — a thousand connected users cost no more memory than ten, and
 * several processes can serve the same users without sharing anything.
 *
 * Four rules keep an internet-facing endpoint honest:
 *
 *   - Credentials are verified against the Repliz API *before* any work is done
 *     for a request, so an anonymous caller cannot make the server allocate.
 *     Successes are cached briefly, so this is rarely a network call.
 *   - Each request runs as exactly the credentials it carries. There is no
 *     session id to leak or replay.
 *   - Requests in flight are capped, so memory stays bounded under any load.
 *   - Requests are rate limited per user. Only credential checks for keys not
 *     yet verified are limited per address: hosted clients send every user's
 *     traffic from a few shared IPs, and must not throttle users for each other.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  createOAuthMetadata,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { TooManyRequestsError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { ReplizClient } from "./client.js";
import { createReplizServer } from "./server.js";
import {
  allowedOrigins,
  bearerTokenFromHeaders,
  credentialsFromHeaders,
  getBaseUrl,
  maxConcurrentRequests,
  oauthSettings,
  port,
  rateLimitPerMinute,
  trustProxySetting,
  verifyLimitPerMinute,
  type ReplizCredentials,
} from "./config.js";
import { ReplizOAuthProvider, withIssuer } from "./oauth.js";
import { SIGN_IN_PATH, renderMessagePage, sendPage } from "./oauth-page.js";
import { AuthCache, InFlightLimiter, RateLimiter, fingerprint } from "./guards.js";

const MCP_PATH = "/mcp";
const SWEEP_INTERVAL_MS = 60_000;
/**
 * Each sign-in attempt costs a Repliz API call. The form is posted from the
 * user's own browser, so unlike /mcp and /token it can be counted per address.
 */
const SIGN_IN_ATTEMPTS_PER_MINUTE = 10;
/** Token requests per user per minute. A connection in use refreshes about once an hour. */
const TOKEN_REQUESTS_PER_MINUTE = 60;
/**
 * How long a rejected key pair is answered from memory. Short, so keys that
 * were rejected only because they had just been created are not refused long.
 */
const REJECTED_CACHE_MS = 60_000;

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0" as const, error: { code, message }, id: null };
}

/** How the caller identified themselves on this request. */
type Caller =
  | { kind: "user"; creds: ReplizCredentials; viaOAuth: boolean }
  | { kind: "bad-token" }
  | { kind: "anonymous" };

const BAD_TOKEN_MESSAGE = "Unauthorized: the access token is invalid or has expired.";

export async function runHttp(): Promise<void> {
  const baseUrl = getBaseUrl();
  const listenPort = port();
  // Throws on a half-finished OAuth setup, so it fails here rather than at a user's first connect.
  const oauth = oauthSettings();

  const app = express();
  // Decides which address the per-address limits count against — see the
  // config helper for why this must match the deployment.
  app.set("trust proxy", trustProxySetting());
  app.use(express.json({ limit: "4mb" }));

  const origins = allowedOrigins();
  if (origins.length > 0) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;
      if (origins.includes("*")) {
        res.setHeader("Access-Control-Allow-Origin", "*");
      } else if (origin && origins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Repliz-Access-Key, X-Repliz-Secret-Key, Mcp-Session-Id, Mcp-Protocol-Version"
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      // Browser clients cannot find the OAuth sign-in without reading this.
      res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  const inFlight = new InFlightLimiter();
  const authCache = new AuthCache();
  const rejectedCache = new AuthCache(() => REJECTED_CACHE_MS);
  // Claude.ai and ChatGPT call from a few shared addresses on behalf of all
  // their users, so a per-address budget would let one busy user throttle
  // everyone else behind the same IP. Budgets follow the user's keys; only the
  // work an unverified caller can trigger is counted per address.
  const userLimiter = new RateLimiter();
  const verifyLimiter = new RateLimiter(verifyLimitPerMinute);
  const tokenLimiter = new RateLimiter(() => TOKEN_REQUESTS_PER_MINUTE);
  const signInLimiter = new RateLimiter(() => SIGN_IN_ATTEMPTS_PER_MINUTE);

  /** What is remembered about a key pair: accepted, rejected, or undefined if neither. */
  function knownVerdict(hash: string): boolean | undefined {
    if (authCache.has(hash)) return true;
    if (rejectedCache.has(hash)) return false;
    return undefined;
  }

  /**
   * Check a key pair against the Repliz API, remembering the answer so a
   * user costs one check per cache window rather than one per request.
   * Returns false only when Repliz rejects the keys; other failures throw, so
   * an outage is never reported as bad keys.
   */
  async function checkCredentials(creds: ReplizCredentials): Promise<boolean> {
    const hash = fingerprint(creds);
    const known = knownVerdict(hash);
    if (known !== undefined) return known;
    const valid = await new ReplizClient({ ...creds, baseUrl }).verifyCredentials();
    (valid ? authCache : rejectedCache).add(hash);
    return valid;
  }

  // ── OAuth (optional) ──────────────────────────────────────────────────────
  // Discovery metadata, /register, /authorize and /token come from the SDK's
  // router, which must sit at the root; the sign-in form posts to SIGN_IN_PATH.
  let provider: ReplizOAuthProvider | undefined;
  let resourceMetadataUrl: string | undefined;
  if (oauth) {
    const resourceUrl = new URL(MCP_PATH, oauth.publicUrl);
    // The SDK publishes the issuer as the URL's href; RFC 9207 needs the same string.
    const issuer = oauth.publicUrl.href;
    resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);
    const oauthProvider = new ReplizOAuthProvider({
      secret: oauth.secret,
      issuer,
      resourceUrl,
      accessTokenMs: oauth.accessTokenMs,
      refreshTokenMs: oauth.refreshTokenMs,
      verifyCredentials: checkCredentials,
    });
    provider = oauthProvider;

    // The SDK's router serves this document too, but has no way to advertise
    // Client ID Metadata Documents or RFC 9207. Registered first, this answers.
    const authServerMetadata = {
      ...createOAuthMetadata({ provider: oauthProvider, issuerUrl: oauth.publicUrl }),
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    };
    app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.json(authServerMetadata);
    });

    // RFC 9207 promises the issuer on every authorization response. Ours carry
    // it already; this adds it to the error redirects the SDK sends itself.
    app.use("/authorize", (_req: Request, res: Response, next: NextFunction) => {
      const redirect = res.redirect.bind(res) as (status: number, url: string) => void;
      const addIssuer = (url: string) => {
        try {
          return withIssuer(url, issuer);
        } catch {
          return url;
        }
      };
      res.redirect = ((statusOrUrl: number | string, url?: string) =>
        typeof statusOrUrl === "number"
          ? redirect(statusOrUrl, addIssuer(url ?? ""))
          : redirect(302, addIssuer(statusOrUrl))) as Response["redirect"];
      next();
    });

    // Claude.ai and ChatGPT redeem every user's codes and refresh tokens from
    // a few shared addresses, so the SDK's own /token limit — 50 per address
    // per 15 minutes — would start refusing refreshes once a few hundred users
    // are connected. This replaces it with a budget per user, found from the
    // keys sealed in the grant; a grant that does not open counts against its
    // address, and costs no more than a failed decryption.
    app.post(
      new URL(authServerMetadata.token_endpoint).pathname,
      express.urlencoded({ extended: false }),
      (req: Request, res: Response, next: NextFunction) => {
        const creds = oauthProvider.credentialsFromTokenRequest(req.body ?? {});
        const key = creds ? `user:${fingerprint(creds)}` : `ip:${req.ip ?? "unknown"}`;
        if (!tokenLimiter.take(key)) {
          res.setHeader("Retry-After", "60");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.status(429).json(new TooManyRequestsError("Too many token requests. Retry in a minute.").toResponseObject());
          return;
        }
        next();
      }
    );

    app.use(
      mcpAuthRouter({
        provider: oauthProvider,
        issuerUrl: oauth.publicUrl,
        resourceServerUrl: resourceUrl,
        resourceName: "Repliz",
        tokenOptions: { rateLimit: false },
      })
    );

    app.post(
      SIGN_IN_PATH,
      express.urlencoded({ extended: false, limit: "16kb" }),
      async (req: Request, res: Response) => {
        if (!signInLimiter.take(req.ip ?? "unknown")) {
          res.setHeader("Retry-After", "60");
          sendPage(res, 429, renderMessagePage("Too many attempts", "Wait a minute, then try again."));
          return;
        }
        try {
          const result = await oauthProvider.completeSignIn(req.body ?? {});
          if (result.type === "redirect") {
            res.setHeader("Cache-Control", "no-store");
            res.redirect(303, result.location);
          } else {
            sendPage(res, result.status, result.html);
          }
        } catch (err) {
          // Express 4 does not catch async errors; an escape here would take the process down.
          console.error(`[oauth] sign-in failed: ${err instanceof Error ? err.message : err}`);
          sendPage(res, 500, renderMessagePage("Something went wrong", "Go back to the app and try connecting again."));
        }
      }
    );
  }

  const noCredentialsMessage = oauth
    ? "Unauthorized: connect with OAuth, or provide your Repliz credentials via 'Authorization: Basic <base64(accessKey:secretKey)>' or the 'X-Repliz-Access-Key' and 'X-Repliz-Secret-Key' headers."
    : "Unauthorized: provide your Repliz credentials via 'Authorization: Basic <base64(accessKey:secretKey)>' or the 'X-Repliz-Access-Key' and 'X-Repliz-Secret-Key' headers.";

  /**
   * Work out who is calling: an OAuth access token first, then keys sent as
   * headers. With OAuth off, a Bearer header is ignored exactly as before, so
   * a client that sends one alongside X-Repliz headers keeps working.
   */
  function identify(req: Request): Caller {
    const token = provider ? bearerTokenFromHeaders(req.headers) : null;
    const tokenCreds = token !== null ? provider!.credentialsFromAccessToken(token) : null;
    if (tokenCreds) return { kind: "user", creds: tokenCreds, viaOAuth: true };

    const headerCreds = credentialsFromHeaders(req.headers);
    if (headerCreds) return { kind: "user", creds: headerCreds, viaOAuth: false };
    return token !== null ? { kind: "bad-token" } : { kind: "anonymous" };
  }

  /**
   * Reply 401. When OAuth is on, the WWW-Authenticate header is how a client
   * discovers the sign-in flow; `invalid_token` tells it to refresh or sign in again.
   */
  function unauthorized(res: Response, message: string, tokenError?: "invalid_token"): void {
    if (resourceMetadataUrl) {
      const params = tokenError ? `error="${tokenError}", ` : "";
      res.setHeader("WWW-Authenticate", `Bearer ${params}resource_metadata="${resourceMetadataUrl}"`);
    }
    res.status(401).json(jsonRpcError(-32001, message));
  }

  // Drop expired credential checks and rate-limit windows, so these maps stay
  // as small as the current traffic rather than growing with every caller seen.
  const sweeper = setInterval(() => {
    authCache.sweep();
    rejectedCache.sweep();
    userLimiter.sweep();
    verifyLimiter.sweep();
    tokenLimiter.sweep();
    signInLimiter.sweep();
    provider?.sweep();
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  // Every POST is handled on its own, whatever it carries — initialize, a tool
  // call, a notification — and whether or not the client sends an
  // Mcp-Session-Id left over from before this server went stateless.
  app.post(MCP_PATH, async (req: Request, res: Response) => {
    const caller = identify(req);
    if (caller.kind === "bad-token") {
      unauthorized(res, BAD_TOKEN_MESSAGE, "invalid_token");
      return;
    }
    if (caller.kind === "anonymous") {
      unauthorized(res, noCredentialsMessage);
      return;
    }
    const { creds } = caller;
    const hash = fingerprint(creds);

    if (!userLimiter.take(hash)) {
      res.setHeader("Retry-After", "60");
      res
        .status(429)
        .json(jsonRpcError(-32029, "Too Many Requests: these keys sent too many requests this minute. Retry in a minute."));
      return;
    }
    // Checking keys against Repliz is the one thing a caller without valid keys
    // can make this server do, so that alone is budgeted per address — keys
    // already verified (or already rejected) are answered from memory and free.
    if (knownVerdict(hash) === undefined && !verifyLimiter.take(req.ip ?? "unknown")) {
      res.setHeader("Retry-After", "60");
      res
        .status(429)
        .json(jsonRpcError(-32029, "Too Many Requests: too many unrecognised keys from this address. Retry in a minute."));
      return;
    }

    const release = inFlight.acquire();
    if (!release) {
      res.setHeader("Retry-After", "5");
      res
        .status(503)
        .json(jsonRpcError(-32000, "Server busy: too many requests in progress. Retry in a few seconds."));
      return;
    }
    // 'close' fires both when the response is sent and when the client hangs
    // up first, so the slot is always given back.
    let closed = false;
    res.on("close", () => {
      closed = true;
      release();
    });

    // Verify before allocating anything: an unverified caller must not be able
    // to make the server build an MCP server.
    let valid: boolean;
    try {
      valid = await checkCredentials(creds);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res
        .status(503)
        .json(
          jsonRpcError(-32002, `Could not reach the Repliz API to verify credentials: ${message}`)
        );
      return;
    }
    if (!valid) {
      if (caller.viaOAuth) {
        // The keys sealed in this token were rotated or revoked since sign-in.
        unauthorized(
          res,
          "Unauthorized: Repliz no longer accepts the keys this connection was made with. Connect again.",
          "invalid_token"
        );
      } else {
        res
          .status(401)
          .json(
            jsonRpcError(
              -32001,
              "Unauthorized: the Repliz Access Key / Secret Key were rejected by the Repliz API. Check them in your Repliz workspace under Settings > API."
            )
          );
      }
      return;
    }
    // The client gave up while its keys were being checked; nobody is listening.
    if (closed) return;

    // A server and transport for this one request, bound to these credentials
    // and dropped with the response. No session id is issued, so the client
    // sends its credentials again next time and gets a fresh pair.
    const server = createReplizServer(new ReplizClient({ ...creds, baseUrl }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void server.close().catch(() => {
        /* already closed */
      });
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      // Express 4 does not catch async errors; an escape here would take the process down.
      console.error(`[mcp] request failed: ${err instanceof Error ? err.message : err}`);
      if (!res.headersSent) res.status(500).json(jsonRpcError(-32603, "Internal server error."));
    }
  });

  // GET would open a stream for server-initiated messages, and DELETE would end
  // a session. With no sessions there is nothing to stream or end, and the
  // spec's answer for both is 405, which clients handle by carrying on.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.setHeader("Allow", "POST");
    res.status(405).json(jsonRpcError(-32000, "Method Not Allowed: this server is stateless; send requests with POST."));
  };
  app.get(MCP_PATH, methodNotAllowed);
  app.delete(MCP_PATH, methodNotAllowed);

  app.get("/health", (_req, res) => {
    const memory = process.memoryUsage();
    res.json({
      status: "ok",
      baseUrl,
      oauth: Boolean(provider),
      stateless: true,
      inFlight: inFlight.size,
      maxConcurrentRequests: maxConcurrentRequests(),
      rateLimitPerUserPerMinute: rateLimitPerMinute(),
      verifyLimitPerIpPerMinute: verifyLimitPerMinute(),
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  const httpServer = app.listen(listenPort, () => {
    console.error(
      `Repliz MCP server listening on :${listenPort}${MCP_PATH} (Repliz API: ${baseUrl}).\n` +
        `  Auth: each user sends their own keys, verified against the Repliz API.\n` +
        (oauth
          ? `  OAuth: on, issuer ${oauth.publicUrl.origin} — ${oauth.accessTokenMs / 60_000} min access, ` +
            `${oauth.refreshTokenMs / 86_400_000} day refresh tokens.\n`
          : `  OAuth: off (set REPLIZ_OAUTH_SECRET and REPLIZ_PUBLIC_URL to enable).\n`) +
        `  Stateless: no sessions are kept between requests.\n` +
        `  Limits: ${maxConcurrentRequests()} requests in flight, ${rateLimitPerMinute()} req/min per user, ` +
        `${verifyLimitPerMinute()} key checks/min per IP.`
    );
  });

  // Without this, failing to bind surfaces as an unhandled 'error' event and a
  // raw stack trace, which under a process manager becomes a restart loop that
  // says nothing useful about the cause.
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${listenPort} is already in use. Another instance may be running — ` +
          `stop it, or set PORT to a free port.`
      );
    } else if (err.code === "EACCES") {
      console.error(`Not allowed to bind port ${listenPort}. Ports below 1024 need extra privileges.`);
    } else {
      console.error(`Could not listen on port ${listenPort}: ${err.message}`);
    }
    process.exit(1);
  });

  // Let a container or PM2 stop cleanly instead of being killed mid-request.
  const shutdown = (signal: string) => {
    console.error(`Received ${signal}, shutting down...`);
    clearInterval(sweeper);
    // Stops accepting connections and waits for requests in flight to finish.
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
