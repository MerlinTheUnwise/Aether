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
import type { ExecutionProfiler } from "./profiler.js";
import type { RuntimeCompiler } from "./jit.js";
import { checkContract, checkAdversarial, AdversarialViolation } from "./evaluator/checker.js";
export { AdversarialViolation } from "./evaluator/checker.js";
import { executeRecovery } from "./recovery.js";
export { EscalationError, matchesCondition, retryWithBackoff, executeRecovery } from "./recovery.js";
import type { ImplementationRegistry } from "../implementations/registry.js";
import type { ServiceContainer } from "../implementations/services/container.js";
import type { NodeImplementation, ImplementationContext } from "../implementations/types.js";
import type { MCPRegistry } from "../mcp/registry.js";
import type { MCPEffectMapping } from "../mcp/effects.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type NodeFunction = (inputs: Record<string, any>) => Promise<Record<string, any>>;

export interface ExecutionContext {
  graph: AetherGraph;
  inputs: Record<string, any>;
  nodeImplementations: Map<string, NodeFunction>;
  confidenceThreshold: number;
  onOversightRequired?: (node: string, confidence: number, context: any) => Promise<any>;
  onEffectExecuted?: (node: string, effect: string, detail: any) => void;
  jit?: {
    compiler: RuntimeCompiler;
    profiler: ExecutionProfiler;
    autoCompile: boolean;
    compilationThreshold: number;
  };

  // Registry-based resolution (Phase 5)
  registry?: ImplementationRegistry;
  services?: ServiceContainer;
  contractMode?: "enforce" | "skip" | "warn";

  // MCP support (Phase 1 MCP)
  mcpRegistry?: MCPRegistry;
  mcpEffectMappings?: MCPEffectMapping[];
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

export interface ContractReport {
  totalChecked: number;
  passed: number;
  violated: number;
  unevaluable: number;
  adversarialTriggered: number;
  warnings: string[];
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
  contractReport?: ContractReport;
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

// EscalationError re-exported from ./recovery.ts

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
 * Runtime contract evaluator using the new expression evaluator.
 * Never silently passes — unevaluable expressions produce warnings.
 * Kept as a compatibility wrapper; new code should use checkContract directly.
 */
export function evaluateContract(expression: string, variables: Record<string, any>): boolean {
  const result = checkContract(expression, variables);
  if (result.unevaluable) {
    // Log warning — never silent
    console.warn(`[AETHER] UNEVALUABLE contract: ${expression} — ${result.error}`);
    return false; // Never assume passing
  }
  return result.passed;
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

    // Fall back to per-node inputs (graphInputs[nodeId][portName])
    if (!found && graphInputs[node.id] && typeof graphInputs[node.id] === "object" && portName in graphInputs[node.id]) {
      inputs[portName] = graphInputs[node.id][portName];
      found = true;
    }

    // Fall back to graph-level inputs
    if (!found && portName in graphInputs) {
      inputs[portName] = graphInputs[portName];
    }
  }

  return inputs;
}

// ─── Recovery ────────────────────────────────────────────────────────────────
// Recovery logic extracted to ./recovery.ts (matchesCondition, retryWithBackoff, executeRecovery)

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

  // 4. Resolve implementation: nodeImplementations → MCP → registry → stub
  let implFn: ((inputs: Record<string, any>) => Promise<Record<string, any>>) | undefined;
  const legacyImpl = context.nodeImplementations.get(node.id);
  if (legacyImpl) {
    implFn = legacyImpl;
  } else if (context.mcpRegistry && resolveMCPForNode(node, context)) {
    // MCP-routed node: call external MCP server
    const mcpMapping = resolveMCPForNode(node, context)!;
    const mcpClient = context.mcpRegistry.get(mcpMapping.server);
    if (mcpClient) {
      implFn = async (inp) => {
        // Effect enforcement: verify node declared this server's effects
        const serverPrefix = mcpMapping.server;
        if (!node.effects.some(e => e.startsWith(serverPrefix) || e.startsWith(mcpMapping.effect ?? ""))) {
          throw new Error(`Effect violation: node "${node.id}" called MCP server "${serverPrefix}" but only declared effects: [${node.effects.join(", ")}]`);
        }

        // Report the effect
        effectTracker.recordEffect(node.id, mcpMapping.effect ?? `${mcpMapping.server}.${mcpMapping.tool}`);
        context.onEffectExecuted?.(node.id, mcpMapping.effect ?? `${mcpMapping.server}.${mcpMapping.tool}`, { mcp: true });

        // Merge static params from the mcp block with node inputs
        const toolParams = mcpMapping.params ? { ...inp, ...mcpMapping.params } : inp;

        const callResult = await mcpClient.callTool(mcpMapping.tool, toolParams);
        if (!callResult.success) {
          throw new Error(`mcp_error:${mcpMapping.server}:${callResult.error}`);
        }

        // Map MCP response to output ports
        if (typeof callResult.content === "object" && callResult.content !== null && !Array.isArray(callResult.content)) {
          return callResult.content;
        }
        // Single output port: map the content directly
        const outPorts = Object.keys(node.out);
        if (outPorts.length === 1) {
          return { [outPorts[0]]: callResult.content };
        }
        return { result: callResult.content };
      };
    }
  } else if (context.registry) {
    const resolved = context.registry.resolve(node);
    if (resolved) {
      // Wrap NodeImplementation → NodeFunction by providing ImplementationContext
      const registryImpl = resolved.implementation;
      const implContext: ImplementationContext = {
        nodeId: node.id,
        effects: node.effects,
        confidence: node.confidence ?? 1.0,
        reportEffect: (effect: string) => {
          effectTracker.recordEffect(node.id, effect);
          context.onEffectExecuted?.(node.id, effect, {});
        },
        log: (msg: string) => {},
        getService: context.services ? <T>(name: string) => context.services!.get<T>(name) : undefined,
      };
      implFn = (inp) => registryImpl(inp, implContext);
    }
  }

  const isStub = !implFn;
  // Default contractMode: skip for stubs, enforce when impl exists (either via registry or legacy map)
  const contractMode = isStub ? "skip" : (context.contractMode ?? "enforce");

  // 3. Precondition check
  if (contractMode === "enforce") {
    for (const pre of node.contract.pre ?? []) {
      if (!evaluateContract(pre, inputs)) {
        throw new ContractViolation(node.id, "precondition", pre);
      }
    }
  } else if (contractMode === "warn") {
    for (const pre of node.contract.pre ?? []) {
      if (!evaluateContract(pre, inputs)) {
        console.warn(`[AETHER:WARN] Precondition violation in "${node.id}": ${pre}`);
      }
    }
  }

  let result: Record<string, any>;

  if (isStub) {
    // Stub mode: return defaults, skip postconditions
    result = generateDefaults(node.out);
  } else {
    try {
      result = await implFn!(inputs);
    } catch (error) {
      // 5. Recovery — need to adapt retryWithBackoff to use resolved impl
      result = await executeRecovery(node, error as Error, inputs, context);
    }
  }

  // 6. Postcondition check
  if (contractMode === "enforce") {
    for (const post of node.contract.post ?? []) {
      if (!evaluateContract(post, { ...inputs, ...result })) {
        throw new ContractViolation(node.id, "postcondition", post);
      }
    }

    // 6b. Adversarial check
    if (node.adversarial_check) {
      const adversarialReport = checkAdversarial(node.adversarial_check, inputs, result);
      if (!adversarialReport.allClear) {
        const triggered = adversarialReport.checks.find(c => c.triggered);
        if (triggered) {
          throw new AdversarialViolation(node.id, triggered.expression);
        }
      }
    }
  } else if (contractMode === "warn") {
    for (const post of node.contract.post ?? []) {
      if (!evaluateContract(post, { ...inputs, ...result })) {
        console.warn(`[AETHER:WARN] Postcondition violation in "${node.id}": ${post}`);
      }
    }
    if (node.adversarial_check) {
      const adversarialReport = checkAdversarial(node.adversarial_check, inputs, result);
      if (!adversarialReport.allClear) {
        const triggered = adversarialReport.checks.find(c => c.triggered);
        if (triggered) {
          console.warn(`[AETHER:WARN] Adversarial trigger in "${node.id}": ${triggered.expression}`);
        }
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

  // Contract report tracking
  const contractReport: ContractReport = {
    totalChecked: 0, passed: 0, violated: 0, unevaluable: 0,
    adversarialTriggered: 0, warnings: [],
  };

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

  // ─── JIT: Check for compiled subgraphs ─────────────────────────────────
  const jitCompiledNodes = new Set<string>();
  if (context.jit?.compiler) {
    const compiler = context.jit.compiler;
    // Check all cached compilations for subgraphs of this graph
    const allNodeIds = [...nodeMap.keys()];

    // Try to find cached compilations covering nodes in this graph
    for (const nodeId of allNodeIds) {
      if (jitCompiledNodes.has(nodeId)) continue;

      // Check if this node is part of a cached compilation
      const cached = findCachedCompilation(compiler, nodeId, allNodeIds);
      if (cached) {
        // Execute the compiled function
        const jitStart = performance.now();
        try {
          const jitResult = await cached.fn(
            context.inputs,
            context.nodeImplementations,
            {
              confidenceThreshold: context.confidenceThreshold,
              onOversight: context.onOversightRequired,
              onEffect: context.onEffectExecuted,
            }
          );

          // Store JIT results in state and log
          for (const [jitNodeId, outputs] of Object.entries(jitResult.outputs)) {
            state.set(jitNodeId, outputs as Record<string, any>);
            jitCompiledNodes.add(jitNodeId);
            nodesExecuted++;
          }

          allEffects.push(...jitResult.effects);

          const jitDuration = performance.now() - jitStart;
          for (const jitNodeId of cached.sourceNodes) {
            if (nodeMap.has(jitNodeId)) {
              log.push({
                nodeId: jitNodeId,
                wave: 0, // JIT flattens waves
                duration_ms: jitDuration / cached.sourceNodes.length,
                confidence: jitResult.confidence,
                skipped: false,
                effects: [],
              });
            }
          }
        } catch {
          // JIT execution failed — fall through to interpreter
        }
      }
    }
  }

  // ─── Set up profiler ───────────────────────────────────────────────────
  const profiler = context.jit?.profiler;
  if (profiler) {
    profiler.setGraph(context.graph);
  }

  // Execute wave by wave
  for (const wave of waves) {
    const waveNodes = wave.nodeIds
      .filter(id => !jitCompiledNodes.has(id))
      .map(id => nodeMap.get(id))
      .filter((n): n is AetherNode => n !== undefined);

    if (waveNodes.length === 0) continue;

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

      // Record in profiler
      profiler?.recordNodeExecution({
        nodeId: result.nodeId,
        duration_ms: result.duration_ms,
        wave: wave.level,
        confidence: result.confidence,
        recoveryTriggered: !!result.error,
      });

      // Track contracts for the report
      if (!result.skipped) {
        const node = nodeMap.get(result.nodeId);
        if (node) {
          const hasLegacy = context.nodeImplementations.has(node.id);
          const hasRegistry = context.registry ? !!context.registry.resolve(node) : false;
          const isStub = !hasLegacy && !hasRegistry;
          if (isStub) {
            const contractCount = (node.contract.pre?.length ?? 0) + (node.contract.post?.length ?? 0) +
              (node.contract.invariants?.length ?? 0) + (node.adversarial_check?.break_if?.length ?? 0);
            if (contractCount > 0) {
              contractReport.warnings.push(`${node.id}: ${contractCount} contracts SKIPPED (stub mode)`);
            }
          } else {
            // Seed variables with port names so contracts never hit "Undefined variable"
            // for declared ports. Actual values from edges/outputs override these defaults.
            const portDefaults: Record<string, any> = {};
            for (const portName of Object.keys(node.in)) portDefaults[portName] = undefined;
            for (const portName of Object.keys(node.out)) portDefaults[portName] = undefined;
            const contractVars = { ...portDefaults, ...gatherInputs(node, state, context.graph.edges, context.inputs), ...result.outputs };
            for (const expr of [...(node.contract.pre ?? []), ...(node.contract.post ?? []), ...(node.contract.invariants ?? [])]) {
              contractReport.totalChecked++;
              const check = checkContract(expr, contractVars);
              if (check.unevaluable) contractReport.unevaluable++;
              else if (check.passed) contractReport.passed++;
              else contractReport.violated++;
              contractReport.warnings.push(...check.warnings);
            }
            if (node.adversarial_check) {
              for (const expr of node.adversarial_check.break_if) {
                contractReport.totalChecked++;
                const check = checkContract(expr, contractVars);
                if (!check.unevaluable && check.passed) contractReport.adversarialTriggered++;
                else if (check.unevaluable) contractReport.unevaluable++;
                else contractReport.passed++;
                contractReport.warnings.push(...check.warnings);
              }
            }
          }
        }
      }

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

  const result: ExecutionResult = {
    outputs,
    confidence: confidenceEngine.getGraphConfidence(),
    executionLog: log,
    effectsPerformed: allEffects,
    nodesExecuted,
    nodesSkipped,
    duration_ms: totalDuration,
    waves: waves.length,
    stateTransitions,
    contractReport,
  };

  // Record in profiler
  profiler?.recordGraphExecution(result);

  // ─── JIT: Auto-compile recommendations ────────────────────────────────
  if (context.jit?.autoCompile && context.jit.profiler && context.jit.compiler) {
    const recs = context.jit.profiler.getRecommendations();
    for (const rec of recs) {
      if (!context.jit.compiler.getCached(rec.subgraph)) {
        context.jit.compiler.compile(context.graph, rec.subgraph);
      }
    }
  }

  return result;
}

/** Find a cached compiled function that covers a given node */
function findCachedCompilation(
  compiler: RuntimeCompiler,
  nodeId: string,
  allNodeIds: string[]
): { fn: any; sourceNodes: string[] } | null {
  // Check stats first — if no compilations, skip
  const stats = compiler.getStats();
  if (stats.cached === 0) return null;

  // Try to find a cached compilation containing this node
  // We check by trying all possible subsets that include this node
  // In practice, compilations are stored by node set, so we check getCached
  // with increasingly larger sets around this node
  const cached = compiler.getCached(allNodeIds);
  if (cached && cached.sourceNodes.includes(nodeId)) return cached;

  return null;
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
    registry: context.registry,
    services: context.services,
    contractMode: context.contractMode,
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

// ─── Context Factory ──────────────────────────────────────────────────────────

export async function createExecutionContext(
  graph: AetherGraph,
  inputs: Record<string, any>,
  options?: {
    serviceConfig?: import("../implementations/services/container.js").ServiceContainerConfig;
    contractMode?: "enforce" | "skip" | "warn";
    implementations?: Map<string, NodeFunction>;
  },
): Promise<ExecutionContext> {
  const { ImplementationRegistry } = await import("../implementations/registry.js");
  const { registerProgramImplementations } = await import("../implementations/programs/index.js");
  const { ServiceContainer } = await import("../implementations/services/container.js");

  const services = await ServiceContainer.createDefault(options?.serviceConfig);
  const registry = new ImplementationRegistry();
  registry.registerCore();
  registerProgramImplementations(registry);

  // Apply user overrides
  if (options?.implementations) {
    for (const [nodeId, fn] of options.implementations) {
      registry.override(nodeId, async (inp, ctx) => fn(inp));
    }
  }

  return {
    graph,
    inputs,
    nodeImplementations: options?.implementations ?? new Map(),
    confidenceThreshold: 0.7,
    registry,
    services,
    contractMode: options?.contractMode ?? "enforce",
  };
}

// ─── MCP Resolution ──────────────────────────────────────────────────────────

interface MCPNodeMapping {
  server: string;
  tool: string;
  effect?: string;
  params?: Record<string, string>;
}

/**
 * Resolve MCP routing for a node.
 * Checks: 1) explicit mcp block on the node, 2) effect-based mapping
 */
function resolveMCPForNode(node: AetherNode, context: ExecutionContext): MCPNodeMapping | null {
  // 1. Explicit mcp block on the node (from IR JSON)
  const mcpBlock = (node as any).mcp;
  if (mcpBlock && mcpBlock.server && mcpBlock.tool) {
    return {
      server: mcpBlock.server,
      tool: mcpBlock.tool,
      params: mcpBlock.params,
    };
  }

  // 2. Effect-based mapping
  if (context.mcpEffectMappings) {
    for (const effect of node.effects) {
      const mapping = context.mcpEffectMappings.find(m => m.effect === effect);
      if (mapping && context.mcpRegistry?.get(mapping.server)) {
        return { server: mapping.server, tool: mapping.tool, effect: mapping.effect };
      }
    }
  }

  // 3. Convention-based: try "server.tool" pattern from effects
  if (context.mcpRegistry) {
    for (const effect of node.effects) {
      const dotIdx = effect.indexOf(".");
      if (dotIdx === -1) continue;
      const server = effect.slice(0, dotIdx);
      const tool = effect.slice(dotIdx + 1);
      if (context.mcpRegistry.get(server)) {
        return { server, tool, effect };
      }
    }
  }

  return null;
}
