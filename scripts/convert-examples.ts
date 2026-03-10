import { readFileSync, writeFileSync } from "fs";
import { irToAether } from "../src/parser/bridge.js";

const examples = [
  "src/ir/examples/user-registration.json",
  "src/ir/examples/payment-processing.json",
  "src/ir/examples/product-recommendations.json",
  "src/ir/examples/customer-support-agent.json",
  "src/ir/examples/content-moderation-agent.json",
  "src/ir/examples/data-pipeline-etl.json",
  "src/ir/examples/rate-limiter.json",
  "src/ir/examples/order-lifecycle.json",
  "src/ir/examples/multi-scope-order.json",
  "src/ir/examples/scoped-ecommerce.json",
  "src/ir/examples/template-showcase.json",
  "src/ir/examples/intent-data-pipeline.json",
  "src/ir/examples/intent-data-pipeline-v2.json",
  "src/ir/examples/multi-agent-marketplace.json",
  "src/ir/examples/real-world/transaction-analysis.json",
  "src/ir/examples/real-world/sales-analytics.json",
  "src/ir/examples/real-world/api-orchestration.json",
];

for (const jsonPath of examples) {
  try {
    const json = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const aether = irToAether(json);
    const aetherPath = jsonPath.replace(".json", ".aether");
    writeFileSync(aetherPath, aether, "utf-8");
    console.log("OK: " + aetherPath);
  } catch (e: any) {
    console.error("FAIL: " + jsonPath + " - " + e.message);
  }
}
console.log("Done");
