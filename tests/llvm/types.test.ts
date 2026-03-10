import { describe, it, expect } from "vitest";
import {
  mapTypeToLLVM, isSemanticType, getLLVMFieldType,
  generateStringStruct, generateListStruct, generateConfidenceStruct,
  generateNodeStructs, generateSemanticTypeAlias, collectStructTypes,
} from "../../src/compiler/llvm/types.js";
import type { AetherNode } from "../../src/compiler/llvm/types.js";

describe("LLVM Type Mapper", () => {
  describe("Base type mappings", () => {
    it("Bool → i1", () => {
      const r = mapTypeToLLVM({ type: "Bool" });
      expect(r.llvmType).toBe("i1");
      expect(r.byteSize).toBe(1);
      expect(r.alignment).toBe(1);
    });

    it("Int → i64", () => {
      const r = mapTypeToLLVM({ type: "Int" });
      expect(r.llvmType).toBe("i64");
      expect(r.byteSize).toBe(8);
    });

    it("Float64 → double", () => {
      const r = mapTypeToLLVM({ type: "Float64" });
      expect(r.llvmType).toBe("double");
    });

    it("Float32 → float", () => {
      const r = mapTypeToLLVM({ type: "Float32" });
      expect(r.llvmType).toBe("float");
      expect(r.byteSize).toBe(4);
    });

    it("Decimal → double (approximate)", () => {
      const r = mapTypeToLLVM({ type: "Decimal" });
      expect(r.llvmType).toBe("double");
    });

    it("String → %AetherString", () => {
      const r = mapTypeToLLVM({ type: "String" });
      expect(r.llvmType).toBe("%AetherString");
      expect(r.byteSize).toBe(16);
    });
  });

  describe("Generic type mappings", () => {
    it("List<Int> → %List_i64*", () => {
      const r = mapTypeToLLVM({ type: "List<Int>" });
      expect(r.llvmType).toBe("%List_i64*");
    });

    it("List<String> → %List_AetherString*", () => {
      const r = mapTypeToLLVM({ type: "List<String>" });
      expect(r.llvmType).toBe("%List_AetherString*");
    });

    it("List<Product> → %List_i8*", () => {
      const r = mapTypeToLLVM({ type: "List<Product>" });
      expect(r.llvmType).toBe("%List_i8*");
    });

    it("Map<String, Int> → %Map_AetherString_i64*", () => {
      const r = mapTypeToLLVM({ type: "Map<String, Int>" });
      expect(r.llvmType).toBe("%Map_AetherString_i64*");
    });
  });

  describe("Record/domain types", () => {
    it("AuthenticatedUser → i8* (opaque pointer)", () => {
      const r = mapTypeToLLVM({ type: "AuthenticatedUser" });
      expect(r.llvmType).toBe("i8*");
      expect(r.byteSize).toBe(8);
    });

    it("User → i8* (opaque pointer)", () => {
      const r = mapTypeToLLVM({ type: "User" });
      expect(r.llvmType).toBe("i8*");
    });
  });

  describe("Semantic type detection", () => {
    it("recognizes domain metadata", () => {
      expect(isSemanticType({ type: "String", domain: "authentication" })).toBe(true);
    });

    it("recognizes unit metadata", () => {
      expect(isSemanticType({ type: "Float64", unit: "USD" })).toBe(true);
    });

    it("recognizes dimension metadata", () => {
      expect(isSemanticType({ type: "Int", dimension: "count" })).toBe(true);
    });

    it("no metadata → not semantic", () => {
      expect(isSemanticType({ type: "Int" })).toBe(false);
    });
  });

  describe("Semantic type aliases", () => {
    it("generates alias with domain metadata comment", () => {
      const result = generateSemanticTypeAlias({ type: "String", domain: "authentication" });
      expect(result).toContain("authentication");
      expect(result).toContain("!aether.domain");
    });

    it("returns null for non-semantic types", () => {
      expect(generateSemanticTypeAlias({ type: "Int" })).toBeNull();
    });
  });

  describe("Struct definitions", () => {
    it("generates %String struct", () => {
      const s = generateStringStruct();
      expect(s).toContain("%String = type");
      expect(s).toContain("i64");
      expect(s).toContain("i8*");
    });

    it("generates %List_i64 struct", () => {
      const s = generateListStruct("i64");
      expect(s).toContain("%List_i64 = type");
      expect(s).toContain("i64*");
    });

    it("generates %ConfidenceValue struct", () => {
      const s = generateConfidenceStruct();
      expect(s).toContain("%ConfidenceValue = type");
      expect(s).toContain("double");
      expect(s).toContain("i1");
    });
  });

  describe("Node I/O struct generation", () => {
    const node: AetherNode = {
      id: "validate_email",
      in: {
        email: { type: "String", format: "email" },
      },
      out: {
        valid: { type: "Bool" },
        normalized: { type: "String" },
      },
      contract: {},
      effects: [],
      pure: true,
    };

    it("generates input struct with correct field count", () => {
      const structs = generateNodeStructs(node);
      expect(structs).toContain("%validate_email_in = type");
      expect(structs).toContain("%AetherString"); // email field
    });

    it("generates output struct with correct field count", () => {
      const structs = generateNodeStructs(node);
      expect(structs).toContain("%validate_email_out = type");
      expect(structs).toContain("i1"); // valid field
    });

    it("includes field name comments", () => {
      const structs = generateNodeStructs(node);
      expect(structs).toContain("email");
      expect(structs).toContain("valid, normalized");
    });

    it("handles multi-field input struct", () => {
      const multiNode: AetherNode = {
        id: "create_user",
        in: {
          email: { type: "String" },
          unique: { type: "Bool" },
        },
        out: {
          user: { type: "User" },
        },
        contract: {},
        effects: [],
      };

      const structs = generateNodeStructs(multiNode);
      expect(structs).toContain("%AetherString, i1");
    });
  });

  describe("collectStructTypes", () => {
    it("detects string usage", () => {
      const nodes: AetherNode[] = [{
        id: "n", in: { s: { type: "String" } }, out: {}, contract: {}, effects: [],
      }];
      const result = collectStructTypes(nodes);
      expect(result.hasStrings).toBe(true);
    });

    it("collects list element types", () => {
      const nodes: AetherNode[] = [{
        id: "n", in: { items: { type: "List<Int>" } }, out: {}, contract: {}, effects: [],
      }];
      const result = collectStructTypes(nodes);
      expect(result.listTypes.size).toBe(1);
      expect(result.listTypes.has("i64")).toBe(true);
    });

    it("collects semantic aliases", () => {
      const nodes: AetherNode[] = [{
        id: "n",
        in: { email: { type: "String", domain: "auth" } },
        out: {},
        contract: {},
        effects: [],
      }];
      const result = collectStructTypes(nodes);
      expect(result.semanticAliases.length).toBeGreaterThan(0);
    });
  });
});
