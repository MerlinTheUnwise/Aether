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

In `.aether` surface syntax, annotations are written with `@` shorthand directly after the base type. In JSON IR, they are fields on the TypeAnnotation object.

#### `domain`
Encodes what conceptual domain a value belongs to. Values from different domains are incompatible even if their base types match.

```aether
in:  user_id: String @auth
in:  product_id: String @commerce
```

<details><summary>IR equivalent (JSON)</summary>

```json
{ "type": "String", "domain": "authentication" }
{ "type": "String", "domain": "commerce" }
```

</details>

A `UserID` (domain: authentication) CANNOT flow to a `ProductID` (domain: commerce) port -- the type checker rejects it as `DOMAIN_MISMATCH`.

Common domains: `authentication`, `commerce`, `payment`, `ml`, `support`, `moderation`, `logistics`, `notification`.

#### `dimension` and `unit`
Encode physical or conceptual dimensions with units. Values with different dimensions cannot be combined. Values with the same dimension but different units trigger a warning with auto-convert suggestion.

```aether
in:  temperature: Float64 @celsius
in:  price: Float64 @USD
in:  latency: Float64 @ms
```

<details><summary>IR equivalent (JSON)</summary>

```json
{ "type": "Float64", "dimension": "thermodynamic_temperature", "unit": "celsius" }
{ "type": "Float64", "dimension": "currency", "unit": "USD" }
{ "type": "Float64", "dimension": "time", "unit": "ms" }
```

</details>

`Temperature + Money` -> ERROR: dimension mismatch.
`celsius + kelvin` -> WARNING: unit mismatch (auto-convert available).

#### `format`
Constrains the string format.

```aether
in:  email: String @email
in:  id: String @uuid
in:  token: String @jwt
```

<details><summary>IR equivalent (JSON)</summary>

```json
{ "type": "String", "format": "email" }
{ "type": "String", "format": "uuid_v4" }
{ "type": "String", "format": "jwt" }
```

</details>

#### `sensitivity`
Tracks data sensitivity for privacy compliance. PII data cannot flow to public-scoped ports.

```aether
in:  ssn: String @pii
in:  label: String @public
in:  token: String @internal
```

<details><summary>IR equivalent (JSON)</summary>

```json
{ "type": "String", "sensitivity": "pii" }
{ "type": "String", "sensitivity": "public" }
{ "type": "String", "sensitivity": "internal" }
```

</details>

`pii -> public` -> ERROR: sensitivity violation.
`pii -> internal` -> OK.
`internal -> public` -> OK.
`public -> pii` -> OK (upgrading sensitivity is safe).

#### `range`
Constrains numeric values.

```aether
in:  percentage: Int @range(0, 100)
in:  probability: Float64 @range(0.0, 1.0)
```

<details><summary>IR equivalent (JSON)</summary>

```json
{ "type": "Int", "range": [0, 100] }
{ "type": "Float64", "range": [0.0, 1.0] }
```

</details>

#### `constraint`
Arbitrary value constraint. Primarily used for **confidence gates** -- preventing low-confidence values from entering high-stakes nodes.

```aether
in:  action: String @constraint("> 0.7")
in:  verified: Bool @constraint("= true")
```

<details><summary>IR equivalent (JSON)</summary>

```json
{ "type": "String", "constraint": "> 0.7" }
{ "type": "Bool", "constraint": "= true" }
```

</details>

A port with `@constraint("> 0.9")` structurally prevents any value with propagated confidence <= 0.9 from flowing in.

#### `state_type`
Links a port to a declared StateType. See Temporal State Types below.

```aether
in:  order: Record @state_type("OrderLifecycle")
```

<details><summary>IR equivalent (JSON)</summary>

```json
{ "type": "Record", "state_type": "OrderLifecycle" }
```

</details>

## Annotation Reference

The `.aether` surface syntax provides `@annotation` shorthand that expands to IR TypeAnnotation fields. Here is the complete list of supported annotations:

### Format Annotations

| Annotation | IR Expansion | Example |
|---|---|---|
| `@email` | `"format": "email"` | `in: addr: String @email` |
| `@uuid` | `"format": "uuid_v4"` | `in: id: String @uuid` |
| `@jwt` | `"format": "jwt"` | `in: token: String @jwt` |
| `@phone` | `"format": "phone"` | `in: number: String @phone` |
| `@url` | `"format": "url"` | `in: link: String @url` |
| `@iso8601` | `"format": "iso8601"` | `in: ts: String @iso8601` |

### Domain Annotations

| Annotation | IR Expansion | Example |
|---|---|---|
| `@auth` | `"domain": "authentication"` | `in: user: Record @auth` |
| `@commerce` | `"domain": "commerce"` | `in: product: Record @commerce` |
| `@payment` | `"domain": "payment"` | `in: amount: Float64 @payment` |
| `@ml` | `"domain": "ml"` | `in: features: List<Float64> @ml` |
| `@support` | `"domain": "support"` | `in: ticket: Record @support` |
| `@mod` | `"domain": "moderation"` | `in: content: String @mod` |

### Sensitivity Annotations

| Annotation | IR Expansion | Example |
|---|---|---|
| `@pii` | `"sensitivity": "pii"` | `in: ssn: String @pii` |
| `@public` | `"sensitivity": "public"` | `out: label: String @public` |
| `@internal` | `"sensitivity": "internal"` | `in: token: String @internal` |

### Unit Annotations (with auto-dimension)

| Annotation | IR Expansion | Example |
|---|---|---|
| `@USD` | `"unit": "USD", "dimension": "currency"` | `in: price: Float64 @USD` |
| `@EUR` | `"unit": "EUR", "dimension": "currency"` | `in: price: Float64 @EUR` |
| `@GBP` | `"unit": "GBP", "dimension": "currency"` | `in: price: Float64 @GBP` |
| `@kelvin` | `"unit": "kelvin", "dimension": "thermodynamic_temperature"` | `in: temp: Float64 @kelvin` |
| `@celsius` | `"unit": "celsius", "dimension": "thermodynamic_temperature"` | `in: temp: Float64 @celsius` |
| `@ms` | `"unit": "ms", "dimension": "time"` | `in: latency: Float64 @ms` |
| `@seconds` | `"unit": "seconds", "dimension": "time"` | `in: duration: Float64 @seconds` |
| `@bytes` | `"unit": "bytes", "dimension": "data_size"` | `in: size: Int @bytes` |
| `@percent` | `"unit": "percent", "dimension": "ratio"` | `in: rate: Float64 @percent` |

### Parameterized Annotations

| Annotation | IR Expansion | Example |
|---|---|---|
| `@constraint("expr")` | `"constraint": "expr"` | `in: action: String @constraint("> 0.9")` |
| `@range(min, max)` | `"range": [min, max]` | `in: score: Int @range(0, 100)` |
| `@state_type("name")` | `"state_type": "name"` | `in: order: Record @state_type("OrderLifecycle")` |

### Stacking Annotations

Multiple annotations can be combined on a single port. They are applied left-to-right:

```aether
in:  email: String @email @auth @pii
// Expands to: { "type": "String", "format": "email", "domain": "authentication", "sensitivity": "pii" }

in:  amount: Float64 @USD @range(0.01, 999999.99)
// Expands to: { "type": "Float64", "unit": "USD", "dimension": "currency", "range": [0.01, 999999.99] }
```

### Custom Domain/Dimension/Unit

For domains, dimensions, or units not covered by the built-in annotations, use the JSON IR directly and convert with `format`:

```json
{ "type": "Float64", "dimension": "mass", "unit": "kg" }
```

## Temporal State Types

State machines as first-class types with Z3-verified transitions.

### Declaration

```aether
statetype OrderLifecycle
  states: [created, paid, shipped, delivered, cancelled, refunded]
  transitions:
    created -> paid when payment_confirmed
    created -> cancelled when user_request
    paid -> shipped when carrier_accepted
    paid -> refunded when user_request
    shipped -> delivered when carrier_confirmed
    delivered -> refunded when user_request
  never:
    cancelled -> paid
    delivered -> shipped
  terminal: [delivered, cancelled, refunded]
  initial: created
end
```

<details><summary>IR equivalent (JSON)</summary>

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

</details>

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

AETHER supports lightweight dependent types via `@constraint` annotations on input ports.

```aether
node create_user
  in:  email: String, unique: Bool @constraint("= true")
  // ...
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "id": "create_user",
  "in": {
    "email": { "type": "String" },
    "unique": { "type": "Bool", "constraint": "= true" }
  }
}
```

</details>

The `@constraint("= true")` means this port can only receive a value that has been verified as `true` by a preceding node. If `check_uniqueness.unique` is wired to `create_user.unique`, the type system ensures the uniqueness check has been performed before user creation can proceed.

This is not full dependent typing (no Pi-types or Sigma-types). It's a practical, verifiable constraint system that prevents "use before check" bugs.

### Confidence Gates as Dependent Types

```aether
node execute_action
  in:  action: String @constraint("> 0.9")
  // ...
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "in": {
    "action": { "type": "String", "constraint": "> 0.9" }
  }
}
```

</details>

This input port requires propagated confidence above 0.9. At runtime, if the upstream node's confidence * its own confidence doesn't exceed 0.9, the executor either skips the node or routes to human oversight. The gate is structural -- not a runtime check that might be forgotten.

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

```aether
use crud-entity as user_crud
  Entity = Record @auth
  IdType = String @uuid
  storage_effect = database.write
end
```

<details><summary>IR equivalent (JSON)</summary>

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

</details>

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
