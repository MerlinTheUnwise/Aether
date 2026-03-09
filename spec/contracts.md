# AETHER Contract Specification

## 1. Contract Block Structure

Every node carries a `contract` block with three optional sections:

```json
{
  "contract": {
    "pre": ["email.length > 0"],
    "post": ["user.email == email", "user.status == active"],
    "invariants": ["never(action deletes user_data)"]
  }
}
```

- **pre**: Preconditions that must hold before node execution. Verified against input port types.
- **post**: Postconditions that must hold after node execution. Verified against output port types.
- **invariants**: Properties that must hold throughout execution. Typically safety constraints.

## 2. Expression Syntax

Contract expressions use a simplified predicate language:

### Operators

| Symbol  | Alias    | Meaning              |
|---------|----------|----------------------|
| `&&`    | `∧`      | Logical AND          |
| `\|\|`  | `∨`      | Logical OR           |
| `!`     | `¬`      | Logical NOT          |
| `==`    | `=`      | Equality             |
| `!=`    | `≠`      | Inequality           |
| `<`     |          | Less than            |
| `>`     |          | Greater than         |
| `<=`    | `≤`      | Less or equal        |
| `>=`    | `≥`      | Greater or equal     |
| `∈`     |          | Set membership       |

### Quantifiers

- `forall(x, collection, predicate)` — universal quantification
- `exists(x, collection, predicate)` — existential quantification

### Property Access

- `x.y` — direct property access on a typed value
- `x.y.z` — chained property access

### Set Operations

- `intersection(A, B)` — set intersection
- `A is_subset_of B` — subset check
- `x not_in A` — negated membership

## 3. Adversarial Check Rules

When a node's `confidence < 0.85`, it **must** declare an `adversarial_check` block:

```json
{
  "confidence": 0.75,
  "adversarial_check": {
    "break_if": [
      "action.risk_level > agent_authority_level",
      "action modifies billing"
    ]
  }
}
```

### Semantics

Each `break_if` expression describes a **bad state** that should never occur. The verifier asserts the expression and checks:
- **UNSAT** → the bad state is impossible → **passed**
- **SAT** → the bad state can occur → **failed** (with counterexample)

### Confidence Threshold: 0.85

The threshold 0.85 is chosen because empirically, AI systems operating above ~85% confidence exhibit acceptable error rates. Below this threshold, overconfidence becomes dangerous and explicit adversarial testing is required.

## 4. Verification Semantics

### Postcondition Verification

For each postcondition `P`:
1. Declare Z3 variables from port type annotations
2. Assert all preconditions as assumptions
3. Assert `¬P` (negation of postcondition)
4. If **UNSAT**: `P` always holds → **verified**
5. If **SAT**: `P` can be violated → **failed** with counterexample

### Adversarial Check Verification

For each `break_if` expression `B`:
1. Declare Z3 variables from port type annotations
2. Assert all preconditions as assumptions
3. Assert `B` directly
4. If **UNSAT**: bad state impossible → **passed**
5. If **SAT**: bad state reachable → **failed** with counterexample

### Unsupported Expressions

Expressions containing quantifiers, set operations, lambda expressions, or custom predicates that cannot be translated to Z3 are marked `"unsupported"`. They do not count as failures but are excluded from the verification percentage.

## 5. Supervised Blocks

A node marked `supervised` has contracts that are **asserted but not proven**:

```json
{
  "supervised": {
    "reason": "LLM-generated logic — human review required",
    "review_status": "pending"
  }
}
```

Supervised nodes contribute `0.0` to the verification score but their confidence still propagates (degraded) through the graph. The validator emits a warning, not an error.
