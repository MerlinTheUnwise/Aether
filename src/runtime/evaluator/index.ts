// AETHER Contract Evaluator — public API
export { tokenize, type Token, type TokenType } from "./lexer.js";
export { parse, type ASTNode, type ParseResult, type ParseError } from "./parser.js";
export { evaluate, builtinFunctions, type EvalContext, type EvalResult } from "./evaluator.js";
export {
  checkContract,
  checkNodeContracts,
  checkAdversarial,
  AdversarialViolation,
  type ContractCheckResult,
  type NodeContractReport,
  type AdversarialReport,
} from "./checker.js";
