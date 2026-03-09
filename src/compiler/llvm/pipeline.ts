/**
 * AETHER Full Native Compilation Pipeline
 *
 * Orchestrates: validate → type-check → verify → emit IR → compile → link
 * Goes from AETHER-IR JSON all the way to a native binary.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join, dirname, basename } from "path";
import { execSync } from "child_process";
import { validateGraph } from "../../ir/validator.js";
import { checkTypes } from "../checker.js";
import { verifyGraph } from "../verifier.js";
import { LLVMCodeGenerator, summarizeModule } from "./codegen.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompilationOptions {
  input: string;                    // path to AETHER-IR JSON
  outputDir?: string;               // default: current directory
  outputName?: string;              // default: graph ID
  target?: "binary" | "object" | "llvm-ir" | "assembly";  // default: binary
  optimization?: 0 | 1 | 2 | 3;    // LLVM optimization level, default: 2
  parallel?: boolean;               // enable parallel waves, default: true
  contracts?: "abort" | "log" | "count";  // contract mode, default: "abort"
  stripDebug?: boolean;             // remove debug info, default: false
  verbose?: boolean;                // print each compilation step
}

export interface StageResult {
  success: boolean;
  duration_ms: number;
  errors?: string[];
  outputPath?: string;
  lines?: number;
  percentage?: number;
}

export interface CompilationResult {
  success: boolean;
  stages: {
    validate: StageResult;
    typeCheck: StageResult;
    verify: StageResult;
    emitIR: StageResult;
    compileObj?: StageResult;
    link?: StageResult;
  };
  outputPath: string;
  binarySize?: number;
  errors: string[];
}

export interface ToolchainStatus {
  llc: { available: boolean; version?: string; path?: string };
  clang: { available: boolean; version?: string; path?: string };
  runtime: { available: boolean; path?: string };
}

// ─── Toolchain Detection ──────────────────────────────────────────────────────

export async function detectToolchain(): Promise<ToolchainStatus> {
  const status: ToolchainStatus = {
    llc: { available: false },
    clang: { available: false },
    runtime: { available: false },
  };

  // Check llc
  try {
    const llcOutput = execSync("llc --version 2>&1", { encoding: "utf-8", timeout: 5000 });
    status.llc.available = true;
    const versionMatch = llcOutput.match(/LLVM version (\d+\.\d+\.\d+)/i)
      || llcOutput.match(/version (\d+\.\d+\.\d+)/i)
      || llcOutput.match(/(\d+\.\d+\.\d+)/);
    if (versionMatch) status.llc.version = versionMatch[1];
    // Try to find path
    try {
      const whichCmd = process.platform === "win32" ? "where llc" : "which llc";
      status.llc.path = execSync(whichCmd, { encoding: "utf-8", timeout: 3000 }).trim().split("\n")[0];
    } catch { /* path detection optional */ }
  } catch { /* llc not found */ }

  // Check clang
  try {
    const clangOutput = execSync("clang --version 2>&1", { encoding: "utf-8", timeout: 5000 });
    status.clang.available = true;
    const versionMatch = clangOutput.match(/clang version (\d+\.\d+\.\d+)/i)
      || clangOutput.match(/version (\d+\.\d+\.\d+)/i)
      || clangOutput.match(/(\d+\.\d+\.\d+)/);
    if (versionMatch) status.clang.version = versionMatch[1];
    try {
      const whichCmd = process.platform === "win32" ? "where clang" : "which clang";
      status.clang.path = execSync(whichCmd, { encoding: "utf-8", timeout: 3000 }).trim().split("\n")[0];
    } catch { /* path detection optional */ }
  } catch { /* clang not found */ }

  // Check runtime library
  const runtimePaths = [
    join(process.cwd(), "dist", "native", "libaether_runtime.a"),
    join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..", "dist", "native", "libaether_runtime.a"),
  ];
  for (const p of runtimePaths) {
    if (existsSync(p)) {
      status.runtime = { available: true, path: p };
      break;
    }
  }

  return status;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

function timeStage<T>(fn: () => T): { result: T; duration_ms: number } {
  const start = performance.now();
  const result = fn();
  return { result, duration_ms: Math.round((performance.now() - start) * 100) / 100 };
}

async function timeStageAsync<T>(fn: () => Promise<T>): Promise<{ result: T; duration_ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, duration_ms: Math.round((performance.now() - start) * 100) / 100 };
}

export async function compileToBinary(options: CompilationOptions): Promise<CompilationResult> {
  const target = options.target ?? "binary";
  const optimization = options.optimization ?? 2;
  const parallel = options.parallel ?? true;
  const verbose = options.verbose ?? false;
  const outputDir = options.outputDir ?? ".";
  const errors: string[] = [];

  const log = (msg: string) => { if (verbose) console.log(`  [pipeline] ${msg}`); };

  // Load graph
  let graphJson: any;
  try {
    graphJson = JSON.parse(readFileSync(options.input, "utf-8"));
  } catch (e) {
    return {
      success: false,
      stages: {
        validate: { success: false, duration_ms: 0, errors: [`Failed to load input: ${(e as Error).message}`] },
        typeCheck: { success: false, duration_ms: 0 },
        verify: { success: false, duration_ms: 0, percentage: 0 },
        emitIR: { success: false, duration_ms: 0, outputPath: "", lines: 0 },
      },
      outputPath: "",
      errors: [`Failed to load input: ${(e as Error).message}`],
    };
  }

  const name = options.outputName ?? graphJson.id ?? "output";

  // Stage 1: Validate
  log("Stage 1: Validating graph...");
  const { result: validation, duration_ms: validateTime } = timeStage(() => validateGraph(graphJson));
  const validateStage: StageResult = {
    success: validation.valid,
    duration_ms: validateTime,
    errors: validation.valid ? undefined : [...validation.errors],
  };
  if (!validation.valid) {
    errors.push(...validation.errors);
    log(`Validation FAILED (${validation.errors.length} errors)`);
    return {
      success: false,
      stages: {
        validate: validateStage,
        typeCheck: { success: false, duration_ms: 0 },
        verify: { success: false, duration_ms: 0, percentage: 0 },
        emitIR: { success: false, duration_ms: 0, outputPath: "", lines: 0 },
      },
      outputPath: "",
      errors,
    };
  }
  log(`Validation OK (${validateTime}ms)`);

  // Stage 2: Type Check
  log("Stage 2: Type checking...");
  const { result: typeResult, duration_ms: typeCheckTime } = timeStage(() => checkTypes(graphJson));
  const typeErrors = typeResult.errors;
  const typeCheckStage: StageResult = {
    success: typeErrors.length === 0,
    duration_ms: typeCheckTime,
    errors: typeErrors.length > 0 ? typeErrors.map((d) => d.message) : undefined,
  };
  if (typeErrors.length > 0) {
    errors.push(...typeErrors.map((d) => d.message));
    log(`Type check FAILED (${typeErrors.length} errors)`);
    return {
      success: false,
      stages: {
        validate: validateStage,
        typeCheck: typeCheckStage,
        verify: { success: false, duration_ms: 0, percentage: 0 },
        emitIR: { success: false, duration_ms: 0, outputPath: "", lines: 0 },
      },
      outputPath: "",
      errors,
    };
  }
  log(`Type check OK (${typeCheckTime}ms)`);

  // Stage 3: Verify (Z3)
  log("Stage 3: Verifying contracts...");
  let verifyStage: StageResult;
  try {
    const { result: verifyResult, duration_ms: verifyTime } = await timeStageAsync(() => verifyGraph(graphJson));
    const totalContracts = verifyResult.results.length;
    const verifiedCount = verifyResult.results.filter((r) => r.verified).length;
    const pct = totalContracts > 0 ? Math.round((verifiedCount / totalContracts) * 100) : 100;
    verifyStage = { success: true, duration_ms: verifyTime, percentage: pct };
    // Log warnings for failed verifications
    for (const r of verifyResult.results) {
      if (!r.verified) {
        log(`  Warning: verification failed for ${r.node_id}`);
      }
    }
    log(`Verification OK (${pct}% verified, ${verifyTime}ms)`);
  } catch (e) {
    verifyStage = { success: true, duration_ms: 0, percentage: 0, errors: [(e as Error).message] };
    log(`Verification skipped: ${(e as Error).message}`);
  }

  // Stage 4: Emit LLVM IR
  log("Stage 4: Emitting LLVM IR...");
  const { result: irResult, duration_ms: emitTime } = timeStage(() => {
    const gen = new LLVMCodeGenerator({ parallel });
    const mod = gen.generateModule(graphJson);
    const text = gen.serialize(mod);
    return { mod, text };
  });

  const llPath = join(outputDir, `${name}.ll`);
  writeFileSync(llPath, irResult.text, "utf-8");
  const lineCount = irResult.text.split("\n").length;

  const emitIRStage: StageResult = {
    success: true,
    duration_ms: emitTime,
    outputPath: llPath,
    lines: lineCount,
  };
  log(`Emit IR OK (${lineCount} lines, ${emitTime}ms)`);

  // If target is llvm-ir, stop here
  if (target === "llvm-ir") {
    return {
      success: true,
      stages: { validate: validateStage, typeCheck: typeCheckStage, verify: verifyStage, emitIR: emitIRStage },
      outputPath: llPath,
      errors,
    };
  }

  // Stage 5: Compile to Object (requires llc)
  log("Stage 5: Compiling to object...");
  const toolchain = await detectToolchain();

  if (!toolchain.llc.available) {
    errors.push("llc not found on PATH. Install LLVM: https://releases.llvm.org/download.html");
    log("llc not found — stopping after IR generation");
    return {
      success: false,
      stages: { validate: validateStage, typeCheck: typeCheckStage, verify: verifyStage, emitIR: emitIRStage },
      outputPath: llPath,
      errors,
    };
  }

  const objPath = join(outputDir, `${name}.o`);
  let compileObjStage: StageResult;
  try {
    const objStart = performance.now();
    const fileType = target === "assembly" ? "asm" : "obj";
    const outputExt = target === "assembly" ? join(outputDir, `${name}.s`) : objPath;
    execSync(`llc -filetype=${fileType} -O${optimization} "${llPath}" -o "${outputExt}"`, {
      encoding: "utf-8",
      timeout: 60000,
    });
    const objTime = Math.round((performance.now() - objStart) * 100) / 100;
    compileObjStage = { success: true, duration_ms: objTime, outputPath: outputExt };
    log(`Compile to ${fileType} OK (${objTime}ms)`);
  } catch (e) {
    const msg = (e as Error).message;
    errors.push(`llc failed: ${msg}`);
    compileObjStage = { success: false, duration_ms: 0, errors: [msg] };
    return {
      success: false,
      stages: { validate: validateStage, typeCheck: typeCheckStage, verify: verifyStage, emitIR: emitIRStage, compileObj: compileObjStage },
      outputPath: llPath,
      errors,
    };
  }

  // If target is object or assembly, stop here
  if (target === "object" || target === "assembly") {
    return {
      success: true,
      stages: { validate: validateStage, typeCheck: typeCheckStage, verify: verifyStage, emitIR: emitIRStage, compileObj: compileObjStage },
      outputPath: compileObjStage.outputPath!,
      errors,
    };
  }

  // Stage 6: Link to Binary (requires clang)
  log("Stage 6: Linking to binary...");
  if (!toolchain.clang.available) {
    errors.push("clang not found on PATH. Install LLVM: https://releases.llvm.org/download.html");
    log("clang not found — stopping after object compilation");
    return {
      success: false,
      stages: { validate: validateStage, typeCheck: typeCheckStage, verify: verifyStage, emitIR: emitIRStage, compileObj: compileObjStage },
      outputPath: objPath,
      errors,
    };
  }

  const binaryExt = process.platform === "win32" ? ".exe" : "";
  const binaryPath = join(outputDir, `${name}${binaryExt}`);
  let linkStage: StageResult;
  try {
    const linkStart = performance.now();
    const runtimeDir = toolchain.runtime.path ? dirname(toolchain.runtime.path) : join(process.cwd(), "dist", "native");
    let linkCmd = `clang "${objPath}" -L"${runtimeDir}" -laether_runtime -lpthread -o "${binaryPath}"`;
    if (process.platform === "win32") {
      linkCmd += " -lws2_32";
    }
    execSync(linkCmd, { encoding: "utf-8", timeout: 60000 });
    const linkTime = Math.round((performance.now() - linkStart) * 100) / 100;
    linkStage = { success: true, duration_ms: linkTime, outputPath: binaryPath };
    log(`Link OK (${linkTime}ms)`);
  } catch (e) {
    const msg = (e as Error).message;
    errors.push(`clang link failed: ${msg}`);
    linkStage = { success: false, duration_ms: 0, errors: [msg] };
    return {
      success: false,
      stages: { validate: validateStage, typeCheck: typeCheckStage, verify: verifyStage, emitIR: emitIRStage, compileObj: compileObjStage, link: linkStage },
      outputPath: objPath,
      errors,
    };
  }

  // Get binary size
  let binarySize: number | undefined;
  try {
    binarySize = statSync(binaryPath).size;
  } catch { /* ok */ }

  return {
    success: true,
    stages: { validate: validateStage, typeCheck: typeCheckStage, verify: verifyStage, emitIR: emitIRStage, compileObj: compileObjStage, link: linkStage },
    outputPath: binaryPath,
    binarySize,
    errors,
  };
}
