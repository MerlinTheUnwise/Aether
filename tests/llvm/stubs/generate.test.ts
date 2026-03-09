/**
 * Tests for stub implementation generator
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { generateStubs, generateTestHarness } from "../../../src/compiler/llvm/stubs.js";

const EXAMPLES = join(process.cwd(), "src", "ir", "examples");

function loadGraph(name: string) {
  return JSON.parse(readFileSync(join(EXAMPLES, `${name}.json`), "utf-8"));
}

describe("Stub Generator", () => {
  it("generates stubs for user-registration → C source with 3 impl functions", () => {
    const graph = loadGraph("user-registration");
    const code = generateStubs(graph);

    expect(code).toContain('#include "aether_runtime.h"');
    expect(code).toContain("impl_validate_email");
    expect(code).toContain("impl_check_uniqueness");
    expect(code).toContain("impl_create_user");

    // Count impl functions
    const implCount = (code.match(/impl_\w+\(/g) || [])
      .filter((m, i, arr) => arr.indexOf(m) === i).length;
    expect(implCount).toBe(3);
  });

  it("each stub returns correct default types", () => {
    const graph = loadGraph("user-registration");
    const code = generateStubs(graph);

    // Bool defaults to true
    expect(code).toContain("= true;");
    // String defaults to empty string
    expect(code).toContain('aether_string_from_cstr("")');
  });

  it("stub function signatures match node I/O types", () => {
    const graph = loadGraph("user-registration");
    const code = generateStubs(graph);

    // validate_email has input struct with email field
    expect(code).toContain("struct validate_email_in");
    expect(code).toContain("struct validate_email_out");

    // check_uniqueness has input struct with email field
    expect(code).toContain("struct check_uniqueness_in");
    expect(code).toContain("struct check_uniqueness_out");
  });

  it("generates stubs for payment-processing graph", () => {
    const graph = loadGraph("payment-processing");
    const code = generateStubs(graph);

    expect(code).toContain('#include "aether_runtime.h"');
    // Should have multiple impl functions
    const implMatches = code.match(/impl_\w+\(/g) || [];
    expect(implMatches.length).toBeGreaterThan(0);
  });

  it("handles Int output type with 0 default", () => {
    const graph = {
      id: "int-test",
      version: 1,
      nodes: [
        {
          id: "counter",
          in: {},
          out: { count: { type: "Int" } },
          contract: {},
          effects: [],
          pure: true,
        },
      ],
      edges: [],
    };
    const code = generateStubs(graph);
    expect(code).toContain("= 0;");
  });

  it("handles Float64 output type with 0.0 default", () => {
    const graph = {
      id: "float-test",
      version: 1,
      nodes: [
        {
          id: "calculator",
          in: {},
          out: { result: { type: "Float64" } },
          contract: {},
          effects: [],
          pure: true,
        },
      ],
      edges: [],
    };
    const code = generateStubs(graph);
    expect(code).toContain("= 0.0;");
  });

  it("skips IntentNodes", () => {
    const graph = {
      id: "intent-test",
      version: 1,
      nodes: [
        { id: "intent1", intent: true, description: "Sort data" },
        {
          id: "real_node",
          in: {},
          out: { result: { type: "Bool" } },
          contract: {},
          effects: [],
          pure: true,
        },
      ],
      edges: [],
    };
    const code = generateStubs(graph);
    expect(code).not.toContain("impl_intent1");
    expect(code).toContain("impl_real_node");
  });
});

describe("Test Harness Generator", () => {
  it("generates harness with main() and runtime init/finalize", () => {
    const graph = loadGraph("user-registration");
    const harness = generateTestHarness(graph);

    expect(harness).toContain('#include "aether_runtime.h"');
    expect(harness).toContain("int main(");
    expect(harness).toContain("aether_runtime_init(");
    expect(harness).toContain("aether_graph_run()");
    expect(harness).toContain("aether_runtime_finalize()");
    expect(harness).toContain("aether_contract_failure_count()");
  });

  it("includes stubs file via #include", () => {
    const graph = loadGraph("user-registration");
    const harness = generateTestHarness(graph);

    expect(harness).toContain("#include");
    expect(harness).toContain("_stubs.c");
  });

  it("returns exit code based on contract failures", () => {
    const graph = loadGraph("user-registration");
    const harness = generateTestHarness(graph);

    expect(harness).toContain("return failures > 0 ? 1 : 0;");
  });
});
