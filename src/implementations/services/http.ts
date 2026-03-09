/**
 * AETHER Service — HTTP
 *
 * Simulated HTTP request/response handling with real routing,
 * status codes, response bodies, and failure injection.
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface HTTPRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: any;
}

export interface HTTPResponse {
  status: number;
  headers: Record<string, string>;
  body: any;
}

export type RouteHandler = (req: HTTPRequest) => Promise<HTTPResponse>;

export type Middleware = (req: HTTPRequest, next: () => Promise<HTTPResponse>) => Promise<HTTPResponse>;

interface HTTPFailureConfig {
  status: number;
  probability: number;
  path?: string;
}

// ─── HTTP Service ───────────────────────────────────────────────────────────────

export class AetherHTTPService {
  private routes: Map<string, RouteHandler> = new Map();
  private middlewareStack: Middleware[] = [];
  private requestLog: HTTPRequest[] = [];
  private failures: HTTPFailureConfig[] = [];

  constructor() {}

  registerRoute(method: string, path: string, handler: RouteHandler): void {
    this.routes.set(`${method.toUpperCase()} ${path}`, handler);
  }

  addMiddleware(mw: Middleware): void {
    this.middlewareStack.push(mw);
  }

  async request(req: HTTPRequest): Promise<HTTPResponse> {
    this.requestLog.push({ ...req });

    // Check failure injection
    for (const fc of this.failures) {
      if (fc.path && fc.path !== req.path) continue;
      if (Math.random() < fc.probability) {
        return { status: fc.status, headers: {}, body: { error: `Injected failure: ${fc.status}` } };
      }
    }

    const key = `${req.method.toUpperCase()} ${req.path}`;
    const handler = this.routes.get(key);

    if (!handler) {
      return { status: 404, headers: {}, body: { error: `No route for ${key}` } };
    }

    // Apply middleware chain
    const execute = async (): Promise<HTTPResponse> => handler(req);

    let chain = execute;
    for (let i = this.middlewareStack.length - 1; i >= 0; i--) {
      const mw = this.middlewareStack[i];
      const next = chain;
      chain = () => mw(req, next);
    }

    return chain();
  }

  getLog(): HTTPRequest[] {
    return [...this.requestLog];
  }

  clearLog(): void {
    this.requestLog = [];
  }

  injectFailure(config: HTTPFailureConfig): void {
    this.failures.push(config);
  }

  clearFailures(): void {
    this.failures = [];
  }
}
