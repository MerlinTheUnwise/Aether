# AETHER Type System Specification

## 1. Base Types

| Type        | Description                      | JS Runtime   |
|-------------|----------------------------------|--------------|
| `String`    | UTF-8 text                       | `string`     |
| `Bool`      | Boolean value                    | `boolean`    |
| `Int`       | 64-bit signed integer            | `number`     |
| `Float64`   | IEEE 754 double-precision float  | `number`     |
| `Decimal`   | Arbitrary-precision decimal      | `string`*    |
| `List<T>`   | Ordered collection of `T`        | `Array`      |
| `Record`    | Named product type (struct)      | `Object`     |
| `Map<K,V>`  | Key-value mapping                | `Map`/Object |

*Decimal is serialized as string to preserve precision.

Numeric coercion: `Int` ↔ `Float64` ↔ `Float32` ↔ `Number` are considered compatible. All other base type mismatches are hard errors.

## 2. Semantic Annotations

Every port `TypeAnnotation` may carry zero or more semantic annotations:

| Annotation    | Type              | Purpose                                          |
|---------------|-------------------|--------------------------------------------------|
| `dimension`   | `string`          | Physical/logical dimension (e.g., `"length"`, `"currency"`) |
| `unit`        | `string`          | Unit within dimension (e.g., `"meters"`, `"USD"`)           |
| `domain`      | `string`          | Business domain isolation (e.g., `"authentication"`)        |
| `format`      | `string`          | Serialization format (e.g., `"email"`, `"jwt"`)             |
| `sensitivity` | `string`          | Data classification (`"public"`, `"internal"`, `"pii"`)     |
| `range`       | `[number, number]`| Valid numeric range `[min, max]`                             |
| `constraint`  | `string`          | Dependent type gate (e.g., `"== true"`, `"> 0.7"`)          |

## 3. Compatibility Rules

When data flows across an edge `from.port → to.port`, the checker enforces:

### 3.1 Base Type Match
Source and destination base types must be identical or both numeric. Violation: `BASE_TYPE_MISMATCH` (error).

### 3.2 Dimension Match
If both ports declare `dimension`, they must be identical. Violation: `DIMENSION_MISMATCH` (error).

### 3.3 Unit Conversion
If both ports declare `unit` and dimensions are compatible, mismatched units produce a warning (`UNIT_MISMATCH`) with an auto-convert suggestion. The runtime may insert a conversion shim.

### 3.4 Domain Isolation
If both ports declare `domain`, they must be identical. Data from `"authentication"` cannot flow to `"commerce"`. Violation: `DOMAIN_MISMATCH` (error).

### 3.5 Sensitivity Flow
Sensitivity labels form a lattice: `pii > internal > public`. Data may flow to equal or higher sensitivity. Flowing `pii → public` is a hard error: `SENSITIVITY_VIOLATION`.

### 3.6 Constraint (Dependent Types)
A destination port with `constraint` (e.g., `"> 0.7"`) creates a **type-level gate**: the value flowing in must satisfy the constraint at runtime. The type checker emits a `CONSTRAINT_WARNING` when it can statically determine the constraint may not hold.

## 4. Dependent Types via Constraints

Constraints on input ports act as dependent type guards:

```json
{
  "confidence_score": {
    "type": "Float64",
    "range": [0.0, 1.0],
    "constraint": "> 0.7"
  }
}
```

This means: the node will only execute if `confidence_score > 0.7`. The transpiler emits a runtime precondition check. The Z3 verifier attempts to prove the constraint is always satisfied given upstream postconditions.

## 5. Temporal State Types (Phase 1+)

Temporal state types model entities that transition through well-defined states:

```
statetype OrderState {
  states: [pending, confirmed, shipped, delivered, cancelled]
  transitions: {
    pending → confirmed | cancelled,
    confirmed → shipped | cancelled,
    shipped → delivered
  }
  invariants: [
    "once(cancelled) → never(shipped)",
    "once(delivered) → never(cancelled)"
  ]
}
```

The type checker verifies that edges carrying state-typed values respect the declared transition graph.

## 6. Pattern Template Types (Phase 2+)

Parameterized subgraphs allow reusable graph patterns:

```
template RetryWithFallback<T, F> {
  params: { maxRetries: Int, fallback: F }
  nodes: [attempt: T → Result, retry_logic, fallback_node: F]
  edges: [attempt.error → retry_logic.input, retry_logic.exhausted → fallback_node.input]
}
```

Template instantiation inlines the subgraph with concrete type parameters.
