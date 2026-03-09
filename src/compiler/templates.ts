/**
 * AETHER Template Engine
 *
 * Handles template instantiation with contract verification.
 * Templates are parameterized subgraphs that can be instantiated
 * with type-safe bindings.
 */

import type {
  AetherTemplate,
  AetherTemplateInstance,
  AetherTemplateParameter,
  AetherNode,
  AetherEdge,
  TypeAnnotation,
  ValidationResult,
} from "../ir/validator.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstantiationResult {
  success: boolean;
  nodes: AetherNode[];
  edges: AetherEdge[];
  errors: string[];
  warnings: string[];
}

// ─── Template Validation ──────────────────────────────────────────────────────

export function validateTemplate(template: AetherTemplate): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!template.id || template.id.length === 0) {
    errors.push("Template must have a non-empty id");
  }

  if (!template.parameters || !Array.isArray(template.parameters)) {
    errors.push("Template must have a parameters array");
  } else {
    const paramNames = new Set<string>();
    for (const param of template.parameters) {
      if (!param.name) {
        errors.push("Template parameter must have a name");
      } else if (paramNames.has(param.name)) {
        errors.push(`Duplicate template parameter: "${param.name}"`);
      } else {
        paramNames.add(param.name);
      }

      if (!param.kind || !["type", "value", "effect", "node_id"].includes(param.kind)) {
        errors.push(`Template parameter "${param.name}": invalid kind "${param.kind}"`);
      }
    }
  }

  if (!template.nodes || !Array.isArray(template.nodes)) {
    errors.push("Template must have a nodes array");
  }

  if (!template.edges || !Array.isArray(template.edges)) {
    errors.push("Template must have an edges array");
  }

  // Check that parameter references in nodes actually reference declared parameters
  const declaredParams = new Set(template.parameters.map(p => p.name));
  for (const node of template.nodes) {
    const refs = collectParameterRefs(node);
    for (const ref of refs) {
      if (!declaredParams.has(ref)) {
        warnings.push(`Template node "${node.id}" references undeclared parameter "$${ref}"`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    supervisedCount: 0,
    holeCount: 0,
    completeness: 1,
  };
}

// ─── Parameter Reference Collection ──────────────────────────────────────────

function collectParameterRefs(node: AetherNode): Set<string> {
  const refs = new Set<string>();
  const json = JSON.stringify(node);
  const matches = json.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g);
  for (const match of matches) {
    refs.add(match[1]);
  }
  return refs;
}

// ─── Binding Validation ──────────────────────────────────────────────────────

function validateBindings(
  template: AetherTemplate,
  bindings: Record<string, unknown>,
  existingNodeIds?: Set<string>,
): string[] {
  const errors: string[] = [];

  // Check completeness: every parameter must have a binding
  for (const param of template.parameters) {
    if (!(param.name in bindings)) {
      errors.push(`parameter "${param.name}" requires a binding of kind "${param.kind}"`);
      continue;
    }

    const value = bindings[param.name];

    // Validate binding kind
    switch (param.kind) {
      case "type": {
        if (typeof value !== "object" || value === null || !("type" in value)) {
          errors.push(
            `parameter "${param.name}": expected a TypeAnnotation object (kind "type"), got ${typeof value}`
          );
        }
        break;
      }
      case "value": {
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
          errors.push(
            `parameter "${param.name}": expected a literal value (string, number, or boolean) for kind "value", got ${typeof value}`
          );
        }
        break;
      }
      case "effect": {
        if (typeof value !== "string") {
          errors.push(
            `parameter "${param.name}": expected a string for kind "effect", got ${typeof value}`
          );
        }
        break;
      }
      case "node_id": {
        if (typeof value !== "string") {
          errors.push(
            `parameter "${param.name}": expected a string for kind "node_id", got ${typeof value}`
          );
        } else if (existingNodeIds && !existingNodeIds.has(value)) {
          errors.push(
            `parameter "${param.name}": node_id "${value}" does not match any existing node`
          );
        }
        break;
      }
    }

    // Validate constraint if present
    if (param.constraint && value !== undefined) {
      const constraintError = validateConstraint(param, value);
      if (constraintError) {
        errors.push(constraintError);
      }
    }
  }

  // Check for extra bindings
  const paramNames = new Set(template.parameters.map(p => p.name));
  for (const key of Object.keys(bindings)) {
    if (!paramNames.has(key)) {
      errors.push(`unknown parameter "${key}" in bindings`);
    }
  }

  return errors;
}

function validateConstraint(param: AetherTemplateParameter, value: unknown): string | null {
  const constraint = param.constraint!;

  if (param.kind === "value" && typeof value === "number") {
    // Numeric constraints: "> 0", ">= 1", "< 100", etc.
    const match = constraint.match(/^([><!]=?)\s*(-?\d+(?:\.\d+)?)$/);
    if (match) {
      const [, op, numStr] = match;
      const threshold = parseFloat(numStr);
      let satisfied = false;
      switch (op) {
        case ">": satisfied = value > threshold; break;
        case ">=": satisfied = value >= threshold; break;
        case "<": satisfied = value < threshold; break;
        case "<=": satisfied = value <= threshold; break;
        case "!=": satisfied = value !== threshold; break;
      }
      if (!satisfied) {
        return `parameter "${param.name}": value ${value} does not satisfy constraint "${constraint}"`;
      }
    }
  }

  // Type constraints like "has Ord" — we accept them as-is for now (structural check)
  // More constraints can be added here in the future

  return null;
}

// ─── Template Instantiation ──────────────────────────────────────────────────

export function instantiateTemplate(
  template: AetherTemplate,
  instance: AetherTemplateInstance,
  existingNodeIds?: Set<string>,
): InstantiationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Step 1-3: Validate bindings
  const bindingErrors = validateBindings(template, instance.bindings, existingNodeIds);
  if (bindingErrors.length > 0) {
    return {
      success: false,
      nodes: [],
      edges: [],
      errors: bindingErrors,
      warnings,
    };
  }

  // Build substitution map
  const substitutions = new Map<string, unknown>();
  for (const param of template.parameters) {
    substitutions.set(param.name, instance.bindings[param.name]);
  }

  // Step 4: Substitute parameters in nodes
  const prefix = instance.id;
  const concreteNodes: AetherNode[] = [];

  for (const templateNode of template.nodes) {
    const substituted = substituteNode(templateNode, substitutions);
    // Step 5: Prefix node IDs
    substituted.id = `${prefix}_${templateNode.id}`;
    concreteNodes.push(substituted);
  }

  // Step 6: Prefix edge references
  const concreteEdges: AetherEdge[] = [];
  for (const templateEdge of template.edges) {
    concreteEdges.push({
      from: prefixEdgeRef(templateEdge.from, prefix, template),
      to: prefixEdgeRef(templateEdge.to, prefix, template),
    });
  }

  return {
    success: true,
    nodes: concreteNodes,
    edges: concreteEdges,
    errors,
    warnings,
  };
}

function prefixEdgeRef(ref: string, prefix: string, template: AetherTemplate): string {
  const dot = ref.indexOf(".");
  if (dot < 0) return ref;
  const nodeId = ref.slice(0, dot);
  const portName = ref.slice(dot + 1);

  // Check if this references a template-internal node
  const isTemplateNode = template.nodes.some(n => n.id === nodeId);
  if (isTemplateNode) {
    return `${prefix}_${nodeId}.${portName}`;
  }

  // External reference (e.g., from $node_id binding) — leave as-is
  return ref;
}

function substituteNode(node: AetherNode, substitutions: Map<string, unknown>): AetherNode {
  // Deep clone via JSON round-trip, then walk and substitute
  const json = JSON.stringify(node);
  const substituted = substituteString(json, substitutions);
  return JSON.parse(substituted) as AetherNode;
}

function substituteString(str: string, substitutions: Map<string, unknown>): string {
  // Replace "$ParamName" (quoted) with bound values
  // For type bindings (objects with "type" field), substitute just the type name string
  // For other objects, substitute the full JSON
  // For primitives, substitute the JSON-stringified value
  return str.replace(/"\$([A-Za-z_][A-Za-z0-9_]*)"/g, (_match, name) => {
    if (substitutions.has(name)) {
      const value = substitutions.get(name);
      // Type annotations: substitute the type name as a string
      if (typeof value === "object" && value !== null && "type" in value) {
        return JSON.stringify((value as TypeAnnotation).type);
      }
      return JSON.stringify(value);
    }
    return _match;
  }).replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
    // Unquoted $param references (inside compound strings like "List<$T>")
    if (substitutions.has(name)) {
      const value = substitutions.get(name);
      if (typeof value === "string") {
        return value;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      if (typeof value === "object" && value !== null && "type" in value) {
        return (value as TypeAnnotation).type;
      }
    }
    return _match;
  });
}
