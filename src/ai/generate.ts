/**
 * AETHER AI Generation Pipeline
 * Generates AETHER-IR from natural language descriptions using Claude,
 * then validates, type-checks, and verifies the output.
 * Each validation failure becomes a BugReport — proof that AETHER's
 * verification pipeline catches bugs plain code generation would miss.
 */

import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { validateGraph, type ValidationResult, type AetherGraph } from "../ir/validator.js";
import { checkTypes, type CheckResult } from "../compiler/checker.js";
import { verifyGraph, type GraphVerificationReport } from "../compiler/verifier.js";
import { aetherToIR, irToAether } from "../parser/bridge.js";
import { formatError } from "../parser/errors.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BugType =
  | "missing_recovery"
  | "missing_adversarial"
  | "type_mismatch"
  | "domain_mismatch"
  | "sensitivity_violation"
  | "contract_violation"
  | "cycle_detected"
  | "confidence_gap"
  | "effect_undeclared"
  | "port_mismatch"
  | "state_violation";

export interface BugReport {
  type: BugType;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  node?: string;
  edge?: string;
  wouldCauseInProduction: string;
  caughtBy: "validator" | "type_checker" | "z3_verifier" | "confidence_rule";
}

export interface GenerationAttempt {
  attemptNumber: number;
  raw_json: string;
  parseSuccess: boolean;
  validationResult?: ValidationResult;
  errors?: string[];
  fixPrompt?: string;
}

export interface GenerationRequest {
  description: string;
  format?: "aether" | "json";
  model?: string;
  maxAttempts?: number;
  validate?: boolean;
  verify?: boolean;
}

export interface GenerationResult {
  success: boolean;
  graph: AetherGraph | null;
  aetherSource?: string;
  attempts: GenerationAttempt[];
  bugsFound: BugReport[];
  finalValidation: ValidationResult | null;
  finalVerification: GraphVerificationReport | null;
}

// ─── Prompt Loading ──────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let _generationPrompt: string | null = null;
let _aetherGenerationPrompt: string | null = null;

export function getGenerationPrompt(): string {
  if (!_generationPrompt) {
    const promptPath = join(__dirname, "../../prompts/generate-ir.md");
    _generationPrompt = readFileSync(promptPath, "utf-8");
  }
  return _generationPrompt;
}

export function getAetherGenerationPrompt(): string {
  if (!_aetherGenerationPrompt) {
    const promptPath = join(__dirname, "../../prompts/generate-aether.md");
    _aetherGenerationPrompt = readFileSync(promptPath, "utf-8");
  }
  return _aetherGenerationPrompt;
}

// ─── JSON Cleaning ───────────────────────────────────────────────────────────

export function cleanJsonResponse(raw: string): string {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // Fix trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

  return cleaned;
}

// ─── .aether Response Cleaning ──────────────────────────────────────────────

export function cleanAetherResponse(raw: string): string {
  let cleaned = raw.trim();
  // Strip markdown code fences (```aether, ```, or ```text)
  if (cleaned.startsWith("```aether")) {
    cleaned = cleaned.slice(9);
  } else if (cleaned.startsWith("```text")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

export function buildAetherFixPrompt(errors: string[], formattedErrors?: string): string {
  const errorList = errors.map((e, i) => `${i + 1}. ${e}`).join("\n");
  return `The generated .aether program has parse/validation errors:
${formattedErrors || errorList}

Fix them and return only the corrected .aether program. Remember:
- Every effectful node needs a recovery block
- Confidence < 0.85 requires break_if checks in contracts
- Every edge "from" must reference an out port, "to" must reference an in port
- The graph must be a DAG (no cycles)
- All nodes need at least one post contract
- Syntax: graph...end, node...end, edge from.port -> to.port`;
}

// ─── Bug Report Classification ───────────────────────────────────────────────

const PRODUCTION_IMPACTS: Record<BugType, string> = {
  missing_recovery: "Unhandled side-effect failure would crash the production system with no fallback",
  missing_adversarial: "AI/ML output would be trusted blindly, potentially causing silent incorrect results",
  type_mismatch: "Incompatible data types would cause runtime type errors or data corruption",
  domain_mismatch: "Wrong semantic domain (e.g., mixing authentication tokens with user IDs) would cause logic errors",
  sensitivity_violation: "PII or sensitive data would leak to unauthorized consumers (data breach risk)",
  contract_violation: "Contract postconditions would be violated, producing invalid output silently",
  cycle_detected: "Circular dependency would cause an infinite loop or stack overflow at runtime",
  confidence_gap: "Overconfident AI node would make decisions without required human oversight",
  effect_undeclared: "Side effects (database writes, API calls) would occur without tracking or rollback capability",
  port_mismatch: "Edge references non-existent ports, causing data flow to fail at runtime",
  state_violation: "Invalid state machine transition would corrupt application state",
};

export function classifyValidationError(error: string): BugReport | null {
  const lower = error.toLowerCase();

  if (lower.includes("recovery") && (lower.includes("effectful") || lower.includes("effect"))) {
    const nodeMatch = error.match(/node "([^"]+)"/i) || error.match(/node (\S+)/i);
    return {
      type: "missing_recovery",
      severity: "critical",
      description: error,
      node: nodeMatch?.[1],
      wouldCauseInProduction: PRODUCTION_IMPACTS.missing_recovery,
      caughtBy: "validator",
    };
  }

  // confidence_gap must be checked BEFORE adversarial (the error often contains "adversarial_check")
  if (lower.includes("confidence") && lower.includes("0.85")) {
    const nodeMatch = error.match(/node "([^"]+)"/i) || error.match(/node (\S+)/i);
    return {
      type: "confidence_gap",
      severity: "high",
      description: error,
      node: nodeMatch?.[1],
      wouldCauseInProduction: PRODUCTION_IMPACTS.confidence_gap,
      caughtBy: "confidence_rule",
    };
  }

  if (lower.includes("adversarial") || lower.includes("adversarial_check")) {
    const nodeMatch = error.match(/node "([^"]+)"/i) || error.match(/node (\S+)/i);
    return {
      type: "missing_adversarial",
      severity: "high",
      description: error,
      node: nodeMatch?.[1],
      wouldCauseInProduction: PRODUCTION_IMPACTS.missing_adversarial,
      caughtBy: "validator",
    };
  }

  if (lower.includes("cycle") || lower.includes("dag")) {
    return {
      type: "cycle_detected",
      severity: "critical",
      description: error,
      wouldCauseInProduction: PRODUCTION_IMPACTS.cycle_detected,
      caughtBy: "validator",
    };
  }

  if (lower.includes("port") && (lower.includes("not found") || lower.includes("does not"))) {
    const edgeMatch = error.match(/"([^"]+\.[^"]+)"/);
    return {
      type: "port_mismatch",
      severity: "high",
      description: error,
      edge: edgeMatch?.[1],
      wouldCauseInProduction: PRODUCTION_IMPACTS.port_mismatch,
      caughtBy: "validator",
    };
  }

  return null;
}

export function classifyCheckError(error: { code: string; message: string; edge: string }): BugReport | null {
  switch (error.code) {
    case "BASE_TYPE_MISMATCH":
      return {
        type: "type_mismatch",
        severity: "high",
        description: error.message,
        edge: error.edge,
        wouldCauseInProduction: PRODUCTION_IMPACTS.type_mismatch,
        caughtBy: "type_checker",
      };
    case "DOMAIN_MISMATCH":
      return {
        type: "domain_mismatch",
        severity: "medium",
        description: error.message,
        edge: error.edge,
        wouldCauseInProduction: PRODUCTION_IMPACTS.domain_mismatch,
        caughtBy: "type_checker",
      };
    case "SENSITIVITY_VIOLATION":
      return {
        type: "sensitivity_violation",
        severity: "critical",
        description: error.message,
        edge: error.edge,
        wouldCauseInProduction: PRODUCTION_IMPACTS.sensitivity_violation,
        caughtBy: "type_checker",
      };
    case "DIMENSION_MISMATCH":
      return {
        type: "type_mismatch",
        severity: "high",
        description: error.message,
        edge: error.edge,
        wouldCauseInProduction: PRODUCTION_IMPACTS.type_mismatch,
        caughtBy: "type_checker",
      };
    case "STATE_TYPE_MISMATCH":
      return {
        type: "state_violation",
        severity: "high",
        description: error.message,
        edge: error.edge,
        wouldCauseInProduction: PRODUCTION_IMPACTS.state_violation,
        caughtBy: "type_checker",
      };
    default:
      return null;
  }
}

export function classifyVerificationFailure(
  nodeId: string,
  result: { status: string; expression?: string },
  kind: "postcondition" | "adversarial"
): BugReport | null {
  if (result.status === "failed") {
    if (kind === "postcondition") {
      return {
        type: "contract_violation",
        severity: "high",
        description: `Contract postcondition failed for node "${nodeId}": ${result.expression || "unknown"}`,
        node: nodeId,
        wouldCauseInProduction: PRODUCTION_IMPACTS.contract_violation,
        caughtBy: "z3_verifier",
      };
    }
    if (kind === "adversarial") {
      return {
        type: "missing_adversarial",
        severity: "high",
        description: `Adversarial check failed for node "${nodeId}": ${result.expression || "unknown"}`,
        node: nodeId,
        wouldCauseInProduction: PRODUCTION_IMPACTS.missing_adversarial,
        caughtBy: "z3_verifier",
      };
    }
  }
  return null;
}

// ─── Auto-Fix Prompt ─────────────────────────────────────────────────────────

export function buildFixPrompt(errors: string[]): string {
  return `The generated AETHER-IR has these issues:
${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

Fix them and return only the corrected JSON. Remember:
- Every effectful node needs a recovery block
- Confidence < 0.85 requires adversarial_check with at least one break_if
- Every edge "from" must reference an out port, "to" must reference an in port
- The graph must be a DAG (no cycles)
- All nodes need at least one postcondition in contract.post`;
}

// ─── API Call ────────────────────────────────────────────────────────────────

export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  model: string,
  apiKey: string
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API error (${response.status}): ${body}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  const textBlock = data.content.find(b => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("No text response from Claude API");
  }
  return textBlock.text;
}

// ─── Generation Pipeline ─────────────────────────────────────────────────────

export async function generateFromDescription(request: GenerationRequest): Promise<GenerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not set. To use AI generation:\n" +
      "  export ANTHROPIC_API_KEY=sk-ant-...\n\n" +
      "Get a key at: https://console.anthropic.com/"
    );
  }

  const format = request.format ?? "aether";
  const model = request.model || "claude-sonnet-4-20250514";
  const maxAttempts = request.maxAttempts ?? 3;
  const shouldValidate = request.validate !== false;
  const shouldVerify = request.verify !== false;
  const systemPrompt = format === "aether" ? getAetherGenerationPrompt() : getGenerationPrompt();

  const attempts: GenerationAttempt[] = [];
  const bugsFound: BugReport[] = [];
  let finalGraph: AetherGraph | null = null;
  let finalAetherSource: string | undefined;
  let finalValidation: ValidationResult | null = null;
  let finalVerification: GraphVerificationReport | null = null;
  let currentMessage = request.description;

  for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
    const raw = await callClaude(systemPrompt, currentMessage, model, apiKey);
    const attempt: GenerationAttempt = {
      attemptNumber: attemptNum,
      raw_json: raw,
      parseSuccess: false,
    };

    // Parse response based on format
    let graph: AetherGraph;
    if (format === "aether") {
      const cleaned = cleanAetherResponse(raw);
      const parseResult = aetherToIR(cleaned);

      if (parseResult.errors.length > 0 || !parseResult.graph) {
        attempt.parseSuccess = false;
        const errorMessages = parseResult.errors.map(e => e.message);
        const formatted = parseResult.errors.map(e => formatError(e, "<generated>")).join("\n\n");
        attempt.errors = errorMessages;
        attempts.push(attempt);

        if (attemptNum < maxAttempts) {
          const fixPrompt = buildAetherFixPrompt(errorMessages, formatted);
          attempt.fixPrompt = fixPrompt;
          currentMessage = fixPrompt;
        }
        continue;
      }

      graph = parseResult.graph;
      attempt.parseSuccess = true;
      finalAetherSource = cleaned;
    } else {
      try {
        const cleaned = cleanJsonResponse(raw);
        graph = JSON.parse(cleaned) as AetherGraph;
        attempt.parseSuccess = true;
      } catch {
        attempt.parseSuccess = false;
        attempt.errors = ["Failed to parse response as JSON"];
        attempts.push(attempt);

        if (attemptNum < maxAttempts) {
          const fixPrompt = "Your response was not valid JSON. Return ONLY valid JSON with no markdown or explanation.";
          attempt.fixPrompt = fixPrompt;
          currentMessage = fixPrompt;
        }
        continue;
      }
    }

    if (!shouldValidate) {
      finalGraph = graph;
      attempts.push(attempt);
      break;
    }

    // Validate
    const validation = validateGraph(graph as any);
    attempt.validationResult = validation;
    const errors: string[] = [...validation.errors];

    // Collect bugs from validation errors
    for (const err of validation.errors) {
      const bug = classifyValidationError(err);
      if (bug) bugsFound.push(bug);
    }

    // Type check
    let checkResult: CheckResult | null = null;
    try {
      checkResult = checkTypes(graph as any);
      for (const err of checkResult.errors) {
        errors.push(err.message);
        const bug = classifyCheckError(err);
        if (bug) bugsFound.push(bug);
      }
    } catch {
      // Type checking optional — some graphs may not be checkable
    }

    // Verify with Z3
    let verifyReport: GraphVerificationReport | null = null;
    if (shouldVerify && validation.valid) {
      try {
        verifyReport = await verifyGraph(graph as any);
        for (const nodeResult of verifyReport.results) {
          for (const post of nodeResult.postconditions) {
            const bug = classifyVerificationFailure(nodeResult.node_id, post, "postcondition");
            if (bug) bugsFound.push(bug);
          }
          for (const adv of nodeResult.adversarial_checks) {
            const bug = classifyVerificationFailure(nodeResult.node_id, adv, "adversarial");
            if (bug) bugsFound.push(bug);
          }
        }
        finalVerification = verifyReport;
      } catch {
        // Z3 verification optional
      }
    }

    attempt.errors = errors.length > 0 ? errors : undefined;
    attempts.push(attempt);

    if (validation.valid && errors.length === 0) {
      finalGraph = graph;
      finalValidation = validation;
      break;
    }

    finalGraph = graph;
    finalValidation = validation;

    // Auto-fix: send errors back
    if (attemptNum < maxAttempts && errors.length > 0) {
      if (format === "aether") {
        const fixPrompt = buildAetherFixPrompt(errors);
        attempt.fixPrompt = fixPrompt;
        currentMessage = fixPrompt;
      } else {
        const fixPrompt = buildFixPrompt(errors);
        attempt.fixPrompt = fixPrompt;
        currentMessage = fixPrompt;
      }
    }
  }

  return {
    success: finalValidation?.valid ?? false,
    graph: finalGraph,
    aetherSource: finalAetherSource,
    attempts,
    bugsFound,
    finalValidation,
    finalVerification,
  };
}

// ─── Mock Generation (for testing without API) ───────────────────────────────

export function processRawResponse(
  raw: string,
  options: { validate?: boolean; verify?: boolean } = {}
): { graph: AetherGraph | null; validation: ValidationResult | null; bugs: BugReport[]; parseSuccess: boolean } {
  const shouldValidate = options.validate !== false;
  const bugs: BugReport[] = [];

  // Parse
  let graph: AetherGraph;
  try {
    const cleaned = cleanJsonResponse(raw);
    graph = JSON.parse(cleaned) as AetherGraph;
  } catch {
    return { graph: null, validation: null, bugs, parseSuccess: false };
  }

  if (!shouldValidate) {
    return { graph, validation: null, bugs, parseSuccess: true };
  }

  // Validate
  const validation = validateGraph(graph as any);
  for (const err of validation.errors) {
    const bug = classifyValidationError(err);
    if (bug) bugs.push(bug);
  }

  // Type check
  try {
    const checkResult = checkTypes(graph as any);
    for (const err of checkResult.errors) {
      const bug = classifyCheckError(err);
      if (bug) bugs.push(bug);
    }
  } catch {
    // optional
  }

  return { graph, validation, bugs, parseSuccess: true };
}
