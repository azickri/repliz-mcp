/**
 * The Repliz MCP server, served over Streamable HTTP for many users at once.
 *
 * A user connects by pointing their MCP client at https://<host>/mcp and
 * either sending their own Repliz Access Key and Secret Key as headers, or —
 * when OAuth is configured — clicking "Connect" and typing those keys into the
 * sign-in page once. Nothing else is installed or configured on their side,
 * and the server stores nothing between requests beyond the live session
 * itself.
 *
 * Four rules keep an internet-facing endpoint honest:
 *
 *   - Credentials are verified against the Repliz API *before* a session
 *     exists, so an anonymous caller cannot make the server allocate memory.
 *   - Every later request is re-checked against the credentials that opened the
 *     session, so a leaked session id is useless on its own.
 *   - Sessions expire when idle and are capped in number, so memory stays
 *     bounded even when clients vanish without saying goodbye.
 *   - Requests are rate limited per IP.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  createOAuthMetadata,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { ReplizClient } from "./client.js";
import { createReplizServer } from "./server.js";
import {
  allowedOrigins,
  bearerTokenFromHeaders,
  credentialsFromHeaders,
  getBaseUrl,
  maxSessions,
  oauthSettings,
  port,
  rateLimitPerMinute,
  sessionIdleMs,
  trustProxySetting,
  type ReplizCredentials,
} from "./config.js";
import { ReplizOAuthProvider, withIssuer } from "./oauth.js";
import { SIGN_IN_PATH, renderMessagePage, sendPage } from "./oauth-page.js";
import { AuthCache, RateLimiter, SessionStore, fingerprint, sameFingerprint } from "./session.js";

const MCP_PATH = "/mcp";
const SWEEP_INTERVAL_MS = 60_000;
/** Each sign-in attempt costs a Repliz API call, so it gets a tighter budget than /mcp. */
const SIGN_IN_ATTEMPTS_PER_MINUTE = 10;

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
  // Decides which address the rate limiter counts against — see the config
  // helper for why this must match the deployment.
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
      // Browser clients cannot resume a session, or find the OAuth sign-in, without reading these.
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  const sessions = new SessionStore<StreamableHTTPServerTransport>((id, reason, live) => {
    console.error(`[session] ${id} closed (${reason}). Live: ${live}`);
  });
  const authCache = new AuthCache();
  const rateLimiter = new RateLimiter();
  const signInLimiter = new RateLimiter(() => SIGN_IN_ATTEMPTS_PER_MINUTE);

  /**
   * Check a key pair against the Repliz API, remembering successes briefly so
   * reconnects stay cheap. Returns false only when Repliz rejects the keys;
   * other failures throw, so an outage is never reported as bad keys.
   */
  async function checkCredentials(creds: ReplizCredentials): Promise<boolean> {
    const hash = fingerprint(creds);
    if (authCache.has(hash)) return true;
    const valid = await new ReplizClient({ ...creds, baseUrl }).verifyCredentials();
    if (valid) authCache.add(hash);
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

    app.use(
      mcpAuthRouter({
        provider: oauthProvider,
        issuerUrl: oauth.publicUrl,
        resourceServerUrl: resourceUrl,
        resourceName: "Repliz",
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

  app.use(MCP_PATH, (req: Request, res: Response, next: NextFunction) => {
    if (!rateLimiter.take(req.ip ?? "unknown")) {
      res.setHeader("Retry-After", "60");
      res
        .status(429)
        .json(jsonRpcError(-32029, "Too Many Requests: slow down and retry in a minute."));
      return;
    }
    next();
  });

  // Reclaim sessions whose client went away without sending DELETE — the common
  // case for a closed tab or a dropped network. Without this the session map
  // grows until the process runs out of memory.
  const sweeper = setInterval(() => {
    sessions.sweepIdle();
    authCache.sweep();
    rateLimiter.sweep();
    signInLimiter.sweep();
    provider?.sweep();
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  /**
   * Re-check the caller against the credentials that opened this session.
   * Returns true when the request may proceed; otherwise it has already replied.
   *
   * The session id is sent as a plain header on every request, so it can surface
   * in a reverse-proxy access log, a client's debug output, or the shell history
   * on a shared machine. Binding the session to a fingerprint of its credentials
   * means that replaying a leaked id grants nothing. An OAuth session is bound
   * to the keys sealed in its token, so a refreshed token keeps the session.
   */
  function authorizeSession(req: Request, res: Response, credentialHash: string): boolean {
    const caller = identify(req);
    if (caller.kind === "bad-token") {
      unauthorized(res, BAD_TOKEN_MESSAGE, "invalid_token");
      return false;
    }
    if (caller.kind === "anonymous") {
      unauthorized(
        res,
        "Unauthorized: this session is bound to a set of Repliz credentials — send them with every request, not only at initialize."
      );
      return false;
    }
    if (!sameFingerprint(fingerprint(caller.creds), credentialHash)) {
      res
        .status(403)
        .json(
          jsonRpcError(
            -32003,
            "Forbidden: these credentials do not own this session. Start your own session instead of reusing another one's id."
          )
        );
      return false;
    }
    return true;
  }

  app.post(MCP_PATH, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    if (existing && sessionId) {
      if (!authorizeSession(req, res, existing.credentialHash)) return;
      sessions.touch(sessionId);
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }

    // A session id we don't recognise means it expired, or the process restarted
    // and lost its in-memory sessions. The spec's signal for that is 404, which
    // tells a compliant client to re-initialize on its own; a 400 would surface
    // as a hard error instead.
    if (sessionId) {
      res.status(404).json(jsonRpcError(-32001, "Session not found: start a new session."));
      return;
    }

    if (!isInitializeRequest(req.body)) {
      res
        .status(400)
        .json(jsonRpcError(-32000, "Bad Request: no session ID and not an initialize request."));
      return;
    }

    if (sessions.atCapacity() && !sessions.makeRoom()) {
      res.setHeader("Retry-After", "60");
      res
        .status(503)
        .json(jsonRpcError(-32000, "Server at capacity: too many active sessions. Retry shortly."));
      return;
    }

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

    // Verify before allocating anything: an unverified caller must not be able
    // to make the server hold a session's worth of memory.
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

    const credentialHash = fingerprint(creds);
    const server = createReplizServer(new ReplizClient({ ...creds, baseUrl }));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.add(sid, transport, credentialHash);
        console.error(`[session] ${sid} opened. Live: ${sessions.size}`);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.forget(transport.sessionId);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // GET opens the server-sent events stream; DELETE tears the session down.
  const handleSessionRequest = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session || !sessionId) {
      if (sessionId) {
        res.status(404).json(jsonRpcError(-32001, "Session not found: start a new session."));
      } else {
        res.status(400).json(jsonRpcError(-32000, "Bad Request: missing session ID."));
      }
      return;
    }
    if (!authorizeSession(req, res, session.credentialHash)) return;
    sessions.touch(sessionId);
    await session.transport.handleRequest(req, res);
  };

  app.get(MCP_PATH, handleSessionRequest);
  app.delete(MCP_PATH, handleSessionRequest);

  app.get("/health", (_req, res) => {
    const memory = process.memoryUsage();
    res.json({
      status: "ok",
      baseUrl,
      oauth: Boolean(provider),
      sessions: sessions.size,
      maxSessions: maxSessions(),
      sessionIdleMinutes: sessionIdleMs() / 60_000,
      rateLimitPerMinute: rateLimitPerMinute(),
      rssMb: Math.round(memory.rss / 1024 / 1024),
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
        `  Limits: ${maxSessions()} sessions, ${sessionIdleMs() / 60_000} min idle timeout, ` +
        `${rateLimitPerMinute()} req/min per IP.`
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
    sessions.closeAll("shutdown");
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
