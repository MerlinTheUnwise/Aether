import { describe, it, expect, beforeEach } from "vitest";
import { AetherMLService, sentimentModel, moderationModel, recommendationModel } from "../../src/implementations/services/ml.js";

describe("AetherMLService", () => {
  let ml: AetherMLService;

  beforeEach(() => {
    ml = new AetherMLService();
    ml.registerModel("sentiment", sentimentModel);
    ml.registerModel("moderation", moderationModel);
    ml.registerModel("recommendation", recommendationModel);
  });

  // ── Sentiment ─────────────────────────────────────────────────────────────

  it("sentiment classifier: positive text → 'positive' with high confidence", async () => {
    const result = await ml.classify("sentiment", { text: "This is an amazing product!" });
    expect(result.label).toBe("positive");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("sentiment classifier: negative text → 'negative'", async () => {
    const result = await ml.classify("sentiment", { text: "This is terrible and horrible" });
    expect(result.label).toBe("negative");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("sentiment classifier: ambiguous text → default with low confidence", async () => {
    const result = await ml.classify("sentiment", { text: "I went to the store" });
    expect(result.label).toBe("neutral");
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("sentiment classifier: neutral text → 'neutral'", async () => {
    const result = await ml.classify("sentiment", { text: "It was okay and fine" });
    expect(result.label).toBe("neutral");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  // ── Moderation ────────────────────────────────────────────────────────────

  it("content moderation: harmful text flagged", async () => {
    const result = await ml.classify("moderation", { text: "This contains spam content" });
    expect(result.label).toBe("spam");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("content moderation: safe text passes", async () => {
    const result = await ml.classify("moderation", { text: "Hello world, nice day" });
    expect(result.label).toBe("safe");
  });

  it("content moderation: threat detected", async () => {
    const result = await ml.classify("moderation", { text: "threat of violence" });
    expect(result.label).toBe("harmful");
  });

  // ── Recommendation ────────────────────────────────────────────────────────

  it("recommendation scorer: matching input → high score", async () => {
    const result = await ml.predict("recommendation", { category_match: true });
    expect(result.value).toBeGreaterThan(0.7);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("recommendation scorer: no match → low score", async () => {
    const result = await ml.predict("recommendation", { category_match: false, price_in_range: false });
    expect(result.value).toBeLessThan(0.5);
    expect(result.confidence).toBeLessThan(0.7);
  });

  // ── Confidence values ─────────────────────────────────────────────────────

  it("confidence values are within 0.0–1.0", async () => {
    const tests = [
      ml.classify("sentiment", { text: "great" }),
      ml.classify("sentiment", { text: "terrible" }),
      ml.classify("sentiment", { text: "random" }),
      ml.classify("moderation", { text: "spam" }),
      ml.classify("moderation", { text: "hello" }),
      ml.predict("recommendation", { category_match: true }),
      ml.predict("recommendation", {}),
    ];

    const results = await Promise.all(tests);
    for (const r of results) {
      expect(r.confidence).toBeGreaterThanOrEqual(0.0);
      expect(r.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("unknown model throws", async () => {
    await expect(ml.classify("unknown", {})).rejects.toThrow(/not found/i);
  });

  it("classify on regressor throws", async () => {
    await expect(ml.classify("recommendation", {})).rejects.toThrow(/not a classifier/i);
  });

  it("predict on classifier throws", async () => {
    await expect(ml.predict("sentiment", {})).rejects.toThrow(/not a regressor/i);
  });

  it("hasModel returns correct status", () => {
    expect(ml.hasModel("sentiment")).toBe(true);
    expect(ml.hasModel("nonexistent")).toBe(false);
  });

  it("alternatives returned for multi-match", async () => {
    // Text that matches both positive and neutral
    const result = await ml.classify("sentiment", { text: "It was great but okay overall" });
    // Should have primary + at least one alternative
    expect(result.label).toBeTruthy();
    expect(result.alternatives.length).toBeGreaterThanOrEqual(1);
  });
});
