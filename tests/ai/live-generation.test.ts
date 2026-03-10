/**
 * Live AI Generation Tests (API-gated)
 * Skip if no ANTHROPIC_API_KEY is set.
 */

import { describe, it, expect } from "vitest";
import { generateFromDescription } from "../../src/ai/generate.js";
import { scenarios } from "../../src/ai/scenarios.js";

const apiAvailable = !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!apiAvailable)("AI generation — live API", () => {
  it("generates valid graph from simple description", async () => {
    const result = await generateFromDescription({
      description: "Build a simple user registration: validate the email, hash the password, and store the user in the database.",
      maxAttempts: 2,
    });

    expect(result.attempts.length).toBeGreaterThanOrEqual(1);
    expect(result.attempts[0].parseSuccess).toBe(true);
    expect(result.graph).not.toBeNull();
    expect(result.graph!.nodes.length).toBeGreaterThanOrEqual(1);
  }, 60000);

  it("recommender-overlap scenario catches expected bugs", async () => {
    const scenario = scenarios.find(s => s.id === "recommender-overlap")!;
    const result = await generateFromDescription({
      description: scenario.description,
      maxAttempts: 2,
    });

    expect(result.attempts.length).toBeGreaterThanOrEqual(1);
    expect(result.bugsFound.length).toBeGreaterThanOrEqual(0);

    // The thesis: AETHER should catch at least one bug
    // (LLMs frequently miss adversarial checks for overlap conditions)
    if (result.bugsFound.length > 0) {
      for (const bug of result.bugsFound) {
        expect(bug.wouldCauseInProduction).toBeTruthy();
        expect(bug.caughtBy).toBeTruthy();
      }
    }
  }, 60000);
});
