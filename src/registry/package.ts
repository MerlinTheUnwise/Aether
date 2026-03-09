/**
 * AETHER Package Format
 * Defines the .aetherpkg package structure for sharing verified AETHER graphs.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { emitCompact } from "../compiler/compact.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TypeAnnotation {
  type: string;
  domain?: string;
  unit?: string;
  dimension?: string;
  format?: string;
  sensitivity?: string;
  range?: [number, number];
  constraint?: string;
}

export interface BoundaryContract {
  name: string;
  in: Record<string, TypeAnnotation>;
  out: Record<string, TypeAnnotation>;
  contract?: { pre?: string[]; post?: string[] };
  effects?: string[];
  confidence?: number;
}

export interface PackageManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  provides: {
    type: "graph" | "template" | "certified-algorithm" | "scope";
    boundary_contracts?: BoundaryContract[];
    exposed_inputs?: Record<string, TypeAnnotation>;
    exposed_outputs?: Record<string, TypeAnnotation>;
    effects?: string[];
  };
  dependencies?: Record<string, string>;
  verification: {
    percentage: number;
    confidence: number;
    supervised_count: number;
    z3_verified: boolean;
    lean_proofs: boolean;
    last_verified: string;
  };
  aether_ir_version: string;
  keywords: string[];
}

export interface AetherGraph {
  id: string;
  version: number;
  nodes: any[];
  edges: { from: string; to: string }[];
  effects: string[];
  [key: string]: unknown;
}

export interface GraphVerificationReport {
  graph_id: string;
  nodes_verified: number;
  nodes_failed: number;
  nodes_unsupported: number;
  results: any[];
  verification_percentage: number;
  stateTypeResults: any[];
}

export interface Package {
  manifest: PackageManifest;
  graph: AetherGraph;
  verification: GraphVerificationReport;
  compact?: string;
  proofs?: string;
  readme?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Create Package ──────────────────────────────────────────────────────────

export function createPackage(
  graph: AetherGraph,
  manifest: Partial<PackageManifest>,
  options?: { includeProofs?: boolean; includeCompact?: boolean },
): Package {
  // Validate graph has minimum required fields
  if (!graph || !graph.id || !Array.isArray(graph.nodes)) {
    throw new Error("Invalid graph: must have id and nodes array");
  }

  // Determine provides type
  const providesType = manifest.provides?.type ?? detectProvidesType(graph);

  // Collect effects from graph
  const graphEffects = graph.effects ?? [];
  const nodeEffects = new Set<string>();
  for (const node of graph.nodes) {
    if (node.effects) {
      for (const eff of node.effects) {
        nodeEffects.add(eff);
      }
    }
  }

  // Collect exposed inputs/outputs
  const exposedInputs: Record<string, TypeAnnotation> = {};
  const exposedOutputs: Record<string, TypeAnnotation> = {};
  if (graph.nodes.length > 0) {
    // Find source nodes (no incoming edges) and sink nodes (no outgoing edges)
    const incomingNodes = new Set(graph.edges.map(e => e.to.split(".")[0]));
    const outgoingNodes = new Set(graph.edges.map(e => e.from.split(".")[0]));
    for (const node of graph.nodes) {
      if (node.intent) continue;
      if (!incomingNodes.has(node.id) && node.in) {
        for (const [port, type] of Object.entries(node.in)) {
          exposedInputs[`${node.id}.${port}`] = type as TypeAnnotation;
        }
      }
      if (!outgoingNodes.has(node.id) && node.out) {
        for (const [port, type] of Object.entries(node.out)) {
          exposedOutputs[`${node.id}.${port}`] = type as TypeAnnotation;
        }
      }
    }
  }

  // Count supervised nodes
  const supervisedCount = graph.nodes.filter((n: any) => n.supervised).length;

  // Build verification report placeholder if not provided
  const verification: GraphVerificationReport = {
    graph_id: graph.id,
    nodes_verified: 0,
    nodes_failed: 0,
    nodes_unsupported: 0,
    results: [],
    verification_percentage: 0,
    stateTypeResults: [],
  };

  // Build full manifest
  const fullManifest: PackageManifest = {
    name: manifest.name ?? `@aether/${graph.id}`,
    version: manifest.version ?? "1.0.0",
    description: manifest.description ?? `AETHER package: ${graph.id}`,
    author: manifest.author ?? "aether",
    license: manifest.license ?? "MIT",
    provides: {
      type: providesType,
      exposed_inputs: manifest.provides?.exposed_inputs ?? exposedInputs,
      exposed_outputs: manifest.provides?.exposed_outputs ?? exposedOutputs,
      effects: manifest.provides?.effects ?? [...graphEffects, ...nodeEffects],
      boundary_contracts: manifest.provides?.boundary_contracts,
    },
    dependencies: manifest.dependencies ?? {},
    verification: manifest.verification ?? {
      percentage: 0,
      confidence: 0,
      supervised_count: supervisedCount,
      z3_verified: false,
      lean_proofs: false,
      last_verified: new Date().toISOString(),
    },
    aether_ir_version: manifest.aether_ir_version ?? "0.1.0",
    keywords: manifest.keywords ?? [graph.id],
  };

  const pkg: Package = {
    manifest: fullManifest,
    graph,
    verification,
  };

  // Compact form
  if (options?.includeCompact) {
    try {
      pkg.compact = emitCompact(graph as any);
    } catch {
      // Compact form generation failed, skip
    }
  }

  return pkg;
}

// ─── Validate Package ────────────────────────────────────────────────────────

export function validatePackage(pkg: Package): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!pkg.manifest) errors.push("Missing manifest");
  if (!pkg.graph) errors.push("Missing graph");

  if (pkg.manifest) {
    if (!pkg.manifest.name) errors.push("Missing manifest.name");
    if (!pkg.manifest.version) errors.push("Missing manifest.version");
    if (!pkg.manifest.description) errors.push("Missing manifest.description");
    if (!pkg.manifest.provides) errors.push("Missing manifest.provides");
    if (!pkg.manifest.verification) errors.push("Missing manifest.verification");

    // Validate semver format
    if (pkg.manifest.version && !/^\d+\.\d+\.\d+/.test(pkg.manifest.version)) {
      errors.push(`Invalid version format: ${pkg.manifest.version} (expected semver)`);
    }

    // Validate name format
    if (pkg.manifest.name && !/^@[\w-]+\/[\w-]+$/.test(pkg.manifest.name)) {
      warnings.push(`Package name "${pkg.manifest.name}" does not follow @scope/name convention`);
    }
  }

  if (pkg.graph) {
    if (!pkg.graph.id) errors.push("Missing graph.id");
    if (!Array.isArray(pkg.graph.nodes)) errors.push("graph.nodes must be an array");
    if (!Array.isArray(pkg.graph.edges)) errors.push("graph.edges must be an array");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Load / Save Package ─────────────────────────────────────────────────────

export function loadPackage(path: string): Package {
  const manifestPath = join(path, "aether.pkg.json");
  const graphPath = join(path, "graph.json");
  const verificationPath = join(path, "verification.json");

  if (!existsSync(manifestPath)) {
    throw new Error(`Package manifest not found: ${manifestPath}`);
  }

  const manifest: PackageManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const graph: AetherGraph = existsSync(graphPath)
    ? JSON.parse(readFileSync(graphPath, "utf-8"))
    : { id: manifest.name, version: 1, nodes: [], edges: [], effects: [] };
  const verification: GraphVerificationReport = existsSync(verificationPath)
    ? JSON.parse(readFileSync(verificationPath, "utf-8"))
    : { graph_id: graph.id, nodes_verified: 0, nodes_failed: 0, nodes_unsupported: 0, results: [], verification_percentage: 0, stateTypeResults: [] };

  const pkg: Package = { manifest, graph, verification };

  const compactPath = join(path, "graph.aether");
  if (existsSync(compactPath)) {
    pkg.compact = readFileSync(compactPath, "utf-8");
  }

  const proofPath = join(path, "proofs", "graph.lean");
  if (existsSync(proofPath)) {
    pkg.proofs = readFileSync(proofPath, "utf-8");
  }

  const readmePath = join(path, "README.md");
  if (existsSync(readmePath)) {
    pkg.readme = readFileSync(readmePath, "utf-8");
  }

  return pkg;
}

export function savePackage(pkg: Package, outputPath: string): void {
  mkdirSync(outputPath, { recursive: true });

  writeFileSync(
    join(outputPath, "aether.pkg.json"),
    JSON.stringify(pkg.manifest, null, 2),
    "utf-8",
  );

  writeFileSync(
    join(outputPath, "graph.json"),
    JSON.stringify(pkg.graph, null, 2),
    "utf-8",
  );

  writeFileSync(
    join(outputPath, "verification.json"),
    JSON.stringify(pkg.verification, null, 2),
    "utf-8",
  );

  if (pkg.compact) {
    writeFileSync(join(outputPath, "graph.aether"), pkg.compact, "utf-8");
  }

  if (pkg.proofs) {
    const proofsDir = join(outputPath, "proofs");
    mkdirSync(proofsDir, { recursive: true });
    writeFileSync(join(proofsDir, "graph.lean"), pkg.proofs, "utf-8");
  }

  if (pkg.readme) {
    writeFileSync(join(outputPath, "README.md"), pkg.readme, "utf-8");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectProvidesType(graph: AetherGraph): "graph" | "template" | "certified-algorithm" | "scope" {
  if ((graph as any).parameters) return "template";
  if ((graph as any).scopes && (graph as any).scopes.length > 0) return "scope";
  // Check if it looks like a certified algorithm (single node, pure, with contracts)
  if (graph.nodes.length === 1 && graph.nodes[0].pure && graph.nodes[0].contract) {
    return "certified-algorithm";
  }
  return "graph";
}
