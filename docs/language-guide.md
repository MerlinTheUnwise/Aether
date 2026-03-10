# AETHER Language Guide

> Axiomatic Execution Through Holistic Expression & Reasoning
> An intermediate representation format designed for AI-generated safety-critical workflows.

## What AETHER Is

AETHER is a programming language where programs are **computation graphs** (directed acyclic graphs), not linear text. Every node in the graph carries typed inputs/outputs, machine-verifiable contracts, confidence annotations, declared effects, and recovery strategies.

Programs are represented as JSON (AETHER-IR), validated by a schema, type-checked for semantic correctness, verified by Z3 for contract satisfaction, and executed by a parallel graph runtime. They can also be compiled to native binaries via LLVM.

**AETHER is AI-first.** Humans declare intent. AI generates AETHER-IR. Machines verify and execute. No human ever needs to read or write AETHER directly.

## The Nine Pillars

Every design decision in AETHER traces back to one of these principles:

### 1. Graph-Native
Programs are DAGs, not text files. No syntax errors possible — a program is structurally valid JSON or it isn't. No brackets to mismatch, no indentation bugs, no semicolons.

### 2. Contract-Verified
Every node carries preconditions, postconditions, and invariants. These are contracts verified by Z3 (arithmetic, boolean, comparisons, implication). Complex expressions fall back to runtime evaluation. Optional Lean 4 proof skeleton export is available for manual completion.

### 3. Intent-Declarative
Layer 3 nodes declare WHAT should be true ("output must be sorted") without specifying HOW. The intent resolver matches these to certified algorithms with proven contracts.

### 4. Confidence-Aware
Every value can carry a confidence annotation (0.0–1.0) that propagates multiplicatively through the graph. Low-confidence paths are automatically gated — routed to human review or fallback.

### 5. Effect-Tracked
All side effects (database, network, filesystem, email, etc.) are declared on every node and enforced at runtime. Pure nodes declare no effects. An undeclared effect is a violation.

### 6. Parallel-Default
Nodes without data dependencies execute in parallel automatically. The runtime groups nodes into waves by topological level and runs each wave via `Promise.all()` (JS) or pthreads (native).

### 7. Self-Healing
No exceptions. Every effectful node must declare recovery strategies (retry, fallback, escalate, respond, report). The validator rejects programs with missing recovery. Unhandled errors are structurally impossible.

### 8. Incremental-Verifiable
Each node is validated the instant it's added to the graph. Partial graphs with typed holes are supported. AI builds node-by-node with immediate feedback — no need to generate a complete program before learning if it's valid.

### 9. Context-Scoped
Large programs decompose into scopes with boundary contracts. AI loads only the scope it's working on plus boundary contracts of neighbors. If the work satisfies boundary contracts, it's guaranteed correct in the larger system.

## Three Execution Layers

### Layer 3 — Intent
Declare desired properties and outcomes. The runtime resolves these to certified implementations.

```json
{
  "id": "sort_results",
  "intent": true,
  "ensure": ["output is sorted ascending by date"],
  "in": { "data": { "type": "List<Record>" } },
  "out": { "sorted": { "type": "List<Record>" } }
}
```

### Layer 2 — Structural
Construct computation graphs with full contracts. This is the primary working layer where most programs live.

```json
{
  "id": "validate_email",
  "in": { "email": { "type": "String", "format": "email" } },
  "out": { "normalized": { "type": "String", "domain": "authentication" } },
  "contract": { "pre": ["email.length > 0"], "post": ["normalized.is_lowercase"] },
  "effects": [],
  "pure": true,
  "confidence": 0.99
}
```

### Layer 1 — Constructive
Build new verified algorithms when needed. These join the certified library for future intent resolution.

## Execution Model

1. **Validate** — Schema validation, DAG check, confidence rules, recovery rules
2. **Type Check** — Semantic type compatibility across all edges
3. **Verify** — Z3 proves postconditions and checks adversarial conditions
4. **Resolve** — Intent nodes matched to certified algorithms (if any)
5. **Execute** — Parallel wave scheduling with confidence gating
6. **Visualize** — HTML graph rendering with verification overlay

Three runtime modes from the same source:
- **Interpreted** — Graph executor walks the DAG (development/debugging)
- **Compiled** — Hot subgraphs compiled to optimized JavaScript functions (Node.js production)
- **Native** — LLVM IR generation with C runtime (experimental — end-to-end execution not yet verified)

## Key Terminology

| Term | Meaning |
|---|---|
| **Node** | A computation unit with typed I/O, contracts, effects, confidence |
| **Edge** | A typed data flow connection: `"source_node.out_port"` → `"dest_node.in_port"` |
| **Graph** | A complete program (DAG of nodes + edges) |
| **Wave** | A set of nodes with no mutual data dependencies, executing in parallel |
| **Contract** | Machine-verifiable pre/post/invariant conditions |
| **Adversarial Check** | A condition that would be true IF the implementation is wrong |
| **Confidence** | Numeric certainty (0.0–1.0) propagating multiplicatively through the graph |
| **Effect** | A declared side effect (database.read, network, email, etc.) |
| **Recovery** | A typed error handling strategy (no exceptions in AETHER) |
| **Hole** | A typed placeholder in a partial graph, carrying the contracts the eventual node must satisfy |
| **Scope** | A subset of a graph's nodes with boundary contracts for independent verification |
| **Supervised** | An explicitly unverified code region (tracked, not hidden) |
| **Intent** | A Layer 3 declaration of a desired property, resolved to a certified implementation |
| **Certified Algorithm** | A library algorithm with Z3-proven contracts |
| **Template** | A parameterized subgraph that can be instantiated with type-safe bindings |
| **Boundary Contract** | An interface contract between two scopes (requires/provides) |

## Real Execution

AETHER programs are not just specifications — they execute with real computation, real data, and real contract enforcement. Three execution modes are available:

### Stub Mode (`execute <path>`)
Structural verification with typed defaults. Each node produces default outputs matching its output types. Contracts are skipped (defaults won't satisfy real contracts). Useful for validating graph structure and wave scheduling.

### Real Mode (`execute <path> --real`)
Actual computation with full contract enforcement. Each node resolves to a registered implementation that performs real data processing. Contracts (pre/post/invariants) are evaluated against actual outputs. Effects are tracked and validated. Recovery strategies fire on real failures.

Real mode requires:
- **Implementations** registered for each node ID in the `ImplementationRegistry`
- **Services** (database, filesystem, email, ML) injected via `ServiceContainer`
- **Test data** — seed files for databases, input files for the graph

### Native Mode (`compile <path>`)
LLVM compilation for performance-critical deployments. The graph is compiled to native machine code with contracts inlined. See the [Native Compilation](native-compilation.md) guide.
