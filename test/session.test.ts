/**
 * Session bookkeeping: the credential binding that makes a leaked session id
 * worthless, and the bounds that keep memory from growing without limit.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  AuthCache,
  EVICTION_GRACE_MS,
  RateLimiter,
  SessionStore,
  fingerprint,
  sameFingerprint,
  type ClosableTransport,
} from "../src/session.js";

/** Stand-in transport that records whether it was closed. */
class FakeTransport implements ClosableTransport {
  closed = false;
  close() {
    this.closed = true;
  }
}

const ENV_KEYS = [
  "REPLIZ_MAX_SESSIONS",
  "REPLIZ_SESSION_IDLE_MINUTES",
  "REPLIZ_RATE_LIMIT_PER_MINUTE",
  "REPLIZ_AUTH_CACHE_MINUTES",
];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("fingerprint", () => {
  test("is stable for the same credentials", () => {
    const a = fingerprint({ accessKey: "key", secretKey: "secret" });
    const b = fingerprint({ accessKey: "key", secretKey: "secret" });
    assert.equal(a, b);
  });

  test("differs when either half differs", () => {
    const base = fingerprint({ accessKey: "key", secretKey: "secret" });
    assert.notEqual(base, fingerprint({ accessKey: "key2", secretKey: "secret" }));
    assert.notEqual(base, fingerprint({ accessKey: "key", secretKey: "secret2" }));
  });

  test("does not collide across a shifted split of the same characters", () => {
    // Without the length prefix, ("ab","c") and ("a","bc") would hash the same
    // and one user could ride another user's session.
    assert.notEqual(
      fingerprint({ accessKey: "ab", secretKey: "c" }),
      fingerprint({ accessKey: "a", secretKey: "bc" })
    );
  });

  test("does not leak the secret", () => {
    const hash = fingerprint({ accessKey: "pub", secretKey: "TOPSECRET" });
    assert.doesNotMatch(hash, /TOPSECRET/);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

describe("sameFingerprint", () => {
  const hash = fingerprint({ accessKey: "key", secretKey: "secret" });

  test("matches an identical fingerprint", () => {
    assert.equal(sameFingerprint(hash, hash), true);
  });

  test("rejects a different fingerprint", () => {
    assert.equal(sameFingerprint(hash, fingerprint({ accessKey: "x", secretKey: "y" })), false);
  });

  test("rejects empty, truncated and non-hex input rather than throwing", () => {
    assert.equal(sameFingerprint("", ""), false);
    assert.equal(sameFingerprint(hash, ""), false);
    assert.equal(sameFingerprint(hash, hash.slice(0, 10)), false);
    assert.equal(sameFingerprint(hash, "zzzz"), false);
    assert.equal(sameFingerprint(hash, undefined as unknown as string), false);
  });
});

describe("AuthCache", () => {
  test("remembers a verified pair and forgets it after the window", () => {
    process.env.REPLIZ_AUTH_CACHE_MINUTES = "5";
    const cache = new AuthCache();
    const t0 = 1_000_000;
    cache.add("abc", t0);
    assert.equal(cache.has("abc", t0 + 60_000), true);
    assert.equal(cache.has("abc", t0 + 5 * 60_000), false, "expires exactly at the boundary");
  });

  test("never claims to know an unseen pair", () => {
    assert.equal(new AuthCache().has("never-added"), false);
  });

  test("sweep releases expired entries", () => {
    process.env.REPLIZ_AUTH_CACHE_MINUTES = "1";
    const cache = new AuthCache();
    cache.add("a", 0);
    cache.add("b", 0);
    assert.equal(cache.size, 2);
    cache.sweep(60_001);
    assert.equal(cache.size, 0);
  });
});

describe("RateLimiter", () => {
  test("allows up to the limit, then refuses within the window", () => {
    process.env.REPLIZ_RATE_LIMIT_PER_MINUTE = "3";
    const limiter = new RateLimiter();
    const t0 = 500_000;
    assert.equal(limiter.take("ip", t0), true);
    assert.equal(limiter.take("ip", t0), true);
    assert.equal(limiter.take("ip", t0), true);
    assert.equal(limiter.take("ip", t0), false, "fourth call in the same minute");
  });

  test("starts a fresh window after a minute", () => {
    process.env.REPLIZ_RATE_LIMIT_PER_MINUTE = "1";
    const limiter = new RateLimiter();
    assert.equal(limiter.take("ip", 0), true);
    assert.equal(limiter.take("ip", 30_000), false);
    assert.equal(limiter.take("ip", 60_000), true);
  });

  test("counts each key separately", () => {
    process.env.REPLIZ_RATE_LIMIT_PER_MINUTE = "1";
    const limiter = new RateLimiter();
    assert.equal(limiter.take("a", 0), true);
    assert.equal(limiter.take("b", 0), true, "b must not inherit a's budget");
    assert.equal(limiter.take("a", 0), false);
  });

  test("sweep releases stale windows", () => {
    const limiter = new RateLimiter();
    limiter.take("a", 0);
    assert.equal(limiter.size, 1);
    limiter.sweep(60_001);
    assert.equal(limiter.size, 0);
  });
});

describe("SessionStore", () => {
  const hashA = fingerprint({ accessKey: "A", secretKey: "a" });
  const hashB = fingerprint({ accessKey: "B", secretKey: "b" });

  test("keeps each session's credential fingerprint", () => {
    const store = new SessionStore();
    store.add("s1", new FakeTransport(), hashA);
    store.add("s2", new FakeTransport(), hashB);
    assert.equal(store.get("s1")!.credentialHash, hashA);
    assert.equal(store.get("s2")!.credentialHash, hashB);
    assert.notEqual(store.get("s1")!.credentialHash, store.get("s2")!.credentialHash);
  });

  test("drop closes the transport and frees the slot", () => {
    const store = new SessionStore();
    const transport = new FakeTransport();
    store.add("s1", transport, hashA);
    store.drop("s1", "test");
    assert.equal(transport.closed, true);
    assert.equal(store.size, 0);
    assert.equal(store.get("s1"), undefined);
  });

  test("forget releases the slot without double-closing", () => {
    const store = new SessionStore();
    const transport = new FakeTransport();
    store.add("s1", transport, hashA);
    store.forget("s1");
    assert.equal(store.size, 0);
    assert.equal(transport.closed, false, "the transport closed itself; we only drop the entry");
  });

  test("sweepIdle reclaims sessions abandoned without a DELETE", () => {
    process.env.REPLIZ_SESSION_IDLE_MINUTES = "30";
    const store = new SessionStore();
    const stale = new FakeTransport();
    const fresh = new FakeTransport();
    const now = 10_000_000;
    store.add("stale", stale, hashA, now - 31 * 60_000);
    store.add("fresh", fresh, hashB, now - 60_000);

    assert.equal(store.sweepIdle(now), 1);
    assert.equal(stale.closed, true);
    assert.equal(fresh.closed, false);
    assert.equal(store.size, 1);
  });

  test("touch keeps an active session from being swept", () => {
    process.env.REPLIZ_SESSION_IDLE_MINUTES = "30";
    const store = new SessionStore();
    const now = 10_000_000;
    store.add("s1", new FakeTransport(), hashA, now - 31 * 60_000);
    store.touch("s1", now);
    assert.equal(store.sweepIdle(now), 0);
    assert.equal(store.size, 1);
  });

  test("atCapacity follows REPLIZ_MAX_SESSIONS", () => {
    process.env.REPLIZ_MAX_SESSIONS = "2";
    const store = new SessionStore();
    assert.equal(store.atCapacity(), false);
    store.add("a", new FakeTransport(), hashA);
    store.add("b", new FakeTransport(), hashB);
    assert.equal(store.atCapacity(), true);
  });

  test("makeRoom refuses while every session is genuinely active", () => {
    process.env.REPLIZ_MAX_SESSIONS = "2";
    process.env.REPLIZ_SESSION_IDLE_MINUTES = "30";
    const store = new SessionStore();
    const now = 10_000_000;
    store.add("a", new FakeTransport(), hashA, now);
    store.add("b", new FakeTransport(), hashB, now);
    assert.equal(store.makeRoom(now), false, "must not cut off a user mid-conversation");
    assert.equal(store.size, 2);
  });

  test("makeRoom evicts the least recently used session once it is past the grace period", () => {
    process.env.REPLIZ_MAX_SESSIONS = "2";
    process.env.REPLIZ_SESSION_IDLE_MINUTES = "30";
    const store = new SessionStore();
    const now = 10_000_000;
    const oldest = new FakeTransport();
    const newer = new FakeTransport();
    store.add("oldest", oldest, hashA, now - EVICTION_GRACE_MS - 1_000);
    store.add("newer", newer, hashB, now - 1_000);

    assert.equal(store.makeRoom(now), true);
    assert.equal(oldest.closed, true, "the quietest session goes first");
    assert.equal(newer.closed, false);
    assert.equal(store.size, 1);
  });

  test("closeAll empties the store on shutdown", () => {
    const store = new SessionStore();
    const a = new FakeTransport();
    const b = new FakeTransport();
    store.add("a", a, hashA);
    store.add("b", b, hashB);
    store.closeAll("shutdown");
    assert.equal(a.closed && b.closed, true);
    assert.equal(store.size, 0);
  });

  test("reports closures to the observer with the remaining count", () => {
    const seen: Array<[string, string, number]> = [];
    const store = new SessionStore((id, reason, live) => seen.push([id, reason, live]));
    store.add("a", new FakeTransport(), hashA);
    store.add("b", new FakeTransport(), hashB);
    store.drop("a", "idle timeout");
    assert.deepEqual(seen, [["a", "idle timeout", 1]]);
  });
});
