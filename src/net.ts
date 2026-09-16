/**
 * Network safety helpers for remote (hosted) mode.
 *
 * When this server runs on a VPS for many users, any URL a tool is asked to
 * fetch or write to is attacker-controlled input. Two guards live here:
 *
 *   - isAllowedUploadHost(): the presigned PUT target must belong to Repliz's
 *     storage backend, so a caller cannot make the server ship bytes to a host
 *     they control.
 *   - assertPublicUrl(): a URL the server will fetch must resolve to a public
 *     address, so a caller cannot reach the VPS's own loopback, the private
 *     LAN, or a cloud metadata endpoint (SSRF).
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Hosts allowed as presigned-upload targets. Suffix match on the hostname. */
const DEFAULT_UPLOAD_HOSTS = ["r2.cloudflarestorage.com", "storage.repliz.com"];

/**
 * Upload-host allowlist, overridable with REPLIZ_UPLOAD_HOSTS (comma-separated)
 * for self-hosted Repliz deployments using different storage.
 */
export function uploadHostAllowlist(): string[] {
  const raw = process.env.REPLIZ_UPLOAD_HOSTS?.trim();
  if (!raw) return DEFAULT_UPLOAD_HOSTS;
  const hosts = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : DEFAULT_UPLOAD_HOSTS;
}

/** True if `hostname` equals or is a subdomain of an allowlisted host. */
function hostMatches(hostname: string, allowed: string): boolean {
  return hostname === allowed || hostname.endsWith(`.${allowed}`);
}

/**
 * Validate a presigned upload URL. Throws with an explanatory message rather
 * than returning false, so the model relays a useful error to the user.
 */
export function assertAllowedUploadUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid uploadUrl: not a valid URL.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Invalid uploadUrl: must use https, got '${url.protocol}'.`);
  }

  const allowlist = uploadHostAllowlist();
  const hostname = url.hostname.toLowerCase();
  if (!allowlist.some((allowed) => hostMatches(hostname, allowed))) {
    throw new Error(
      `Refusing to upload to '${hostname}': not a Repliz storage host. ` +
        `Pass the 'upload' field returned by repliz_init_file unmodified. ` +
        `Allowed hosts: ${allowlist.join(", ")}.`
    );
  }
  return url;
}

/**
 * True for addresses that must never be reachable from a hosted server:
 * loopback, RFC1918 / CGNAT / link-local (incl. 169.254.169.254 metadata),
 * and their IPv6 equivalents.
 */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (version === 6) {
    const addr = ip.toLowerCase().split("%")[0];
    if (addr === "::" || addr === "::1") return true;
    if (addr.startsWith("fe80")) return true; // link-local
    if (/^f[cd]/.test(addr)) return true; // unique local
    if (addr.startsWith("ff")) return true; // multicast
    // IPv4-mapped (::ffff:10.0.0.1) — re-check the embedded IPv4.
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  return true; // not an IP literal at all — treat as unsafe
}

/**
 * Resolve `rawUrl` and throw unless it is an http(s) URL pointing at a public
 * address. Returns the parsed URL and the resolved IP.
 *
 * Note: this checks the address at validation time. A hostile DNS entry could
 * in principle return a different address on the subsequent fetch (a DNS
 * rebinding race); the allowlisted upload target and the absence of any
 * response body relay make that a poor exfiltration primitive here.
 */
export async function assertPublicUrl(rawUrl: string, label = "URL"): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid ${label}: not a valid URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Invalid ${label}: must use http or https, got '${url.protocol}'.`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`Refusing to fetch ${label} at private address '${hostname}'.`);
    }
    return url;
  }

  let resolved: { address: string };
  try {
    resolved = await lookup(hostname);
  } catch {
    throw new Error(`Cannot resolve ${label} host '${hostname}'.`);
  }
  if (isPrivateAddress(resolved.address)) {
    throw new Error(
      `Refusing to fetch ${label}: host '${hostname}' resolves to the private address '${resolved.address}'.`
    );
  }
  return url;
}
