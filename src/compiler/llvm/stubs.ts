/**
 * AETHER Stub Implementation Generator
 *
 * Generates C stub implementations for all nodes in a graph.
 * Stubs return typed defaults so the graph runs end-to-end
 * without real implementations. Users replace stubs incrementally.
 */

import { mapTypeToLLVM, type AetherNode, type TypeAnnotation } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AetherGraph {
  id: string;
  version: number;
  nodes: (AetherNode | { intent?: boolean; [key: string]: unknown })[];
  edges: { from: string; to: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

function cTypeForAether(ann: TypeAnnotation): string {
  const baseType = ann.type.replace(/\?$/, "");
  switch (baseType) {
    case "Bool": return "bool";
    case "Int": return "int64_t";
    case "Float64": case "Decimal": return "double";
    case "Float32": return "float";
    case "String": case "Email": case "URL": case "JSON": return "AetherString";
    default:
      if (baseType.startsWith("List<")) return "AetherList";
      return "AetherString"; // fallback for unknown types
  }
}

function cDefaultForType(ann: TypeAnnotation, varName: string): string {
  const baseType = ann.type.replace(/\?$/, "");
  switch (baseType) {
    case "Bool": return `${varName} = true;`;
    case "Int": return `${varName} = 0;`;
    case "Float64": case "Decimal": return `${varName} = 0.0;`;
    case "Float32": return `${varName} = 0.0f;`;
    case "String": case "Email": case "URL": case "JSON":
      return `${varName} = aether_string_from_cstr("");`;
    default:
      if (baseType.startsWith("List<")) {
        return `${varName} = aether_list_new(sizeof(int64_t));`;
      }
      return `${varName} = aether_string_from_cstr("");`;
  }
}

function isRealNode(n: any): n is AetherNode {
  return n && typeof n === "object" && "id" in n && !("intent" in n && n.intent === true);
}

// ─── Stub Generator ──────────────────────────────────────────────────────────

export function generateStubs(graph: AetherGraph): string {
  const lines: string[] = [];
  const realNodes = graph.nodes.filter(isRealNode);

  lines.push("/* Auto-generated stub implementations for AETHER graph */");
  lines.push(`/* Graph: ${graph.id} (v${graph.version}) */`);
  lines.push(`/* Nodes: ${realNodes.length} */`);
  lines.push("");
  lines.push('#include "aether_runtime.h"');
  lines.push("#include <stdint.h>");
  lines.push("#include <stdbool.h>");
  lines.push("");

  for (const node of realNodes) {
    const sid = safeId(node.id);

    // Generate input struct
    const inPorts = Object.entries(node.in);
    const outPorts = Object.entries(node.out);

    lines.push(`/* ─── ${node.id} ─── */`);

    // Input struct
    lines.push(`struct ${sid}_in {`);
    if (inPorts.length === 0) {
      lines.push("    int _empty;");
    } else {
      for (const [portName, ann] of inPorts) {
        lines.push(`    ${cTypeForAether(ann)} ${safeId(portName)};`);
      }
    }
    lines.push("};");
    lines.push("");

    // Output struct
    lines.push(`struct ${sid}_out {`);
    if (outPorts.length === 0) {
      lines.push("    int _empty;");
    } else {
      for (const [portName, ann] of outPorts) {
        lines.push(`    ${cTypeForAether(ann)} ${safeId(portName)};`);
      }
    }
    lines.push("};");
    lines.push("");

    // In/Out type comments
    const inComment = inPorts.map(([name, ann]) => `${name}: ${ann.type}`).join(", ");
    const outComment = outPorts.map(([name, ann]) => `${name}: ${ann.type}`).join(", ");

    // Stub implementation
    lines.push(`// Stub implementation for: ${node.id}`);
    lines.push(`// In:  { ${inComment} }`);
    lines.push(`// Out: { ${outComment} }`);
    lines.push(`struct ${sid}_out impl_${sid}(struct ${sid}_in input) {`);
    lines.push(`    (void)input;  /* suppress unused parameter warning */`);
    lines.push(`    struct ${sid}_out result;`);
    for (const [portName, ann] of outPorts) {
      lines.push(`    ${cDefaultForType(ann, `result.${safeId(portName)}`)}`);
    }
    lines.push("    return result;");
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Test Harness Generator ──────────────────────────────────────────────────

export function generateTestHarness(graph: AetherGraph): string {
  const lines: string[] = [];

  lines.push("/* Auto-generated test harness for AETHER graph */");
  lines.push(`/* Graph: ${graph.id} (v${graph.version}) */`);
  lines.push("");
  lines.push('#include "aether_runtime.h"');
  lines.push('#include <stdio.h>');
  lines.push('#include <stdlib.h>');
  lines.push("");
  lines.push("/* Include generated stubs */");
  lines.push(`#include "${safeId(graph.id)}_stubs.c"`);
  lines.push("");
  lines.push("/* The AETHER graph entry point (from the .ll file, after compilation) */");
  lines.push("extern void aether_graph_run(void);");
  lines.push("");
  lines.push("int main(int argc, char** argv) {");
  lines.push("    (void)argc; (void)argv;");
  lines.push("    aether_runtime_init(0.7, 0);  /* threshold=0.7, mode=abort */");
  lines.push('    printf("Running AETHER graph: %s\\n", "' + graph.id + '");');
  lines.push("    aether_graph_run();");
  lines.push("    aether_runtime_finalize();");
  lines.push("    int failures = aether_contract_failure_count();");
  lines.push('    printf("Contract failures: %d\\n", failures);');
  lines.push("    return failures > 0 ? 1 : 0;");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}
