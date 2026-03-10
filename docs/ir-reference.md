# AETHER-IR Reference

> The complete specification of the AETHER Intermediate Representation.
> This is the primary reference for the JSON IR that underlies all AETHER programs.

## Overview

AETHER-IR is a JSON format representing computation graphs. The `.aether` surface syntax compiles down to this format via the parser. All AETHER tools operate on this IR internally. The schema uses JSON Schema draft-07 with `additionalProperties: false` on all objects -- no extra fields allowed.

Each section below documents the IR structure and shows how it maps to the `.aether` surface syntax.

## AetherGraph (Top Level)

The root object of every AETHER program.

| Field | Type | Required | Default | Surface Syntax |
|---|---|---|---|---|
| `id` | string | yes | -- | `graph my_graph v1` |
| `version` | integer | yes | -- | `graph my_graph v1` |
| `effects` | string[] | yes | -- | `effects: [db.read, email]` |
| `nodes` | (AetherNode \| AetherHole \| IntentNode)[] | yes | -- | `node ...`, `hole ...`, `intent ...` blocks |
| `edges` | AetherEdge[] | yes | -- | `edge src.port -> dst.port` |
| `partial` | boolean | -- | false | `partial` keyword |
| `sla` | object | -- | -- | `sla:` block under `metadata:` |
| `state_types` | StateType[] | -- | [] | `statetype ... end` blocks |
| `scopes` | Scope[] | -- | [] | `scope ... end` blocks |
| `templates` | AetherTemplate[] | -- | [] | `template ... end` blocks |
| `template_instances` | AetherTemplateInstance[] | -- | [] | `use template as id ... end` blocks |
| `metadata` | object | -- | -- | `metadata:` block |

**`metadata.safety_level`**: `"low"` | `"medium"` | `"high"`
**`metadata.human_oversight`**: `{ required_when: string }` (e.g., `"confidence < 0.7"`)

**Surface syntax example:**

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

  // nodes, edges, etc.

end // graph
```

## AetherNode

A computation unit in the graph.

| Field | Type | Required | Surface Syntax |
|---|---|---|---|
| `id` | string | yes | `node my_node` |
| `in` | Record<string, TypeAnnotation> | yes | `in:  name: Type @ann` |
| `out` | Record<string, TypeAnnotation> | yes | `out: name: Type @ann` |
| `contract` | Contract | yes | `contracts:` block |
| `effects` | string[] | yes | `effects: [db.read]` |
| `pure` | boolean | -- | `pure` keyword |
| `confidence` | number | -- | `confidence: 0.95` |
| `adversarial_check` | AdversarialCheck | -- | `adversarial:` block |
| `recovery` | Record<string, RecoveryAction> | -- | `recovery:` block |
| `supervised` | SupervisedBlock | -- | `supervised: "reason" status` |

**Surface syntax example:**

```aether
node check_uniqueness
  in:  email: String @email @auth
  out: unique: Bool
  effects: [database.read]
  contracts:
    post: unique <=> !exists(users, email)
  recovery:
    db_timeout -> retry(3, exponential)
    db_error -> fallback(assume_unique: false)
  confidence: 0.95
end
```

### Validation Rules (MUST satisfy all)

1. `contract` must have at least one entry in `post` (every node guarantees something)
2. If `effects` is non-empty AND `pure` is not `true` → `recovery` is REQUIRED
3. If `confidence` is defined AND `confidence < 0.85` → `adversarial_check` is REQUIRED with ≥1 `break_if`
4. `id` must be unique within the graph
5. Port names must be unique within a node's `in` and within its `out`

## Contract

| Field | Type | Required | Surface Syntax |
|---|---|---|---|
| `pre` | string[] | -- | `pre:  expression` (one per line) |
| `post` | string[] | yes (>=1) | `post: expression` (one per line) |
| `invariants` | string[] | -- | `inv:  expression` (one per line) |

**Surface syntax:** In `.aether`, contracts are written inside a `contracts:` block with `pre:`, `post:`, and `inv:` prefixes:

```aether
contracts:
  pre:  amount > 0
  pre:  card_token.length > 0
  post: validated_amount == amount
  post: status == created
  inv:  status != captured
```

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

| Field | Type | Required | Surface Syntax |
|---|---|---|---|
| `break_if` | string[] | yes (>=1) | `break_if: expression` (one per line) |

The verifier asserts each `break_if` expression and checks for UNSAT. If SAT -> the bad condition is possible -> the implementation may be wrong.

**Surface syntax:**

```aether
adversarial:
  break_if: tax < 0
  break_if: tax > income
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "break_if": [
    "tax < 0",
    "tax > income",
    "recommended ∩ purchases ≠ ∅"
  ]
}
```

</details>

## RecoveryAction

Each entry maps a condition name to a recovery strategy.

**Surface syntax:**

```aether
recovery:
  db_timeout -> retry(3, exponential)
  db_error -> fallback(unique: false)
  auth_failure -> escalate("authentication failed")
  not_found -> respond(404, "not found")
  other_error -> report(channel: ops-alerts)
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "db_timeout": { "action": "retry", "params": { "count": 3, "backoff": "exponential" } },
  "db_error": { "action": "fallback", "params": { "value": { "unique": false } } },
  "auth_failure": { "action": "escalate", "params": { "message": "authentication failed" } }
}
```

</details>

| Action | Surface Syntax | Params | Behavior |
|---|---|---|---|
| `retry` | `-> retry(3, exponential)` | `{ count, backoff? }` | Retry N times with delay |
| `fallback` | `-> fallback(key: value)` | `{ value?, node? }` | Return fallback value or delegate |
| `escalate` | `-> escalate("msg")` | `{ message, preserve_context? }` | Route to human oversight |
| `respond` | `-> respond(401, "msg")` | `{ status, body }` | Return HTTP-like response |
| `report` | `-> report(channel: name)` | `{ channel? }` | Log error and continue |

## SupervisedBlock

| Field | Type | Required | Surface Syntax |
|---|---|---|---|
| `reason` | string | yes | `supervised: "reason" status` |
| `review_status` | string | -- | `pending` \| `approved` \| `rejected` (after reason) |

**Surface syntax:**

```aether
supervised: "null handling is domain-specific" pending
```

Supervised nodes contribute 0 to the verification score. Their contracts are asserted but not proven. They degrade the program's overall verification percentage.

## TypeAnnotation

| Field | Type | Required | Surface Syntax |
|---|---|---|---|
| `type` | string | yes | `String`, `Bool`, `Int`, `Float64`, `List<T>`, `Record`, `Map<K,V>` |
| `domain` | string | -- | `@auth`, `@commerce`, `@payment`, `@ml`, `@support`, `@mod` |
| `unit` | string | -- | `@USD`, `@EUR`, `@celsius`, `@ms`, `@seconds`, `@bytes`, `@percent` |
| `dimension` | string | -- | (auto-set by unit annotations) |
| `format` | string | -- | `@email`, `@uuid`, `@jwt`, `@phone`, `@url`, `@iso8601` |
| `sensitivity` | string | -- | `@pii`, `@public`, `@internal` |
| `range` | [number, number] | -- | `@range(0, 100)` |
| `constraint` | string | -- | `@constraint("> 0.7")` |
| `state_type` | string | -- | `@state_type("OrderLifecycle")` |

**Surface syntax example:** `email: String @email @auth @pii` expands to `{ "type": "String", "format": "email", "domain": "authentication", "sensitivity": "pii" }`

See the [Annotation Reference](type-system.md#annotation-reference) in the Type System guide for the complete list.

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

| Field | Type | Required | Surface Syntax |
|---|---|---|---|
| `from` | string | yes | `edge source.port -> dest.port` |
| `to` | string | yes | (part of the same `edge` statement) |

**Surface syntax:**

```aether
edge validate_email.normalized -> check_uniqueness.email
edge check_uniqueness.unique -> create_user.unique
```

### Edge Validation Rules

1. `from` must reference an existing node's `out` port
2. `to` must reference an existing node's `in` port
3. The graph must remain acyclic (no circular data dependencies)
4. Types at both ends must pass the type checker

## AetherHole (Partial Graphs)

Used when `graph.partial = true`. A placeholder for a node not yet built.

| Field | Type | Required | Surface Syntax |
|---|---|---|---|
| `id` | string | yes | `hole my_hole` |
| `hole` | `true` | yes | (implicit from `hole` keyword) |
| `must_satisfy` | object | yes | `in:`, `out:`, `contracts:` inside the hole block |

**Surface syntax:**

```aether
hole pending_validator
  in:  data: String
  out: valid: Bool
  contracts:
    post: valid == true || valid == false
end
```

`must_satisfy` has the same shape as an AetherNode (`in`, `out`, `effects`, `contract`) but represents requirements, not implementation.

When filling a hole via the incremental builder:
- The replacement node's `in` must be a superset of `must_satisfy.in`
- The replacement node's `out` must be a superset of `must_satisfy.out`
- The replacement's contracts must imply the hole's contracts

## IntentNode (Layer 3)

| Field | Type | Required | Surface Syntax |
|---|---|---|---|
| `id` | string | yes | `intent sort_results` |
| `intent` | `true` | yes | (implicit from `intent` keyword) |
| `ensure` | string[] | yes | `ensure: expression` (one per line) |
| `in` | Record<string, TypeAnnotation> | yes | `in:  name: Type` |
| `out` | Record<string, TypeAnnotation> | yes | `out: name: Type` |
| `effects` | string[] | -- | `effects: [db.read]` |
| `constraints` | object | -- | `constraints:` block |
| `confidence` | number | -- | `confidence: 0.95` |

**Surface syntax:**

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

The intent resolver matches these against the certified algorithm library and replaces them with concrete implementations.

## StateType

| Field | Type | Required | Surface Syntax |
|---|---|---|---|
| `id` | string | yes | `statetype OrderLifecycle` |
| `states` | string[] | yes | `states: [s1, s2, s3]` |
| `transitions` | Transition[] | yes | `from -> to when condition` |
| `invariants.never` | [{from, to}] | -- | `never:` block |
| `invariants.terminal` | string[] | -- | `terminal: [s1, s2]` |
| `invariants.initial` | string | -- | `initial: s1` |

**Surface syntax:**

```aether
statetype OrderLifecycle
  states: [created, paid, shipped, delivered, cancelled]
  transitions:
    created -> paid when payment_confirmed
    paid -> shipped when carrier_accepted
  never:
    cancelled -> paid
  terminal: [delivered, cancelled]
  initial: created
end
```

**Transition (JSON):** `{ from: string, to: string, when: string }`

**Validation rules:**
- All states must be unique
- All transition from/to must reference declared states
- No transition may match a never-invariant pair
- Terminal states must not appear as `from` in any transition
- Z3 verifies never-invariants and terminal invariants

## Scope

| Field | Type | Required | Surface Syntax |
|---|---|---|---|
| `id` | string | yes | `scope order_scope` |
| `nodes` | string[] | yes | `nodes: [node1, node2]` |
| `boundary_contracts.requires` | BoundaryContract[] | -- | `requires:` block |
| `boundary_contracts.provides` | BoundaryContract[] | -- | `provides:` block |

**Surface syntax:**

```aether
scope order_scope
  nodes: [create_order, process_payment, ship_order]
  provides:
    order_data
      out: order_id: String @uuid @commerce
  end
  requires:
    payment_service
      in: amount: Float64 @USD
  end
end
```

**BoundaryContract (JSON):** `{ name: string, in: Record<string, TypeAnnotation>, out: Record<string, TypeAnnotation>, contract?: Contract, effects?: string[], confidence?: number }`

**Validation rules:**
- Every node must belong to exactly one scope (if scopes are defined)
- Every cross-scope edge must be covered by a boundary contract
- Provider's provides contract must be type-compatible with requirer's requires contract

## AetherTemplate

| Field | Type | Required | Surface Syntax |
|---|---|---|---|
| `id` | string | yes | `template crud-entity` |
| `parameters` | Parameter[] | yes | `params:` block with `$Name: kind` |
| `nodes` | AetherNode[] | yes | `node ... end` blocks inside template |
| `edges` | AetherEdge[] | yes | `edge ... -> ...` inside template |

**Surface syntax:**

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

  edge validate_input.validated -> create_entity.data
end
```

**Parameter (JSON):** `{ name: string, kind: "type" | "value" | "effect" | "node_id", constraint?: string }`

**AetherTemplateInstance:** Instantiated with `use template as instance_id ... end`:

```aether
use crud-entity as user_crud
  Entity = Record @auth
  IdType = String @uuid
  storage_effect = database.write
end
```

Parameters are referenced with `$` prefix in template nodes: `$Entity`, `$max_retries`, `$storage_effect`.

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

## Implementations

Nodes get their implementations through a 3-level resolution system:

### 1. Registry-Based Resolution
The `ImplementationRegistry` resolves node IDs to implementation functions:

- **Exact ID match** — `registry.registerById("fetch_csv_data", impl)` matches nodes with `id: "fetch_csv_data"`
- **Pattern match** — `registry.registerByPattern(/pattern/, impl)` matches node IDs against a regex (used for template-prefixed IDs like `user_crud_validate_input`)
- **Type signature match** — `registry.registerBySignature(inputTypes, outputTypes, impl)` matches by I/O type compatibility
- **User overrides** — `registry.override(nodeId, impl)` takes highest priority

### 2. Service Container
Effectful implementations access services via dependency injection:

- `context.getService<AetherDatabase>("database")` — In-memory database with seed support
- `context.getService<AetherFileSystem>("filesystem")` — Sandboxed filesystem for file I/O
- `context.getService<AetherEmailService>("email")` — Email capture service
- `context.getService<AetherMLService>("ml")` — Rule-based ML classification

### 3. Stub Mode Fallback
When no implementation is found, the executor generates typed defaults for all output ports. Contracts are skipped in stub mode since defaults won't satisfy real contracts.
