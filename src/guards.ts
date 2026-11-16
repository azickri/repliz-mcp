/**
 * The bounds that keep an internet-facing, stateless endpoint cheap to run.
 *
 * Everything here is deliberately free of Express and of the MCP SDK so it can
 * be tested directly — these are the parts where a quiet mistake turns into a
 * security hole or an unbounded memory leak.
 */

import { createHash } from "node:crypto";
import { authCacheMs, maxConcurrentRequests, rateLimitPerMinute, type ReplizCredentials } from "./config.js";

/**
 * Stable, non-reversible fingerprint of a credential pair, used as the auth
 * cache key so the cache never holds a secret.
 *
 * The access key's length is prefixed so that no two different pairs can
 * produce the same input string — without it, ("ab", "c") and ("a", "bc")
 * would hash identically and one pair could ride the other's cached check.
 */
export function fingerprint(creds: ReplizCredentials): string {
  return createHash("sha256")
    .update(`${creds.accessKey.length}:${creds.accessKey}:${creds.secretKey}`)
    .digest("hex");
}

/**
 * Remembers credential pairs recently checked against Repliz, so each request
 * does not cost an extra API round-trip. The server keeps one for accepted
 * pairs, short enough that a revoked key stops working soon after, and one for
 * rejected pairs, shorter still, so a client retrying bad keys costs one check
 * a minute instead of one per request.
 */
export class AuthCache {
  private readonly entries = new Map<string, number>();

  /** `ttlMs` defaults to REPLIZ_AUTH_CACHE_MINUTES. */
  constructor(private readonly ttlMs: () => number = authCacheMs) {}

  has(hash: string, now = Date.now()): boolean {
    const expiry = this.entries.get(hash);
    if (expiry === undefined) return false;
    if (expiry <= now) {
      this.entries.delete(hash);
      return false;
    }
    return true;
  }

  add(hash: string, now = Date.now()): void {
    this.entries.set(hash, now + this.ttlMs());
  }

  sweep(now = Date.now()): void {
    for (const [hash, expiry] of this.entries) {
      if (expiry <= now) this.entries.delete(hash);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Fixed-window per-key request counter. */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  /** `perMinute` defaults to the server-wide REPLIZ_RATE_LIMIT_PER_MINUTE. */
  constructor(private readonly perMinute: () => number = rateLimitPerMinute) {}

  /** Returns true if the request is allowed. */
  take(key: string, now = Date.now()): boolean {
    const limit = this.perMinute();
    const window = this.windows.get(key);

    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (window.count >= limit) return false;
    window.count += 1;
    return true;
  }

  sweep(now = Date.now()): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  get size(): number {
    return this.windows.size;
  }
}

/**
 * Counts requests being handled right now and refuses past a cap.
 *
 * The server keeps no sessions, so this is the one number memory follows: each
 * admitted request holds a short-lived MCP server until its response is sent.
 */
export class InFlightLimiter {
  private count = 0;

  /** `max` defaults to the server-wide REPLIZ_MAX_CONCURRENT_REQUESTS. */
  constructor(private readonly max: () => number = maxConcurrentRequests) {}

  /**
   * Claim a slot. Returns the function that gives it back, or null when every
   * slot is taken. Releasing twice is harmless, so callers can wire the release
   * to every way a request can end without counting how many fired.
   */
  acquire(): (() => void) | null {
    if (this.count >= this.max()) return null;
    this.count += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.count -= 1;
    };
  }

  get size(): number {
    return this.count;
  }
}
