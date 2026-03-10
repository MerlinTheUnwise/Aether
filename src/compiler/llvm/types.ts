/**
 * AETHER → LLVM IR Type Mapper
 *
 * Maps AETHER type annotations to LLVM IR type representations.
 * Handles base types, semantic wrappers, strings, lists, records, and node I/O structs.
 */

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
  state_type?: string;
}

export interface LLVMTypeMapping {
  aetherType: string;
  llvmType: string;
  byteSize: number;
  alignment: number;
}

export interface AetherNode {
  id: string;
  in: Record<string, TypeAnnotation>;
  out: Record<string, TypeAnnotation>;
  contract: { pre?: string[]; post?: string[]; invariants?: string[] };
  confidence?: number;
  adversarial_check?: { break_if: string[] };
  effects: string[];
  pure?: boolean;
  recovery?: Record<string, { action: string; params?: Record<string, unknown> }>;
  supervised?: { reason: string; review_status?: string };
}

// ─── Base Type Mapping ────────────────────────────────────────────────────────

const BASE_TYPE_MAP: Record<string, { llvmType: string; byteSize: number; alignment: number }> = {
  Bool:    { llvmType: "i1",     byteSize: 1, alignment: 1 },
  Int:     { llvmType: "i64",    byteSize: 8, alignment: 8 },
  Float64: { llvmType: "double", byteSize: 8, alignment: 8 },
  Float32: { llvmType: "float",  byteSize: 4, alignment: 4 },
  Decimal: { llvmType: "double", byteSize: 8, alignment: 8 },
  String:  { llvmType: "%AetherString", byteSize: 16, alignment: 8 },
  // Common semantic types — all represented as opaque pointers at native level
  Email:   { llvmType: "%AetherString", byteSize: 16, alignment: 8 },
  URL:     { llvmType: "%AetherString", byteSize: 16, alignment: 8 },
  JSON:    { llvmType: "%AetherString", byteSize: 16, alignment: 8 },
  UUID:    { llvmType: "%AetherString", byteSize: 16, alignment: 8 },
  Void:    { llvmType: "void",   byteSize: 0, alignment: 0 },
};

// ─── Type Mapper ──────────────────────────────────────────────────────────────

/**
 * Map an AETHER TypeAnnotation to an LLVM IR type.
 */
export function mapTypeToLLVM(annotation: TypeAnnotation): LLVMTypeMapping {
  const aetherType = annotation.type;

  // Check base types first
  const base = BASE_TYPE_MAP[aetherType];
  if (base) {
    return { aetherType, ...base };
  }

  // List<T> → %List_T*
  const listMatch = aetherType.match(/^List<(.+)>$/);
  if (listMatch) {
    const innerMapping = mapTypeToLLVM({ type: listMatch[1] });
    const innerLLVM = innerMapping.llvmType.replace(/[%*]/g, "");
    return {
      aetherType,
      llvmType: `%List_${innerLLVM}*`,
      byteSize: 8,
      alignment: 8,
    };
  }

  // Map<K,V> → %Map_K_V*
  const mapMatch = aetherType.match(/^Map<(.+),\s*(.+)>$/);
  if (mapMatch) {
    const kMapping = mapTypeToLLVM({ type: mapMatch[1] });
    const vMapping = mapTypeToLLVM({ type: mapMatch[2] });
    const kLLVM = kMapping.llvmType.replace(/[%*]/g, "");
    const vLLVM = vMapping.llvmType.replace(/[%*]/g, "");
    return {
      aetherType,
      llvmType: `%Map_${kLLVM}_${vLLVM}*`,
      byteSize: 8,
      alignment: 8,
    };
  }

  // Any other type is treated as an opaque pointer (i8*)
  // Domain types (User, Order, Payment, etc.) are opaque at the native level
  return {
    aetherType,
    llvmType: "i8*",
    byteSize: 8,
    alignment: 8,
  };
}

/**
 * Check if a type annotation has semantic metadata (domain/unit/dimension).
 */
export function isSemanticType(annotation: TypeAnnotation): boolean {
  return !!(annotation.domain || annotation.unit || annotation.dimension);
}

/**
 * Get the raw LLVM type string for a type annotation (without pointer for inline struct fields).
 */
export function getLLVMFieldType(annotation: TypeAnnotation): string {
  return mapTypeToLLVM(annotation).llvmType;
}

// ─── Struct Definitions ───────────────────────────────────────────────────────

/**
 * Generate the %String struct definition.
 */
export function generateStringStruct(): string {
  return "%String = type { i64, i8* }  ; { length, data_ptr }";
}

/**
 * Generate a %List_T struct definition for a given element LLVM type.
 */
export function generateListStruct(elementLLVMType: string): string {
  const safeName = elementLLVMType.replace(/[%*]/g, "");
  return `%List_${safeName} = type { i64, ${elementLLVMType}*, i64 }  ; { length, data_ptr, capacity }`;
}

/**
 * Generate the %ConfidenceValue struct definition.
 */
export function generateConfidenceStruct(): string {
  return "%ConfidenceValue = type { double, i1 }  ; { confidence_score, needs_oversight }";
}

// ─── Node I/O Structs ─────────────────────────────────────────────────────────

/**
 * Generate LLVM IR struct definitions for a node's input and output ports.
 * Returns the struct definitions as LLVM IR text lines.
 */
export function generateNodeStructs(node: AetherNode): string {
  const lines: string[] = [];
  const safeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");

  // Input struct
  const inPorts = Object.entries(node.in);
  const inFields = inPorts.map(([name, ann]) => getLLVMFieldType(ann));
  const inComment = inPorts.map(([name]) => name).join(", ");
  lines.push(`%${safeId}_in = type { ${inFields.join(", ")} }  ; { ${inComment} }`);

  // Output struct
  const outPorts = Object.entries(node.out);
  const outFields = outPorts.map(([name, ann]) => getLLVMFieldType(ann));
  const outComment = outPorts.map(([name]) => name).join(", ");
  lines.push(`%${safeId}_out = type { ${outFields.join(", ")} }  ; { ${outComment} }`);

  return lines.join("\n");
}

/**
 * Generate semantic type alias with metadata comment.
 */
export function generateSemanticTypeAlias(annotation: TypeAnnotation): string | null {
  if (!isSemanticType(annotation)) return null;

  const baseMapping = mapTypeToLLVM({ type: annotation.type });
  const safeName = (annotation.domain || annotation.type).replace(/[^a-zA-Z0-9_]/g, "_");
  const baseLLVM = baseMapping.llvmType.replace(/\*$/, "");

  const metaParts: string[] = [];
  if (annotation.domain) metaParts.push(`"${annotation.domain}"`);
  if (annotation.unit) metaParts.push(`unit="${annotation.unit}"`);
  if (annotation.dimension) metaParts.push(`dim="${annotation.dimension}"`);

  const lines: string[] = [];
  lines.push(`; ${safeName} is ${annotation.type} with domain metadata`);
  lines.push(`; !aether.domain = !{!${metaParts.join(", !")}}`);
  return lines.join("\n");
}

/**
 * Collect all unique struct types needed for a set of nodes.
 */
export function collectStructTypes(nodes: AetherNode[]): {
  structs: string[];
  semanticAliases: string[];
  listTypes: Set<string>;
  hasStrings: boolean;
} {
  const structs: string[] = [];
  const semanticAliases: string[] = [];
  const listTypes = new Set<string>();
  let hasStrings = false;
  const seenSemantic = new Set<string>();

  for (const node of nodes) {
    // Generate node I/O structs
    structs.push(generateNodeStructs(node));

    // Scan all port types
    const allPorts = [...Object.values(node.in), ...Object.values(node.out)];
    for (const ann of allPorts) {
      if (ann.type === "String") hasStrings = true;

      const listMatch = ann.type.match(/^List<(.+)>$/);
      if (listMatch) {
        const innerMapping = mapTypeToLLVM({ type: listMatch[1] });
        listTypes.add(innerMapping.llvmType);
      }

      if (isSemanticType(ann)) {
        const key = `${ann.domain || ""}:${ann.type}`;
        if (!seenSemantic.has(key)) {
          seenSemantic.add(key);
          const alias = generateSemanticTypeAlias(ann);
          if (alias) semanticAliases.push(alias);
        }
      }
    }
  }

  return { structs, semanticAliases, listTypes, hasStrings };
}
