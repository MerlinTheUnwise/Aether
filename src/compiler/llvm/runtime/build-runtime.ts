/**
 * AETHER Runtime Build Script
 *
 * Checks for clang, builds the C runtime library, copies output, reports result.
 * Used by the `build-runtime` CLI command.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface BuildResult {
  success: boolean;
  clangFound: boolean;
  clangVersion: string;
  staticLib: boolean;
  sharedLib: boolean;
  errors: string[];
  outputDir: string;
}

/**
 * Check if clang is available and return its version.
 */
export function checkClang(): { found: boolean; version: string } {
  try {
    const output = execSync("clang --version", { encoding: "utf-8", timeout: 10000 });
    const match = output.match(/clang version (\S+)/);
    return { found: true, version: match ? match[1] : "unknown" };
  } catch {
    return { found: false, version: "" };
  }
}

/**
 * Check if make (or mingw32-make) is available.
 */
function findMake(): string | null {
  for (const cmd of ["make", "mingw32-make"]) {
    try {
      execSync(`${cmd} --version`, { encoding: "utf-8", timeout: 10000, stdio: "pipe" });
      return cmd;
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * Build the runtime library. Returns a BuildResult.
 * If checkOnly is true, just checks prerequisites without building.
 */
export function buildRuntime(options?: { checkOnly?: boolean }): BuildResult {
  const runtimeDir = join(__dirname);
  const result: BuildResult = {
    success: false,
    clangFound: false,
    clangVersion: "",
    staticLib: false,
    sharedLib: false,
    errors: [],
    outputDir: runtimeDir,
  };

  // Check clang
  const clang = checkClang();
  result.clangFound = clang.found;
  result.clangVersion = clang.version;

  if (!clang.found) {
    result.errors.push("clang not found in PATH. Install LLVM/Clang to build the native runtime.");
    return result;
  }

  // Check source files exist
  const headerPath = join(runtimeDir, "aether_runtime.h");
  const implPath = join(runtimeDir, "aether_runtime.c");

  if (!existsSync(headerPath)) {
    result.errors.push(`Header not found: ${headerPath}`);
    return result;
  }
  if (!existsSync(implPath)) {
    result.errors.push(`Implementation not found: ${implPath}`);
    return result;
  }

  if (options?.checkOnly) {
    result.success = true;
    return result;
  }

  // Find make tool
  const makeCmd = findMake();

  if (makeCmd) {
    // Use Makefile
    try {
      execSync(`${makeCmd} -C "${runtimeDir}" clean all`, {
        encoding: "utf-8",
        timeout: 60000,
        stdio: "pipe",
      });
    } catch (e) {
      const msg = e instanceof Error ? (e as any).stderr || e.message : String(e);
      result.errors.push(`Build failed: ${msg}`);
      return result;
    }
  } else {
    // Direct clang invocation as fallback
    try {
      // Build object file
      execSync(
        `clang -std=c11 -Wall -Wextra -Wpedantic -O2 -fPIC -c "${join(runtimeDir, "aether_runtime.c")}" -o "${join(runtimeDir, "aether_runtime.o")}"`,
        { encoding: "utf-8", timeout: 30000, stdio: "pipe" },
      );
      // Build static lib
      execSync(
        `ar rcs "${join(runtimeDir, "libaether_runtime.a")}" "${join(runtimeDir, "aether_runtime.o")}"`,
        { encoding: "utf-8", timeout: 10000, stdio: "pipe" },
      );
    } catch (e) {
      const msg = e instanceof Error ? (e as any).stderr || e.message : String(e);
      result.errors.push(`Build failed (direct): ${msg}`);
      return result;
    }
  }

  // Check outputs
  const isWindows = process.platform === "win32";
  const staticPath = join(runtimeDir, "libaether_runtime.a");
  const sharedPath = join(runtimeDir, isWindows ? "libaether_runtime.dll" : "libaether_runtime.so");

  result.staticLib = existsSync(staticPath);
  result.sharedLib = existsSync(sharedPath);
  result.success = result.staticLib; // static lib is the minimum requirement

  if (!result.staticLib) {
    result.errors.push("Static library was not produced");
  }

  return result;
}

/**
 * Get the list of all runtime function signatures (for codegen matching).
 */
export function getRuntimeSignatures(): RuntimeSignature[] {
  return RUNTIME_SIGNATURES;
}

export interface RuntimeSignature {
  name: string;
  returnType: string;
  params: string[];
  category: string;
}

const RUNTIME_SIGNATURES: RuntimeSignature[] = [
  // String
  { name: "aether_string_new", returnType: "%AetherString", params: ["i8*"], category: "string" },
  { name: "aether_string_copy", returnType: "%AetherString", params: ["%AetherString"], category: "string" },
  { name: "aether_string_free", returnType: "void", params: ["%AetherString*"], category: "string" },
  { name: "aether_string_length", returnType: "i64", params: ["%AetherString"], category: "string" },
  { name: "aether_string_is_lowercase", returnType: "i1", params: ["%AetherString"], category: "string" },
  { name: "aether_string_is_trimmed", returnType: "i1", params: ["%AetherString"], category: "string" },
  { name: "aether_string_equals", returnType: "i1", params: ["%AetherString", "%AetherString"], category: "string" },
  { name: "aether_string_to_lower", returnType: "%AetherString", params: ["%AetherString"], category: "string" },
  { name: "aether_string_trim", returnType: "%AetherString", params: ["%AetherString"], category: "string" },

  // List
  { name: "aether_list_new", returnType: "%AetherList", params: ["i64"], category: "list" },
  { name: "aether_list_free", returnType: "void", params: ["%AetherList*"], category: "list" },
  { name: "aether_list_push", returnType: "void", params: ["%AetherList*", "i8*"], category: "list" },
  { name: "aether_list_get", returnType: "i8*", params: ["%AetherList*", "i64"], category: "list" },
  { name: "aether_list_length", returnType: "i64", params: ["%AetherList*"], category: "list" },
  { name: "aether_list_contains", returnType: "i1", params: ["%AetherList*", "i8*", "i8*"], category: "list" },
  { name: "aether_list_is_distinct", returnType: "i1", params: ["%AetherList*", "i8*"], category: "list" },

  // Confidence
  { name: "aether_confidence_new", returnType: "%AetherConfidence", params: ["double", "double"], category: "confidence" },
  { name: "aether_confidence_propagate", returnType: "%AetherConfidence", params: ["double", "%AetherConfidence*", "i64", "double"], category: "confidence" },
  { name: "aether_min_confidence", returnType: "double", params: ["double*", "i64"], category: "confidence" },

  // Effects
  { name: "aether_effect_log_new", returnType: "%AetherEffectLog", params: [], category: "effects" },
  { name: "aether_effect_log_record", returnType: "void", params: ["%AetherEffectLog*", "i8*", "i8*"], category: "effects" },
  { name: "aether_effect_log_free", returnType: "void", params: ["%AetherEffectLog*"], category: "effects" },

  // Contracts
  { name: "aether_contract_violation", returnType: "void", params: ["i8*", "i8*", "i8*"], category: "contracts" },

  // Error state
  { name: "aether_set_error", returnType: "void", params: ["i32", "i8*"], category: "error" },
  { name: "aether_get_error", returnType: "%AetherError*", params: [], category: "error" },
  { name: "aether_clear_error", returnType: "void", params: [], category: "error" },
  { name: "aether_has_error", returnType: "i1", params: [], category: "error" },

  // Recovery
  { name: "aether_recovery_enter", returnType: "void", params: ["i8*"], category: "recovery" },
  { name: "aether_recovery_exit", returnType: "void", params: ["i8*"], category: "recovery" },
  { name: "aether_recovery_set_condition", returnType: "void", params: ["i8*"], category: "recovery" },
  { name: "aether_recovery_get_condition", returnType: "i8*", params: [], category: "recovery" },
  { name: "aether_sleep_ms", returnType: "void", params: ["i64"], category: "recovery" },
  { name: "aether_report_error", returnType: "void", params: ["i8*", "i8*"], category: "recovery" },
  { name: "aether_escalate", returnType: "void", params: ["i8*", "i8*"], category: "recovery" },
  { name: "aether_was_escalated", returnType: "i32", params: [], category: "recovery" },
  { name: "aether_fatal", returnType: "void", params: ["i8*"], category: "recovery" },
  { name: "aether_string_eq_cstr", returnType: "i1", params: ["i8*", "i8*"], category: "recovery" },

  // Contracts (extended)
  { name: "aether_contract_set_mode", returnType: "void", params: ["i32"], category: "contracts" },
  { name: "aether_contract_assert", returnType: "void", params: ["i1", "i8*"], category: "contracts" },
  { name: "aether_contract_adversarial", returnType: "void", params: ["i1", "i8*"], category: "contracts" },
  { name: "aether_contract_failure_count", returnType: "i64", params: [], category: "contracts" },

  // Confidence (extended)
  { name: "aether_confidence_set", returnType: "void", params: ["i8*", "double"], category: "confidence" },
  { name: "aether_confidence_get", returnType: "double", params: ["i8*"], category: "confidence" },
  { name: "aether_log_skip", returnType: "void", params: ["i8*", "double"], category: "confidence" },

  // Arena
  { name: "aether_arena_new", returnType: "%AetherArena", params: ["i64"], category: "arena" },
  { name: "aether_arena_alloc", returnType: "i8*", params: ["%AetherArena*", "i64"], category: "arena" },
  { name: "aether_arena_reset", returnType: "void", params: ["%AetherArena*"], category: "arena" },
  { name: "aether_arena_free", returnType: "void", params: ["%AetherArena*"], category: "arena" },

  // Execution log
  { name: "aether_log_new", returnType: "%AetherExecutionLog", params: [], category: "logging" },
  { name: "aether_log_record", returnType: "void", params: ["%AetherExecutionLog*", "%AetherNodeLog"], category: "logging" },
  { name: "aether_log_print", returnType: "void", params: ["%AetherExecutionLog*"], category: "logging" },
  { name: "aether_log_free", returnType: "void", params: ["%AetherExecutionLog*"], category: "logging" },
  { name: "aether_time_ms", returnType: "double", params: [], category: "logging" },

  // Thread pool
  { name: "aether_pool_new", returnType: "%AetherThreadPool*", params: ["i64"], category: "threadpool" },
  { name: "aether_pool_submit", returnType: "%AetherTask*", params: ["%AetherThreadPool*", "i8*", "i8*", "i8*"], category: "threadpool" },
  { name: "aether_pool_wait_all", returnType: "void", params: ["%AetherThreadPool*"], category: "threadpool" },
  { name: "aether_pool_free", returnType: "void", params: ["%AetherThreadPool*"], category: "threadpool" },
  { name: "aether_get_num_cores", returnType: "i64", params: [], category: "threadpool" },
  { name: "aether_execute_wave", returnType: "void", params: ["%AetherThreadPool*", "%AetherWave*"], category: "threadpool" },
];
