/**
 * Thin HTTP client for the Repliz Public API.
 *
 * Handles Basic Auth, query-string building (including repeated params for
 * arrays), JSON bodies, and turning non-2xx responses into descriptive errors.
 */

import { requestTimeoutMs, type ReplizConfig } from "./config.js";

export type QueryValue = string | number | boolean | Array<string | number> | undefined | null;
export type QueryParams = Record<string, QueryValue>;

export class ReplizApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, method: string, path: string) {
    const detail =
      typeof body === "string"
        ? body
        : (body as { message?: unknown })?.message ?? JSON.stringify(body);
    super(`Repliz API ${method} ${path} failed with HTTP ${status}: ${detail}`);
    this.name = "ReplizApiError";
    this.status = status;
    this.body = body;
  }
}

export class ReplizClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: ReplizConfig) {
    this.baseUrl = config.baseUrl;
    const token = Buffer.from(`${config.accessKey}:${config.secretKey}`).toString("base64");
    this.authHeader = `Basic ${token}`;
  }

  private buildUrl(path: string, query?: QueryParams): string {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          // Repeat the param for each array item (OpenAPI form/explode style):
          //   ?types=facebook&types=instagram
          for (const item of value) {
            if (item === undefined || item === null) continue;
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    opts: { query?: QueryParams; body?: unknown } = {}
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };

    let bodyInit: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyInit = JSON.stringify(opts.body);
    }

    // Bound every outbound call: without a timeout a stalled Repliz request
    // pins the caller's session (and its memory) open indefinitely.
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: bodyInit,
        signal: AbortSignal.timeout(requestTimeoutMs()),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error(
          `Repliz API ${method} ${path} timed out after ${requestTimeoutMs() / 1000}s.`
        );
      }
      throw err;
    }

    const text = await response.text();
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      throw new ReplizApiError(response.status, parsed, method, path);
    }

    return parsed as T;
  }

  get<T = unknown>(path: string, query?: QueryParams): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  post<T = unknown>(path: string, body?: unknown, query?: QueryParams): Promise<T> {
    return this.request<T>("POST", path, { body, query });
  }

  put<T = unknown>(path: string, body?: unknown, query?: QueryParams): Promise<T> {
    return this.request<T>("PUT", path, { body, query });
  }

  delete<T = unknown>(path: string, query?: QueryParams, body?: unknown): Promise<T> {
    return this.request<T>("DELETE", path, { query, body });
  }

  /**
   * Check that these credentials are actually valid, using the cheapest
   * authenticated endpoint in the API (no parameters, small response).
   * Returns false only for an auth rejection; other failures throw, so a
   * Repliz outage surfaces as 503 rather than being reported as bad keys.
   */
  async verifyCredentials(): Promise<boolean> {
    try {
      await this.get("/public/account/count");
      return true;
    } catch (err) {
      if (err instanceof ReplizApiError && (err.status === 401 || err.status === 403)) {
        return false;
      }
      throw err;
    }
  }
}
