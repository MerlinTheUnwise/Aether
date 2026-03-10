# Contracts & Verification

> How to write provable contracts, understand Z3 verification, and use confidence and adversarial checks.

## Contract Structure

Every AetherNode has a `contract` block:

```json
{
  "contract": {
    "pre": ["email.length > 0"],
    "post": ["normalized.is_lowercase", "normalized.is_trimmed"],
    "invariants": ["never(action modifies billing)"]
  }
}
```

- **`pre`** — Preconditions. Must be true BEFORE the node executes. Checked at runtime. If violated, the node doesn't execute.
- **`post`** — Postconditions. Must be true AFTER the node executes. Verified by Z3 at compile time. Checked at runtime. At least one required per node.
- **`invariants`** — Must hold throughout execution. Used for safety constraints.

## Z3 Verification

The verifier uses the z3-solver npm package (Z3 WASM) via its TypeScript API — no SMT-LIB2 strings.

### Postcondition Verification

For each postcondition expression:
1. Parse the expression into Z3 Expr objects
2. Assert `NOT(postcondition)`
3. Run Z3 solver
4. If **UNSAT** → the postcondition ALWAYS holds → **VERIFIED**
5. If **SAT** → Z3 found inputs where the postcondition fails → **FAILED** (counterexample provided)

### Adversarial Check Verification

For each `break_if` expression:
1. Parse into Z3 Expr
2. Assert the `break_if` expression (the "bad" condition)
3. Run Z3 solver
4. If **UNSAT** → the bad condition can NEVER be true → **PASSED** (good)
5. If **SAT** → the bad condition COULD be true → **FAILED** (the implementation might be wrong)

### What Z3 Can Verify

| Expression Type | Supported | Example |
|---|---|---|
| Integer arithmetic | ✓ | `x + y > 0`, `amount * rate = total` |
| Comparisons | ✓ | `x > 0`, `a ≤ b`, `count ≥ 1` |
| Boolean logic | ✓ | `a ∧ b`, `a ∨ b`, `¬a` |
| Chained comparisons | ✓ | `0 ≤ x ≤ 100` |
| Implication | ✓ | `paid → shipped_within_24h` |
| String equality | ✓ | `status = "active"` |
| Membership (basic) | ✓ | `status ∈ ["active", "pending"]` |
| Property access | ✓ | `user.email.is_lowercase` |
| List length | ✓ | `list.length > 0` |
| Quantifiers | Partial | `∀x ∈ list: P(x)` (basic cases) |
| Set intersection | Partial | `recommended ∩ purchases = ∅` |
| Lambda expressions | ✗ | Returned as "unsupported" |
| ML model outputs | ✗ | Use supervised blocks |
| Complex functions | ✗ | Returned as "unsupported" |

**Unsupported expressions return `"unsupported"` — they never throw.** The verifier always completes and reports what it could and couldn't verify.

## Adversarial Self-Checks

**Required when `confidence < 0.85`.**

Adversarial checks force the AI to think about how its code could be wrong. Each `break_if` describes a condition that would be true if the implementation has a bug.

### Writing Good Adversarial Checks

**Think: "What would be true if I made a mistake?"**

```json
{
  "adversarial_check": {
    "break_if": [
      "tax < 0",
      "tax > income",
      "rate_applied ∉ valid_brackets"
    ]
  }
}
```

Each `break_if` should target a specific failure mode:
- **Range violations:** `result < 0` when it should be non-negative
- **Logical contradictions:** `recommended ∩ purchases ≠ ∅` when they should be disjoint
- **Invariant violations:** `action modifies billing` when billing modification is forbidden
- **Type confusions:** `output.user_id = input.product_id` when IDs shouldn't be swapped

**Don't write trivial adversarial checks** like `break_if: ["false"]` — this always passes and catches nothing. The check should be specific to what could actually go wrong.

## Confidence System

### Propagation

```
propagated_confidence(node) = node.confidence × min(input_confidences)
```

- Node with no inputs: `propagated = declared` (or 1.0 if undefined)
- Node with multiple inputs: uses the MINIMUM of all input confidences
- Multiplicative: confidence can only decrease or stay the same, never increase

### Threshold (0.85)

When `confidence < 0.85`, the adversarial check requirement activates. This threshold was chosen because it's the empirical boundary where AI overconfidence becomes dangerous — below 0.85, the AI is not sure enough to skip self-examination.

### Oversight Gate (default 0.7)

When propagated confidence drops below the oversight threshold (configurable per graph), the runtime either:
- Skips the node (if no oversight handler)
- Pauses and routes to a human (if oversight handler configured)
- Triggers a fallback path

### Graph Confidence

The overall graph confidence is the product of confidences along the **critical path** — the longest path through the DAG by node count.

### Confidence in Practice

A typical flow:
```
validate_email (0.99) → check_uniqueness (0.95) → create_user (0.95)

Propagated:
  validate_email: 0.99
  check_uniqueness: 0.95 × 0.99 = 0.9405
  create_user: 0.95 × 0.9405 = 0.8935

Graph confidence: 0.8935
```

Content moderation with cascading:
```
classify_content (0.80) → assess_severity (0.75) → decide_action (0.70)

Propagated:
  classify_content: 0.80
  assess_severity: 0.75 × 0.80 = 0.60  ← below 0.7 threshold!
  decide_action: SKIPPED (oversight required)
```

## Supervised Blocks

When verification is undecidable, too expensive, or the domain is genuinely uncertain:

```json
{
  "supervised": {
    "reason": "ML model output is non-deterministic",
    "review_status": "pending"
  }
}
```

**Properties:**
- Contracts are asserted but NOT proven
- Tracked as "unverified" in the verification report
- Contributes 0% to verification score
- Confidence still propagates (degraded)
- Must have a `reason` explaining why verification isn't possible
- `review_status` can be `"pending"`, `"approved"`, or `"rejected"`

**When to use:** ML model outputs, heuristic logic, domain-specific rules that can't be formalized, integration with external systems whose behavior isn't provable.

**When NOT to use:** Don't use supervised blocks to avoid writing contracts. If a contract can be written and verified, it should be. Supervised is the honest escape hatch, not a shortcut.

## Verification Reality

Z3 translates 93% of contract expressions to its internal AST — but translating to Z3 is not the same as proving.

### What Z3 CAN Prove
- **Contradictions** — a postcondition that contradicts itself is caught
- **Simple arithmetic** — `x + y > 0` where x, y are unconstrained integers
- **Boolean logic** — `a ∧ ¬a` is UNSAT (contradiction detected)
- **Chained comparisons** — `0 ≤ x ≤ 100` range constraints

### What Z3 CANNOT Prove
- **Anything about opaque implementations** — Z3 sees contracts but not node code. It cannot verify that `normalize(email)` produces lowercase output. Most postconditions reference implementation behavior, which is why the formal proof rate is ~1% (1/113 postconditions across reference programs).
- **Complex predicates** — quantified statements, set operations, and lambda expressions
- **Semantic properties** — "output is sorted" requires knowing the implementation

### What the Runtime Evaluator Covers
The expression evaluator (`src/runtime/evaluator/`) checks 100% of contract expressions at runtime. Every postcondition that Z3 can't prove is enforced at execution time against actual outputs. This is the real safety net — not Z3.

### Honest Proof Rate on Reference Programs
- Total postconditions: 113
- Z3 proved (UNSAT): 1 (0.9%)
- Z3 found counterexample (SAT): 104
- Z3 couldn't translate: 8
- Runtime evaluator covers: 100%

The high SAT (counterexample) count is expected: Z3 treats node implementations as opaque, so from Z3's perspective any output is possible, making most postconditions falsifiable.

## Verification Percentage

```
verified% = verified_nodes / (verified_nodes + failed_nodes) × 100
```

Unsupported and supervised nodes are excluded from the denominator. This means a graph with 10 verified nodes and 2 supervised nodes reports 100% verification — the supervised nodes are tracked separately.

The verification dashboard shows the full breakdown: verified, failed, unsupported, and supervised counts.

## Effect Requirements

Any node with non-empty `effects` (and `pure` is not `true`) must have a `recovery` block. The validator rejects nodes that can fail (effectful operations) without specifying how to handle failure.

**Pure nodes** (`effects: []` or `pure: true`) need no recovery — they can't fail from side effects.

**Effect-recovery pairs** (common patterns):

| Effect | Common Recoveries |
|---|---|
| `database.read` | retry, fallback (cached value) |
| `database.write` | retry, escalate |
| `network` | retry with backoff, fallback, timeout response |
| `ml_model.infer` | fallback (default output), report |
| `email` | retry, report |
| `payment_gateway.write` | retry, escalate, respond(402) |
| `filesystem` | retry, fallback |
