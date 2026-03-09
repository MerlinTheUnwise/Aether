# AETHER Type System

> Complete reference for semantic types, temporal state types, dependent types, and pattern templates.

## Semantic Types

Every TypeAnnotation in AETHER can carry semantic metadata beyond the base type. This metadata is enforced at compile time by the type checker.

### Base Types

| Type | Description | LLVM IR |
|---|---|---|
| `String` | UTF-8 text | `%String*` |
| `Bool` | true/false | `i1` |
| `Int` | 64-bit signed integer | `i64` |
| `Float64` | 64-bit IEEE float | `double` |
| `Decimal` | Precise decimal | `double` (approximate in native) |
| `List<T>` | Ordered collection | `%List*` |
| `Record` | Structured data | Generated struct |
| `Map<K,V>` | Key-value mapping | Runtime hash map |

### Semantic Annotations

#### `domain`
Encodes what conceptual domain a value belongs to. Values from different domains are incompatible even if their base types match.

```json
{ "type": "String", "domain": "authentication" }
{ "type": "String", "domain": "commerce" }
```

A `UserID` (domain: authentication) CANNOT flow to a `ProductID` (domain: commerce) port — the type checker rejects it as `DOMAIN_MISMATCH`.

Common domains: `authentication`, `commerce`, `payment`, `ml`, `support`, `moderation`, `logistics`, `notification`.

#### `dimension` and `unit`
Encode physical or conceptual dimensions with units. Values with different dimensions cannot be combined. Values with the same dimension but different units trigger a warning with auto-convert suggestion.

```json
{ "type": "Float64", "dimension": "thermodynamic_temperature", "unit": "celsius" }
{ "type": "Float64", "dimension": "currency", "unit": "USD" }
{ "type": "Float64", "dimension": "time", "unit": "ms" }
```

`Temperature + Money` → ERROR: dimension mismatch.
`celsius + kelvin` → WARNING: unit mismatch (auto-convert available).

#### `format`
Constrains the string format.

```json
{ "type": "String", "format": "email" }
{ "type": "String", "format": "uuid_v4" }
{ "type": "String", "format": "jwt" }
```

#### `sensitivity`
Tracks data sensitivity for privacy compliance. PII data cannot flow to public-scoped ports.

```json
{ "type": "String", "sensitivity": "pii" }
{ "type": "String", "sensitivity": "public" }
{ "type": "String", "sensitivity": "internal" }
```

`pii → public` → ERROR: sensitivity violation.
`pii → internal` → OK.
`internal → public` → OK.
`public → pii` → OK (upgrading sensitivity is safe).

#### `range`
Constrains numeric values.

```json
{ "type": "Int", "range": [0, 100] }
{ "type": "Float64", "range": [0.0, 1.0] }
```

#### `constraint`
Arbitrary value constraint. Primarily used for **confidence gates** — preventing low-confidence values from entering high-stakes nodes.

```json
{ "type": "String", "constraint": "> 0.7" }
{ "type": "Bool", "constraint": "= true" }
```

A port with `constraint: "> 0.9"` structurally prevents any value with propagated confidence ≤ 0.9 from flowing in.

#### `state_type`
Links a port to a declared StateType. See Temporal State Types below.

```json
{ "type": "Record", "state_type": "OrderLifecycle" }
```

## Temporal State Types

State machines as first-class types with Z3-verified transitions.

### Declaration

```json
{
  "state_types": [{
    "id": "OrderLifecycle",
    "states": ["created", "paid", "shipped", "delivered", "cancelled", "refunded"],
    "transitions": [
      { "from": "created", "to": "paid", "when": "payment_confirmed" },
      { "from": "created", "to": "cancelled", "when": "user_request" },
      { "from": "paid", "to": "shipped", "when": "carrier_accepted" },
      { "from": "paid", "to": "refunded", "when": "user_request" },
      { "from": "shipped", "to": "delivered", "when": "carrier_confirmed" },
      { "from": "delivered", "to": "refunded", "when": "user_request" }
    ],
    "invariants": {
      "never": [
        { "from": "cancelled", "to": "paid" },
        { "from": "delivered", "to": "shipped" }
      ],
      "terminal": ["delivered", "cancelled", "refunded"],
      "initial": "created"
    }
  }]
}
```

### Verification

Z3 proves:
- Never-invariants: `cancelled → paid` is impossible (UNSAT)
- Terminal invariants: no transition exists FROM a terminal state (UNSAT)
- Reachability: every non-initial state is reachable (warning if not)

### Runtime Tracking

During execution, the StateTracker records every state transition and checks validity against the declared transitions. Invalid transitions are logged as violations.

### In Lean 4 Export

State types become inductive types with transition relations and impossibility theorems.

## Dependent Types

AETHER supports lightweight dependent types via `constraint` annotations on input ports.

```json
{
  "id": "create_user",
  "in": {
    "email": { "type": "String" },
    "unique": { "type": "Bool", "constraint": "= true" }
  }
}
```

The `constraint: "= true"` means this port can only receive a value that has been verified as `true` by a preceding node. If `check_uniqueness.unique` is wired to `create_user.unique`, the type system ensures the uniqueness check has been performed before user creation can proceed.

This is not full dependent typing (no Π-types or Σ-types). It's a practical, verifiable constraint system that prevents "use before check" bugs.

### Confidence Gates as Dependent Types

```json
{
  "in": {
    "action": { "type": "String", "constraint": "> 0.9" }
  }
}
```

This input port requires propagated confidence above 0.9. At runtime, if the upstream node's confidence × its own confidence doesn't exceed 0.9, the executor either skips the node or routes to human oversight. The gate is structural — not a runtime check that might be forgotten.

## Pattern Templates

Parameterized subgraphs with contract-verified instantiation.

### Template Parameters

| Kind | What it substitutes | Example |
|---|---|---|
| `type` | A TypeAnnotation | `$Entity` → `{ "type": "Record", "domain": "commerce" }` |
| `value` | A literal value | `$max_retries` → `3` |
| `effect` | An effect tag | `$storage_effect` → `"database.write"` |
| `node_id` | A node reference | `$fallback_node` → `"cache_lookup"` |

Parameters are referenced with `$` prefix in template nodes.

### Instantiation

```json
{
  "template_instances": [{
    "id": "user_crud",
    "template": "crud-entity",
    "bindings": {
      "Entity": { "type": "Record", "domain": "authentication" },
      "IdType": { "type": "String", "format": "uuid_v4" },
      "storage_effect": "database.write"
    }
  }]
}
```

### Instantiation Verification

1. Every parameter must have a binding (missing → error naming the parameter)
2. Each binding must match its parameter kind
3. Constraint satisfaction checked (e.g., `"has Ord"` for sortable types)
4. Substitution: parameters replaced in all nodes, edges, contracts
5. ID prefixing: all instantiated node IDs prefixed with instance ID (no collisions)
6. Result validated through the full pipeline

### Standard Library Templates

| Template | Parameters | Nodes | Purpose |
|---|---|---|---|
| `crud-entity` | Entity, IdType, storage_effect | 6 | Full CRUD operations |
| `retry-with-fallback` | T_in, T_out, max_retries, primary_effect, fallback_node | 2 | Resilient execution |
| `auth-gate` | TokenType, UserType, auth_effect | 3 | Authentication flow |
| `confidence-cascade` | InputType, OutputType, threshold | 3 | Multi-stage confidence |
