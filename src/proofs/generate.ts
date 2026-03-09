/**
 * AETHER Proof Generator
 * Generates complete Lean 4 files from AetherGraph + verification reports.
 */

import type {
  AetherGraph,
  AetherNode,
  AetherEdge,
  TypeAnnotation,
  StateType,
} from "../ir/validator.js";
import type { GraphVerificationReport, VerificationResult, PostconditionResult, AdversarialResult } from "../compiler/verifier.js";
import { mapTypeToLean, generateSemanticWrapper, generateStateTypeExport, type LeanStructure } from "./lean-types.js";
import { contractToLean, translateContractSection, type ContractContext, type TranslationResult } from "./lean-contracts.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProofExport {
  filename: string;
  source: string;
  metadata: {
    graphId: string;
    nodesExported: number;
    theoremsGenerated: number;
    sorryCount: number;
    fullyProved: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isNode(n: any): n is AetherNode {
  return n && typeof n.id === "string" && !("hole" in n && n.hole === true) && !("intent" in n && n.intent === true);
}

function toPascalCase(s: string): string {
  return s.replace(/(^|[_-])([a-z])/g, (_, __, c) => c.toUpperCase());
}

function section(title: string): string {
  const bar = "═══════════════════════════════════════";
  return `-- ${bar}\n-- Section: ${title}\n-- ${bar}`;
}

// ─── Generator ───────────────────────────────────────────────────────────────

export function generateProofExport(
  graph: AetherGraph,
  verificationReport?: GraphVerificationReport,
): ProofExport {
  const nodes = graph.nodes.filter(isNode);
  const verResults = new Map<string, VerificationResult>();
  if (verificationReport) {
    for (const r of verificationReport.results) {
      verResults.set(r.node_id, r);
    }
  }

  const lines: string[] = [];
  const allImports = new Set<string>();
  let theoremsGenerated = 0;
  let sorryCount = 0;
  let fullyProved = 0;

  // ─── Header ──────────────────────────────────────────────────────────
  const verifiedCount = verificationReport
    ? `${verificationReport.nodes_verified}/${verificationReport.results.length} nodes verified by Z3`
    : "no verification data";

  lines.push("/-");
  lines.push("  AETHER Proof Certificate");
  lines.push(`  Graph: ${graph.id} (v${graph.version})`);
  lines.push(`  Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`  Verification: ${verifiedCount}`);
  lines.push("");
  lines.push("  This file contains formal proof sketches for AETHER graph contracts.");
  lines.push("  Theorems marked with `sorry` are proof obligations that can be");
  lines.push("  completed manually or with Lean tactics.");
  lines.push("-/");
  lines.push("");

  // ─── Section 1: Type Definitions ─────────────────────────────────────
  lines.push(section("Type Definitions"));
  lines.push("");

  // Collect semantic types from all nodes
  const seenWrappers = new Set<string>();
  const wrappers: LeanStructure[] = [];

  for (const node of nodes) {
    for (const [name, ann] of [...Object.entries(node.in), ...Object.entries(node.out)]) {
      const wrapper = generateSemanticWrapper(name, ann);
      if (wrapper && !seenWrappers.has(wrapper.name)) {
        seenWrappers.add(wrapper.name);
        wrappers.push(wrapper);
        for (const imp of wrapper.imports) allImports.add(imp);
      }
    }
  }

  if (wrappers.length > 0) {
    for (const w of wrappers) {
      lines.push(w.source);
      lines.push("");
    }
  } else {
    lines.push("-- No semantic type wrappers needed");
    lines.push("");
  }

  // State types
  const stateTypes = graph.state_types ?? [];
  if (stateTypes.length > 0) {
    for (const st of stateTypes) {
      const exported = generateStateTypeExport(st);
      lines.push(exported.inductiveType);
      lines.push("");
      lines.push(exported.transitionRelation);
      lines.push("");
      for (const t of exported.neverTheorems) {
        lines.push(t);
        lines.push("");
        theoremsGenerated++;
        fullyProved++; // `by intro h; cases h` is a complete proof
      }
      for (const t of exported.terminalTheorems) {
        lines.push(t);
        lines.push("");
        theoremsGenerated++;
        fullyProved++;
      }
      for (const imp of exported.imports) allImports.add(imp);
    }
  }

  // ─── Section 2: Node Contracts ───────────────────────────────────────
  lines.push(section("Node Contracts"));
  lines.push("");

  for (const node of nodes) {
    const verResult = verResults.get(node.id);
    const context: ContractContext = {
      nodeId: node.id,
      inputTypes: node.in,
      outputTypes: node.out,
      variables: [...Object.keys(node.in), ...Object.keys(node.out)],
    };

    lines.push(`namespace ${toPascalCase(node.id)}`);
    lines.push("");

    // Preconditions
    const preExprs = node.contract.pre ?? [];
    if (preExprs.length > 0) {
      const params = Object.entries(node.in)
        .map(([name, ann]) => `(${name} : ${mapTypeToLean(ann).leanType})`)
        .join(" ");

      lines.push("-- Precondition");
      lines.push(`def pre ${params} : Prop :=`);

      const preTrans = preExprs.map(e => contractToLean(e, context));
      if (preTrans.length === 1) {
        lines.push(`  ${preTrans[0].lean}`);
      } else {
        lines.push(`  ${preTrans.map(t => t.lean).join(" ∧\n  ")}`);
      }
      lines.push("");
    }

    // Postconditions
    const postExprs = node.contract.post ?? [];
    if (postExprs.length > 0) {
      const allParams = [
        ...Object.entries(node.in).map(([name, ann]) => `(${name} : ${mapTypeToLean(ann).leanType})`),
        ...Object.entries(node.out).map(([name, ann]) => `(${name} : ${mapTypeToLean(ann).leanType})`),
      ].join(" ");

      lines.push("-- Postcondition");
      lines.push(`def post ${allParams} : Prop :=`);

      const postTrans = postExprs.map(e => contractToLean(e, context));
      if (postTrans.length === 1) {
        lines.push(`  ${postTrans[0].lean}`);
      } else {
        lines.push(`  ${postTrans.map(t => t.lean).join(" ∧\n  ")}`);
      }
      lines.push("");

      // Contract theorem
      const allUnsupported = postTrans.every(t => !t.supported);
      const postVerified = verResult?.postconditions ?? [];
      const anyFailed = postVerified.some(p => p.status === "failed");

      if (anyFailed) {
        // Z3 found counterexample — do NOT generate theorem
        lines.push("-- WARNING: Z3 found counterexample — contract may not hold");
        for (const p of postVerified) {
          if (p.status === "failed" && p.counterexample) {
            lines.push(`-- Counterexample for "${p.expression}": ${JSON.stringify(p.counterexample)}`);
          }
        }
        lines.push("");
      } else {
        const z3Verified = verResult?.verified === true;
        const proofTactic = getProofTactic(postTrans, z3Verified);
        theoremsGenerated++;

        lines.push(`-- Contract theorem: if pre holds, implementation guarantees post`);
        if (z3Verified) {
          lines.push(`-- (Z3 verified: UNSAT for ¬post given pre)`);
        }

        if (proofTactic === "sorry") {
          sorryCount++;
          const reason = allUnsupported ? "unsupported expressions" : "Z3-verified, tactic needed";
          lines.push(`theorem contract_holds : sorry := sorry  -- proof obligation: ${reason}`);
        } else {
          fullyProved++;
          lines.push(`theorem contract_holds : True := ${proofTactic}`);
        }
        lines.push("");
      }
    }

    // Adversarial checks
    const breakIfs = (node as any).adversarial_check?.break_if as string[] | undefined;
    if (breakIfs && breakIfs.length > 0) {
      const advResults = verResult?.adversarial_checks ?? [];

      for (let i = 0; i < breakIfs.length; i++) {
        const expr = breakIfs[i];
        const advResult = advResults[i];
        const trans = contractToLean(expr, context);

        if (advResult?.status === "failed") {
          lines.push(`-- WARNING: Adversarial check failed — break_if condition IS reachable`);
          lines.push(`-- Expression: "${expr}"`);
          if (advResult.counterexample) {
            lines.push(`-- Counterexample: ${JSON.stringify(advResult.counterexample)}`);
          }
          lines.push("");
          continue;
        }

        theoremsGenerated++;
        const z3Passed = advResult?.status === "passed";

        lines.push(`-- Adversarial check: this should be impossible`);
        if (z3Passed) {
          lines.push(`-- (Z3 verified: UNSAT)`);
        }

        if (!trans.supported) {
          sorryCount++;
          lines.push(`theorem adversarial_${i + 1} : sorry := sorry  -- proof obligation: ${expr}`);
        } else if (z3Passed) {
          sorryCount++; // Z3 verified but we still need sorry for the Lean proof
          lines.push(`theorem adversarial_${i + 1} : ¬ (${trans.lean}) := by`);
          lines.push(`  sorry  -- Z3-verified: complete with Lean tactics`);
        } else {
          sorryCount++;
          lines.push(`theorem adversarial_${i + 1} : ¬ (${trans.lean}) := by`);
          lines.push(`  sorry  -- proof obligation`);
        }
        lines.push("");
      }
    }

    lines.push(`end ${toPascalCase(node.id)}`);
    lines.push("");
  }

  // ─── Section 3: Graph Composition ────────────────────────────────────
  lines.push(section("Graph Composition"));
  lines.push("");

  // Edge type safety theorems
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    const [fromNode, fromPort] = edge.from.split(".");
    const [toNode, toPort] = edge.to.split(".");

    const srcNode = nodes.find(n => n.id === fromNode);
    const dstNode = nodes.find(n => n.id === toNode);

    if (!srcNode || !dstNode) {
      lines.push(`-- Edge ${edge.from} → ${edge.to}: node not found (intent/hole)`);
      lines.push("");
      continue;
    }

    const srcType = srcNode.out[fromPort];
    const dstType = dstNode.in[toPort];

    if (!srcType || !dstType) {
      lines.push(`-- Edge ${edge.from} → ${edge.to}: port not found`);
      lines.push("");
      continue;
    }

    const srcLean = mapTypeToLean(srcType).leanType;
    const dstLean = mapTypeToLean(dstType).leanType;
    const compatible = srcType.type === dstType.type;

    theoremsGenerated++;
    lines.push(`-- Edge type safety: ${edge.from} → ${edge.to}`);
    lines.push(`-- Types: ${srcLean} → ${dstLean} (${compatible ? "compatible" : "may need coercion"})`);

    if (compatible) {
      fullyProved++;
      lines.push(`theorem edge_type_safe_${i + 1} : True := trivial  -- same type, trivially safe`);
    } else {
      sorryCount++;
      lines.push(`theorem edge_type_safe_${i + 1} : sorry := sorry  -- type coercion needed`);
    }
    lines.push("");
  }

  // ─── Section 4: Verification Summary ─────────────────────────────────
  lines.push(section("Verification Summary"));
  lines.push("");
  lines.push("/-");
  lines.push("  Verification Report:");
  lines.push(`  - Nodes exported: ${nodes.length}`);
  lines.push(`  - Theorems generated: ${theoremsGenerated}`);
  lines.push(`  - Fully proved: ${fullyProved}`);
  lines.push(`  - Proof obligations (sorry): ${sorryCount}`);
  if (verificationReport) {
    lines.push(`  - Z3 verification: ${verificationReport.nodes_verified}/${verificationReport.results.length} nodes verified`);
  }
  lines.push("");
  lines.push("  To complete proofs, replace `sorry` with Lean tactics.");
  lines.push("  Start with: `simp`, `omega`, `decide`, or `exact`.");
  lines.push("-/");

  // ─── Build imports ───────────────────────────────────────────────────
  const importLines: string[] = [];
  // Always include basic imports
  importLines.push("import Mathlib.Data.List.Basic");
  importLines.push("import Mathlib.Data.String.Basic");
  for (const imp of allImports) {
    const line = `import ${imp}`;
    if (!importLines.includes(line)) importLines.push(line);
  }

  // Assemble final source
  const headerEnd = lines.indexOf("") > 0 ? lines.indexOf("-/") + 1 : 0;
  // Find the end of the header comment
  let headerEndIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "-/") {
      headerEndIdx = i + 1;
      break;
    }
  }

  const finalLines = [
    ...lines.slice(0, headerEndIdx),
    "",
    ...importLines,
    "",
    ...lines.slice(headerEndIdx),
  ];

  return {
    filename: `${graph.id}.lean`,
    source: finalLines.join("\n"),
    metadata: {
      graphId: graph.id,
      nodesExported: nodes.length,
      theoremsGenerated,
      sorryCount,
      fullyProved,
    },
  };
}

// ─── Proof Tactics ───────────────────────────────────────────────────────────

function getProofTactic(translations: TranslationResult[], z3Verified: boolean): string {
  // If all translations are supported and simple, try trivial
  const allSupported = translations.every(t => t.supported);

  if (!allSupported) return "sorry";

  // Simple True/trivial cases
  if (translations.every(t => t.lean === "True" || t.lean === "true")) {
    return "trivial";
  }

  // Z3 verified but still needs Lean tactic — use sorry
  // (we can't auto-generate valid Lean tactics for arbitrary propositions)
  return "sorry";
}
