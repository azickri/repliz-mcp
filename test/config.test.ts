/**
 * Credential parsing is the front door of this server, and the tunables decide
 * how much memory a stranger can make it hold. Both are pinned here.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  allowedOrigins,
  credentialsFromHeaders,
  getBaseUrl,
  maxSessions,
  maxUploadBytes,
  port,
  rateLimitPerMinute,
  sessionIdleMs,
  trustProxySetting,
} from "../src/config.js";

const ENV_KEYS = [
  "REPLIZ_BASE_URL",
  "REPLIZ_MAX_SESSIONS",
  "REPLIZ_SESSION_IDLE_MINUTES",
  "REPLIZ_RATE_LIMIT_PER_MINUTE",
  "REPLIZ_MAX_UPLOAD_MB",
  "REPLIZ_ALLOWED_ORIGINS",
  "REPLIZ_TRUST_PROXY",
  "PORT",
];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("credentialsFromHeaders", () => {
  test("reads an Authorization: Basic header", () => {
    assert.deepEqual(credentialsFromHeaders({ authorization: basic("key", "secret") }), {
      accessKey: "key",
      secretKey: "secret",
    });
  });

  test("accepts any capitalisation of the Basic scheme", () => {
    assert.deepEqual(credentialsFromHeaders({ authorization: basic("k", "s").replace("Basic", "BASIC") }), {
      accessKey: "k",
      secretKey: "s",
    });
  });

  test("keeps colons that belong to the secret", () => {
    // Only the first colon separates the pair; the rest is part of the secret.
    assert.deepEqual(credentialsFromHeaders({ authorization: basic("key", "a:b:c") }), {
      accessKey: "key",
      secretKey: "a:b:c",
    });
  });

  test("reads the explicit X-Repliz headers", () => {
    assert.deepEqual(
      credentialsFromHeaders({
        "x-repliz-access-key": "  key  ",
        "x-repliz-secret-key": "  secret  ",
      }),
      { accessKey: "key", secretKey: "secret" }
    );
  });

  test("prefers Authorization when both forms are present", () => {
    const creds = credentialsFromHeaders({
      authorization: basic("from-auth", "s1"),
      "x-repliz-access-key": "from-header",
      "x-repliz-secret-key": "s2",
    });
    assert.equal(creds?.accessKey, "from-auth");
  });

  test("falls back to the X-Repliz pair when Authorization is not Basic", () => {
    assert.deepEqual(
      credentialsFromHeaders({
        authorization: "Bearer sometoken",
        "x-repliz-access-key": "key",
        "x-repliz-secret-key": "secret",
      }),
      { accessKey: "key", secretKey: "secret" }
    );
  });

  test("takes the first value when a header is repeated", () => {
    assert.deepEqual(
      credentialsFromHeaders({
        "x-repliz-access-key": ["key", "other"],
        "x-repliz-secret-key": ["secret", "other"],
      }),
      { accessKey: "key", secretKey: "secret" }
    );
  });

  const rejected: Array<[string, Record<string, string | string[] | undefined>]> = [
    ["no headers at all", {}],
    ["only an access key", { "x-repliz-access-key": "key" }],
    ["only a secret key", { "x-repliz-secret-key": "secret" }],
    ["blank values", { "x-repliz-access-key": "   ", "x-repliz-secret-key": "   " }],
    ["Bearer token alone", { authorization: "Bearer abc" }],
    ["Basic with no colon", { authorization: `Basic ${Buffer.from("nocolon").toString("base64")}` }],
    ["Basic with an empty user", { authorization: `Basic ${Buffer.from(":secret").toString("base64")}` }],
    ["Basic with an empty secret", { authorization: `Basic ${Buffer.from("key:").toString("base64")}` }],
    ["Basic with undecodable payload", { authorization: "Basic !!!not-base64!!!" }],
  ];
  for (const [name, headers] of rejected) {
    test(`returns null for ${name}`, () => assert.equal(credentialsFromHeaders(headers), null));
  }
});

describe("getBaseUrl", () => {
  test("defaults to the Repliz production API", () => {
    assert.equal(getBaseUrl(), "https://api.repliz.com");
  });

  test("honours an override and strips trailing slashes", () => {
    process.env.REPLIZ_BASE_URL = "https://staging.example.com///";
    assert.equal(getBaseUrl(), "https://staging.example.com");
  });
});

describe("tunables", () => {
  test("use their documented defaults when unset", () => {
    assert.equal(port(), 3000);
    assert.equal(maxSessions(), 300);
    assert.equal(sessionIdleMs(), 30 * 60_000);
    assert.equal(rateLimitPerMinute(), 120);
    assert.equal(maxUploadBytes(), 100 * 1024 * 1024);
    assert.deepEqual(allowedOrigins(), []);
  });

  test("read valid overrides", () => {
    process.env.REPLIZ_MAX_SESSIONS = "1000";
    process.env.REPLIZ_SESSION_IDLE_MINUTES = "5";
    assert.equal(maxSessions(), 1000);
    assert.equal(sessionIdleMs(), 5 * 60_000);
  });

  test("ignore nonsense rather than starting with a broken limit", () => {
    // A typo must not disable the cap that bounds memory.
    for (const bad of ["abc", "-1", "0", "", "   ", "NaN"]) {
      process.env.REPLIZ_MAX_SESSIONS = bad;
      assert.equal(maxSessions(), 300, `"${bad}" should fall back to the default`);
    }
  });

  test("truncate a fractional value instead of rejecting it", () => {
    process.env.REPLIZ_MAX_SESSIONS = "10.9";
    assert.equal(maxSessions(), 10);
  });
});

describe("allowedOrigins", () => {
  test("splits and trims a comma-separated list", () => {
    process.env.REPLIZ_ALLOWED_ORIGINS = " https://claude.ai , https://chatgpt.com ";
    assert.deepEqual(allowedOrigins(), ["https://claude.ai", "https://chatgpt.com"]);
  });

  test("drops empty entries", () => {
    process.env.REPLIZ_ALLOWED_ORIGINS = "https://a.com,,";
    assert.deepEqual(allowedOrigins(), ["https://a.com"]);
  });
});

describe("trustProxySetting", () => {
  test("defaults to loopback, which suits Nginx on the same host", () => {
    assert.equal(trustProxySetting(), "loopback");
  });

  test("understands booleans, hop counts and subnet lists", () => {
    process.env.REPLIZ_TRUST_PROXY = "true";
    assert.equal(trustProxySetting(), true);
    process.env.REPLIZ_TRUST_PROXY = "FALSE";
    assert.equal(trustProxySetting(), false);
    process.env.REPLIZ_TRUST_PROXY = "2";
    assert.equal(trustProxySetting(), 2);
    process.env.REPLIZ_TRUST_PROXY = "10.0.0.0/8";
    assert.equal(trustProxySetting(), "10.0.0.0/8");
  });
});
