/**
 * The Repliz MCP server, served over Streamable HTTP for many users at once.
 *
 * A user connects by pointing their MCP client at https://<host>/mcp and
 * sending their own Repliz Access Key and Secret Key. Nothing else is installed
 * or configured on their side, and the server stores nothing between requests
 * beyond the live session itself.
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
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { ReplizClient } from "./client.js";
import { createReplizServer } from "./server.js";
import {
  allowedOrigins,
  credentialsFromHeaders,
  getBaseUrl,
  maxSessions,
  port,
  rateLimitPerMinute,
  sessionIdleMs,
  trustProxySetting,
} from "./config.js";
import { AuthCache, RateLimiter, SessionStore, fingerprint, sameFingerprint } from "./session.js";

const MCP_PATH = "/mcp";
const SWEEP_INTERVAL_MS = 60_000;

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0" as const, error: { code, message }, id: null };
}

export async function runHttp(): Promise<void> {
  const baseUrl = getBaseUrl();
  const listenPort = port();

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
      // Browser clients cannot resume a session without reading this back.
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
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
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  /**
   * Re-check the caller against the credentials that opened this session.
   * Returns true when the request may proceed; otherwise it has already replied.
   *
   * The session id is sent as a plain header on every request, so it can surface
   * in a reverse-proxy access log, a client's debug output, or the shell history
   * on a shared machine. Binding the session to a fingerprint of its credentials
   * means that replaying a leaked id grants nothing.
   */
  function authorizeSession(req: Request, res: Response, credentialHash: string): boolean {
    const creds = credentialsFromHeaders(req.headers);
    if (!creds) {
      res
        .status(401)
        .json(
          jsonRpcError(
            -32001,
            "Unauthorized: this session is bound to a set of Repliz credentials — send them with every request, not only at initialize."
          )
        );
      return false;
    }
    if (!sameFingerprint(fingerprint(creds), credentialHash)) {
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

    const creds = credentialsFromHeaders(req.headers);
    if (!creds) {
      res
        .status(401)
        .json(
          jsonRpcError(
            -32001,
            "Unauthorized: provide your Repliz credentials via 'Authorization: Basic <base64(accessKey:secretKey)>' or the 'X-Repliz-Access-Key' and 'X-Repliz-Secret-Key' headers."
          )
        );
      return;
    }

    const client = new ReplizClient({ ...creds, baseUrl });

    // Verify before allocating anything: an unverified caller must not be able
    // to make the server hold a session's worth of memory.
    const credentialHash = fingerprint(creds);
    if (!authCache.has(credentialHash)) {
      let valid: boolean;
      try {
        valid = await client.verifyCredentials();
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
        res
          .status(401)
          .json(
            jsonRpcError(
              -32001,
              "Unauthorized: the Repliz Access Key / Secret Key were rejected by the Repliz API. Check them in your Repliz workspace under Settings > API."
            )
          );
        return;
      }
      authCache.add(credentialHash);
    }

    const server = createReplizServer(client);
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
        `  Limits: ${maxSessions()} sessions, ${sessionIdleMs() / 60_000} min idle timeout, ` +
        `${rateLimitPerMinute()} req/min per IP.`
    );
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
