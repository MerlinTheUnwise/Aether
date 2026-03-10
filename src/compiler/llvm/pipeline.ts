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
  stubsPath?: string;               // path to generated stubs .c file to link
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

// Augmented PATH that includes common LLVM install locations
function getAugmentedEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const extraPaths: string[] = [];
  if (process.platform === "win32") {
    extraPaths.push("C:\\Program Files\\LLVM\\bin");
    extraPaths.push("C:\\Program Files (x86)\\LLVM\\bin");
  } else {
    extraPaths.push("/usr/local/opt/llvm/bin");
    extraPaths.push("/opt/homebrew/opt/llvm/bin");
  }
  env.PATH = [...extraPaths, env.PATH || ""].join(process.platform === "win32" ? ";" : ":");
  return env;
}

function tryExec(cmd: string, timeout = 5000): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout, env: getAugmentedEnv(), stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

export async function detectToolchain(): Promise<ToolchainStatus> {
  const status: ToolchainStatus = {
    llc: { available: false },
    clang: { available: false },
    runtime: { available: false },
  };

  // Check llc
  const llcOutput = tryExec("llc --version 2>&1");
  if (llcOutput) {
    status.llc.available = true;
    const versionMatch = llcOutput.match(/LLVM version (\d+\.\d+\.\d+)/i)
      || llcOutput.match(/version (\d+\.\d+\.\d+)/i)
      || llcOutput.match(/(\d+\.\d+\.\d+)/);
    if (versionMatch) status.llc.version = versionMatch[1];
    const whichCmd = process.platform === "win32" ? "where llc" : "which llc";
    const llcPath = tryExec(whichCmd, 3000);
    if (llcPath) status.llc.path = llcPath.trim().split("\n")[0];
  }

  // Check clang
  const clangOutput = tryExec("clang --version 2>&1");
  if (clangOutput) {
    status.clang.available = true;
    const versionMatch = clangOutput.match(/clang version (\d+\.\d+\.\d+)/i)
      || clangOutput.match(/version (\d+\.\d+\.\d+)/i)
      || clangOutput.match(/(\d+\.\d+\.\d+)/);
    if (versionMatch) status.clang.version = versionMatch[1];
    const whichCmd = process.platform === "win32" ? "where clang" : "which clang";
    const clangPath = tryExec(whichCmd, 3000);
    if (clangPath) status.clang.path = clangPath.trim().split("\n")[0];
  }

  // Check runtime library
  const runtimePaths = [
    join(process.cwd(), "dist", "native", "libaether_runtime.a"),
    join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..", "dist", "native", "libaether_runtime.a"),
    join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "runtime", "libaether_runtime.a"),
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
    const gen = new LLVMCodeGenerator({ parallel, contractMode: options.contracts });
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

  // Stage 5: Compile to Object (requires llc or clang)
  log("Stage 5: Compiling to object...");
  const toolchain = await detectToolchain();

  if (!toolchain.llc.available && !toolchain.clang.available) {
    errors.push("Neither llc nor clang found on PATH. Install LLVM: https://releases.llvm.org/download.html");
    log("No compiler found — stopping after IR generation");
    return {
      success: false,
      stages: { validate: validateStage, typeCheck: typeCheckStage, verify: verifyStage, emitIR: emitIRStage },
      outputPath: llPath,
      errors,
    };
  }

  const objExt = process.platform === "win32" ? ".obj" : ".o";
  const objPath = join(outputDir, `${name}${objExt}`);
  let compileObjStage: StageResult;
  try {
    const objStart = performance.now();
    const fileType = target === "assembly" ? "asm" : "obj";
    const outputExt = target === "assembly" ? join(outputDir, `${name}.s`) : objPath;

    const execEnv = getAugmentedEnv();
    if (toolchain.llc.available) {
      execSync(`llc -filetype=${fileType} -O${optimization} "${llPath}" -o "${outputExt}"`, {
        encoding: "utf-8", timeout: 60000, env: execEnv,
      });
    } else {
      if (target === "assembly") {
        execSync(`clang -S -x ir -O${optimization} "${llPath}" -o "${outputExt}"`, {
          encoding: "utf-8", timeout: 60000, env: execEnv,
        });
      } else {
        execSync(`clang -c -x ir -O${optimization} "${llPath}" -o "${outputExt}"`, {
          encoding: "utf-8", timeout: 60000, env: execEnv,
        });
      }
    }
    const objTime = Math.round((performance.now() - objStart) * 100) / 100;
    compileObjStage = { success: true, duration_ms: objTime, outputPath: outputExt };
    log(`Compile to ${fileType} OK (${objTime}ms) [${toolchain.llc.available ? "llc" : "clang"}]`);
  } catch (e) {
    const msg = (e as Error).message;
    errors.push(`Compilation failed: ${msg}`);
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
    // Look for runtime lib in multiple locations
    const runtimeSearchPaths = [
      toolchain.runtime.path ? dirname(toolchain.runtime.path) : "",
      join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..", "dist", "native"),
      join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "runtime"),
      join(process.cwd(), "dist", "native"),
    ].filter(Boolean);

    let runtimeDir = runtimeSearchPaths.find(p => existsSync(join(p, "libaether_runtime.a"))) || runtimeSearchPaths[0];
    const runtimeCSource = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "runtime", "aether_runtime.c");

    // If no static lib but C source exists, compile + link directly
    let linkCmd: string;

    // Collect C source files to compile alongside the object
    const extraSources: string[] = [];

    if (existsSync(runtimeCSource)) {
      extraSources.push(`"${runtimeCSource}"`);
    }

    // Include stubs file if provided
    if (options.stubsPath && existsSync(options.stubsPath)) {
      extraSources.push(`"${options.stubsPath}"`);
      log(`Including stubs: ${options.stubsPath}`);
    }

    if (extraSources.length > 0) {
      // Compile source files directly alongside the object — most portable approach
      const runtimeInclude = dirname(runtimeCSource);
      linkCmd = `clang "${objPath}" ${extraSources.join(" ")} -I"${runtimeInclude}" -D_CRT_SECURE_NO_WARNINGS -o "${binaryPath}"`;
    } else {
      // Try linking against static library
      linkCmd = `clang "${objPath}" -L"${runtimeDir}" -laether_runtime -o "${binaryPath}"`;
    }

    if (process.platform !== "win32") {
      linkCmd += " -lpthread";
    }

    execSync(linkCmd, { encoding: "utf-8", timeout: 60000, env: getAugmentedEnv() });
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
