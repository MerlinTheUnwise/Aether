import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { LLVMCodeGenerator, summarizeModule } from "../../src/compiler/llvm/codegen.js";
import { getRuntimeSignatures, checkClang, type RuntimeSignature } from "../../src/compiler/llvm/runtime/build-runtime.js";

const RUNTIME_DIR = "src/compiler/llvm/runtime";

describe("Runtime Library", () => {
  describe("File existence", () => {
    it("header file exists", () => {
      expect(existsSync(join(RUNTIME_DIR, "aether_runtime.h"))).toBe(true);
    });

    it("implementation file exists", () => {
      expect(existsSync(join(RUNTIME_DIR, "aether_runtime.c"))).toBe(true);
    });

    it("Makefile exists", () => {
      expect(existsSync(join(RUNTIME_DIR, "Makefile"))).toBe(true);
    });

    it("build script exists", () => {
      expect(existsSync(join(RUNTIME_DIR, "build-runtime.ts"))).toBe(true);
    });
  });

  describe("Header content", () => {
    const header = readFileSync(join(RUNTIME_DIR, "aether_runtime.h"), "utf-8");

    it("has include guard", () => {
      expect(header).toContain("#ifndef AETHER_RUNTIME_H");
      expect(header).toContain("#define AETHER_RUNTIME_H");
      expect(header).toContain("#endif");
    });

    it("includes required C headers", () => {
      expect(header).toContain("#include <stdint.h>");
      expect(header).toContain("#include <stdbool.h>");
      expect(header).toContain("#include <stddef.h>");
    });

    it("declares AetherString type and functions", () => {
      expect(header).toContain("AetherString");
      expect(header).toContain("aether_string_new");
      expect(header).toContain("aether_string_length");
      expect(header).toContain("aether_string_is_lowercase");
      expect(header).toContain("aether_string_is_trimmed");
      expect(header).toContain("aether_string_equals");
    });

    it("declares AetherList type and functions", () => {
      expect(header).toContain("AetherList");
      expect(header).toContain("aether_list_new");
      expect(header).toContain("aether_list_push");
      expect(header).toContain("aether_list_contains");
      expect(header).toContain("aether_list_is_distinct");
    });

    it("declares AetherConfidence type and functions", () => {
      expect(header).toContain("AetherConfidence");
      expect(header).toContain("aether_confidence_new");
      expect(header).toContain("aether_confidence_propagate");
      expect(header).toContain("aether_min_confidence");
    });

    it("declares contract violation handler", () => {
      expect(header).toContain("aether_contract_violation");
    });

    it("declares error state functions", () => {
      expect(header).toContain("AetherError");
      expect(header).toContain("AetherErrorCode");
      expect(header).toContain("aether_set_error");
      expect(header).toContain("aether_get_error");
      expect(header).toContain("aether_clear_error");
      expect(header).toContain("aether_has_error");
    });

    it("declares memory arena functions", () => {
      expect(header).toContain("AetherArena");
      expect(header).toContain("aether_arena_new");
      expect(header).toContain("aether_arena_alloc");
      expect(header).toContain("aether_arena_reset");
      expect(header).toContain("aether_arena_free");
    });

    it("declares execution timing functions", () => {
      expect(header).toContain("AetherNodeLog");
      expect(header).toContain("AetherExecutionLog");
      expect(header).toContain("aether_log_new");
      expect(header).toContain("aether_log_record");
      expect(header).toContain("aether_log_print");
      expect(header).toContain("aether_time_ms");
    });

    it("declares effect logging functions", () => {
      expect(header).toContain("AetherEffectLog");
      expect(header).toContain("aether_effect_log_new");
      expect(header).toContain("aether_effect_log_record");
      expect(header).toContain("aether_effect_log_free");
    });
  });

  describe("Implementation content", () => {
    const impl = readFileSync(join(RUNTIME_DIR, "aether_runtime.c"), "utf-8");

    it("includes the runtime header", () => {
      expect(impl).toContain('#include "aether_runtime.h"');
    });

    it("implements all string functions", () => {
      expect(impl).toContain("aether_string_new");
      expect(impl).toContain("aether_string_copy");
      expect(impl).toContain("aether_string_free");
      expect(impl).toContain("aether_string_length");
      expect(impl).toContain("aether_string_is_lowercase");
      expect(impl).toContain("aether_string_is_trimmed");
      expect(impl).toContain("aether_string_equals");
      expect(impl).toContain("aether_string_to_lower");
      expect(impl).toContain("aether_string_trim");
    });

    it("implements list with realloc growth", () => {
      expect(impl).toContain("realloc");
      expect(impl).toContain("aether_list_push");
    });

    it("implements contract violation with abort", () => {
      expect(impl).toContain("abort()");
      expect(impl).toContain("CONTRACT VIOLATION");
    });

    it("uses thread-local for error state", () => {
      expect(impl).toMatch(/_Thread_local|static AetherError tls_error/);
    });

    it("implements bump allocator arena", () => {
      expect(impl).toContain("aether_arena_alloc");
      expect(impl).toContain("arena->offset");
    });

    it("uses clock() for timing", () => {
      expect(impl).toContain("clock()");
      expect(impl).toContain("CLOCKS_PER_SEC");
    });
  });

  describe("Runtime signatures", () => {
    const sigs = getRuntimeSignatures();

    it("exports a non-empty signature list", () => {
      expect(sigs.length).toBeGreaterThan(0);
    });

    it("has all expected categories", () => {
      const categories = new Set(sigs.map(s => s.category));
      expect(categories.has("string")).toBe(true);
      expect(categories.has("list")).toBe(true);
      expect(categories.has("confidence")).toBe(true);
      expect(categories.has("contracts")).toBe(true);
      expect(categories.has("effects")).toBe(true);
      expect(categories.has("error")).toBe(true);
      expect(categories.has("arena")).toBe(true);
      expect(categories.has("logging")).toBe(true);
    });

    it("each signature has name, returnType, params, and category", () => {
      for (const sig of sigs) {
        expect(sig.name).toBeTruthy();
        expect(sig.returnType).toBeTruthy();
        expect(Array.isArray(sig.params)).toBe(true);
        expect(sig.category).toBeTruthy();
      }
    });

    it("all C function names match header declarations", () => {
      const header = readFileSync(join(RUNTIME_DIR, "aether_runtime.h"), "utf-8");
      for (const sig of sigs) {
        expect(header).toContain(sig.name);
      }
    });

    it("contract_violation takes 3 string params", () => {
      const cv = sigs.find(s => s.name === "aether_contract_violation");
      expect(cv).toBeDefined();
      expect(cv!.returnType).toBe("void");
      expect(cv!.params).toEqual(["i8*", "i8*", "i8*"]);
    });

    it("min_confidence takes double* and count", () => {
      const mc = sigs.find(s => s.name === "aether_min_confidence");
      expect(mc).toBeDefined();
      expect(mc!.returnType).toBe("double");
      expect(mc!.params).toEqual(["double*", "i64"]);
    });
  });

  describe("checkClang", () => {
    it("returns an object with found and version fields", () => {
      const result = checkClang();
      expect(typeof result.found).toBe("boolean");
      expect(typeof result.version).toBe("string");
    });
  });
});

describe("Codegen-Runtime Integration", () => {
  function loadGraph(name: string) {
    const path = `src/ir/examples/${name}.json`;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  describe("Runtime declarations in generated IR", () => {
    const graph = loadGraph("user-registration");
    const gen = new LLVMCodeGenerator();
    const mod = gen.generateModule(graph);
    const text = gen.serialize(mod);

    it("includes runtime struct definitions", () => {
      expect(text).toContain("%AetherString = type");
      expect(text).toContain("%AetherList = type");
      expect(text).toContain("%AetherConfidence = type");
      expect(text).toContain("%AetherEffectLog = type");
      expect(text).toContain("%AetherError = type");
      expect(text).toContain("%AetherArena = type");
      expect(text).toContain("%AetherNodeLog = type");
      expect(text).toContain("%AetherExecutionLog = type");
    });

    it("declares all runtime functions", () => {
      const sigs = getRuntimeSignatures();
      for (const sig of sigs) {
        expect(text).toContain(`@${sig.name}`);
      }
    });

    it("runtime declarations match C signatures with MSVC ABI", () => {
      const sigs = getRuntimeSignatures();
      for (const sig of sigs) {
        // Large struct returns use sret pattern
        const isLargeReturn = sig.returnType.startsWith("%") && !sig.returnType.includes("*");
        const abiParams = sig.params.map(p => (p.startsWith("%") && !p.includes("*")) ? `${p}*` : p);
        if (isLargeReturn) {
          const sretParam = `${sig.returnType}* sret(${sig.returnType})`;
          const paramStr = [sretParam, ...abiParams].join(", ");
          const declPattern = `declare void @${sig.name}(${paramStr})`;
          expect(text).toContain(declPattern);
        } else {
          const paramStr = abiParams.join(", ");
          const declPattern = `declare ${sig.returnType} @${sig.name}(${paramStr})`;
          expect(text).toContain(declPattern);
        }
      }
    });

    it("main function initializes arena", () => {
      expect(text).toContain("aether_arena_new");
      expect(text).toContain("%arena");
    });

    it("main function initializes execution log", () => {
      expect(text).toContain("aether_log_new");
      expect(text).toContain("%exec_log");
    });

    it("main function cleans up arena and log", () => {
      expect(text).toContain("aether_arena_free");
      expect(text).toContain("aether_log_print");
      expect(text).toContain("aether_log_free");
    });
  });

  describe("Struct layout matching", () => {
    const graph = loadGraph("user-registration");
    const gen = new LLVMCodeGenerator();
    const mod = gen.generateModule(graph);
    const text = gen.serialize(mod);

    it("AetherString layout matches C: { i64, i8* }", () => {
      expect(text).toContain("%AetherString = type { i64, i8* }");
    });

    it("AetherList layout matches C: { i64, i8*, i64, i64 }", () => {
      expect(text).toContain("%AetherList = type { i64, i8*, i64, i64 }");
    });

    it("AetherConfidence layout matches C: { double, i1 }", () => {
      expect(text).toContain("%AetherConfidence = type { double, i1 }");
    });

    it("AetherArena layout matches C: { i8*, i64, i64 }", () => {
      expect(text).toContain("%AetherArena = type { i8*, i64, i64 }");
    });

    it("AetherError layout matches C: { i32, [256 x i8] }", () => {
      expect(text).toContain("%AetherError = type { i32, [256 x i8] }");
    });

    it("AetherNodeLog layout matches C: { i8*, double, double, double, i1 }", () => {
      expect(text).toContain("%AetherNodeLog = type { i8*, double, double, double, i1 }");
    });
  });

  describe("Summary includes runtime deps", () => {
    const graph = loadGraph("user-registration");
    const gen = new LLVMCodeGenerator();
    const mod = gen.generateModule(graph);
    const text = gen.serialize(mod);
    const summary = summarizeModule(mod, text);

    it("reports runtime dependencies from C library", () => {
      expect(summary.runtimeDeps).toContain("aether_contract_violation");
      expect(summary.runtimeDeps).toContain("aether_arena_new");
      expect(summary.runtimeDeps).toContain("aether_log_new");
    });

    it("struct count includes runtime structs", () => {
      // At least the 8 runtime structs + node I/O structs + ConfidenceValue + String
      expect(summary.structCount).toBeGreaterThanOrEqual(10);
    });
  });
});
