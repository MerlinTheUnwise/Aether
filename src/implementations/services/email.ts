/**
 * AETHER Service — Email
 *
 * Captures emails in memory instead of sending them.
 * Real structure, real validation, real failure modes.
 */

import { randomUUID } from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface Email {
  to: string[];
  from: string;
  subject: string;
  body: string;
  html?: string;
  attachments?: Array<{ name: string; content: string }>;
  sent_at?: string;
}

interface EmailFailureConfig {
  probability: number;
  error: string;
}

// ─── Email Service ──────────────────────────────────────────────────────────────

export class AetherEmailService {
  private sent: Email[] = [];
  private failureConfig?: EmailFailureConfig;

  constructor() {}

  async send(email: Email): Promise<{ sent: boolean; id: string }> {
    // Validate
    if (!email.to || email.to.length === 0) {
      throw new Error("Email must have at least one recipient");
    }
    if (!email.from) {
      throw new Error("Email must have a sender");
    }
    if (!email.subject) {
      throw new Error("Email must have a subject");
    }

    // Check failure injection
    if (this.failureConfig && Math.random() < this.failureConfig.probability) {
      throw new Error(this.failureConfig.error);
    }

    const id = randomUUID();
    this.sent.push({
      ...email,
      sent_at: new Date().toISOString(),
    });

    return { sent: true, id };
  }

  getSent(): Email[] {
    return [...this.sent];
  }

  getLastSent(): Email | null {
    return this.sent.length > 0 ? this.sent[this.sent.length - 1] : null;
  }

  clear(): void {
    this.sent = [];
  }

  injectFailure(config: EmailFailureConfig): void {
    this.failureConfig = config;
  }

  clearFailures(): void {
    this.failureConfig = undefined;
  }
}
