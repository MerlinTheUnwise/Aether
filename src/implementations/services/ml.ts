/**
 * AETHER Service — ML Classification
 *
 * Rule-based classifier producing deterministic, meaningful classifications
 * with realistic confidence scores. Not random — uses configurable rules.
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface MLModel {
  type: "classifier" | "regressor";
  rules: Array<{
    condition: (input: any) => boolean;
    output: { label?: string; value?: number; confidence: number };
  }>;
  default_output: { label?: string; value?: number; confidence: number };
}

// ─── ML Service ─────────────────────────────────────────────────────────────────

export class AetherMLService {
  private models: Map<string, MLModel> = new Map();

  constructor() {}

  registerModel(name: string, model: MLModel): void {
    this.models.set(name, model);
  }

  async classify(model: string, input: any): Promise<{
    label: string;
    confidence: number;
    alternatives: Array<{ label: string; confidence: number }>;
  }> {
    const m = this.models.get(model);
    if (!m) throw new Error(`Model not found: ${model}`);
    if (m.type !== "classifier") throw new Error(`Model "${model}" is not a classifier`);

    // Evaluate all rules, collect matches
    const matches: Array<{ label: string; confidence: number }> = [];
    for (const rule of m.rules) {
      if (rule.condition(input)) {
        matches.push({ label: rule.output.label!, confidence: rule.output.confidence });
      }
    }

    if (matches.length === 0) {
      return {
        label: m.default_output.label!,
        confidence: m.default_output.confidence,
        alternatives: [],
      };
    }

    // Best match is highest confidence
    matches.sort((a, b) => b.confidence - a.confidence);
    return {
      label: matches[0].label,
      confidence: matches[0].confidence,
      alternatives: matches.slice(1),
    };
  }

  async predict(model: string, input: any): Promise<{
    value: number;
    confidence: number;
  }> {
    const m = this.models.get(model);
    if (!m) throw new Error(`Model not found: ${model}`);
    if (m.type !== "regressor") throw new Error(`Model "${model}" is not a regressor`);

    for (const rule of m.rules) {
      if (rule.condition(input)) {
        return { value: rule.output.value!, confidence: rule.output.confidence };
      }
    }

    return { value: m.default_output.value!, confidence: m.default_output.confidence };
  }

  hasModel(name: string): boolean {
    return this.models.has(name);
  }
}

// ─── Pre-Built Models ───────────────────────────────────────────────────────────

export const sentimentModel: MLModel = {
  type: "classifier",
  rules: [
    {
      condition: (input) => /\b(great|excellent|love|amazing|wonderful)\b/i.test(input.text),
      output: { label: "positive", confidence: 0.92 },
    },
    {
      condition: (input) => /\b(terrible|horrible|hate|awful|disgusting)\b/i.test(input.text),
      output: { label: "negative", confidence: 0.89 },
    },
    {
      condition: (input) => /\b(okay|fine|average|mediocre)\b/i.test(input.text),
      output: { label: "neutral", confidence: 0.75 },
    },
  ],
  default_output: { label: "neutral", confidence: 0.55 },
};

export const moderationModel: MLModel = {
  type: "classifier",
  rules: [
    {
      condition: (input) => /\b(spam|scam|phishing)\b/i.test(input.text),
      output: { label: "spam", confidence: 0.95 },
    },
    {
      condition: (input) => /\b(threat|violence|harm)\b/i.test(input.text),
      output: { label: "harmful", confidence: 0.88 },
    },
  ],
  default_output: { label: "safe", confidence: 0.82 },
};

export const recommendationModel: MLModel = {
  type: "regressor",
  rules: [
    {
      condition: (input) => input.category_match === true,
      output: { value: 0.85, confidence: 0.80 },
    },
    {
      condition: (input) => input.price_in_range === true,
      output: { value: 0.70, confidence: 0.75 },
    },
  ],
  default_output: { value: 0.30, confidence: 0.60 },
};
