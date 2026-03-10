/**
 * AETHER Service — Real HTTP Adapter
 *
 * Uses Node.js native fetch for real HTTP requests.
 * Maps AETHER's HTTPRequest/HTTPResponse to fetch API.
 */

import type { HTTPAdapter } from "./adapter.js";
import type { HTTPRequest, HTTPResponse } from "./http.js";

export class RealHTTPAdapter implements HTTPAdapter {
  private baseUrl?: string;
  private defaultHeaders: Record<string, string>;
  private timeout_ms: number;

  constructor(config?: { baseUrl?: string; headers?: Record<string, string>; timeout_ms?: number }) {
    this.baseUrl = config?.baseUrl;
    this.defaultHeaders = config?.headers ?? {};
    this.timeout_ms = config?.timeout_ms ?? 30000;
  }

  async request(req: HTTPRequest): Promise<HTTPResponse> {
    const url = this.baseUrl ? `${this.baseUrl}${req.path}` : req.path;
    const headers = { ...this.defaultHeaders, ...req.headers };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout_ms);

    try {
      const fetchOptions: RequestInit = {
        method: req.method.toUpperCase(),
        headers,
        signal: controller.signal,
      };

      if (req.body !== undefined && req.method.toUpperCase() !== "GET") {
        fetchOptions.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        if (!headers["content-type"] && !headers["Content-Type"]) {
          (fetchOptions.headers as Record<string, string>)["Content-Type"] = "application/json";
        }
      }

      const response = await fetch(url, fetchOptions);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let body: any;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        body = await response.json();
      } else {
        body = await response.text();
      }

      return {
        status: response.status,
        headers: responseHeaders,
        body,
      };
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw Object.assign(new Error(`HTTP request timeout after ${this.timeout_ms}ms: ${req.method} ${url}`), { type: "timeout" });
      }
      if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
        throw Object.assign(new Error(`Connection refused: ${url}`), { type: "network_error" });
      }
      if (err.cause?.code === "ENOTFOUND" || err.message?.includes("ENOTFOUND")) {
        throw Object.assign(new Error(`DNS lookup failed: ${url}`), { type: "network_error" });
      }
      throw Object.assign(new Error(`HTTP request failed: ${err.message}`), { type: "network_error" });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
