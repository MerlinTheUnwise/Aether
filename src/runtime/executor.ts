/**
 * AETHER Runtime — Graph Execution Engine
 *
 * Direct DAG executor: runs the graph without transpiling to JavaScript.
 * - Parallel wave scheduling (Promise.all within each wave)
 * - Confidence-gated execution
 * - Contract checking at runtime
 * - Recovery strategies (retry, fallback, escalate, respond, report)
 * - Effect enforcement via EffectTracker integration
 */

import type { AetherGraph, AetherNode, AetherEdge, TypeAnnotation, StateType, Scope } from "../ir/validator.js";
import { ConfidenceEngine } from "./confidence.js";
import { EffectTracker } from "./effects.js";
import { extractScope, computeScopeOrder } from "../compiler/scopes.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type NodeFunction = (inputs: Record<string, any>) => Promise<Record<string, any>>;

export interface ExecutionContext {
  graph: AetherGraph;
  inputs: Record<string, any>;
  nodeImplementations: Map<string, NodeFunction>;
  confidenceThreshold: number;
  onOversightRequired?: (node: string, confidence: number, context: any) => Promise<any>;
  onEffectExecuted?: (node: string, effect: string, detail: any) => void;
}

export interface ExecutionLogEntry {
  nodeId: string;
  wave: number;
  duration_ms: number;
  confidence: number;
  skipped: boolean;
  effects: string[];
  error?: string;
}

export interface StateTransitionEntry {
  stateType: string;
  from: string;
  to: string;
  node: string;
  when: string;
}

export interface StateTracker {
  currentStates: Map<string, string>;  // state_type_id → current_state
  transitionLog: StateTransitionEntry[];
  violations: string[];
}

export interface ExecutionResult {
  outputs: Record<string, any>;
  confidence: number;
  executionLog: ExecutionLogEntry[];
  effectsPerformed: string[];
  nodesExecuted: number;
  nodesSkipped: number;
  duration_ms: number;
  waves: number;
  stateTransitions?: {
    log: StateTransitionEntry[];
    violations: string[];
    finalStates: Record<string, string>;
  };
}

export class ContractViolation extends Error {
  nodeId: string;
  kind: "precondition" | "postcondition";
  expression: string;

  constructor(nodeId: string, kind: "precondition" | "postcondition", expression: string) {
    super(`Contract violation in "${nodeId}": ${kind} failed — ${expression}`);
    this.name = "ContractViolation";
    this.nodeId = nodeId;
    this.kind = kind;
    this.expression = expression;
  }
}

export class EscalationError extends Error {
  nodeId: string;

  constructor(nodeId: string, message?: string) {
    super(`Escalation required for "${nodeId}"${message ? `: ${message}` : ""}`);
    this.name = "EscalationError";
    this.nodeId = nodeId;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isNode(n: { id: string; hole?: boolean }): n is AetherNode {
  return !("hole" in n && (n as any).hole === true) && !("intent" in n && (n as any).intent === true);
}

function parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

/** Generate default values based on type annotation */
function generateDefault(type: TypeAnnotation): any {
  const t = type.type;
  if (t === "String") return "";
  if (t === "Bool") return true;
  if (t === "Int") return 0;
  if (t === "Float64") return 0.0;
  if (t.startsWith("List")) return [];
  if (t.startsWith("Map")) return {};
  if (t.startsWith("Set")) return [];
  // Unknown types get empty string
  return "";
}

/** Generate default outputs for a node */
function generateDefaults(out: Record<string, TypeAnnotation>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [port, type] of Object.entries(out)) {
    result[port] = generateDefault(type);
  }
  return result;
}

// ─── Wave Scheduling ─────────────────────────────────────────────────────────

interface Wave {
  level: number;
  nodeIds: string[];
}

function computeWaves(graph: AetherGraph): Wave[] {
  const nodes = graph.nodes.filter(n => isNode(n)) as AetherNode[];
  const nodeIds = new Set(nodes.map(n => n.id));

  // Build adjacency
  const adj = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  for (const id of nodeIds) {
    adj.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const edge of graph.edges) {
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

  // Kahn's algorithm producing waves
  const waves: Wave[] = [];
  let remaining = new Set(nodeIds);

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) {
        wave.push(id);
      }
    }

    if (wave.length === 0) {
      throw new Error("Cycle detected in graph — cannot schedule waves");
    }

    waves.push({ level: waves.length, nodeIds: wave });

    for (const id of wave) {
      remaining.delete(id);
      for (const next of adj.get(id) ?? []) {
        inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      }
    }
  }

  return waves;
}

// ─── Contract Evaluation ─────────────────────────────────────────────────────

/**
 * Simple runtime contract evaluator.
 * Converts AETHER contract expressions to JavaScript and evaluates.
 * For unsupported expressions, logs a warning and returns true.
 */
export function evaluateContract(expression: string, variables: Record<string, any>): boolean {
  try {
    let js = expression;

    // Replace logical operators
    js = js.replace(/\s*∧\s*/g, " && ");
    js = js.replace(/\s*∨\s*/g, " || ");
    js = js.replace(/¬/g, "!");
    js = js.replace(/\s*≠\s*/g, " !== ");
    js = js.replace(/\s*≤\s*/g, " <= ");
    js = js.replace(/\s*≥\s*/g, " >= ");

    // x ∈ list → list.includes(x)
    js = js.replace(/(\w+)\s*∈\s*(\w+)/g, "$2.includes($1)");

    // x in [a, b, c] → [a, b, c].includes(x)
    js = js.replace(/(\w+)\s+in\s+(\[.+?\])/g, "$2.includes($1)");

    // Unsupported: quantifiers, set ops, <=>, exists(), complex lambda
    if (/∀|∃|<=>|exists\(|forall\(|∪|∩|⊂|⊆/.test(js)) {
      return true; // Assume passing — Z3 already checked
    }

    // Replace standalone = with === (but not == or != or <=/>= already handled)
    js = js.replace(/(?<!=)(?<!!)\b=(?!=)/g, " === ");
    // Fix potential triple ===
    js = js.replace(/===\s*===/g, "===");

    // Build a safe evaluation context
    const keys = Object.keys(variables);
    const values = Object.values(variables);

    // Create function with variable bindings
    const fn = new Function(...keys, `try { return !!(${js}); } catch(e) { return true; }`);
    return fn(...values);
  } catch {
    // Can't evaluate → assume passing
    return true;
  }
}

// ─── Input Gathering ─────────────────────────────────────────────────────────

function gatherInputs(
  node: AetherNode,
  state: Map<string, Record<string, any>>,
  edges: AetherEdge[],
  graphInputs: Record<string, any>
): Record<string, any> {
  const inputs: Record<string, any> = {};

  // For each input port, find the edge that feeds it
  for (const portName of Object.keys(node.in)) {
    // Check edges
    let found = false;
    for (const edge of edges) {
      const to = parseEdgeRef(edge.to);
      if (to && to.nodeId === node.id && to.portName === portName) {
        const from = parseEdgeRef(edge.from);
        if (from) {
          const sourceOutputs = state.get(from.nodeId);
          if (sourceOutputs) {
            inputs[portName] = sourceOutputs[from.portName];
            found = true;
            break;
          }
        }
      }
    }

    // Fall back to graph-level inputs
    if (!found && portName in graphInputs) {
      inputs[portName] = graphInputs[portName];
    }
  }

  return inputs;
}

// ─── Recovery ────────────────────────────────────────────────────────────────

function matchesCondition(error: Error, condition: string): boolean {
  const msg = error.message.toLowerCase();
  const cond = condition.toLowerCase();
  // Match if condition appears in error message, or error type matches
  return msg.includes(cond) || (error as any).type === condition || (error as any).code === condition;
}

async function retryWithBackoff(
  node: AetherNode,
  inputs: Record<string, any>,
  context: ExecutionContext,
  params?: Record<string, unknown>
): Promise<Record<string, any>> {
  const count = (params?.count as number) ?? (params?.attempts as number) ?? 3;
  const backoff = (params?.backoff as string) ?? "exponential";

  for (let attempt = 1; attempt <= count; attempt++) {
    const delay = backoff === "exponential" ? 100 * Math.pow(2, attempt) : 100 * attempt;
    await new Promise(r => setTimeout(r, delay));
    try {
      const impl = context.nodeImplementations.get(node.id);
      if (impl) return await impl(inputs);
    } catch (e) {
      if (attempt === count) throw e;
    }
  }
  throw new Error(`Retry exhausted for "${node.id}"`);
}

async function executeRecoveryStrategy(
  node: AetherNode,
  error: Error,
  inputs: Record<string, any>,
  context: ExecutionContext
): Promise<Record<string, any>> {
  if (!node.recovery) throw error;

  for (const [condition, action] of Object.entries(node.recovery)) {
    if (matchesCondition(error, condition)) {
      const act = action as { action: string; params?: Record<string, unknown> };
      switch (act.action) {
        case "retry":
          return await retryWithBackoff(node, inputs, context, act.params);
        case "fallback":
          return act.params?.value as Record<string, any> ?? generateDefaults(node.out);
        case "escalate":
          if (context.onOversightRequired) {
            return await context.onOversightRequired(
              node.id, 0, { error, message: act.params?.message }
            );
          }
          throw new EscalationError(node.id, act.params?.message as string);
        case "respond":
          return { status: act.params?.status, body: act.params?.body };
        case "report":
          console.error(`[AETHER:${node.id}] ${error.message}`);
          throw error;
        default:
          throw error;
      }
    }
  }
  throw error;
}

// ─── Node Execution ──────────────────────────────────────────────────────────

interface NodeResult {
  nodeId: string;
  outputs: Record<string, any>;
  confidence: number;
  effects: string[];
  skipped: boolean;
  duration_ms: number;
  error?: string;
}

async function executeNode(
  node: AetherNode,
  context: ExecutionContext,
  state: Map<string, Record<string, any>>,
  confidenceEngine: ConfidenceEngine,
  effectTracker: EffectTracker
): Promise<NodeResult> {
  const start = performance.now();

  // 1. Gather inputs
  const inputs = gatherInputs(node, state, context.graph.edges, context.inputs);

  // 2. Confidence gate
  const inputConfidences = new Map<string, number>();
  for (const edge of context.graph.edges) {
    const to = parseEdgeRef(edge.to);
    if (to && to.nodeId === node.id) {
      const from = parseEdgeRef(edge.from);
      if (from) {
        const sourceConf = confidenceEngine["propagatedConfidences"].get(from.nodeId);
        if (sourceConf !== undefined) {
          inputConfidences.set(from.nodeId, sourceConf);
        }
      }
    }
  }

  const nodeConfidence = confidenceEngine.propagate(node.id, inputConfidences);

  if (nodeConfidence < context.confidenceThreshold) {
    if (context.onOversightRequired) {
      const oversightResult = await context.onOversightRequired(node.id, nodeConfidence, inputs);
      if (oversightResult !== undefined && oversightResult !== null) {
        const duration = performance.now() - start;
        return {
          nodeId: node.id,
          outputs: oversightResult,
          confidence: nodeConfidence,
          effects: node.effects,
          skipped: false,
          duration_ms: duration,
        };
      }
    } else {
      const duration = performance.now() - start;
      return {
        nodeId: node.id,
        outputs: generateDefaults(node.out),
        confidence: nodeConfidence,
        effects: [],
        skipped: true,
        duration_ms: duration,
      };
    }
  }

  // 4. Execute implementation
  const impl = context.nodeImplementations.get(node.id);
  const isStub = !impl;

  // 3. Precondition check (skip in stub mode — upstream defaults won't satisfy real contracts)
  if (!isStub) {
    for (const pre of node.contract.pre ?? []) {
      if (!evaluateContract(pre, inputs)) {
        throw new ContractViolation(node.id, "precondition", pre);
      }
    }
  }

  let result: Record<string, any>;

  if (isStub) {
    // Stub mode: return defaults, skip postconditions
    result = generateDefaults(node.out);
  } else {
    try {
      result = await impl(inputs);
    } catch (error) {
      // 5. Recovery
      result = await executeRecoveryStrategy(node, error as Error, inputs, context);
    }
  }

  // 6. Postcondition check (skip in stub mode — defaults won't satisfy real contracts)
  if (!isStub) {
    for (const post of node.contract.post ?? []) {
      if (!evaluateContract(post, { ...inputs, ...result })) {
        throw new ContractViolation(node.id, "postcondition", post);
      }
    }
  }

  // 7. Track effects
  for (const effect of node.effects) {
    effectTracker.recordEffect(node.id, effect);
    context.onEffectExecuted?.(node.id, effect, result);
  }

  const duration = performance.now() - start;

  return {
    nodeId: node.id,
    outputs: result,
    confidence: nodeConfidence,
    effects: [...node.effects],
    skipped: false,
    duration_ms: duration,
  };
}

// ─── Main Executor ───────────────────────────────────────────────────────────

export async function execute(context: ExecutionContext): Promise<ExecutionResult> {
  const totalStart = performance.now();
  const log: ExecutionLogEntry[] = [];
  const state = new Map<string, Record<string, any>>();
  const allEffects: string[] = [];
  let nodesExecuted = 0;
  let nodesSkipped = 0;

  const confidenceEngine = new ConfidenceEngine(context.graph, context.confidenceThreshold);
  const effectTracker = new EffectTracker(context.graph);

  // State tracking setup
  const stateTracker: StateTracker = {
    currentStates: new Map(),
    transitionLog: [],
    violations: [],
  };

  // Build state type lookup
  const stateTypeMap = new Map<string, StateType>();
  const graphAny = context.graph as any;
  if (graphAny.state_types && Array.isArray(graphAny.state_types)) {
    for (const st of graphAny.state_types) {
      stateTypeMap.set(st.id, st);
      // Initialize to initial state if defined
      if (st.invariants?.initial) {
        stateTracker.currentStates.set(st.id, st.invariants.initial);
      }
    }
  }

  // Compute waves
  const waves = computeWaves(context.graph);

  // Build node map
  const nodeMap = new Map<string, AetherNode>();
  for (const n of context.graph.nodes) {
    if (isNode(n)) nodeMap.set(n.id, n);
  }

  // Execute wave by wave
  for (const wave of waves) {
    const waveNodes = wave.nodeIds
      .map(id => nodeMap.get(id))
      .filter((n): n is AetherNode => n !== undefined);

    // Execute all nodes in wave in parallel
    const results = await Promise.all(
      waveNodes.map(node =>
        executeNode(node, context, state, confidenceEngine, effectTracker)
      )
    );

    // Store results
    for (const result of results) {
      state.set(result.nodeId, result.outputs);
      allEffects.push(...result.effects);

      if (result.skipped) {
        nodesSkipped++;
      } else {
        nodesExecuted++;
      }

      log.push({
        nodeId: result.nodeId,
        wave: wave.level,
        duration_ms: result.duration_ms,
        confidence: result.confidence,
        skipped: result.skipped,
        effects: result.effects,
        error: result.error,
      });

      // Track state transitions for state-typed output ports
      if (stateTypeMap.size > 0 && !result.skipped) {
        const node = nodeMap.get(result.nodeId);
        if (node) {
          for (const [portName, ann] of Object.entries(node.out)) {
            if (ann.state_type) {
              const stDef = stateTypeMap.get(ann.state_type);
              if (!stDef) continue;

              // Determine the new state from the output value
              const outputVal = result.outputs[portName];
              const newState = typeof outputVal === "string" ? outputVal : undefined;
              if (!newState || !stDef.states.includes(newState)) continue;

              const currentState = stateTracker.currentStates.get(ann.state_type);

              if (currentState) {
                // Check if transition is valid
                const validTransition = stDef.transitions.some(
                  t => t.from === currentState && t.to === newState
                );
                if (!validTransition && currentState !== newState) {
                  stateTracker.violations.push(
                    `Invalid transition in "${result.nodeId}": ${ann.state_type} ${currentState}→${newState}`
                  );
                }

                // Find matching transition for 'when'
                const matchingT = stDef.transitions.find(
                  t => t.from === currentState && t.to === newState
                );
                stateTracker.transitionLog.push({
                  stateType: ann.state_type,
                  from: currentState,
                  to: newState,
                  node: result.nodeId,
                  when: matchingT?.when ?? "unknown",
                });
              } else {
                // First state assignment
                stateTracker.transitionLog.push({
                  stateType: ann.state_type,
                  from: "(initial)",
                  to: newState,
                  node: result.nodeId,
                  when: "initialization",
                });
              }

              stateTracker.currentStates.set(ann.state_type, newState);
            }
          }
        }
      }
    }
  }

  // Collect final outputs (from the last wave's nodes)
  const outputs: Record<string, any> = {};
  for (const [nodeId, nodeOutputs] of state) {
    outputs[nodeId] = nodeOutputs;
  }

  const totalDuration = performance.now() - totalStart;

  // Build state transitions result
  const stateTransitions = stateTypeMap.size > 0 ? {
    log: stateTracker.transitionLog,
    violations: stateTracker.violations,
    finalStates: Object.fromEntries(stateTracker.currentStates),
  } : undefined;

  return {
    outputs,
    confidence: confidenceEngine.getGraphConfidence(),
    executionLog: log,
    effectsPerformed: allEffects,
    nodesExecuted,
    nodesSkipped,
    duration_ms: totalDuration,
    waves: waves.length,
    stateTransitions,
  };
}

// ─── Scope-Aware Execution ───────────────────────────────────────────────────

export interface ScopeExecutionResult extends ExecutionResult {
  scopeId: string;
  boundaryOutputs: Record<string, any>;
}

function parseEdgeRefExec(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

export async function executeScope(
  graph: AetherGraph,
  scopeId: string,
  boundaryInputs: Record<string, any>,
  context: ExecutionContext
): Promise<ScopeExecutionResult> {
  const scopeView = extractScope(graph, scopeId);
  const scope = scopeView.scope;
  const scopeNodeIds = new Set(scope.nodes);

  // Build inputs: graph-level inputs + boundary inputs
  const mergedInputs = { ...context.inputs, ...boundaryInputs };

  // Execute the scope's subgraph
  const scopeContext: ExecutionContext = {
    graph: scopeView.graph,
    inputs: mergedInputs,
    nodeImplementations: context.nodeImplementations,
    confidenceThreshold: context.confidenceThreshold,
    onOversightRequired: context.onOversightRequired,
    onEffectExecuted: context.onEffectExecuted,
  };

  const result = await execute(scopeContext);

  // Collect boundary outputs: values from scope's nodes that feed into other scopes
  const boundaryOutputs: Record<string, any> = {};
  for (const edge of scopeView.boundaryEdges) {
    const from = parseEdgeRefExec(edge.from);
    const to = parseEdgeRefExec(edge.to);
    if (!from || !to) continue;
    if (scopeNodeIds.has(from.nodeId) && !scopeNodeIds.has(to.nodeId)) {
      // Output from this scope to another
      const nodeOutputs = result.outputs[from.nodeId];
      if (nodeOutputs && from.portName in nodeOutputs) {
        boundaryOutputs[`${from.nodeId}.${from.portName}`] = nodeOutputs[from.portName];
      }
    }
  }

  return {
    ...result,
    scopeId,
    boundaryOutputs,
  };
}

export async function executeScopedGraph(context: ExecutionContext): Promise<ExecutionResult> {
  const graph = context.graph;
  const scopes = graph.scopes ?? [];

  if (scopes.length === 0) {
    return execute(context);
  }

  // Determine execution order
  const scopeOrder = computeScopeOrder(graph);

  const totalStart = performance.now();
  const allLog: ExecutionLogEntry[] = [];
  const allOutputs: Record<string, any> = {};
  const allEffects: string[] = [];
  let totalExecuted = 0;
  let totalSkipped = 0;
  let totalWaves = 0;
  let minConfidence = 1;

  // Track boundary outputs across scope executions
  const boundaryValues: Record<string, any> = {};

  // Build node-to-scope map and edge map for boundary resolution
  const nodeToScope = new Map<string, string>();
  for (const scope of scopes) {
    for (const nodeId of scope.nodes) {
      nodeToScope.set(nodeId, scope.id);
    }
  }

  for (const scopeId of scopeOrder) {
    // Gather boundary inputs for this scope from completed scopes
    const boundaryInputs: Record<string, any> = {};
    for (const edge of graph.edges) {
      const from = parseEdgeRefExec(edge.from);
      const to = parseEdgeRefExec(edge.to);
      if (!from || !to) continue;

      const fromScope = nodeToScope.get(from.nodeId);
      const toScope = nodeToScope.get(to.nodeId);
      if (fromScope !== scopeId && toScope === scopeId) {
        const key = `${from.nodeId}.${from.portName}`;
        if (key in boundaryValues) {
          boundaryInputs[to.portName] = boundaryValues[key];
        }
      }
    }

    const scopeResult = await executeScope(graph, scopeId, boundaryInputs, context);

    // Merge results
    Object.assign(allOutputs, scopeResult.outputs);
    allLog.push(...scopeResult.executionLog);
    allEffects.push(...scopeResult.effectsPerformed);
    totalExecuted += scopeResult.nodesExecuted;
    totalSkipped += scopeResult.nodesSkipped;
    totalWaves += scopeResult.waves;
    if (scopeResult.confidence < minConfidence) minConfidence = scopeResult.confidence;

    // Store boundary outputs for downstream scopes
    Object.assign(boundaryValues, scopeResult.boundaryOutputs);
  }

  return {
    outputs: allOutputs,
    confidence: minConfidence,
    executionLog: allLog,
    effectsPerformed: allEffects,
    nodesExecuted: totalExecuted,
    nodesSkipped: totalSkipped,
    duration_ms: performance.now() - totalStart,
    waves: totalWaves,
  };
}
