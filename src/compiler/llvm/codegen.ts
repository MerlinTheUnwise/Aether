/**
 * AETHER → LLVM IR Code Generator
 *
 * Translates AETHER graphs into LLVM IR text (.ll files).
 * Each node becomes an LLVM function. The graph becomes a main function
 * that wires nodes together following the DAG wave schedule.
 */

import {
  mapTypeToLLVM, getLLVMFieldType, generateStringStruct, generateListStruct,
  generateConfidenceStruct, collectStructTypes,
  type AetherNode, type TypeAnnotation,
} from "./types.js";
import { generateConfidenceCode, generateConfidenceGlobals } from "./confidence.js";
import { getRuntimeSignatures, type RuntimeSignature } from "./runtime/build-runtime.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AetherEdge {
  from: string;
  to: string;
}

interface AetherGraph {
  id: string;
  version: number;
  effects: string[];
  nodes: (AetherNode | { intent?: boolean; [key: string]: unknown })[];
  edges: AetherEdge[];
  metadata?: Record<string, unknown>;
}

export interface LLVMModule {
  name: string;
  structs: string[];
  globals: string[];
  functions: string[];
  metadata: string[];
  declarations: string[];
}

interface Wave {
  level: number;
  nodeIds: string[];
}

export interface LLVMCodegenOptions {
  parallel: boolean;            // default true
  threadPoolSize?: number;      // default: auto-detect
  confidenceGating: boolean;    // default true
  executionLogging: boolean;    // default true
  arenaSize?: number;           // default: 1MB (1048576)
  contractMode?: "abort" | "log" | "count";  // default: "abort"
}

const DEFAULT_CODEGEN_OPTIONS: LLVMCodegenOptions = {
  parallel: true,
  confidenceGating: true,
  executionLogging: true,
  arenaSize: 1048576,
  contractMode: "abort",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function isAetherNode(n: AetherNode | { intent?: boolean; [key: string]: unknown }): n is AetherNode {
  return !("intent" in n && (n as any).intent === true) && !("hole" in n && (n as any).hole === true);
}

/**
 * Returns true if the LLVM type represents a struct > 8 bytes.
 * On MSVC x64 ABI, such types must be passed/returned via pointer (sret/byval).
 */
function isLargeStruct(llvmType: string): boolean {
  if (llvmType.endsWith("*")) return false; // already a pointer
  if (llvmType.startsWith("%") && !llvmType.includes("*")) {
    // All named struct types in our codegen are > 8 bytes
    // (AetherString=16, AetherList=32, etc.)
    return true;
  }
  return false;
}

// ─── Contract → LLVM IR ───────────────────────────────────────────────────────

interface ContractIR {
  instructions: string[];
  resultVar: string;
  supported: boolean;
}

/**
 * Translate a contract expression to LLVM IR instructions.
 * Returns the instructions and the name of the i1 result variable.
 */
export function contractToLLVM(
  expr: string,
  portVars: Map<string, { varName: string; llvmType: string }>,
  counter: { value: number },
): ContractIR {
  const unsupported = [
    "forall(", "exists(", "is_subset_of", "intersection(", "not_in",
    "has_duplicates", "is_distinct", "in allowed_actions", "modifies",
    "deletes", "never(", "size in ", "<=>",
  ];
  for (const pat of unsupported) {
    if (expr.includes(pat)) {
      return {
        instructions: [`; CONTRACT SKIPPED: "${expr}" (verified by Z3 at compile time)`],
        resultVar: "",
        supported: false,
      };
    }
  }

  const instructions: string[] = [];
  const c = () => counter.value++;

  // a ∧ b  or  a && b
  if (expr.includes("∧") || (expr.includes("&&") && !expr.includes("."))) {
    const parts = expr.split(/\s*(?:∧|&&)\s*/);
    const partResults: string[] = [];
    for (const part of parts) {
      const sub = contractToLLVM(part.trim(), portVars, counter);
      if (!sub.supported) return sub;
      instructions.push(...sub.instructions);
      partResults.push(sub.resultVar);
    }
    let acc = partResults[0];
    for (let i = 1; i < partResults.length; i++) {
      const n = c();
      const result = `%and_${n}`;
      instructions.push(`  ${result} = and i1 ${acc}, ${partResults[i]}`);
      acc = result;
    }
    return { instructions, resultVar: acc, supported: true };
  }

  // a ∨ b  or  a || b
  if (expr.includes("∨") || (expr.includes("||") && !expr.includes("."))) {
    const parts = expr.split(/\s*(?:∨|\|\|)\s*/);
    const partResults: string[] = [];
    for (const part of parts) {
      const sub = contractToLLVM(part.trim(), portVars, counter);
      if (!sub.supported) return sub;
      instructions.push(...sub.instructions);
      partResults.push(sub.resultVar);
    }
    let acc = partResults[0];
    for (let i = 1; i < partResults.length; i++) {
      const n = c();
      const result = `%or_${n}`;
      instructions.push(`  ${result} = or i1 ${acc}, ${partResults[i]}`);
      acc = result;
    }
    return { instructions, resultVar: acc, supported: true };
  }

  // ¬a
  if (expr.startsWith("¬") || expr.startsWith("!")) {
    const inner = expr.slice(1).trim();
    const sub = contractToLLVM(inner, portVars, counter);
    if (!sub.supported) return sub;
    instructions.push(...sub.instructions);
    const n = c();
    const result = `%not_${n}`;
    instructions.push(`  ${result} = xor i1 ${sub.resultVar}, 1`);
    return { instructions, resultVar: result, supported: true };
  }

  // x.length > 0  or  x.is_lowercase etc → runtime helper call
  const propMatch = expr.match(/^(\w+)\.(is_\w+)$/);
  if (propMatch) {
    const [, portName, propName] = propMatch;
    const port = portVars.get(portName);
    if (port) {
      const n = c();
      const result = `%prop_${n}`;
      if (isLargeStruct(port.llvmType)) {
        // MSVC ABI: pass struct via pointer
        const tmpPtr = `%tmp_ptr_${n}`;
        instructions.push(`  ${tmpPtr} = alloca ${port.llvmType}`);
        instructions.push(`  store ${port.llvmType} ${port.varName}, ${port.llvmType}* ${tmpPtr}`);
        instructions.push(`  ${result} = call i1 @aether_string_${propName}(${port.llvmType}* ${tmpPtr})`);
      } else {
        instructions.push(`  ${result} = call i1 @aether_string_${propName}(${port.llvmType} ${port.varName})`);
      }
      return { instructions, resultVar: result, supported: true };
    }
  }

  // x.length > N
  const lenMatch = expr.match(/^(\w+)\.length\s*(>|>=|<|<=|==|!=)\s*(\d+)$/);
  if (lenMatch) {
    const [, portName, op, numStr] = lenMatch;
    const port = portVars.get(portName);
    if (port) {
      const n1 = c();
      const n2 = c();
      const lenVar = `%len_${n1}`;
      const cmpVar = `%cmp_${n2}`;
      if (isLargeStruct(port.llvmType)) {
        // MSVC ABI: pass struct via pointer
        const tmpPtr = `%tmp_ptr_${n1}`;
        instructions.push(`  ${tmpPtr} = alloca ${port.llvmType}`);
        instructions.push(`  store ${port.llvmType} ${port.varName}, ${port.llvmType}* ${tmpPtr}`);
        instructions.push(`  ${lenVar} = call i64 @aether_string_length(${port.llvmType}* ${tmpPtr})`);
      } else {
        instructions.push(`  ${lenVar} = call i64 @aether_string_length(${port.llvmType} ${port.varName})`);
      }
      const icmpOp = op === ">" ? "sgt" : op === ">=" ? "sge" : op === "<" ? "slt" : op === "<=" ? "sle" : op === "==" ? "eq" : "ne";
      instructions.push(`  ${cmpVar} = icmp ${icmpOp} i64 ${lenVar}, ${numStr}`);
      return { instructions, resultVar: cmpVar, supported: true };
    }
  }

  // x > N, x >= N, x < N, x <= N, x == N, x != N  (integer comparisons)
  const cmpMatch = expr.match(/^(\w+)\s*(>=|<=|!=|==|>|<)\s*(.+)$/);
  if (cmpMatch) {
    const [, lhs, op, rhs] = cmpMatch;
    const lhsPort = portVars.get(lhs);

    // Determine if comparing with another port or a literal
    const rhsTrimmed = rhs.trim();
    const rhsPort = portVars.get(rhsTrimmed);

    if (lhsPort) {
      // Can't compare struct types (AetherString, etc.) with icmp/fcmp
      if (isLargeStruct(lhsPort.llvmType)) {
        return {
          instructions: [`; CONTRACT SKIPPED: "${expr}" (struct comparison not supported in native code)`],
          resultVar: "",
          supported: false,
        };
      }

      const n = c();
      const cmpVar = `%cmp_${n}`;
      const icmpOp = op === ">" ? "sgt" : op === ">=" ? "sge" : op === "<" ? "slt" : op === "<=" ? "sle" : op === "==" ? "eq" : "ne";

      if (lhsPort.llvmType === "double" || lhsPort.llvmType === "float") {
        const fcmpOp = op === ">" ? "ogt" : op === ">=" ? "oge" : op === "<" ? "olt" : op === "<=" ? "ole" : op === "==" ? "oeq" : "one";
        if (rhsPort) {
          instructions.push(`  ${cmpVar} = fcmp ${fcmpOp} ${lhsPort.llvmType} ${lhsPort.varName}, ${rhsPort.varName}`);
        } else {
          // Ensure floating point literal has decimal point
          let fpLiteral = rhsTrimmed === "true" ? "1.0" : rhsTrimmed === "false" ? "0.0" : rhsTrimmed;
          if (/^\d+$/.test(fpLiteral)) fpLiteral += ".0";
          instructions.push(`  ${cmpVar} = fcmp ${fcmpOp} ${lhsPort.llvmType} ${lhsPort.varName}, ${fpLiteral}`);
        }
      } else if (lhsPort.llvmType === "i1") {
        // Boolean comparison
        const boolVal = rhsTrimmed === "true" ? "1" : rhsTrimmed === "false" ? "0" : rhsTrimmed;
        if (rhsPort) {
          instructions.push(`  ${cmpVar} = icmp ${icmpOp} i1 ${lhsPort.varName}, ${rhsPort.varName}`);
        } else {
          instructions.push(`  ${cmpVar} = icmp ${icmpOp} i1 ${lhsPort.varName}, ${boolVal}`);
        }
      } else {
        if (rhsPort) {
          instructions.push(`  ${cmpVar} = icmp ${icmpOp} ${lhsPort.llvmType} ${lhsPort.varName}, ${rhsPort.varName}`);
        } else {
          instructions.push(`  ${cmpVar} = icmp ${icmpOp} ${lhsPort.llvmType} ${lhsPort.varName}, ${rhsTrimmed === "true" ? "1" : rhsTrimmed === "false" ? "0" : rhsTrimmed}`);
        }
      }
      return { instructions, resultVar: cmpVar, supported: true };
    }
  }

  // Dotted property access we can't handle → skip
  if (expr.includes(".") && !portVars.has(expr.split(/\s/)[0]?.split(".")[0])) {
    return {
      instructions: [`; CONTRACT SKIPPED: "${expr}" (verified by Z3 at compile time)`],
      resultVar: "",
      supported: false,
    };
  }

  // Fallback: unsupported
  return {
    instructions: [`; CONTRACT SKIPPED: "${expr}" (verified by Z3 at compile time)`],
    resultVar: "",
    supported: false,
  };
}

// ─── Recovery Code Generation ─────────────────────────────────────────────────

interface RecoveryEntry {
  condition: string;
  action: string;
  params?: Record<string, unknown>;
}

/**
 * Generate LLVM IR for a node with recovery strategies.
 * Wraps the node in a recovery context using setjmp/longjmp pattern.
 */
function generateRecoveryWrapper(
  node: AetherNode,
  sid: string,
  addStringConstant: (value: string) => { globalName: string; length: number },
): string {
  const recovery = node.recovery;
  if (!recovery || Object.keys(recovery).length === 0) return "";

  const entries: RecoveryEntry[] = Object.entries(recovery).map(([condition, spec]) => ({
    condition,
    action: spec.action,
    params: spec.params,
  }));

  const lines: string[] = [];
  lines.push(`; Recovery wrapper for ${node.id}`);

  // Enter recovery context
  const nodeNameConst = addStringConstant(node.id);
  lines.push(`  call void @aether_recovery_enter(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0))`);

  // Check for error after impl call (simulates setjmp/longjmp check)
  lines.push(`  %has_error_${sid} = call i1 @aether_has_error()`);
  lines.push(`  br i1 %has_error_${sid}, label %handle_recovery_${sid}, label %recovery_ok_${sid}`);
  lines.push("");

  // Recovery handling block
  lines.push(`handle_recovery_${sid}:`);
  lines.push(`  %condition_${sid} = call i8* @aether_recovery_get_condition()`);

  let labelIdx = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const condConst = addStringConstant(entry.condition);
    const checkLabel = `check_recovery_${sid}_${labelIdx}`;
    const actionLabel = `recovery_action_${sid}_${labelIdx}`;
    const nextLabel = i < entries.length - 1
      ? `check_recovery_${sid}_${labelIdx + 1}`
      : `unhandled_recovery_${sid}`;

    // Emit the check label for entries after the first (first is inline in handle_recovery)
    if (i > 0) {
      lines.push(`${checkLabel}:`);
    }

    lines.push(`  %is_${sid}_${labelIdx} = call i1 @aether_string_eq_cstr(i8* %condition_${sid}, i8* getelementptr([${condConst.length} x i8], [${condConst.length} x i8]* ${condConst.globalName}, i64 0, i64 0))`);
    lines.push(`  br i1 %is_${sid}_${labelIdx}, label %${actionLabel}, label %${nextLabel}`);
    lines.push("");

    lines.push(`${actionLabel}:`);

    // Generate action-specific IR
    switch (entry.action) {
      case "retry": {
        const count = (entry.params?.count as number) ?? 3;
        const backoff = (entry.params?.backoff as string) ?? "exponential";
        lines.push(`  ; retry(${count}, ${backoff})`);
        lines.push(`  %retry_count_${sid}_${labelIdx} = alloca i32`);
        lines.push(`  store i32 0, i32* %retry_count_${sid}_${labelIdx}`);
        lines.push(`  call void @aether_clear_error()`);
        lines.push(`  br label %retry_loop_${sid}_${labelIdx}`);
        lines.push("");
        lines.push(`retry_loop_${sid}_${labelIdx}:`);
        lines.push(`  %attempt_${sid}_${labelIdx} = load i32, i32* %retry_count_${sid}_${labelIdx}`);
        lines.push(`  %should_retry_${sid}_${labelIdx} = icmp slt i32 %attempt_${sid}_${labelIdx}, ${count}`);
        lines.push(`  br i1 %should_retry_${sid}_${labelIdx}, label %do_retry_${sid}_${labelIdx}, label %retry_exhausted_${sid}_${labelIdx}`);
        lines.push("");
        lines.push(`do_retry_${sid}_${labelIdx}:`);
        // Backoff delay
        if (backoff === "exponential") {
          lines.push(`  %attempt_64_${sid}_${labelIdx} = sext i32 %attempt_${sid}_${labelIdx} to i64`);
          lines.push(`  %shift_${sid}_${labelIdx} = shl i64 1, %attempt_64_${sid}_${labelIdx}`);
          lines.push(`  %delay_${sid}_${labelIdx} = mul i64 100, %shift_${sid}_${labelIdx}`);
        } else {
          lines.push(`  %attempt_64_${sid}_${labelIdx} = sext i32 %attempt_${sid}_${labelIdx} to i64`);
          lines.push(`  %delay_${sid}_${labelIdx} = mul i64 100, %attempt_64_${sid}_${labelIdx}`);
        }
        lines.push(`  call void @aether_sleep_ms(i64 %delay_${sid}_${labelIdx})`);
        lines.push(`  %next_attempt_${sid}_${labelIdx} = add i32 %attempt_${sid}_${labelIdx}, 1`);
        lines.push(`  store i32 %next_attempt_${sid}_${labelIdx}, i32* %retry_count_${sid}_${labelIdx}`);
        // Re-call impl directly — MSVC ABI: sret + pointer
        lines.push(`  %retry_buf_${sid}_${labelIdx} = alloca %${sid}_out`);
        lines.push(`  call void @impl_${sid}(%${sid}_out* sret(%${sid}_out) %retry_buf_${sid}_${labelIdx}, %${sid}_in* %inputs_ptr)`);
        lines.push(`  %retry_result_${sid}_${labelIdx} = load %${sid}_out, %${sid}_out* %retry_buf_${sid}_${labelIdx}`);
        lines.push(`  %retry_err_${sid}_${labelIdx} = call i1 @aether_has_error()`);
        lines.push(`  br i1 %retry_err_${sid}_${labelIdx}, label %retry_loop_${sid}_${labelIdx}, label %retry_success_${sid}_${labelIdx}`);
        lines.push("");
        lines.push(`retry_success_${sid}_${labelIdx}:`);
        lines.push(`  call void @aether_recovery_exit(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0))`);
        lines.push(`  br label %recovery_ok_${sid}`);
        lines.push("");
        lines.push(`retry_exhausted_${sid}_${labelIdx}:`);
        lines.push(`  br label %${nextLabel}`);
        break;
      }

      case "fallback": {
        lines.push(`  ; fallback`);
        lines.push(`  call void @aether_clear_error()`);
        // Propagate degraded confidence (0.5)
        lines.push(`  call void @aether_confidence_set(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0), double 0.5)`);
        lines.push(`  call void @aether_recovery_exit(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0))`);
        lines.push(`  br label %recovery_ok_${sid}`);
        break;
      }

      case "escalate": {
        const msg = (entry.params?.message as string) ?? "escalation required";
        const msgConst = addStringConstant(msg);
        lines.push(`  ; escalate("${msg}")`);
        lines.push(`  call void @aether_escalate(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0), i8* getelementptr([${msgConst.length} x i8], [${msgConst.length} x i8]* ${msgConst.globalName}, i64 0, i64 0))`);
        lines.push(`  call void @aether_clear_error()`);
        lines.push(`  call void @aether_recovery_exit(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0))`);
        lines.push(`  br label %recovery_ok_${sid}`);
        break;
      }

      case "respond": {
        const status = (entry.params?.status as number) ?? 500;
        const body = (entry.params?.body as string) ?? "error";
        const bodyConst = addStringConstant(body);
        lines.push(`  ; respond(${status}, "${body}")`);
        lines.push(`  call void @aether_report_error(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0), i8* getelementptr([${bodyConst.length} x i8], [${bodyConst.length} x i8]* ${bodyConst.globalName}, i64 0, i64 0))`);
        lines.push(`  call void @aether_clear_error()`);
        lines.push(`  call void @aether_recovery_exit(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0))`);
        lines.push(`  br label %recovery_ok_${sid}`);
        break;
      }

      case "report": {
        const channel = (entry.params?.channel as string) ?? "stderr";
        const channelConst = addStringConstant(channel);
        lines.push(`  ; report("${channel}")`);
        lines.push(`  call void @aether_report_error(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0), i8* getelementptr([${channelConst.length} x i8], [${channelConst.length} x i8]* ${channelConst.globalName}, i64 0, i64 0))`);
        lines.push(`  call void @aether_clear_error()`);
        lines.push(`  call void @aether_recovery_exit(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0))`);
        lines.push(`  br label %recovery_ok_${sid}`);
        break;
      }

      default:
        lines.push(`  ; unknown recovery action: ${entry.action}`);
        lines.push(`  br label %${nextLabel}`);
    }
    lines.push("");
    labelIdx++;
  }

  // Unhandled recovery — fatal
  const unhandledConst = addStringConstant(`unhandled recovery in ${node.id}`);
  lines.push(`unhandled_recovery_${sid}:`);
  lines.push(`  call void @aether_fatal(i8* getelementptr([${unhandledConst.length} x i8], [${unhandledConst.length} x i8]* ${unhandledConst.globalName}, i64 0, i64 0))`);
  lines.push(`  unreachable`);
  lines.push("");

  // Recovery ok — exit recovery context
  lines.push(`recovery_ok_${sid}:`);
  lines.push(`  call void @aether_recovery_exit(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0))`);

  return lines.join("\n");
}

// ─── Adversarial Check Code Generation ────────────────────────────────────────

/**
 * Generate LLVM IR for adversarial checks (negative assertions).
 * The condition should be FALSE — if true, the implementation may be wrong.
 */
function generateAdversarialChecks(
  node: AetherNode,
  sid: string,
  portVars: Map<string, { varName: string; llvmType: string }>,
  counter: { value: number },
  addStringConstant: (value: string) => { globalName: string; length: number },
): string[] {
  const adv = node.adversarial_check;
  if (!adv || !adv.break_if || adv.break_if.length === 0) return [];

  const lines: string[] = [];
  lines.push(`  ; Adversarial checks for ${node.id}`);

  for (const breakExpr of adv.break_if) {
    const result = contractToLLVM(breakExpr, portVars, counter);
    lines.push(...result.instructions);
    if (result.supported) {
      const descConst = addStringConstant(`adversarial: ${breakExpr}`);
      lines.push(`  call void @aether_contract_adversarial(i1 ${result.resultVar}, i8* getelementptr([${descConst.length} x i8], [${descConst.length} x i8]* ${descConst.globalName}, i64 0, i64 0))`);
    }
  }

  return lines;
}

/**
 * Generate LLVM IR for state invariant checks.
 * Invariants are negative assertions on state transitions.
 */
function generateInvariantChecks(
  node: AetherNode,
  sid: string,
  portVars: Map<string, { varName: string; llvmType: string }>,
  counter: { value: number },
  addStringConstant: (value: string) => { globalName: string; length: number },
): string[] {
  const invariants = node.contract?.invariants;
  if (!invariants || invariants.length === 0) return [];

  const lines: string[] = [];
  lines.push(`  ; State invariant checks for ${node.id}`);

  for (const inv of invariants) {
    // Invariants like "status != captured" are transition constraints
    const result = contractToLLVM(inv, portVars, counter);
    lines.push(...result.instructions);
    if (result.supported) {
      const descConst = addStringConstant(`invariant: ${inv}`);
      lines.push(`  call void @aether_contract_assert(i1 ${result.resultVar}, i8* getelementptr([${descConst.length} x i8], [${descConst.length} x i8]* ${descConst.globalName}, i64 0, i64 0))`);
    }
  }

  return lines;
}

/**
 * Generate LLVM IR for confidence gating of a node.
 * If confidence is below threshold, skip the node and return defaults.
 */
function generateConfidenceGate(
  node: AetherNode,
  sid: string,
  addStringConstant: (value: string) => { globalName: string; length: number },
): string[] {
  const conf = node.confidence;
  if (conf === undefined) return [];

  const lines: string[] = [];
  const nodeNameConst = addStringConstant(node.id);

  lines.push(`  ; Confidence gate for ${node.id}`);
  lines.push(`  %input_conf_${sid} = call double @aether_confidence_get(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0))`);
  lines.push(`  %node_conf_raw_${sid} = fmul double ${formatDouble(conf)}, %input_conf_${sid}`);
  lines.push(`  call void @aether_confidence_set(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0), double %node_conf_raw_${sid})`);
  lines.push(`  %gate_check_${sid} = fcmp ogt double %node_conf_raw_${sid}, 0.7`);
  lines.push(`  br i1 %gate_check_${sid}, label %execute_node_${sid}, label %skip_node_${sid}`);
  lines.push("");
  lines.push(`skip_node_${sid}:`);
  lines.push(`  call void @aether_log_skip(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0), double %node_conf_raw_${sid})`);
  lines.push(`  store %${sid}_out zeroinitializer, %${sid}_out* %sret_ptr`);
  lines.push(`  ret void`);
  lines.push("");
  lines.push(`execute_node_${sid}:`);

  return lines;
}

function formatDouble(n: number): string {
  if (Number.isInteger(n)) return n.toFixed(1);
  return String(n);
}

// ─── Topological Waves ────────────────────────────────────────────────────────

function computeWaves(nodes: AetherNode[], edges: AetherEdge[]): Wave[] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const adj = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    adj.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const edge of edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);
    if (from && to && nodeIds.has(from.nodeId) && nodeIds.has(to.nodeId) && from.nodeId !== to.nodeId) {
      const neighbors = adj.get(from.nodeId)!;
      if (!neighbors.has(to.nodeId)) {
        neighbors.add(to.nodeId);
        inDegree.set(to.nodeId, (inDegree.get(to.nodeId) ?? 0) + 1);
      }
    }
  }

  const waves: Wave[] = [];
  const remaining = new Set(nodeIds);
  let level = 0;

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) wave.push(id);
    }
    if (wave.length === 0) throw new Error("Cycle detected in graph");

    for (const id of wave) {
      remaining.delete(id);
      for (const neighbor of adj.get(id) ?? []) {
        inDegree.set(neighbor, (inDegree.get(neighbor) ?? 0) - 1);
      }
    }

    waves.push({ level, nodeIds: wave });
    level++;
  }

  return waves;
}

// ─── Runtime Struct Definitions ───────────────────────────────────────────

/**
 * Generate LLVM IR struct definitions for all C runtime types.
 * These match the C struct layouts in aether_runtime.h.
 */
function generateRuntimeStructs(): string[] {
  return [
    "; Runtime struct definitions (match C ABI in aether_runtime.h)",
    "%AetherString = type { i64, i8* }  ; { length, data }",
    "%AetherList = type { i64, i8*, i64, i64 }  ; { length, data, capacity, element_size }",
    "%AetherConfidence = type { double, i1 }  ; { score, needs_oversight }",
    "%AetherEffectLog = type { i8**, i64, i64 }  ; { effects, count, capacity }",
    "%AetherError = type { i32, [256 x i8] }  ; { code, message }",
    "%AetherArena = type { i8*, i64, i64 }  ; { base, size, offset }",
    "%AetherNodeLog = type { i8*, double, double, double, i1 }  ; { node_id, start_ms, end_ms, confidence, skipped }",
    "%AetherExecutionLog = type { %AetherNodeLog*, i64, i64, double }  ; { entries, count, capacity, total_ms }",
    "%AetherThreadPool = type opaque  ; opaque — managed by runtime",
    "%AetherTask = type { i8*, i8*, i8*, i1 }  ; { fn, arg, result, completed }",
    "%AetherWave = type { %AetherTask*, i64, double, double }  ; { tasks, task_count, start_ms, end_ms }",
  ];
}

// ─── Code Generator ───────────────────────────────────────────────────────────

export class LLVMCodeGenerator {
  private stringConstants: Map<string, { globalName: string; length: number }> = new Map();
  private runtimeDecls: Set<string> = new Set();
  private options: LLVMCodegenOptions;

  constructor(options?: Partial<LLVMCodegenOptions>) {
    this.options = { ...DEFAULT_CODEGEN_OPTIONS, ...options };
  }

  /**
   * Register a string constant and return its global variable name.
   */
  private addStringConstant(value: string): { globalName: string; length: number } {
    if (this.stringConstants.has(value)) return this.stringConstants.get(value)!;

    const idx = this.stringConstants.size;
    const globalName = `@.str.${idx}`;
    const length = llvmStringByteLength(value) + 1; // +1 for null terminator
    this.stringConstants.set(value, { globalName, length });
    return { globalName, length };
  }

  /**
   * Declare a runtime function we depend on.
   */
  private declareRuntime(decl: string): void {
    this.runtimeDecls.add(decl);
  }

  /**
   * Generate LLVM IR function for a single node.
   * Includes: preconditions, implementation call, postconditions,
   * adversarial checks, invariant checks, recovery wrapper, and confidence gates.
   */
  generateNodeFunction(node: AetherNode): string {
    const sid = safeId(node.id);
    const lines: string[] = [];
    const hasRecovery = node.recovery && Object.keys(node.recovery).length > 0;
    const hasConfidenceGate = node.confidence !== undefined;

    // Function header comment
    lines.push(`; Node: ${node.id}`);
    lines.push(`; Pure: ${node.pure ?? false}, Confidence: ${node.confidence ?? "unspecified"}`);
    if (hasRecovery) lines.push(`; Recovery: ${Object.keys(node.recovery!).join(", ")}`);

    // Function signature — MSVC ABI: sret for output, pointer for input
    lines.push(`define void @aether_${sid}(%${sid}_out* sret(%${sid}_out) %sret_ptr, %${sid}_in* %inputs_ptr) {`);
    lines.push("entry:");

    // Load input struct from pointer
    lines.push(`  %inputs = load %${sid}_in, %${sid}_in* %inputs_ptr`);

    // Extract input ports
    const inPorts = Object.entries(node.in);
    const portVars = new Map<string, { varName: string; llvmType: string }>();
    const counter = { value: 0 };

    for (let i = 0; i < inPorts.length; i++) {
      const [portName, ann] = inPorts[i];
      const llvmType = getLLVMFieldType(ann);
      const varName = `%${portName}`;
      lines.push(`  ${varName} = extractvalue %${sid}_in %inputs, ${i}`);
      portVars.set(portName, { varName, llvmType });
    }

    // Confidence gate — branch to skip_node if below threshold
    if (hasConfidenceGate) {
      const gateLines = generateConfidenceGate(
        node, sid, (v) => this.addStringConstant(v),
      );
      lines.push(...gateLines);
    }

    // Precondition checks (using aether_contract_assert)
    const preContracts = node.contract?.pre ?? [];
    let hasPreCheck = false;

    if (preContracts.length > 0) {
      const preResults: string[] = [];
      const preSkipped: string[] = [];

      for (const pre of preContracts) {
        const result = contractToLLVM(pre, portVars, counter);
        lines.push(...result.instructions);
        if (result.supported) {
          preResults.push(result.resultVar);
        } else {
          preSkipped.push(pre);
        }
      }

      if (preResults.length > 0) {
        hasPreCheck = true;
        let preCheck = preResults[0];
        for (let i = 1; i < preResults.length; i++) {
          const n = counter.value++;
          const combined = `%pre_combined_${n}`;
          lines.push(`  ${combined} = and i1 ${preCheck}, ${preResults[i]}`);
          preCheck = combined;
        }

        // Use contract_assert for mode-aware checking
        const preDescConst = this.addStringConstant(`pre: ${preContracts.join(" ∧ ")}`);
        lines.push(`  call void @aether_contract_assert(i1 ${preCheck}, i8* getelementptr([${preDescConst.length} x i8], [${preDescConst.length} x i8]* ${preDescConst.globalName}, i64 0, i64 0))`);

        // Also keep the branch for backward compatibility
        lines.push(`  br i1 ${preCheck}, label %body, label %pre_fail`);
        lines.push("");
        lines.push("pre_fail:");

        const nameConst = this.addStringConstant(node.id);
        const preConst = this.addStringConstant("precondition");
        const preExprConst = this.addStringConstant(preContracts.join(" && "));
        lines.push(`  call void @aether_contract_violation(i8* getelementptr([${nameConst.length} x i8], [${nameConst.length} x i8]* ${nameConst.globalName}, i64 0, i64 0), i8* getelementptr([${preConst.length} x i8], [${preConst.length} x i8]* ${preConst.globalName}, i64 0, i64 0), i8* getelementptr([${preExprConst.length} x i8], [${preExprConst.length} x i8]* ${preExprConst.globalName}, i64 0, i64 0))`);
        // In non-abort modes, contract_violation returns — fall through to body
        lines.push("  br label %body");
        lines.push("");
        lines.push("body:");
      }
    }

    if (!hasPreCheck) {
      lines.push(`  br label %body`);
      lines.push("");
      lines.push("body:");
    }

    // Implementation call — MSVC ABI: sret + pointer
    this.declareRuntime(`declare void @impl_${sid}(%${sid}_out* sret(%${sid}_out), %${sid}_in*)`);
    lines.push(`  %result_ptr = alloca %${sid}_out`);
    lines.push(`  call void @impl_${sid}(%${sid}_out* sret(%${sid}_out) %result_ptr, %${sid}_in* %inputs_ptr)`);
    lines.push(`  %result = load %${sid}_out, %${sid}_out* %result_ptr`);

    // Recovery wrapper (after impl call, checks for errors)
    if (hasRecovery) {
      const recoveryIR = generateRecoveryWrapper(
        node, sid, (v) => this.addStringConstant(v),
      );
      lines.push(recoveryIR);
    }

    // Postcondition checks
    const postContracts = node.contract?.post ?? [];
    let hasPostCheck = false;

    if (postContracts.length > 0) {
      const outPorts = Object.entries(node.out);
      const postPortVars = new Map(portVars);

      for (let i = 0; i < outPorts.length; i++) {
        const [portName, ann] = outPorts[i];
        const llvmType = getLLVMFieldType(ann);
        const varName = `%out_${portName}`;
        lines.push(`  ${varName} = extractvalue %${sid}_out %result, ${i}`);
        postPortVars.set(portName, { varName, llvmType });
      }

      const postResults: string[] = [];
      for (const post of postContracts) {
        const result = contractToLLVM(post, postPortVars, counter);
        lines.push(...result.instructions);
        if (result.supported) {
          postResults.push(result.resultVar);
        }
      }

      if (postResults.length > 0) {
        hasPostCheck = true;
        let postCheck = postResults[0];
        for (let i = 1; i < postResults.length; i++) {
          const n = counter.value++;
          const combined = `%post_combined_${n}`;
          lines.push(`  ${combined} = and i1 ${postCheck}, ${postResults[i]}`);
          postCheck = combined;
        }

        // Use contract_assert for mode-aware checking
        const postDescConst = this.addStringConstant(`post: ${postContracts.join(" ∧ ")}`);
        lines.push(`  call void @aether_contract_assert(i1 ${postCheck}, i8* getelementptr([${postDescConst.length} x i8], [${postDescConst.length} x i8]* ${postDescConst.globalName}, i64 0, i64 0))`);

        lines.push(`  br i1 ${postCheck}, label %done, label %post_fail`);
        lines.push("");
        lines.push("post_fail:");

        const nameConst = this.addStringConstant(node.id);
        const postConst = this.addStringConstant("postcondition");
        const postExprConst = this.addStringConstant(postContracts.join(" && "));
        lines.push(`  call void @aether_contract_violation(i8* getelementptr([${nameConst.length} x i8], [${nameConst.length} x i8]* ${nameConst.globalName}, i64 0, i64 0), i8* getelementptr([${postConst.length} x i8], [${postConst.length} x i8]* ${postConst.globalName}, i64 0, i64 0), i8* getelementptr([${postExprConst.length} x i8], [${postExprConst.length} x i8]* ${postExprConst.globalName}, i64 0, i64 0))`);
        // In non-abort modes, contract_violation returns — fall through to done
        lines.push("  br label %done");
        lines.push("");
        lines.push("done:");
      }

      // Adversarial checks (after postconditions, using post port vars)
      const advLines = generateAdversarialChecks(
        node, sid, postPortVars, counter, (v) => this.addStringConstant(v),
      );
      lines.push(...advLines);

      // State invariant checks
      const invLines = generateInvariantChecks(
        node, sid, postPortVars, counter, (v) => this.addStringConstant(v),
      );
      lines.push(...invLines);
    } else {
      // Still generate adversarial/invariant checks even without postconditions
      const outPorts = Object.entries(node.out);
      if (outPorts.length > 0 && (node.adversarial_check || node.contract?.invariants)) {
        const postPortVars = new Map(portVars);
        for (let i = 0; i < outPorts.length; i++) {
          const [portName, ann] = outPorts[i];
          const llvmType = getLLVMFieldType(ann);
          const varName = `%out_${portName}`;
          lines.push(`  ${varName} = extractvalue %${sid}_out %result, ${i}`);
          postPortVars.set(portName, { varName, llvmType });
        }

        const advLines = generateAdversarialChecks(
          node, sid, postPortVars, counter, (v) => this.addStringConstant(v),
        );
        lines.push(...advLines);

        const invLines = generateInvariantChecks(
          node, sid, postPortVars, counter, (v) => this.addStringConstant(v),
        );
        lines.push(...invLines);
      }
    }

    // String runtime functions are declared via addRuntimeDeclarations

    // Confidence propagation — store the propagated value
    if (hasConfidenceGate) {
      const nodeNameConst = this.addStringConstant(node.id);
      lines.push(`  call void @aether_confidence_set(i8* getelementptr([${nodeNameConst.length} x i8], [${nodeNameConst.length} x i8]* ${nodeNameConst.globalName}, i64 0, i64 0), double %node_conf_raw_${sid})`);
    }

    lines.push(`  store %${sid}_out %result, %${sid}_out* %sret_ptr`);
    lines.push(`  ret void`);
    lines.push("}");

    return lines.join("\n");
  }

  /**
   * Generate a task wrapper function for a parallelized node.
   * The wrapper casts void* args to the typed struct, calls the node function,
   * and writes the result to the void* result buffer.
   */
  generateTaskWrapper(node: AetherNode): string {
    const sid = safeId(node.id);
    const lines: string[] = [];

    lines.push(`; Task wrapper for parallel execution of ${node.id}`);
    lines.push(`define void @task_${sid}(i8* %arg, i8* %result_buf) {`);
    lines.push("entry:");
    // Cast void* arg → typed input struct pointer
    lines.push(`  %in_ptr = bitcast i8* %arg to %${sid}_in*`);
    // Cast void* result_buf → typed output struct pointer
    lines.push(`  %out_ptr = bitcast i8* %result_buf to %${sid}_out*`);
    // Call the node function — MSVC ABI: sret + pointer
    lines.push(`  call void @aether_${sid}(%${sid}_out* sret(%${sid}_out) %out_ptr, %${sid}_in* %in_ptr)`);
    lines.push("  ret void");
    lines.push("}");

    return lines.join("\n");
  }

  /**
   * Generate the main orchestrator function that wires nodes together.
   * When parallel=true, multi-node waves use pool_submit + wait_all.
   * Single-node waves always call directly (no pool overhead).
   */
  generateMain(graph: AetherGraph): string {
    const nodes = graph.nodes.filter(isAetherNode);
    const waves = computeWaves(nodes, graph.edges);
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Build edge map: target port → source port
    const edgeSourcePort = new Map<string, { nodeId: string; portIndex: number; portName: string }>();

    for (const edge of graph.edges) {
      const from = parseEdgeRef(edge.from);
      const to = parseEdgeRef(edge.to);
      if (from && to) {
        const toKey = `${to.nodeId}.${to.portName}`;
        const srcNode = nodeMap.get(from.nodeId);
        if (srcNode) {
          const outPorts = Object.keys(srcNode.out);
          const portIdx = outPorts.indexOf(from.portName);
          edgeSourcePort.set(toKey, { nodeId: from.nodeId, portIndex: portIdx, portName: from.portName });
        }
      }
    }

    const lines: string[] = [];
    const useParallel = this.options.parallel;
    const arenaSize = this.options.arenaSize ?? 1048576;

    lines.push(`; Main orchestrator — ${useParallel ? "parallel" : "sequential"} wave-scheduled execution`);
    lines.push("define i32 @main() {");
    lines.push("entry:");

    // Initialize runtime (must come first)
    const contractModeInt = this.options.contractMode === "count" ? 2 : this.options.contractMode === "log" ? 1 : 0;
    lines.push("  ; Initialize AETHER runtime");
    lines.push(`  call void @aether_runtime_init(double 0.7, i32 ${contractModeInt})`);

    // Initialize arena for temporary allocations
    lines.push("  ; Arena allocation for temporaries");
    lines.push("  %arena = alloca %AetherArena");
    lines.push(`  call void @aether_arena_new(%AetherArena* sret(%AetherArena) %arena, i64 ${arenaSize})`);

    // Initialize execution log
    if (this.options.executionLogging) {
      lines.push("  ; Execution log");
      lines.push("  %exec_log = alloca %AetherExecutionLog");
      lines.push("  call void @aether_log_new(%AetherExecutionLog* sret(%AetherExecutionLog) %exec_log)");
    }

    // Initialize thread pool for parallel execution
    if (useParallel) {
      const poolSize = this.options.threadPoolSize ?? 0; // 0 = auto-detect
      lines.push("  ; Thread pool initialization");
      lines.push(`  %pool = call %AetherThreadPool* @aether_pool_new(i64 ${poolSize})`);
    }

    lines.push("");

    // Track which nodes have been skipped by confidence gating
    const skippedSet = new Set<string>();

    for (const wave of waves) {
      lines.push(`  ; Wave ${wave.level}`);

      const isMultiNode = wave.nodeIds.length > 1;
      const usePoolForWave = useParallel && isMultiNode;

      // Confidence gating: pre-check all nodes in wave before submission
      if (this.options.confidenceGating && usePoolForWave) {
        lines.push(`  ; Confidence pre-check for wave ${wave.level}`);
        for (const nodeId of wave.nodeIds) {
          const node = nodeMap.get(nodeId);
          if (!node) continue;
          const sid = safeId(nodeId);
          const conf = node.confidence ?? 1.0;

          if (conf < 0.85) {
            lines.push(`  ; LOW CONFIDENCE: ${nodeId} (${conf}) — pulled out for sequential handling`);
            skippedSet.add(nodeId);
          }
        }
      }

      // Check for cascading skips: if any upstream dependency was skipped, skip this node too
      for (const nodeId of wave.nodeIds) {
        if (skippedSet.has(nodeId)) continue;
        const node = nodeMap.get(nodeId);
        if (!node) continue;
        for (const [portName] of Object.entries(node.in)) {
          const edgeKey = `${nodeId}.${portName}`;
          const source = edgeSourcePort.get(edgeKey);
          if (source && skippedSet.has(source.nodeId)) {
            lines.push(`  ; CASCADING SKIP: ${nodeId} depends on skipped ${source.nodeId}`);
            skippedSet.add(nodeId);
            break;
          }
        }
      }

      // Get the non-skipped nodes for this wave
      const activeNodes = wave.nodeIds.filter(id => !skippedSet.has(id));

      if (activeNodes.length === 0) {
        lines.push(`  ; Wave ${wave.level} entirely skipped (confidence gating)`);
        lines.push("");
        continue;
      }

      const usePoolForActiveWave = useParallel && activeNodes.length > 1;

      // Allocate input structs and wire edges for all active nodes
      for (const nodeId of activeNodes) {
        const node = nodeMap.get(nodeId);
        if (!node) continue;
        const sid = safeId(nodeId);

        lines.push(`  %input_${sid} = alloca %${sid}_in`);
        lines.push(`  store %${sid}_in zeroinitializer, %${sid}_in* %input_${sid}`);

        const inPorts = Object.entries(node.in);
        for (let i = 0; i < inPorts.length; i++) {
          const [portName] = inPorts[i];
          const edgeKey = `${nodeId}.${portName}`;
          const source = edgeSourcePort.get(edgeKey);

          if (source) {
            const srcSid = safeId(source.nodeId);
            const extractVar = `%wire_${sid}_${portName}`;
            lines.push(`  ${extractVar} = extractvalue %${srcSid}_out %result_${srcSid}, ${source.portIndex}`);

            const loadVar = `%tmp_in_${sid}_${i}`;
            lines.push(`  ${loadVar} = load %${sid}_in, %${sid}_in* %input_${sid}`);
            const insertVar = `%tmp_ins_${sid}_${i}`;
            lines.push(`  ${insertVar} = insertvalue %${sid}_in ${loadVar}, ${getLLVMFieldType(inPorts[i][1])} ${extractVar}, ${i}`);
            lines.push(`  store %${sid}_in ${insertVar}, %${sid}_in* %input_${sid}`);
          }
        }
      }

      if (usePoolForActiveWave) {
        // Parallel: allocate result buffers, submit tasks, wait
        for (const nodeId of activeNodes) {
          const node = nodeMap.get(nodeId);
          if (!node) continue;
          const sid = safeId(nodeId);

          // Allocate result buffer
          lines.push(`  %result_buf_${sid} = alloca %${sid}_out`);
          // Cast pointers to void* for pool_submit
          lines.push(`  %arg_ptr_${sid} = bitcast %${sid}_in* %input_${sid} to i8*`);
          lines.push(`  %res_ptr_${sid} = bitcast %${sid}_out* %result_buf_${sid} to i8*`);
          // Submit task to pool
          lines.push(`  %task_${sid} = call %AetherTask* @aether_pool_submit(%AetherThreadPool* %pool, i8* bitcast (void (i8*, i8*)* @task_${sid} to i8*), i8* %arg_ptr_${sid}, i8* %res_ptr_${sid})`);
        }

        // Wait for all tasks in this wave
        lines.push("  call void @aether_pool_wait_all(%AetherThreadPool* %pool)");

        // Load results from buffers
        for (const nodeId of activeNodes) {
          const sid = safeId(nodeId);
          lines.push(`  %result_${sid} = load %${sid}_out, %${sid}_out* %result_buf_${sid}`);

          // Confidence tracking
          const node = nodeMap.get(nodeId);
          if (node) {
            const confCode = generateConfidenceCode(node, sid);
            if (confCode) lines.push(confCode);
          }
        }
      } else {
        // Sequential: call each node directly (single-node wave or parallel disabled)
        for (const nodeId of activeNodes) {
          const node = nodeMap.get(nodeId);
          if (!node) continue;
          const sid = safeId(nodeId);

          // MSVC ABI: sret + pointer
          lines.push(`  %result_buf_${sid} = alloca %${sid}_out`);
          lines.push(`  call void @aether_${sid}(%${sid}_out* sret(%${sid}_out) %result_buf_${sid}, %${sid}_in* %input_${sid})`);
          lines.push(`  %result_${sid} = load %${sid}_out, %${sid}_out* %result_buf_${sid}`);

          const confCode = generateConfidenceCode(node, sid);
          if (confCode) lines.push(confCode);
        }
      }

      // Handle low-confidence nodes sequentially after the wave
      if (this.options.confidenceGating && usePoolForWave) {
        const lowConfNodes = wave.nodeIds.filter(id => skippedSet.has(id));
        if (lowConfNodes.length > 0) {
          lines.push(`  ; Sequential handling of low-confidence nodes from wave ${wave.level}`);
          for (const nodeId of lowConfNodes) {
            const node = nodeMap.get(nodeId);
            if (!node) continue;
            const sid = safeId(nodeId);

            // Check if this is a cascading skip (upstream was skipped) — truly skip it
            let isCascading = false;
            for (const [portName] of Object.entries(node.in)) {
              const edgeKey = `${nodeId}.${portName}`;
              const source = edgeSourcePort.get(edgeKey);
              if (source && skippedSet.has(source.nodeId)) {
                isCascading = true;
                break;
              }
            }
            if (isCascading) continue;

            // Low-confidence but not cascading: execute sequentially
            lines.push(`  %input_${sid} = alloca %${sid}_in`);
            const inPorts = Object.entries(node.in);
            for (let i = 0; i < inPorts.length; i++) {
              const [portName] = inPorts[i];
              const edgeKey = `${nodeId}.${portName}`;
              const source = edgeSourcePort.get(edgeKey);
              if (source) {
                const srcSid = safeId(source.nodeId);
                const extractVar = `%wire_${sid}_${portName}`;
                lines.push(`  ${extractVar} = extractvalue %${srcSid}_out %result_${srcSid}, ${source.portIndex}`);
                const loadVar = `%tmp_in_${sid}_${i}`;
                lines.push(`  ${loadVar} = load %${sid}_in, %${sid}_in* %input_${sid}`);
                const insertVar = `%tmp_ins_${sid}_${i}`;
                lines.push(`  ${insertVar} = insertvalue %${sid}_in ${loadVar}, ${getLLVMFieldType(inPorts[i][1])} ${extractVar}, ${i}`);
                lines.push(`  store %${sid}_in ${insertVar}, %${sid}_in* %input_${sid}`);
              }
            }
            // MSVC ABI: sret + pointer
            lines.push(`  %result_buf_${sid} = alloca %${sid}_out`);
            lines.push(`  call void @aether_${sid}(%${sid}_out* sret(%${sid}_out) %result_buf_${sid}, %${sid}_in* %input_${sid})`);
            lines.push(`  %result_${sid} = load %${sid}_out, %${sid}_out* %result_buf_${sid}`);
          }
        }
      }

      lines.push("");
    }

    // Cleanup
    lines.push("  ; Cleanup");
    if (useParallel) {
      lines.push("  call void @aether_pool_free(%AetherThreadPool* %pool)");
    }
    if (this.options.executionLogging) {
      lines.push("  call void @aether_log_print(%AetherExecutionLog* %exec_log)");
      lines.push("  call void @aether_log_free(%AetherExecutionLog* %exec_log)");
    }
    lines.push("  call void @aether_arena_free(%AetherArena* %arena)");
    lines.push("  call void @aether_runtime_finalize()");
    lines.push("  ret i32 0");
    lines.push("}");

    return lines.join("\n");
  }

  /**
   * Generate complete LLVM IR module for a graph.
   */
  generateModule(graph: AetherGraph): LLVMModule {
    // Reset state
    this.stringConstants = new Map();
    this.runtimeDecls = new Set();

    const nodes = graph.nodes.filter(isAetherNode);
    const { structs, semanticAliases, listTypes, hasStrings } = collectStructTypes(nodes);

    // Build struct definitions
    const allStructs: string[] = [];

    // Runtime struct definitions (match C ABI)
    allStructs.push(...generateRuntimeStructs());

    // %AetherString is already defined in generateRuntimeStructs()
    // No need for a separate %String alias
    for (const elemType of listTypes) {
      allStructs.push(generateListStruct(elemType));
    }
    allStructs.push(generateConfidenceStruct());
    allStructs.push(...structs);

    // Generate node functions
    const functions: string[] = [];
    for (const node of nodes) {
      functions.push(this.generateNodeFunction(node));
    }

    // Generate task wrappers for parallel execution
    if (this.options.parallel) {
      const waves = computeWaves(nodes, graph.edges);
      const parallelNodeIds = new Set<string>();
      for (const wave of waves) {
        if (wave.nodeIds.length > 1) {
          for (const id of wave.nodeIds) parallelNodeIds.add(id);
        }
      }
      for (const node of nodes) {
        if (parallelNodeIds.has(node.id)) {
          functions.push(this.generateTaskWrapper(node));
        }
      }
    }

    // Generate main
    functions.push(this.generateMain(graph));

    // Collect globals (string constants + impl pointers + confidence)
    const globals: string[] = [];
    for (const [value, info] of this.stringConstants) {
      globals.push(`${info.globalName} = private unnamed_addr constant [${info.length} x i8] c"${escapeStringForLLVM(value)}\\00"`);
    }

    // Confidence globals
    const confGlobals = generateConfidenceGlobals(nodes);
    globals.push(...confGlobals);

    // Collect runtime declarations
    const declarations: string[] = [];
    for (const decl of this.runtimeDecls) {
      if (decl.startsWith("declare")) {
        declarations.push(decl);
      } else {
        globals.push(decl);
      }
    }

    // Add common runtime declarations
    this.addCommonDeclarations(declarations, nodes);

    // Add all runtime library declarations
    this.addRuntimeDeclarations(declarations);

    // Metadata
    const metadata: string[] = [];
    metadata.push(`; ModuleID = '${graph.id}'`);
    metadata.push(`; AETHER graph version ${graph.version}`);
    metadata.push(`; Generated by AETHER LLVM IR emitter`);
    if (graph.effects.length > 0) {
      metadata.push(`; Graph effects: ${graph.effects.join(", ")}`);
    }
    for (const alias of semanticAliases) {
      metadata.push(alias);
    }

    return {
      name: graph.id,
      structs: allStructs,
      globals,
      functions,
      metadata,
      declarations: [...new Set(declarations)],
    };
  }

  /**
   * Add common runtime declarations based on node usage.
   */
  private addCommonDeclarations(_declarations: string[], _nodes: AetherNode[]): void {
    // All declarations are now handled by addRuntimeDeclarations which uses
    // the authoritative C runtime signatures. This avoids type mismatches
    // between inline declarations and the actual C ABI.
  }

  /**
   * Add all runtime library function declarations from the C runtime signatures.
   * These match the C ABI calling conventions exactly.
   */
  private addRuntimeDeclarations(declarations: string[]): void {
    // Deduplicate by function name — the runtime signatures are authoritative
    const sigs = getRuntimeSignatures();
    const sigNames = new Set(sigs.map(s => s.name));
    const filtered = declarations.filter(d => {
      const nameMatch = d.match(/@([a-zA-Z_][a-zA-Z0-9_]*)\(/);
      return !nameMatch || !sigNames.has(nameMatch[1]);
    });
    declarations.length = 0;
    declarations.push(...filtered);

    // Add authoritative runtime declarations with MSVC ABI:
    // - Structs > 8 bytes returned via sret (hidden first pointer param)
    // - Structs > 8 bytes passed as pointers
    for (const sig of sigs) {
      const returnNeedsSret = isLargeStruct(sig.returnType);
      const abiParams = sig.params.map(p => isLargeStruct(p) ? `${p}*` : p);

      if (returnNeedsSret) {
        const sretParam = `${sig.returnType}* sret(${sig.returnType})`;
        const paramStr = [sretParam, ...abiParams].join(", ");
        declarations.push(`declare void @${sig.name}(${paramStr})`);
      } else {
        const paramStr = abiParams.join(", ");
        declarations.push(`declare ${sig.returnType} @${sig.name}(${paramStr})`);
      }
    }
  }

  /**
   * Serialize an LLVMModule to .ll text file content.
   */
  serialize(module: LLVMModule): string {
    const sections: string[] = [];

    // Header metadata
    sections.push(module.metadata.join("\n"));

    // Target (generic)
    sections.push("");
    sections.push('target datalayout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-f80:128-n8:16:32:64-S128"');
    sections.push('target triple = "x86_64-pc-windows-msvc"');

    // Struct definitions
    if (module.structs.length > 0) {
      sections.push("");
      sections.push("; ─── Type Definitions ─────────────────────────────────────────────────────");
      sections.push(module.structs.join("\n"));
    }

    // Global variables
    if (module.globals.length > 0) {
      sections.push("");
      sections.push("; ─── Globals ─────────────────────────────────────────────────────────────");
      sections.push(module.globals.join("\n"));
    }

    // External declarations
    if (module.declarations.length > 0) {
      sections.push("");
      sections.push("; ─── Runtime Declarations ────────────────────────────────────────────────");
      sections.push(module.declarations.join("\n"));
    }

    // Functions
    if (module.functions.length > 0) {
      sections.push("");
      sections.push("; ─── Functions ────────────────────────────────────────────────────────────");
      sections.push(module.functions.join("\n\n"));
    }

    sections.push("");
    return sections.join("\n");
  }
}

// ─── String Escaping ──────────────────────────────────────────────────────────

function escapeStringForLLVM(s: string): string {
  // Encode to UTF-8 bytes, then escape non-printable/non-ASCII bytes
  const bytes = Buffer.from(s, "utf-8");
  let result = "";
  for (const byte of bytes) {
    if (byte >= 32 && byte < 127 && byte !== 0x22 /* " */ && byte !== 0x5c /* \\ */) {
      result += String.fromCharCode(byte);
    } else {
      result += `\\${byte.toString(16).padStart(2, "0")}`;
    }
  }
  return result;
}

/** Get the UTF-8 byte length of a string (for LLVM IR [N x i8] declarations). */
function llvmStringByteLength(s: string): number {
  return Buffer.from(s, "utf-8").length;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export interface EmitSummary {
  graphId: string;
  version: number;
  nodeCount: number;
  functionCount: number;
  structCount: number;
  contractsInlined: number;
  contractsSkipped: number;
  hasConfidence: boolean;
  runtimeDeps: string[];
  lineCount: number;
  parallel: boolean;
  taskWrapperCount: number;
}

/**
 * Analyze a generated module and produce a summary.
 */
export function summarizeModule(module: LLVMModule, serialized: string): EmitSummary {
  // Count contracts
  let contractsInlined = 0;
  let contractsSkipped = 0;
  let recoveryCount = 0;
  let adversarialCount = 0;
  let confidenceGateCount = 0;
  for (const fn of module.functions) {
    const lines = fn.split("\n");
    for (const line of lines) {
      if (line.includes("icmp") || line.includes("fcmp")) contractsInlined++;
      if (line.includes("CONTRACT SKIPPED")) contractsSkipped++;
      if (line.includes("aether_recovery_enter")) recoveryCount++;
      if (line.includes("aether_contract_adversarial")) adversarialCount++;
      if (line.includes("aether_log_skip")) confidenceGateCount++;
    }
  }

  // Count functions (define lines)
  let functionCount = 0;
  for (const fn of module.functions) {
    const defines = fn.split("\n").filter(l => l.startsWith("define "));
    functionCount += defines.length;
  }

  // Runtime deps
  const runtimeDeps = module.declarations
    .filter(d => d.startsWith("declare"))
    .map(d => {
      const match = d.match(/@(\w+)/);
      return match ? match[1] : d;
    });

  // Count task wrappers
  let taskWrapperCount = 0;
  for (const fn of module.functions) {
    const lines = fn.split("\n");
    for (const line of lines) {
      if (line.startsWith("define void @task_")) taskWrapperCount++;
    }
  }

  return {
    graphId: module.name,
    version: 0,
    nodeCount: functionCount - 1 - taskWrapperCount, // minus main and task wrappers
    functionCount,
    structCount: module.structs.length,
    contractsInlined,
    contractsSkipped,
    hasConfidence: module.globals.some(g => g.includes("conf_")),
    runtimeDeps,
    lineCount: serialized.split("\n").length,
    parallel: module.functions.some(fn => fn.includes("aether_pool_submit")),
    taskWrapperCount,
  };
}
