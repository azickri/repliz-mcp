/**
 * Guards that keep a shared host from being used as a proxy into places it
 * should not reach. A regression here silently reopens an SSRF hole, so the
 * awkward cases are pinned deliberately.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  assertAllowedUploadUrl,
  assertPublicUrl,
  isPrivateAddress,
  uploadHostAllowlist,
} from "../src/net.js";

describe("isPrivateAddress", () => {
  const privateV4 = [
    "127.0.0.1", // loopback
    "0.0.0.0",
    "10.1.2.3", // RFC1918
    "172.16.0.1", // RFC1918 lower bound
    "172.31.255.255", // RFC1918 upper bound
    "192.168.1.1",
    "169.254.169.254", // cloud metadata — the one that matters most
    "100.64.0.1", // CGNAT
    "224.0.0.1", // multicast
  ];
  for (const ip of privateV4) {
    test(`rejects ${ip}`, () => assert.equal(isPrivateAddress(ip), true));
  }

  const publicV4 = ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.255.255", "93.184.216.34"];
  for (const ip of publicV4) {
    test(`allows ${ip}`, () => assert.equal(isPrivateAddress(ip), false));
  }

  test("handles IPv6 loopback, link-local and unique-local", () => {
    assert.equal(isPrivateAddress("::1"), true);
    assert.equal(isPrivateAddress("::"), true);
    assert.equal(isPrivateAddress("fe80::1"), true);
    assert.equal(isPrivateAddress("fc00::1"), true);
    assert.equal(isPrivateAddress("fd12:3456::1"), true);
    assert.equal(isPrivateAddress("ff02::1"), true);
    assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
  });

  test("sees through IPv4-mapped IPv6, which would otherwise smuggle a private address", () => {
    assert.equal(isPrivateAddress("::ffff:169.254.169.254"), true);
    assert.equal(isPrivateAddress("::ffff:10.0.0.1"), true);
    assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
  });

  test("treats anything that is not an IP literal as unsafe", () => {
    assert.equal(isPrivateAddress("not-an-ip"), true);
    assert.equal(isPrivateAddress(""), true);
  });
});

describe("assertAllowedUploadUrl", () => {
  const presigned =
    "https://repliz.abc123.r2.cloudflarestorage.com/uploads/x/y.mp4?X-Amz-Signature=deadbeef";

  test("accepts a Repliz R2 presigned URL", () => {
    assert.equal(assertAllowedUploadUrl(presigned).hostname, "repliz.abc123.r2.cloudflarestorage.com");
  });

  test("accepts the Repliz storage host", () => {
    assert.doesNotThrow(() => assertAllowedUploadUrl("https://storage.repliz.com/uploads/a.mp4"));
  });

  test("refuses an unrelated host", () => {
    assert.throws(
      () => assertAllowedUploadUrl("https://evil.example.com/collect"),
      /not a Repliz storage host/
    );
  });

  test("refuses a lookalike that merely contains the allowed host", () => {
    assert.throws(
      () => assertAllowedUploadUrl("https://r2.cloudflarestorage.com.evil.example/x"),
      /not a Repliz storage host/
    );
  });

  test("refuses plaintext http even on an allowed host", () => {
    assert.throws(
      () => assertAllowedUploadUrl("http://storage.repliz.com/uploads/a.mp4"),
      /must use https/
    );
  });

  test("refuses a malformed URL", () => {
    assert.throws(() => assertAllowedUploadUrl("not a url"), /not a valid URL/);
  });

  test("allowlist can be overridden for a self-hosted Repliz", (t) => {
    t.after(() => {
      delete process.env.REPLIZ_UPLOAD_HOSTS;
    });
    process.env.REPLIZ_UPLOAD_HOSTS = "files.example.com";
    assert.deepEqual(uploadHostAllowlist(), ["files.example.com"]);
    assert.doesNotThrow(() => assertAllowedUploadUrl("https://files.example.com/a.mp4"));
    assert.throws(() => assertAllowedUploadUrl(presigned), /not a Repliz storage host/);
  });
});

describe("assertPublicUrl", () => {
  test("refuses a literal private address without needing DNS", async () => {
    await assert.rejects(
      assertPublicUrl("http://169.254.169.254/latest/meta-data/", "sourceUrl"),
      /private address/
    );
    await assert.rejects(assertPublicUrl("http://127.0.0.1:8080/x"), /private address/);
    await assert.rejects(assertPublicUrl("http://[::1]/x"), /private address/);
  });

  test("refuses a non-http scheme", async () => {
    await assert.rejects(assertPublicUrl("file:///etc/passwd"), /must use http or https/);
    await assert.rejects(assertPublicUrl("gopher://example.com/"), /must use http or https/);
  });

  test("refuses a host that cannot be resolved", async () => {
    await assert.rejects(
      assertPublicUrl("https://this-host-should-not-exist.invalid/x"),
      /Cannot resolve/
    );
  });

  test("accepts a public literal address", async () => {
    const url = await assertPublicUrl("https://8.8.8.8/file.mp4");
    assert.equal(url.hostname, "8.8.8.8");
  });
});
