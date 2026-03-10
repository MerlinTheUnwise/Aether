/**
 * AETHER Bug Detection Scenarios
 * Pre-built test scenarios designed to trigger bugs in LLM-generated code.
 * Each scenario describes a workflow that's subtly tricky — the kind of thing
 * where an LLM will generate plausible but wrong code.
 */

import type { BugType } from "./generate.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BugScenario {
  id: string;
  description: string;
  expectedBugTypes: BugType[];
  explanation: string;
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

export const scenarios: BugScenario[] = [
  {
    id: "recommender-overlap",
    description:
      "Build a product recommendation engine: authenticate the user, fetch their purchase history, then generate 10 recommendations. Recommendations should never include already-purchased items.",
    expectedBugTypes: ["missing_adversarial"],
    explanation:
      "LLMs frequently generate recommendation nodes without adversarial checks for the overlap condition. AETHER requires break_if: 'recommended ∩ purchases ≠ ∅' when confidence < 0.85.",
  },
  {
    id: "payment-no-recovery",
    description:
      "Build a payment flow: validate the card, authorize the charge, capture the funds, and send a receipt.",
    expectedBugTypes: ["missing_recovery"],
    explanation:
      "LLMs often forget recovery strategies on payment gateway calls. AETHER requires every effectful node to declare recovery.",
  },
  {
    id: "pii-leak",
    description:
      "Build a user profile API: load user data from the database (including email and phone number), format it for display, and return it as a public API response.",
    expectedBugTypes: ["sensitivity_violation"],
    explanation:
      "User data is PII. Flowing PII-annotated fields to a public-sensitivity response port is a sensitivity violation. LLMs almost never think about data sensitivity.",
  },
  {
    id: "currency-mismatch",
    description:
      "Build a currency converter: take a USD amount, look up the exchange rate, convert to EUR, and return the result.",
    expectedBugTypes: ["domain_mismatch", "type_mismatch"],
    explanation:
      "USD and EUR are different units in the same dimension. The type checker should flag unit mismatches unless explicit conversion is declared.",
  },
  {
    id: "state-machine-violation",
    description:
      "Build an order lifecycle: create order, process payment, ship it, deliver it. Allow cancellation at any point.",
    expectedBugTypes: ["state_violation"],
    explanation:
      "Allow cancellation at any point implies cancelled → shipped should be possible, but a proper state machine should forbid transitions from terminal states.",
  },
  {
    id: "overconfident-ml",
    description:
      "Build a content moderation pipeline: classify user content with an ML model, decide if it should be removed, and execute the removal.",
    expectedBugTypes: ["confidence_gap", "missing_adversarial"],
    explanation:
      "ML classification should have confidence < 1.0. If the LLM sets confidence at 0.95 or forgets to set it, AETHER won't require adversarial checks. If it's set honestly (< 0.85), adversarial checks are required.",
  },
  {
    id: "missing-effect-declaration",
    description:
      "Build a data sync pipeline: read from a source database, transform the records, and write to a destination database.",
    expectedBugTypes: ["effect_undeclared"],
    explanation:
      "Both read and write nodes need effect declarations. LLMs sometimes forget to declare effects, especially on the write side.",
  },
  {
    id: "cycle-dependency",
    description:
      "Build a feedback loop: generate content, run it through quality check, if it fails send it back for regeneration.",
    expectedBugTypes: ["cycle_detected"],
    explanation:
      "A feedback loop creates a cycle in the DAG, which AETHER forbids. The LLM must restructure as retry/iteration, not as a cycle.",
  },
];

export function getScenario(id: string): BugScenario | undefined {
  return scenarios.find(s => s.id === id);
}

export function getAllScenarioIds(): string[] {
  return scenarios.map(s => s.id);
}
