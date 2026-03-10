// @annotation expansion rules for the .aether syntax

import type { TypeAnnotation } from "../ir/validator.js";
import type { ASTAnnotation } from "./ast.js";
import type { ParseWarning } from "./errors.js";

interface AnnotationExpansion {
  format?: string;
  domain?: string;
  sensitivity?: string;
  unit?: string;
  dimension?: string;
}

const annotationExpansions: Record<string, AnnotationExpansion> = {
  // Format
  email:    { format: "email" },
  uuid:     { format: "uuid_v4" },
  jwt:      { format: "jwt" },
  phone:    { format: "phone" },
  url:      { format: "url" },
  iso8601:  { format: "iso8601" },

  // Domain
  auth:     { domain: "authentication" },
  commerce: { domain: "commerce" },
  payment:  { domain: "payment" },
  ml:       { domain: "ml" },
  support:  { domain: "support" },
  mod:      { domain: "moderation" },

  // Sensitivity
  pii:      { sensitivity: "pii" },
  public:   { sensitivity: "public" },
  internal: { sensitivity: "internal" },

  // Units
  USD:      { unit: "USD", dimension: "currency" },
  EUR:      { unit: "EUR", dimension: "currency" },
  GBP:      { unit: "GBP", dimension: "currency" },
  kelvin:   { unit: "kelvin", dimension: "thermodynamic_temperature" },
  celsius:  { unit: "celsius", dimension: "thermodynamic_temperature" },
  ms:       { unit: "ms", dimension: "time" },
  seconds:  { unit: "seconds", dimension: "time" },
  bytes:    { unit: "bytes", dimension: "data_size" },
  percent:  { unit: "percent", dimension: "ratio" },
};

// Known annotation names (for warning on unknown)
const knownAnnotations = new Set([
  ...Object.keys(annotationExpansions),
  "constraint",
  "range",
  "state_type",
]);

export function expandAnnotations(
  baseType: string,
  annotations: ASTAnnotation[]
): { typeAnnotation: Partial<TypeAnnotation>; warnings: ParseWarning[] } {
  const result: Partial<TypeAnnotation> = {};
  const warnings: ParseWarning[] = [];

  for (const ann of annotations) {
    const name = ann.name;

    // Parameterized annotations
    if (name === "constraint" && ann.args && ann.args.length > 0) {
      result.constraint = ann.args[0];
      continue;
    }

    if (name === "range" && ann.args && ann.args.length >= 2) {
      result.range = [Number(ann.args[0]), Number(ann.args[1])];
      continue;
    }

    if (name === "state_type" && ann.args && ann.args.length > 0) {
      result.state_type = ann.args[0];
      continue;
    }

    // Simple expansions
    const expansion = annotationExpansions[name];
    if (expansion) {
      Object.assign(result, expansion);
      continue;
    }

    // Unknown annotation → warning
    if (!knownAnnotations.has(name)) {
      warnings.push({
        message: `unknown annotation @${name}`,
        line: ann.loc.line,
        column: ann.loc.column,
        code: "W001",
        suggestion: `Known annotations: ${[...knownAnnotations].sort().map(a => "@" + a).join(", ")}`,
      });
    }
  }

  return { typeAnnotation: result, warnings };
}

// Reverse: TypeAnnotation → list of annotation strings for the emitter
export function typeAnnotationToAnnotations(ta: TypeAnnotation): string[] {
  const anns: string[] = [];

  // Format
  if (ta.format) {
    const match = Object.entries(annotationExpansions).find(
      ([, v]) => v.format === ta.format
    );
    if (match) anns.push(`@${match[0]}`);
  }

  // Domain
  if (ta.domain) {
    const match = Object.entries(annotationExpansions).find(
      ([, v]) => v.domain === ta.domain
    );
    if (match) anns.push(`@${match[0]}`);
  }

  // Sensitivity
  if (ta.sensitivity) {
    const match = Object.entries(annotationExpansions).find(
      ([, v]) => v.sensitivity === ta.sensitivity
    );
    if (match) anns.push(`@${match[0]}`);
  }

  // Unit
  if (ta.unit) {
    const match = Object.entries(annotationExpansions).find(
      ([, v]) => v.unit === ta.unit
    );
    if (match) anns.push(`@${match[0]}`);
  }

  // Constraint
  if (ta.constraint) {
    anns.push(`@constraint("${ta.constraint}")`);
  }

  // Range
  if (ta.range) {
    anns.push(`@range(${ta.range[0]}, ${ta.range[1]})`);
  }

  // State type
  if (ta.state_type) {
    anns.push(`@state_type("${ta.state_type}")`);
  }

  return anns;
}

export { annotationExpansions, knownAnnotations };
