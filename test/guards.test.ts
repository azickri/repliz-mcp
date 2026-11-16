/**
 * The bounds that keep a stateless endpoint cheap: credential fingerprints for
 * the auth cache, the rate limiters, and the cap on requests in flight.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AuthCache, InFlightLimiter, RateLimiter, fingerprint } from "../src/guards.js";

const ENV_KEYS = [
  "REPLIZ_MAX_CONCURRENT_REQUESTS",
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
    // and one pair could ride the other's cached verification.
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

describe("AuthCache", () => {
  test("remembers a verified pair and forgets it after the window", () => {
    process.env.REPLIZ_AUTH_CACHE_MINUTES = "5";
    const cache = new AuthCache();
    const t0 = 1_000_000;
    cache.add("abc", t0);
    assert.equal(cache.has("abc", t0 + 60_000), true);
    assert.equal(cache.has("abc", t0 + 5 * 60_000), false, "expires exactly at the boundary");
  });

  test("can hold entries for its own window, as the rejected-keys cache does", () => {
    process.env.REPLIZ_AUTH_CACHE_MINUTES = "5";
    const rejected = new AuthCache(() => 60_000);
    rejected.add("bad", 0);
    assert.equal(rejected.has("bad", 59_999), true);
    assert.equal(rejected.has("bad", 60_000), false, "ignores REPLIZ_AUTH_CACHE_MINUTES");
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

describe("InFlightLimiter", () => {
  test("admits up to REPLIZ_MAX_CONCURRENT_REQUESTS, then refuses", () => {
    process.env.REPLIZ_MAX_CONCURRENT_REQUESTS = "2";
    const limiter = new InFlightLimiter();
    assert.ok(limiter.acquire());
    assert.ok(limiter.acquire());
    assert.equal(limiter.acquire(), null, "a third request while two are in flight");
    assert.equal(limiter.size, 2);
  });

  test("a released slot admits the next request", () => {
    const limiter = new InFlightLimiter(() => 1);
    const release = limiter.acquire()!;
    assert.equal(limiter.acquire(), null);
    release();
    assert.equal(limiter.size, 0);
    assert.ok(limiter.acquire());
  });

  test("releasing twice gives back only one slot", () => {
    // A response can both finish and be torn down; the count must not go
    // negative and quietly raise the cap.
    const limiter = new InFlightLimiter(() => 2);
    const first = limiter.acquire()!;
    limiter.acquire();
    first();
    first();
    assert.equal(limiter.size, 1);
    assert.ok(limiter.acquire());
    assert.equal(limiter.acquire(), null, "still capped at two");
  });

  test("a refused request holds no slot", () => {
    const limiter = new InFlightLimiter(() => 1);
    limiter.acquire();
    limiter.acquire();
    limiter.acquire();
    assert.equal(limiter.size, 1);
  });
});

describe("RateLimiter with its own limit", () => {
  test("ignores the server-wide setting", () => {
    process.env.REPLIZ_RATE_LIMIT_PER_MINUTE = "100";
    const limiter = new RateLimiter(() => 1);
    assert.equal(limiter.take("ip", 0), true);
    assert.equal(limiter.take("ip", 0), false);
  });
});
