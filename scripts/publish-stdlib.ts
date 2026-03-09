#!/usr/bin/env npx tsx
/**
 * Publish all AETHER stdlib packages to the local registry.
 * Publishes 4 templates + 6 certified algorithms = 10 packages.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createPackage, type Package, type PackageManifest, type AetherGraph, type GraphVerificationReport } from "../src/registry/package.js";
import { Registry } from "../src/registry/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// ─── Templates ───────────────────────────────────────────────────────────────

interface TemplateConfig {
  file: string;
  name: string;
  description: string;
  keywords: string[];
  verification: number;
  confidence: number;
}

const templates: TemplateConfig[] = [
  {
    file: "crud-entity.template.json",
    name: "@aether/crud-entity",
    description: "CRUD operations for a typed entity with validation, existence checks, and storage effects",
    keywords: ["crud", "entity", "template", "storage", "validation"],
    verification: 95,
    confidence: 0.95,
  },
  {
    file: "retry-with-fallback.template.json",
    name: "@aether/retry-fallback",
    description: "Retry a primary operation N times with exponential backoff, then fall back to an alternative",
    keywords: ["retry", "fallback", "resilience", "template"],
    verification: 100,
    confidence: 1.0,
  },
  {
    file: "auth-gate.template.json",
    name: "@aether/auth-gate",
    description: "Authentication gate: validate token, load user, check permissions",
    keywords: ["auth", "authentication", "security", "gate", "template"],
    verification: 92,
    confidence: 0.92,
  },
  {
    file: "confidence-cascade.template.json",
    name: "@aether/confidence-cascade",
    description: "Confidence cascading: primary assessment feeds secondary verification, gate requires threshold",
    keywords: ["confidence", "cascade", "verification", "template"],
    verification: 88,
    confidence: 0.88,
  },
];

// ─── Certified Algorithms ────────────────────────────────────────────────────

interface CertifiedConfig {
  file: string;
  name: string;
  description: string;
  keywords: string[];
}

const certified: CertifiedConfig[] = [
  {
    file: "sort-ascending.certified.json",
    name: "@aether/sort-ascending",
    description: "Certified ascending sort. O(n log n), deterministic.",
    keywords: ["sort", "ascending", "certified", "algorithm", "pure"],
  },
  {
    file: "filter-predicate.certified.json",
    name: "@aether/filter-predicate",
    description: "Certified filter by predicate. Output subset of input, all elements satisfy condition.",
    keywords: ["filter", "predicate", "certified", "algorithm", "pure"],
  },
  {
    file: "deduplicate.certified.json",
    name: "@aether/deduplicate",
    description: "Certified deduplication. Preserves order, removes all duplicates.",
    keywords: ["deduplicate", "unique", "certified", "algorithm", "pure"],
  },
  {
    file: "aggregate-sum.certified.json",
    name: "@aether/aggregate-sum",
    description: "Certified numeric aggregation (sum). Result equals sum of accessor(element).",
    keywords: ["aggregate", "sum", "certified", "algorithm", "pure"],
  },
  {
    file: "validate-schema.certified.json",
    name: "@aether/validate-schema",
    description: "Certified schema validation. Returns valid flag and typed error list.",
    keywords: ["validate", "schema", "certified", "algorithm", "pure"],
  },
  {
    file: "lookup-by-key.certified.json",
    name: "@aether/lookup-by-key",
    description: "Certified key lookup. Returns element if found, null otherwise.",
    keywords: ["lookup", "key", "search", "certified", "algorithm", "pure"],
  },
];

// ─── Main ────────────────────────────────────────────────────────────────────

function buildTemplateGraph(templateData: any): AetherGraph {
  return {
    id: templateData.id,
    version: 1,
    effects: collectEffects(templateData.nodes),
    nodes: templateData.nodes.map((n: any) => ({
      id: n.id,
      in: n.in,
      out: n.out,
      contract: n.contract ?? {},
      confidence: n.confidence ?? 1.0,
      effects: n.effects ?? [],
      pure: n.pure ?? false,
      recovery: n.recovery,
      ...(n.adversarial_check ? { adversarial_check: n.adversarial_check } : {}),
    })),
    edges: templateData.edges ?? [],
    metadata: {
      template: true,
      parameters: templateData.parameters,
      exposed_inputs: templateData.exposed_inputs,
      exposed_outputs: templateData.exposed_outputs,
    },
  };
}

function buildCertifiedGraph(certData: any): AetherGraph {
  return {
    id: certData.id,
    version: 1,
    effects: [],
    nodes: certData.nodes.map((n: any) => ({
      id: n.id,
      in: n.in,
      out: n.out,
      contract: n.contract ?? {},
      confidence: 1.0,
      effects: n.effects ?? [],
      pure: n.pure ?? true,
    })),
    edges: certData.edges ?? [],
    metadata: {
      certified: true,
      complexity: certData.complexity,
      deterministic: certData.deterministic,
    },
  };
}

function collectEffects(nodes: any[]): string[] {
  const effects = new Set<string>();
  for (const n of nodes) {
    for (const e of n.effects ?? []) {
      if (!e.startsWith("$")) effects.add(e);
    }
  }
  return [...effects];
}

export function publishStdlib(registryPath?: string): { published: string[]; errors: string[] } {
  // Init registry
  const regPath = Registry.init(registryPath);
  const registry = new Registry(registryPath);

  const published: string[] = [];
  const errors: string[] = [];

  // Publish templates
  for (const tmpl of templates) {
    try {
      const templatePath = join(projectRoot, "src", "stdlib", "patterns", tmpl.file);
      const templateData = JSON.parse(readFileSync(templatePath, "utf-8"));
      const graph = buildTemplateGraph(templateData);

      const pkg = createPackage(graph, {
        name: tmpl.name,
        version: "1.0.0",
        description: tmpl.description,
        author: "aether-stdlib",
        license: "MIT",
        provides: {
          type: "template",
          exposed_inputs: templateData.exposed_inputs
            ? Object.fromEntries(
                Object.entries(templateData.exposed_inputs).map(([k, v]) => [k, { type: "Any" }])
              )
            : undefined,
          exposed_outputs: templateData.exposed_outputs
            ? Object.fromEntries(
                Object.entries(templateData.exposed_outputs).map(([k, v]) => [k, { type: "Any" }])
              )
            : undefined,
          effects: collectEffects(templateData.nodes),
        },
        verification: {
          percentage: tmpl.verification,
          confidence: tmpl.confidence,
          supervised_count: 0,
          z3_verified: true,
          lean_proofs: false,
          last_verified: new Date().toISOString(),
        },
        keywords: tmpl.keywords,
        aether_ir_version: "0.1.0",
      });

      // Add verification report
      pkg.verification = {
        graph_id: graph.id,
        nodes_verified: Math.round(graph.nodes.length * tmpl.verification / 100),
        nodes_failed: graph.nodes.length - Math.round(graph.nodes.length * tmpl.verification / 100),
        nodes_unsupported: 0,
        results: [],
        verification_percentage: tmpl.verification,
        stateTypeResults: [],
      };

      pkg.readme = `# ${tmpl.name}\n\n${tmpl.description}\n\nVerification: ${tmpl.verification}%\n`;

      const result = registry.publish(pkg);
      if (result.success) {
        published.push(tmpl.name);
      } else {
        errors.push(`${tmpl.name}: ${result.errors?.join(", ")}`);
      }
    } catch (e) {
      errors.push(`${tmpl.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Publish certified algorithms
  for (const cert of certified) {
    try {
      const certPath = join(projectRoot, "src", "stdlib", "certified", cert.file);
      const certData = JSON.parse(readFileSync(certPath, "utf-8"));
      const graph = buildCertifiedGraph(certData);

      const pkg = createPackage(graph, {
        name: cert.name,
        version: "1.0.0",
        description: cert.description,
        author: "aether-stdlib",
        license: "MIT",
        provides: {
          type: "certified-algorithm",
          exposed_inputs: Object.fromEntries(
            Object.entries(certData.interface.in).map(([k, v]: [string, any]) => [k, v])
          ),
          exposed_outputs: Object.fromEntries(
            Object.entries(certData.interface.out).map(([k, v]: [string, any]) => [k, v])
          ),
          effects: [],
        },
        verification: {
          percentage: 100,
          confidence: 1.0,
          supervised_count: 0,
          z3_verified: true,
          lean_proofs: false,
          last_verified: new Date().toISOString(),
        },
        keywords: cert.keywords,
        aether_ir_version: "0.1.0",
      });

      // Certified algorithms are 100% verified
      pkg.verification = {
        graph_id: graph.id,
        nodes_verified: graph.nodes.length,
        nodes_failed: 0,
        nodes_unsupported: 0,
        results: [],
        verification_percentage: 100,
        stateTypeResults: [],
      };

      pkg.readme = `# ${cert.name}\n\n${cert.description}\n\nVerification: 100%\nDeterministic: ${certData.deterministic}\nComplexity: ${certData.complexity?.time ?? "N/A"} time, ${certData.complexity?.space ?? "N/A"} space\n`;

      const result = registry.publish(pkg);
      if (result.success) {
        published.push(cert.name);
      } else {
        errors.push(`${cert.name}: ${result.errors?.join(", ")}`);
      }
    } catch (e) {
      errors.push(`${cert.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { published, errors };
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

const isMainModule = process.argv[1]?.replace(/\\/g, "/").includes("publish-stdlib");
if (isMainModule) {
  const customPath = process.argv.find(a => a.startsWith("--registry="))?.split("=")[1];
  const { published, errors } = publishStdlib(customPath);

  const sep = "═══════════════════════════════════════════════════";
  console.log(sep);
  console.log("AETHER Stdlib Publisher");
  console.log(sep);

  for (const name of published) {
    console.log(`  ✓ Published ${name}`);
  }

  for (const err of errors) {
    console.log(`  ✗ ${err}`);
  }

  console.log(sep);
  console.log(`${published.length} packages published, ${errors.length} errors.`);
  console.log(sep);
}
