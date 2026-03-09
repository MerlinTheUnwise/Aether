import { describe, it, expect, beforeEach } from "vitest";
import { AetherEmailService } from "../../src/implementations/services/email.js";

describe("AetherEmailService", () => {
  let email: AetherEmailService;

  beforeEach(() => {
    email = new AetherEmailService();
  });

  it("send email → captured in sent list", async () => {
    const result = await email.send({
      to: ["user@example.com"],
      from: "noreply@aether.dev",
      subject: "Welcome",
      body: "Hello!",
    });

    expect(result.sent).toBe(true);
    expect(result.id).toBeTruthy();
    expect(email.getSent()).toHaveLength(1);
  });

  it("email has all required fields", async () => {
    await email.send({
      to: ["a@b.com", "c@d.com"],
      from: "sender@test.com",
      subject: "Test Subject",
      body: "Test body",
      html: "<p>Test</p>",
      attachments: [{ name: "file.txt", content: "data" }],
    });

    const sent = email.getLastSent()!;
    expect(sent.to).toEqual(["a@b.com", "c@d.com"]);
    expect(sent.from).toBe("sender@test.com");
    expect(sent.subject).toBe("Test Subject");
    expect(sent.body).toBe("Test body");
    expect(sent.html).toBe("<p>Test</p>");
    expect(sent.attachments).toHaveLength(1);
    expect(sent.sent_at).toBeTruthy();
  });

  it("getSent returns all sent emails", async () => {
    await email.send({ to: ["a@b.com"], from: "x@y.com", subject: "S1", body: "B1" });
    await email.send({ to: ["c@d.com"], from: "x@y.com", subject: "S2", body: "B2" });
    await email.send({ to: ["e@f.com"], from: "x@y.com", subject: "S3", body: "B3" });

    const sent = email.getSent();
    expect(sent).toHaveLength(3);
    expect(sent.map((e) => e.subject)).toEqual(["S1", "S2", "S3"]);
  });

  it("getLastSent returns null when no emails sent", () => {
    expect(email.getLastSent()).toBeNull();
  });

  it("failure injection → send fails with configured error", async () => {
    email.injectFailure({ probability: 1.0, error: "SMTP connection refused" });

    await expect(
      email.send({ to: ["a@b.com"], from: "x@y.com", subject: "S", body: "B" })
    ).rejects.toThrow("SMTP connection refused");

    expect(email.getSent()).toHaveLength(0);
  });

  it("validation: missing recipients throws", async () => {
    await expect(
      email.send({ to: [], from: "x@y.com", subject: "S", body: "B" })
    ).rejects.toThrow(/recipient/i);
  });

  it("validation: missing from throws", async () => {
    await expect(
      email.send({ to: ["a@b.com"], from: "", subject: "S", body: "B" })
    ).rejects.toThrow(/sender/i);
  });

  it("validation: missing subject throws", async () => {
    await expect(
      email.send({ to: ["a@b.com"], from: "x@y.com", subject: "", body: "B" })
    ).rejects.toThrow(/subject/i);
  });

  it("clearFailures restores normal operation", async () => {
    email.injectFailure({ probability: 1.0, error: "fail" });
    email.clearFailures();

    const result = await email.send({ to: ["a@b.com"], from: "x@y.com", subject: "S", body: "B" });
    expect(result.sent).toBe(true);
  });

  it("clear removes all sent emails", async () => {
    await email.send({ to: ["a@b.com"], from: "x@y.com", subject: "S", body: "B" });
    email.clear();
    expect(email.getSent()).toHaveLength(0);
  });
});
