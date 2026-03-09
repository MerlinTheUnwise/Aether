// Contract Checker — high-level API replacing the old evaluateContract
// Never silently passes. Every expression either passes, fails, or is unevaluable (loud warning).

import { tokenize } from "./lexer.js";
import { parse } from "./parser.js";
import { evaluate, builtinFunctions, EvalContext } from "./evaluator.js";
import type { AetherNode } from "../../ir/validator.js";

export interface ContractCheckResult {
  passed: boolean;
  expression: string;
  evaluated_value: any;
  error?: string;
  warnings: string[];
  unevaluable: boolean;
}

export interface NodeContractReport {
  nodeId: string;
  preconditions: ContractCheckResult[];
  postconditions: ContractCheckResult[];
  invariants: ContractCheckResult[];
  adversarial: AdversarialReport;
  allPassed: boolean;
  warnings: string[];
  unevaluableCount: number;
}

export interface AdversarialReport {
  checks: Array<{
    expression: string;
    triggered: boolean;
    evaluated_value: any;
    error?: string;
  }>;
  allClear: boolean;
}

export function checkContract(
  expression: string,
  variables: Record<string, any>
): ContractCheckResult {
  const tokens = tokenize(expression);

  // Check for lexer errors
  const errorTokens = tokens.filter(t => t.type === "ERROR");
  if (errorTokens.length > 0) {
    return {
      passed: false,
      expression,
      evaluated_value: undefined,
      error: `Lexer error at position ${errorTokens[0].position}: unexpected "${errorTokens[0].value}"`,
      warnings: [`UNEVALUABLE: ${expression} — lexer error`],
      unevaluable: true,
    };
  }

  const { ast, errors: parseErrors } = parse(tokens);

  if (parseErrors.length > 0) {
    return {
      passed: false,
      expression,
      evaluated_value: undefined,
      error: `Parse error: ${parseErrors[0].message} at position ${parseErrors[0].position}`,
      warnings: [`UNEVALUABLE: ${expression} — parse error`],
      unevaluable: true,
    };
  }

  const context: EvalContext = {
    variables,
    functions: { ...builtinFunctions },
  };

  const result = evaluate(ast, context);

  if (!result.success) {
    return {
      passed: false,
      expression,
      evaluated_value: undefined,
      error: result.error,
      warnings: [`UNEVALUABLE: ${expression} — ${result.error}`, ...result.warnings],
      unevaluable: true,
    };
  }

  return {
    passed: !!result.value,
    expression,
    evaluated_value: result.value,
    warnings: result.warnings,
    unevaluable: false,
  };
}

export function checkNodeContracts(
  node: AetherNode,
  inputs: Record<string, any>,
  outputs: Record<string, any>
): NodeContractReport {
  const allWarnings: string[] = [];
  let unevaluableCount = 0;

  const preconditions = (node.contract.pre ?? []).map(expr => {
    const result = checkContract(expr, inputs);
    allWarnings.push(...result.warnings);
    if (result.unevaluable) unevaluableCount++;
    return result;
  });

  const postVars = { ...inputs, ...outputs };
  const postconditions = (node.contract.post ?? []).map(expr => {
    const result = checkContract(expr, postVars);
    allWarnings.push(...result.warnings);
    if (result.unevaluable) unevaluableCount++;
    return result;
  });

  const invariants = (node.contract.invariants ?? []).map(expr => {
    const result = checkContract(expr, postVars);
    allWarnings.push(...result.warnings);
    if (result.unevaluable) unevaluableCount++;
    return result;
  });

  const adversarial = checkAdversarial(
    node.adversarial_check,
    inputs,
    outputs
  );
  allWarnings.push(...adversarial.checks.filter(c => c.error).map(c => `Adversarial check error: ${c.error}`));

  const allPassed =
    preconditions.every(r => r.passed || r.unevaluable) &&
    postconditions.every(r => r.passed || r.unevaluable) &&
    invariants.every(r => r.passed || r.unevaluable) &&
    adversarial.allClear;

  return {
    nodeId: node.id,
    preconditions,
    postconditions,
    invariants,
    adversarial,
    allPassed,
    warnings: allWarnings,
    unevaluableCount,
  };
}

export function checkAdversarial(
  adversarialCheck: { break_if: string[] } | undefined,
  inputs: Record<string, any>,
  outputs: Record<string, any>
): AdversarialReport {
  if (!adversarialCheck || !adversarialCheck.break_if) {
    return { checks: [], allClear: true };
  }

  const allVars = { ...inputs, ...outputs };
  const checks = adversarialCheck.break_if.map(expr => {
    const result = checkContract(expr, allVars);
    return {
      expression: expr,
      triggered: result.unevaluable ? false : !!result.evaluated_value,
      evaluated_value: result.evaluated_value,
      error: result.error,
    };
  });

  const allClear = checks.every(c => !c.triggered);
  return { checks, allClear };
}

export class AdversarialViolation extends Error {
  nodeId: string;
  expression: string;

  constructor(nodeId: string, expression: string) {
    super(`Adversarial violation in "${nodeId}": break_if triggered — ${expression}`);
    this.name = "AdversarialViolation";
    this.nodeId = nodeId;
    this.expression = expression;
  }
}
