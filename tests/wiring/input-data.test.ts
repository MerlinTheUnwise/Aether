/**
 * Tests: Input Data Files — verify seed and inputs load correctly
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { ServiceContainer } from "../../src/implementations/services/container.js";

const PROGRAMS = [
  "user-registration",
  "product-recommendations",
  "data-pipeline-etl",
  "payment-processing",
  "rate-limiter",
  "customer-support-agent",
  "content-moderation-agent",
  "order-lifecycle",
  "multi-scope-order",
  "scoped-ecommerce",
  "multi-agent-marketplace",
  "template-showcase",
  "intent-data-pipeline",
];

describe("Input Data Files", () => {
  for (const name of PROGRAMS) {
    it(`${name} seed file loads and populates database`, async () => {
      const seedPath = `test-data/${name}/seed.json`;
      expect(existsSync(seedPath)).toBe(true);

      const seed = JSON.parse(readFileSync(seedPath, "utf-8"));
      expect(typeof seed).toBe("object");

      // Seed should have at least one table
      const tables = Object.keys(seed);
      expect(tables.length).toBeGreaterThan(0);

      // Create a service container with this seed
      const services = ServiceContainer.createDefault({
        database: { seed },
      });

      const db = services.get<any>("database");

      // Verify each seeded table has records
      for (const table of tables) {
        const records = seed[table];
        if (records.length > 0) {
          const queried = await db.query(table, { field: "id", operator: "!=", value: "" });
          // Some seeds have intentional duplicates (e.g., data-pipeline-etl)
          // so queried count may be <= records.length
          expect(queried.length).toBeGreaterThan(0);
          expect(queried.length).toBeLessThanOrEqual(records.length);
        }
      }
    });

    it(`${name} inputs file loads as valid JSON`, () => {
      const inputsPath = `test-data/${name}/inputs.json`;
      expect(existsSync(inputsPath)).toBe(true);

      const inputs = JSON.parse(readFileSync(inputsPath, "utf-8"));
      expect(typeof inputs).toBe("object");
    });
  }
});
