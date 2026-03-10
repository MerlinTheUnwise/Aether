# AETHER Language Guide

> Axiomatic Execution Through Holistic Expression & Reasoning
> An intermediate representation format designed for AI-generated safety-critical workflows.

## What AETHER Is

AETHER is a programming language where programs are **computation graphs** (directed acyclic graphs), not linear text. Every node in the graph carries typed inputs/outputs, machine-verifiable contracts, confidence annotations, declared effects, and recovery strategies.

Programs are written in `.aether` surface syntax (human-readable) or represented as JSON IR (machine-optimized). Both formats are validated by the schema, type-checked for semantic correctness, verified by Z3 for contract satisfaction, and executed by a parallel graph runtime. Programs can also be compiled to native binaries via LLVM.

**AETHER is AI-first.** Humans declare intent. AI generates programs. Machines verify and execute. The `.aether` format is the primary authoring format; JSON IR is the intermediate representation used internally by tools.

## Writing AETHER Programs

Here is a quick tour of the `.aether` surface syntax. Every concept shown here maps directly to the JSON IR, but `.aether` is far more concise and readable.

### Minimal Program

```aether
graph hello_world v1
  effects: []

  node greet
    in:  name: String
    out: greeting: String
    contracts:
      post: greeting.length > 0
    pure
  end

end // graph
```

### Nodes with Effects, Recovery, and Contracts

```aether
node check_uniqueness
  in:  email: String @email @auth @pii
  out: unique: Bool
  effects: [database.read]
  contracts:
    post: unique <=> !exists(users, email)
  recovery:
    db_timeout -> retry(3, exponential)
    db_error -> fallback(assume_unique: false)
end
```

### Type Annotations

Annotations enrich types with semantic metadata using `@` shorthand:

```aether
in:  amount: Float64 @USD @range(0.01, 999999.99)
in:  token: String @jwt @internal
out: user: Record @auth @pii
in:  order: Record @state_type("OrderLifecycle")
in:  action: String @constraint("> 0.9")
```

### Edges

```aether
edge validate_email.normalized -> check_uniqueness.email
edge check_uniqueness.unique -> create_user.unique
```

### Intent Nodes (Layer 3)

```aether
intent sort_results
  in:  collection: List<Transaction>
  out: sorted: List<Transaction>
  ensure: output is sorted by date
  ensure: output is permutation of input
  constraints:
    time_complexity: O(n log n)
    deterministic: true
end
```

### State Types

```aether
statetype OrderLifecycle
  states: [created, paid, shipped, delivered, cancelled, refunded]
  transitions:
    created -> paid when payment_confirmed
    created -> cancelled when customer_cancelled
    paid -> shipped when shipment_dispatched
  never:
    cancelled -> paid
    delivered -> shipped
  terminal: [cancelled, refunded]
  initial: created
end
```

### Templates and Instantiation

```aether
template crud-entity
  params:
    $Entity: type
    $IdType: type
    $storage_effect: effect

  node validate_input
    in:  data: $Entity
    out: validated: $Entity
    contracts:
      post: output.validated != null
    pure
  end

  // ... more nodes and edges ...
end

use crud-entity as user_crud
  Entity = Record @auth
  IdType = String @uuid
  storage_effect = database.write
end
```

### Adversarial Checks

```aether
node authorize_card
  in:  amount: Float64 @USD
  out: authorized: Float64 @USD, status: String @payment
  effects: [payment_gateway.write]
  contracts:
    post: authorized == amount
  adversarial:
    break_if: authorized != amount
    break_if: status == captured
  confidence: 0.8
  recovery:
    gateway_timeout -> retry(exponential)
end
```

### Graph Metadata and SLA

```aether
graph payment_api v1
  effects: [payment_gateway.write, database.write]

  metadata:
    description: "Payment processing API"
    safety_level: high
    human_oversight: "confidence < 0.7"
    sla:
      latency_ms: 200
      availability: 99.9
```

## The Nine Pillars

Every design decision in AETHER traces back to one of these principles:

### 1. Graph-Native
Programs are DAGs, not text files. The `.aether` surface syntax uses a clean, keyword-based structure (`graph`, `node`, `edge`, `end`) that maps 1:1 to the JSON IR. Both formats are structurally validated.

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

```aether
intent sort_results
  in:  data: List<Record>
  out: sorted: List<Record>
  ensure: output is sorted ascending by date
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "id": "sort_results",
  "intent": true,
  "ensure": ["output is sorted ascending by date"],
  "in": { "data": { "type": "List<Record>" } },
  "out": { "sorted": { "type": "List<Record>" } }
}
```

</details>

### Layer 2 — Structural
Construct computation graphs with full contracts. This is the primary working layer where most programs live.

```aether
node validate_email
  in:  email: String @email
  out: normalized: String @email @auth
  contracts:
    pre:  email.length > 0
    post: normalized.is_lowercase
  pure
  confidence: 0.99
end
```

<details><summary>IR equivalent (JSON)</summary>

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

</details>

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
