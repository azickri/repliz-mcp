/**
 * Runtime configuration.
 *
 * This server is multi-tenant by design: it holds no credentials of its own.
 * Every user sends their own Repliz Access Key and Secret Key on each request,
 * and those are the only credentials the server ever uses. There is
 * deliberately no environment-variable fallback — one would silently lend the
 * operator's own workspace to any caller who omitted their keys.
 *
 * The Repliz Public API uses HTTP Basic Auth: Access Key as the username,
 * Secret Key as the password.
 */

export interface ReplizCredentials {
  accessKey: string;
  secretKey: string;
}

export interface ReplizConfig extends ReplizCredentials {
  baseUrl: string;
}

const DEFAULT_BASE_URL = "https://api.repliz.com";

/** The Repliz API base URL, shared by every user on this host. */
export function getBaseUrl(): string {
  return (process.env.REPLIZ_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

type HeaderBag = Record<string, string | string[] | undefined>;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parse a user's Repliz credentials from request headers. Supports:
 *   - Authorization: Basic base64(accessKey:secretKey)   (mirrors Repliz's own auth)
 *   - X-Repliz-Access-Key + X-Repliz-Secret-Key          (explicit custom headers)
 * Returns null if no complete pair is present.
 */
export function credentialsFromHeaders(headers: HeaderBag): ReplizCredentials | null {
  const auth = headerValue(headers["authorization"]);
  if (auth && /^basic\s+/i.test(auth)) {
    const decoded = Buffer.from(auth.replace(/^basic\s+/i, "").trim(), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx > 0) {
      const accessKey = decoded.slice(0, idx);
      const secretKey = decoded.slice(idx + 1);
      if (accessKey && secretKey) return { accessKey, secretKey };
    }
  }

  const accessKey = headerValue(headers["x-repliz-access-key"])?.trim();
  const secretKey = headerValue(headers["x-repliz-secret-key"])?.trim();
  if (accessKey && secretKey) return { accessKey, secretKey };

  return null;
}

// ─── Tunables ───────────────────────────────────────────────────────────────
// Defaults are sized for a ~1 GB VPS. Each live session costs roughly 1.8 MB,
// so maxSessions() is the main memory lever.

function intFromEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.floor(parsed);
}

/** Port to listen on. */
export function port(): number {
  return intFromEnv("PORT", 3000, 1);
}

/** Drop a session after this long with no request. Default 30 minutes. */
export function sessionIdleMs(): number {
  return intFromEnv("REPLIZ_SESSION_IDLE_MINUTES", 30, 1) * 60_000;
}

/** Hard cap on concurrent sessions, to bound memory. Default 300. */
export function maxSessions(): number {
  return intFromEnv("REPLIZ_MAX_SESSIONS", 300, 1);
}

/** Requests allowed per IP per minute. Default 120. */
export function rateLimitPerMinute(): number {
  return intFromEnv("REPLIZ_RATE_LIMIT_PER_MINUTE", 120, 1);
}

/** Timeout for outbound calls to the Repliz API, in ms. Default 30s. */
export function requestTimeoutMs(): number {
  return intFromEnv("REPLIZ_REQUEST_TIMEOUT_SECONDS", 30, 1) * 1_000;
}

/** How long a successful credential check stays cached, in ms. Default 5 min. */
export function authCacheMs(): number {
  return intFromEnv("REPLIZ_AUTH_CACHE_MINUTES", 5, 1) * 60_000;
}

/**
 * Cap on a file copied through the server, in bytes. The body is buffered in
 * memory, so this directly bounds the spike one upload can cause. Default 100 MB.
 */
export function maxUploadBytes(): number {
  return intFromEnv("REPLIZ_MAX_UPLOAD_MB", 100, 1) * 1024 * 1024;
}

/**
 * Browser origins allowed to call the server. Empty means no CORS headers are
 * emitted, which is correct for server-side clients; "*" allows any origin.
 */
export function allowedOrigins(): string[] {
  const raw = process.env.REPLIZ_ALLOWED_ORIGINS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Express's `trust proxy` setting, which decides the address the per-IP rate
 * limiter counts against.
 *
 * Trusting every hop lets a caller forge `X-Forwarded-For` and get a fresh
 * bucket per request; trusting nothing behind a reverse proxy collapses every
 * user into one bucket. The default, "loopback", is right for the usual case
 * of Nginx or Caddy on the same host, since an outside caller cannot forge a
 * loopback source address. Override with REPLIZ_TRUST_PROXY ("false", "true",
 * a hop count, or an IP/subnet list) when the proxy sits elsewhere.
 */
export function trustProxySetting(): boolean | number | string {
  const raw = process.env.REPLIZ_TRUST_PROXY?.trim();
  if (!raw) return "loopback";
  if (raw.toLowerCase() === "true") return true;
  if (raw.toLowerCase() === "false") return false;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops >= 0) return hops;
  return raw; // comma-separated IPs / subnets, understood by Express
}
