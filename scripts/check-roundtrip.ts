import { readFileSync } from "fs";
import { irToAether, aetherToIR } from "../src/parser/bridge.js";

const files = [
  "src/ir/examples/real-world/sales-analytics.json",
  "src/ir/examples/real-world/transaction-analysis.json",
  "src/ir/examples/template-showcase.json",
  "src/ir/examples/real-world/api-orchestration.json",
];

for (const f of files) {
  try {
    const orig = JSON.parse(readFileSync(f, "utf-8"));
    const aether = irToAether(orig);
    const result = aetherToIR(aether);
    if (result.errors.length > 0) {
      console.log(`${f}: ERRORS`);
      for (const e of result.errors) console.log(`  L${e.line}:${e.column} ${e.message}`);
    } else {
      console.log(`${f}: OK (${result.graph!.nodes.length} nodes)`);
    }
  } catch (e: any) {
    console.log(`${f}: EXCEPTION - ${e.message}`);
  }
}
