#!/usr/bin/env node
/**
 * Repliz MCP server — entry point.
 *
 * Exposes the Repliz Public API as Model Context Protocol tools over a remote
 * Streamable HTTP endpoint. Users connect by URL and send their own Repliz
 * Access Key and Secret Key; the server keeps no credentials of its own.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runHttp } from "./http.js";

// Load a local .env if present, so settings need not be exported by hand. Uses
// Node's built-in loader, so no dependency. Real environment variables always
// win, and loadEnvFile does not overwrite already-loaded values, so the current
// working directory takes priority over the package directory.
function tryLoadEnv(path?: string): void {
  try {
    path ? process.loadEnvFile(path) : process.loadEnvFile();
  } catch {
    // Nothing there (or unsupported Node) — try the next source.
  }
}

tryLoadEnv(); // 1) .env in the current working directory
try {
  // 2) .env next to the package, so `pm2 start dist/index.js` works from anywhere.
  tryLoadEnv(join(dirname(fileURLToPath(import.meta.url)), "..", ".env"));
} catch {
  /* ignore */
}

runHttp().catch((err) => {
  console.error("Fatal error starting the Repliz MCP server:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
