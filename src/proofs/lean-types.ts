/**
 * AETHER Lean 4 Type Mapper
 * Maps AETHER's type system to Lean 4 types for formal proof export.
 */

import type { TypeAnnotation, StateType } from "../ir/validator.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeanTypeMapping {
  aetherType: string;
  leanType: string;
  imports: string[];
}

export interface LeanStructure {
  name: string;
  source: string;
  imports: string[];
}

export interface LeanStateTypeExport {
  inductiveType: string;
  transitionRelation: string;
  neverTheorems: string[];
  terminalTheorems: string[];
  imports: string[];
}

// ─── Base Type Mapping ───────────────────────────────────────────────────────

const BASE_TYPE_MAP: Record<string, { lean: string; imports: string[] }> = {
  String:  { lean: "String",  imports: [] },
  Bool:    { lean: "Bool",    imports: [] },
  Int:     { lean: "Int",     imports: [] },
  Float64: { lean: "Float",   imports: [] },
  Decimal: { lean: "Float",   imports: [] },
};

function parseGenericType(type: string): { base: string; params: string[] } | null {
  const listMatch = type.match(/^List<(.+)>$/);
  if (listMatch) return { base: "List", params: [listMatch[1]] };
  const mapMatch = type.match(/^Map<(.+),\s*(.+)>$/);
  if (mapMatch) return { base: "Map", params: [mapMatch[1], mapMatch[2]] };
  return null;
}

export function mapTypeToLean(annotation: TypeAnnotation): LeanTypeMapping {
  const rawType = annotation.type;

  // Check for generic types first
  const generic = parseGenericType(rawType);
  if (generic) {
    if (generic.base === "List") {
      const inner = mapTypeToLean({ type: generic.params[0] });
      return {
        aetherType: rawType,
        leanType: `List ${inner.leanType}`,
        imports: [...inner.imports],
      };
    }
    if (generic.base === "Map") {
      const k = mapTypeToLean({ type: generic.params[0] });
      const v = mapTypeToLean({ type: generic.params[1] });
      return {
        aetherType: rawType,
        leanType: `Std.HashMap ${k.leanType} ${v.leanType}`,
        imports: ["Std.Data.HashMap", ...k.imports, ...v.imports],
      };
    }
  }

  // Base types
  const base = BASE_TYPE_MAP[rawType];
  if (base) {
    const result: LeanTypeMapping = {
      aetherType: rawType,
      leanType: base.lean,
      imports: [...base.imports],
    };
    // Add comment note for Decimal approximation
    if (rawType === "Decimal") {
      result.leanType = "Float /- Decimal: approximate -/";
    }
    return result;
  }

  // Record type → Structure
  if (rawType === "Record") {
    return { aetherType: rawType, leanType: "Structure", imports: [] };
  }

  // Any other type treated as an opaque structure name
  return { aetherType: rawType, leanType: rawType, imports: [] };
}

// ─── Semantic Type → Newtype Wrapper ─────────────────────────────────────────

function toPascalCase(s: string): string {
  return s.replace(/(^|[_-])([a-z])/g, (_, __, c) => c.toUpperCase());
}

export function generateSemanticWrapper(
  name: string,
  annotation: TypeAnnotation,
): LeanStructure | null {
  // Only generate wrapper if annotation has domain, dimension, or unit
  if (!annotation.domain && !annotation.dimension && !annotation.unit) {
    return null;
  }

  const baseMapping = mapTypeToLean({ type: annotation.type });
  const baseLean = BASE_TYPE_MAP[annotation.type]?.lean ?? annotation.type;
  const structName = toPascalCase(name);
  const lines: string[] = [];

  // Comment with original AETHER type info
  const parts: string[] = [`type: "${annotation.type}"`];
  if (annotation.domain) parts.push(`domain: "${annotation.domain}"`);
  if (annotation.dimension) parts.push(`dimension: "${annotation.dimension}"`);
  if (annotation.unit) parts.push(`unit: "${annotation.unit}"`);
  if (annotation.format) parts.push(`format: "${annotation.format}"`);
  lines.push(`-- AETHER: { ${parts.join(", ")} }`);

  lines.push(`structure ${structName} where`);
  lines.push(`  value : ${baseLean}`);

  // Add constraints based on semantic info
  if (annotation.format === "uuid_v4") {
    lines.push(`  format_valid : value.length = 36  -- UUID format constraint`);
  }
  if (annotation.dimension === "currency") {
    lines.push(`  non_negative : value ≥ 0  -- from invariant`);
  }
  if (annotation.format === "email") {
    lines.push(`  is_lowercase : value = value.toLower`);
    lines.push(`  is_trimmed : value = value.trim`);
  }
  if (annotation.range) {
    lines.push(`  in_range : ${annotation.range[0]} ≤ value ∧ value ≤ ${annotation.range[1]}`);
  }

  lines.push("deriving Repr, BEq");

  return {
    name: structName,
    source: lines.join("\n"),
    imports: baseMapping.imports,
  };
}

// ─── State Type → Inductive + Transitions ────────────────────────────────────

function toSnakeCase(s: string): string {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
}

function stateLabel(stateId: string, stateName: string): string {
  return `${toSnakeCase(stateName)}`;
}

export function generateStateTypeExport(stateType: StateType): LeanStateTypeExport {
  const typeName = toPascalCase(stateType.id);
  const stateName = `${typeName}State`;

  // Inductive type for states
  const stateLines: string[] = [];
  stateLines.push(`-- AETHER: StateType ${stateType.id}`);
  stateLines.push(`inductive ${stateName} where`);
  for (const s of stateType.states) {
    stateLines.push(`  | ${toSnakeCase(s)}`);
  }
  stateLines.push("deriving Repr, BEq");

  // Transition relation
  const transLines: string[] = [];
  transLines.push(`-- Valid transitions`);
  transLines.push(`inductive ${typeName}Transition : ${stateName} → ${stateName} → Prop where`);
  for (const t of stateType.transitions) {
    const fromLabel = toSnakeCase(t.from);
    const toLabel = toSnakeCase(t.to);
    transLines.push(`  | ${fromLabel}_to_${toLabel} : ${typeName}Transition .${fromLabel} .${toLabel}`);
  }

  // Never-invariant theorems
  const neverTheorems: string[] = [];
  if (stateType.invariants?.never) {
    for (const n of stateType.invariants.never) {
      const fromLabel = toSnakeCase(n.from);
      const toLabel = toSnakeCase(n.to);
      const thmName = `no_${fromLabel}_to_${toLabel}`;
      neverTheorems.push(
        `-- Never-invariant: impossible transition\n` +
        `theorem ${thmName} : ¬ ${typeName}Transition .${fromLabel} .${toLabel} := by\n` +
        `  intro h; cases h`
      );
    }
  }

  // Terminal state theorems
  const terminalTheorems: string[] = [];
  if (stateType.invariants?.terminal) {
    for (const t of stateType.invariants.terminal) {
      const label = toSnakeCase(t);
      const thmName = `${label}_is_terminal`;
      terminalTheorems.push(
        `-- Terminal state: no outgoing transitions\n` +
        `theorem ${thmName} : ∀ s, ¬ ${typeName}Transition .${label} s := by\n` +
        `  intro s h; cases h`
      );
    }
  }

  return {
    inductiveType: stateLines.join("\n"),
    transitionRelation: transLines.join("\n"),
    neverTheorems,
    terminalTheorems,
    imports: [],
  };
}
