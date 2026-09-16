/**
 * Session bookkeeping for the multi-user HTTP transport.
 *
 * Everything here is deliberately free of Express and of the MCP SDK so it can
 * be tested directly — these are the parts where a quiet mistake turns into a
 * security hole or an unbounded memory leak.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { authCacheMs, maxSessions, rateLimitPerMinute, sessionIdleMs, type ReplizCredentials } from "./config.js";

/** How quiet a session must be before it can be evicted to admit a new one. */
export const EVICTION_GRACE_MS = 60_000;

/**
 * Stable, non-reversible fingerprint of a credential pair.
 *
 * The access key's length is prefixed so that no two different pairs can
 * produce the same input string — without it, ("ab", "c") and ("a", "bc")
 * would hash identically and a user could ride another user's session.
 */
export function fingerprint(creds: ReplizCredentials): string {
  return createHash("sha256")
    .update(`${creds.accessKey.length}:${creds.accessKey}:${creds.secretKey}`)
    .digest("hex");
}

/** Constant-time comparison of two hex fingerprints. */
export function sameFingerprint(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Remembers recently verified credentials so reconnecting clients do not cost
 * an extra Repliz API round-trip each time. Only positive results are cached,
 * and only briefly, so a revoked key stops working soon after.
 */
export class AuthCache {
  private readonly entries = new Map<string, number>();

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
    this.entries.set(hash, now + authCacheMs());
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

  /** Returns true if the request is allowed. */
  take(key: string, now = Date.now()): boolean {
    const limit = rateLimitPerMinute();
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

/** The minimum a session's transport must provide, so tests can stand one in. */
export interface ClosableTransport {
  close(): void | Promise<void>;
}

export interface Session<T extends ClosableTransport = ClosableTransport> {
  transport: T;
  lastSeen: number;
  /** Fingerprint of the credentials that opened this session. */
  credentialHash: string;
}

/**
 * Holds the live sessions and everything that bounds their number.
 *
 * Sessions exist only in this process's memory, so two failure modes have to be
 * designed against: clients that vanish without sending DELETE (which the MCP
 * SDK's own `client.close()` does not send), and a session cap that would
 * otherwise let those dead sessions lock out real users.
 */
export class SessionStore<T extends ClosableTransport = ClosableTransport> {
  private readonly sessions = new Map<string, Session<T>>();

  constructor(private readonly onClosed?: (id: string, reason: string, live: number) => void) {}

  get size(): number {
    return this.sessions.size;
  }

  get(id: string): Session<T> | undefined {
    return this.sessions.get(id);
  }

  ids(): string[] {
    return [...this.sessions.keys()];
  }

  add(id: string, transport: T, credentialHash: string, now = Date.now()): void {
    this.sessions.set(id, { transport, lastSeen: now, credentialHash });
  }

  touch(id: string, now = Date.now()): void {
    const session = this.sessions.get(id);
    if (session) session.lastSeen = now;
  }

  /** Forget a session without closing it — for the transport's own onclose. */
  forget(id: string): void {
    this.sessions.delete(id);
  }

  /** Close a session and release its memory. */
  drop(id: string, reason: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    void Promise.resolve(session.transport.close()).catch(() => {
      /* already closing */
    });
    this.onClosed?.(id, reason, this.sessions.size);
  }

  /** Drop every session that has gone quiet for longer than the idle window. */
  sweepIdle(now = Date.now()): number {
    const cutoff = now - sessionIdleMs();
    let dropped = 0;
    for (const [id, session] of this.sessions) {
      if (session.lastSeen < cutoff) {
        this.drop(id, "idle timeout");
        dropped += 1;
      }
    }
    return dropped;
  }

  /** True when a new session cannot be admitted without freeing something. */
  atCapacity(): boolean {
    return this.sessions.size >= maxSessions();
  }

  /**
   * Try to free a slot when the cap is reached. Returns true if there is room.
   *
   * Sweep first, then evict the least recently used session — but only if it
   * has been quiet long enough to be plausibly abandoned. A server whose
   * sessions are all genuinely active refuses the new connection instead of
   * cutting off a user mid-conversation.
   */
  makeRoom(now = Date.now()): boolean {
    this.sweepIdle(now);
    if (!this.atCapacity()) return true;

    let oldestId: string | undefined;
    let oldestSeen = Infinity;
    for (const [id, session] of this.sessions) {
      if (session.lastSeen < oldestSeen) {
        oldestSeen = session.lastSeen;
        oldestId = id;
      }
    }

    if (oldestId !== undefined && now - oldestSeen > EVICTION_GRACE_MS) {
      this.drop(oldestId, "evicted to make room at capacity");
      return true;
    }
    return false;
  }

  /** Close everything, for shutdown. */
  closeAll(reason: string): void {
    for (const id of this.ids()) this.drop(id, reason);
  }
}
