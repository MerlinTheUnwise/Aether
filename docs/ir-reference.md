# AETHER-IR Reference

> The complete specification of the AETHER Intermediate Representation.
> This is the primary reference for generating valid AETHER programs.

## Overview

AETHER-IR is a JSON format representing computation graphs. Every AETHER tool operates on this format. The schema uses JSON Schema draft-07 with `additionalProperties: false` on all objects — no extra fields allowed.

## AetherGraph (Top Level)

The root object of every AETHER program.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | string | ✓ | — | Unique graph identifier (snake_case) |
| `version` | integer | ✓ | — | Schema version (≥ 1) |
| `effects` | string[] | ✓ | — | Graph-level declared effects |
| `nodes` | (AetherNode \| AetherHole \| IntentNode)[] | ✓ | — | All computation nodes |
| `edges` | AetherEdge[] | ✓ | — | All data flow connections |
| `partial` | boolean | — | false | Whether holes are allowed |
| `sla` | object | — | — | `{ latency_ms?: number, availability?: number }` |
| `state_types` | StateType[] | — | [] | State machine definitions |
| `scopes` | Scope[] | — | [] | Scope definitions for large programs |
| `templates` | AetherTemplate[] | — | [] | Template definitions |
| `template_instances` | AetherTemplateInstance[] | — | [] | Template instantiations |
| `metadata` | object | — | — | `{ description?, safety_level?, human_oversight? }` |

**`metadata.safety_level`**: `"low"` | `"medium"` | `"high"`
**`metadata.human_oversight`**: `{ required_when: string }` (e.g., `"confidence < 0.7"`)

## AetherNode

A computation unit in the graph.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | string | ✓ | — | Unique within graph (snake_case) |
| `in` | Record<string, TypeAnnotation> | ✓ | — | Input ports with types |
| `out` | Record<string, TypeAnnotation> | ✓ | — | Output ports with types |
| `contract` | Contract | ✓ | — | Pre/post/invariant conditions |
| `effects` | string[] | ✓ | — | Declared side effects (empty = pure) |
| `pure` | boolean | — | — | Shorthand for effects: [] |
| `confidence` | number | — | — | 0.0–1.0. If < 0.85 → adversarial_check REQUIRED |
| `adversarial_check` | AdversarialCheck | — | — | Conditions true when implementation is WRONG |
| `recovery` | Record<string, RecoveryAction> | — | — | Error recovery strategies |
| `supervised` | SupervisedBlock | — | — | Marks node as unverified with reason |

### Validation Rules (MUST satisfy all)

1. `contract` must have at least one entry in `post` (every node guarantees something)
2. If `effects` is non-empty AND `pure` is not `true` → `recovery` is REQUIRED
3. If `confidence` is defined AND `confidence < 0.85` → `adversarial_check` is REQUIRED with ≥1 `break_if`
4. `id` must be unique within the graph
5. Port names must be unique within a node's `in` and within its `out`

## Contract

| Field | Type | Required | Description |
|---|---|---|---|
| `pre` | string[] | — | Preconditions (must be true before execution) |
| `post` | string[] | ✓ (≥1) | Postconditions (guaranteed after execution) |
| `invariants` | string[] | — | Must hold throughout execution |

### Contract Expression Syntax

Expressions are strings using these operators:

| Operator | Meaning | Example |
|---|---|---|
| `=` | Equality | `user.status = "active"` |
| `≠` or `!=` | Inequality | `result ≠ null` |
| `<` `>` `≤` `≥` or `<=` `>=` | Comparison | `amount > 0` |
| `∧` or `&&` | Logical AND | `valid ∧ unique` |
| `∨` or `\|\|` | Logical OR | `cached ∨ fresh` |
| `¬` or `!` | Logical NOT | `¬expired` |
| `∈` | Element of | `status ∈ ["active", "pending"]` |
| `∉` | Not element of | `item ∉ purchased` |
| `∩` | Intersection | `recommended ∩ purchased = ∅` |
| `⊆` | Subset | `result ⊆ all_products` |
| `→` or `⟹` | Implication | `paid → shipped_within_24h` |
| `∀x ∈ list: P(x)` | Universal quantifier | `∀p ∈ recommended: p ∉ purchased` |
| `x.y` | Property access | `user.email.is_lowercase` |

**Z3-Supported:** comparisons, boolean logic, membership, basic arithmetic, property access, implication, chained comparisons (`0 ≤ x ≤ 100`), string literals.

**Unsupported (graceful degradation):** lambdas, complex function calls, ML model outputs → returned as `"unsupported"` by verifier, not errors.

## AdversarialCheck

| Field | Type | Required | Description |
|---|---|---|---|
| `break_if` | string[] | ✓ (≥1) | Conditions that would be true if the implementation is WRONG |

The verifier asserts each `break_if` expression and checks for UNSAT. If SAT → the bad condition is possible → the implementation may be wrong.

**Example:**
```json
{
  "break_if": [
    "tax < 0",
    "tax > income",
    "recommended ∩ purchases ≠ ∅"
  ]
}
```

## RecoveryAction

Each entry maps a condition name to a recovery strategy:

```json
{
  "db_timeout": { "action": "retry", "params": { "count": 3, "backoff": "exponential" } },
  "db_error": { "action": "fallback", "params": { "value": { "unique": false } } },
  "auth_failure": { "action": "escalate", "params": { "message": "authentication failed" } }
}
```

| Action | Params | Behavior |
|---|---|---|
| `retry` | `{ count: number, backoff?: "exponential" \| "linear" }` | Retry N times with delay |
| `fallback` | `{ value?: any, node?: string }` | Return fallback value or delegate to another node |
| `escalate` | `{ message: string, preserve_context?: boolean }` | Route to human oversight |
| `respond` | `{ status: number, body: string }` | Return HTTP-like response |
| `report` | `{ channel?: string }` | Log error and continue |

## SupervisedBlock

| Field | Type | Required | Description |
|---|---|---|---|
| `reason` | string | ✓ | Why this node can't be verified |
| `review_status` | string | — | `"pending"` \| `"approved"` \| `"rejected"` |

Supervised nodes contribute 0 to the verification score. Their contracts are asserted but not proven. They degrade the program's overall verification percentage.

## TypeAnnotation

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | ✓ | Base type: `String`, `Bool`, `Int`, `Float64`, `Decimal`, `List<T>`, `Record`, `Map<K,V>` |
| `domain` | string | — | Semantic domain: `"authentication"`, `"commerce"`, `"ml"` |
| `unit` | string | — | Unit of measurement: `"kelvin"`, `"USD"`, `"ms"` |
| `dimension` | string | — | Physical dimension: `"thermodynamic_temperature"`, `"currency"`, `"time"` |
| `format` | string | — | Format constraint: `"email"`, `"uuid_v4"`, `"jwt"` |
| `sensitivity` | string | — | Data sensitivity: `"pii"`, `"public"`, `"internal"` |
| `range` | [number, number] | — | Value range: `[0, 100]` |
| `constraint` | string | — | Value constraint: `"> 0.7"` (for confidence gates) |
| `state_type` | string | — | Reference to a declared StateType |

### Type Checking Rules

| Check | Severity | Condition |
|---|---|---|
| Base type mismatch | ERROR | `from.type ≠ to.type` |
| Dimension mismatch | ERROR | Both defined, different values |
| Domain mismatch | ERROR | Both defined, different values |
| Sensitivity violation | ERROR | `from.sensitivity = "pii"` → `to.sensitivity = "public"` |
| Unit mismatch | WARNING | Same dimension, different units (auto-convert available) |
| State type mismatch | ERROR | Both defined, different state type IDs |
| Constraint warning | WARNING | Source confidence may not satisfy destination constraint |

## AetherEdge

| Field | Type | Required | Description |
|---|---|---|---|
| `from` | string | ✓ | `"node_id.output_port_name"` |
| `to` | string | ✓ | `"node_id.input_port_name"` |

### Edge Validation Rules

1. `from` must reference an existing node's `out` port
2. `to` must reference an existing node's `in` port
3. The graph must remain acyclic (no circular data dependencies)
4. Types at both ends must pass the type checker

## AetherHole (Partial Graphs)

Used when `graph.partial = true`. A placeholder for a node not yet built.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Placeholder identifier |
| `hole` | `true` | ✓ | Literal `true` — marks this as a hole |
| `must_satisfy` | object | ✓ | Contracts the eventual node must satisfy |

`must_satisfy` has the same shape as an AetherNode (`in`, `out`, `effects`, `contract`) but represents requirements, not implementation.

When filling a hole via the incremental builder:
- The replacement node's `in` must be a superset of `must_satisfy.in`
- The replacement node's `out` must be a superset of `must_satisfy.out`
- The replacement's contracts must imply the hole's contracts

## IntentNode (Layer 3)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Identifier |
| `intent` | `true` | ✓ | Literal `true` — marks as intent |
| `ensure` | string[] | ✓ | Properties that must be true of the output |
| `in` | Record<string, TypeAnnotation> | ✓ | Input types |
| `out` | Record<string, TypeAnnotation> | ✓ | Output types |
| `effects` | string[] | — | Required effects |
| `constraints` | object | — | `{ time_complexity?, space_complexity?, latency_ms?, deterministic? }` |
| `confidence` | number | — | Minimum confidence required |

The intent resolver matches these against the certified algorithm library and replaces them with concrete implementations.

## StateType

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | State type identifier |
| `states` | string[] | ✓ | All possible states (≥ 2) |
| `transitions` | Transition[] | ✓ | Valid state transitions |
| `invariants` | object | — | `{ never?: [{from, to}], terminal?: string[], initial?: string }` |

**Transition:** `{ from: string, to: string, when: string }`

**Validation rules:**
- All states must be unique
- All transition from/to must reference declared states
- No transition may match a never-invariant pair
- Terminal states must not appear as `from` in any transition
- Z3 verifies never-invariants and terminal invariants

## Scope

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Scope identifier |
| `description` | string | — | What this scope does |
| `nodes` | string[] | ✓ | Node IDs belonging to this scope |
| `boundary_contracts` | object | — | `{ requires?: BoundaryContract[], provides?: BoundaryContract[] }` |

**BoundaryContract:** `{ name: string, in: Record<string, TypeAnnotation>, out: Record<string, TypeAnnotation>, contract?: Contract, effects?: string[], confidence?: number }`

**Validation rules:**
- Every node must belong to exactly one scope (if scopes are defined)
- Every cross-scope edge must be covered by a boundary contract
- Provider's provides contract must be type-compatible with requirer's requires contract

## AetherTemplate

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Template identifier |
| `description` | string | — | What this template does |
| `parameters` | Parameter[] | ✓ | Template parameters |
| `nodes` | AetherNode[] | ✓ | Template nodes (may reference $parameters) |
| `edges` | AetherEdge[] | ✓ | Template edges |
| `exposed_inputs` | Record<string, string> | — | External input mappings |
| `exposed_outputs` | Record<string, string> | — | External output mappings |

**Parameter:** `{ name: string, kind: "type" | "value" | "effect" | "node_id", constraint?: string }`

**AetherTemplateInstance:** `{ id: string, template: string, bindings: Record<string, any> }`

Parameters are referenced with `$` prefix in template nodes: `{ "type": "$T" }`, `"$max_retries"`, `"$storage_effect"`.

## Confidence Propagation

```
propagated_confidence(node) = node.confidence × min(input_confidences)
```

- Wave 0 nodes (no inputs): `propagated = declared` (or 1.0 if undefined)
- Graph confidence: product along the critical path
- Oversight threshold: default 0.7 (configurable)
- Below threshold: node skipped or routed to human oversight

## Effect Hierarchy

- `database` covers `database.read`, `database.write`, `database.read_write`
- `database.read_write` covers both `database.read` and `database.write`
- `pure: true` is equivalent to `effects: []`
- A node must only record effects it declared
- Undeclared effects are violations

## Verification Semantics

**Postcondition verification:** Assert `NOT(postcondition)`. If UNSAT → postcondition always holds → VERIFIED.

**Adversarial check:** Assert `break_if` expression. If UNSAT → the bad condition can never be true → PASSED. If SAT → the bad thing could happen → FAILED.

**Supervised blocks:** Contracts are asserted but not proven. Tracked as unverified. Contribute 0% to verification score.

**Verification percentage:** `verified_nodes / (verified_nodes + failed_nodes)`. Unsupported and supervised nodes are excluded from the denominator.
