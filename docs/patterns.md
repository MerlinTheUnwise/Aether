# AETHER Patterns Cookbook

> Complete examples for 14 common scenarios.
> When writing AETHER, copy and adapt these patterns -- don't start from scratch.

## How to Use This Cookbook

Each pattern shows a **complete, valid fragment** in `.aether` surface syntax that passes the full pipeline (validate -> check -> verify). Copy the relevant pattern, modify the domain-specific details, and validate with `npx tsx src/cli.ts parse <your-file.aether>`.

## Pattern 1: Pure Validation Node

A stateless node that validates input and produces normalized output. No effects, no recovery needed.

```aether
node validate_email
  in:  email: String @email
  out: valid: Bool, normalized: String @email @auth
  contracts:
    pre:  email.length > 0
    post: normalized.is_lowercase
    post: normalized.is_trimmed
  pure
  confidence: 0.99
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "id": "validate_email",
  "in": {
    "email": { "type": "String", "format": "email" }
  },
  "out": {
    "valid": { "type": "Bool" },
    "normalized": { "type": "String", "domain": "authentication", "format": "email" }
  },
  "contract": {
    "pre": ["email.length > 0"],
    "post": ["normalized.is_lowercase", "normalized.is_trimmed"]
  },
  "effects": [],
  "pure": true,
  "confidence": 0.99
}
```

</details>

**When to use:** Input validation, data normalization, format checking, parsing.
**Key properties:** `pure`, no recovery needed, high confidence.

## Pattern 2: Database Read with Recovery

A node that reads from a database with timeout and error recovery.

```aether
node check_uniqueness
  in:  email: String @email @auth
  out: unique: Bool
  effects: [database.read]
  contracts:
    post: unique = true || unique = false
  recovery:
    db_timeout -> retry(3, exponential)
    db_error -> fallback(unique: false)
  confidence: 0.95
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "id": "check_uniqueness",
  "in": {
    "email": { "type": "String", "domain": "authentication", "format": "email" }
  },
  "out": {
    "unique": { "type": "Bool" }
  },
  "contract": {
    "post": ["unique = true ∨ unique = false"]
  },
  "effects": ["database.read"],
  "confidence": 0.95,
  "recovery": {
    "db_timeout": {
      "action": "retry",
      "params": { "count": 3, "backoff": "exponential" }
    },
    "db_error": {
      "action": "fallback",
      "params": { "value": { "unique": false } }
    }
  }
}
```

</details>

**When to use:** Any database lookup, cache check, external service query.
**Key properties:** `effects: [database.read]`, recovery for timeout + error, fallback returns safe default.

## Pattern 3: Database Write with Dependent Type Gate

A node that writes to a database, requiring a precondition from a previous node's output.

```aether
node create_user
  in:  email: String @email @auth, unique: Bool @constraint("= true")
  out: user: Record @auth
  effects: [database.write]
  contracts:
    pre:  unique = true
    post: user.email = email
    post: user.status = "active"
  recovery:
    write_fail -> retry(2, exponential)
    constraint_violation -> escalate("user creation constraint violation")
  confidence: 0.95
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "id": "create_user",
  "in": {
    "email": { "type": "String", "domain": "authentication", "format": "email" },
    "unique": { "type": "Bool", "constraint": "= true" }
  },
  "out": {
    "user": { "type": "Record", "domain": "authentication" }
  },
  "contract": {
    "pre": ["unique = true"],
    "post": ["user.email = email", "user.status = \"active\""]
  },
  "effects": ["database.write"],
  "confidence": 0.95,
  "recovery": {
    "write_fail": {
      "action": "retry",
      "params": { "count": 2, "backoff": "exponential" }
    },
    "constraint_violation": {
      "action": "escalate",
      "params": { "message": "user creation constraint violation" }
    }
  }
}
```

</details>

**When to use:** Any write operation that depends on a prior check.
**Key properties:** `@constraint("= true")` on input creates a dependent type gate -- this node can only receive verified-true inputs.

## Pattern 4: ML Inference with Adversarial Checks

A node that calls an ML model with confidence below 0.85, requiring adversarial self-checks.

```aether
node generate_recommendations
  in:  purchases: List<Record> @commerce, views: List<Record> @commerce
  out: recommended: List<Record> @commerce
  effects: [ml_model.infer]
  contracts:
    post: recommended.distinct
  adversarial:
    break_if: recommended.has_duplicates
  recovery:
    model_timeout -> fallback(value: [])
    model_error -> report(channel: ml-errors)
  confidence: 0.85
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "id": "generate_recommendations",
  "in": {
    "purchases": { "type": "List<Record>", "domain": "commerce" },
    "views": { "type": "List<Record>", "domain": "commerce" }
  },
  "out": {
    "recommended": { "type": "List<Record>", "domain": "commerce" }
  },
  "contract": {
    "post": [
      "∀p ∈ recommended: p ∉ purchases",
      "recommended.distinct"
    ]
  },
  "effects": ["ml_model.infer"],
  "confidence": 0.85,
  "adversarial_check": {
    "break_if": [
      "recommended ∩ purchases ≠ ∅",
      "recommended.has_duplicates"
    ]
  },
  "recovery": {
    "model_timeout": {
      "action": "fallback",
      "params": { "value": [] }
    },
    "model_error": {
      "action": "report",
      "params": { "channel": "ml-errors" }
    }
  }
}
```

</details>

**When to use:** Any ML model call, AI inference, probabilistic output.
**Key rule:** confidence < 0.85 -> `adversarial` with `break_if` is REQUIRED. Each `break_if` should describe a condition that would be true if the output is wrong.

## Pattern 5: Authentication Gate

A node that validates tokens and rejects unauthorized requests.

```aether
node authenticate
  in:  token: String @jwt @internal
  out: user: Record @auth @pii
  effects: [database.read]
  contracts:
    pre:  token.length > 0
    post: user.id.length > 0
    post: user.authenticated = true
  recovery:
    invalid_token -> respond(401, "unauthorized")
    expired -> respond(401, "token expired")
    forbidden -> respond(403, "forbidden")
  confidence: 0.98
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "id": "authenticate",
  "in": {
    "token": { "type": "String", "format": "jwt", "sensitivity": "internal" }
  },
  "out": {
    "user": { "type": "Record", "domain": "authentication", "sensitivity": "pii" }
  },
  "contract": {
    "pre": ["token.length > 0"],
    "post": ["user.id.length > 0", "user.authenticated = true"]
  },
  "effects": ["database.read"],
  "confidence": 0.98,
  "recovery": {
    "invalid_token": {
      "action": "respond",
      "params": { "status": 401, "body": "unauthorized" }
    },
    "expired": {
      "action": "respond",
      "params": { "status": 401, "body": "token expired" }
    },
    "forbidden": {
      "action": "respond",
      "params": { "status": 403, "body": "forbidden" }
    }
  }
}
```

</details>

**When to use:** Any request authentication, token validation, permission checking.
**Key properties:** `respond` recovery returns HTTP-like status codes. Note sensitivity annotations: token is `@internal`, user data is `@pii`.

## Pattern 6: Safety-Constrained AI Agent

A node with safety invariants that prevent it from exceeding its authority.

```aether
node decide_action
  in:  intent: String @support, urgency: String
  out: action: String @support
  effects: [llm.infer]
  contracts:
    post: action ∈ allowed_actions
    inv:  never(action modifies billing without human_approval)
    inv:  never(action deletes user_data)
  adversarial:
    break_if: action modifies billing
    break_if: action deletes user_data
    break_if: action ∉ allowed_actions
  recovery:
    unknown_intent -> escalate("unrecognized intent")
    low_confidence -> escalate("confidence too low for autonomous action")
  confidence: 0.75
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "id": "decide_action",
  "in": {
    "intent": { "type": "String", "domain": "support" },
    "urgency": { "type": "String" }
  },
  "out": {
    "action": { "type": "String", "domain": "support" }
  },
  "contract": {
    "post": ["action ∈ allowed_actions"],
    "invariants": [
      "never(action modifies billing without human_approval)",
      "never(action deletes user_data)"
    ]
  },
  "effects": ["llm.infer"],
  "confidence": 0.75,
  "adversarial_check": {
    "break_if": [
      "action modifies billing",
      "action deletes user_data",
      "action ∉ allowed_actions"
    ]
  },
  "recovery": {
    "unknown_intent": {
      "action": "escalate",
      "params": { "message": "unrecognized intent", "preserve_context": true }
    },
    "low_confidence": {
      "action": "escalate",
      "params": { "message": "confidence too low for autonomous action" }
    }
  }
}
```

</details>

**When to use:** Any autonomous AI agent action, decision-making node, automated workflow step.
**Key properties:** `inv` (invariants) declare what must NEVER happen. Adversarial checks mirror the invariants. Recovery escalates to humans when uncertain.

## Pattern 7: Confidence-Gated Execution

An input port with a confidence constraint, creating a type-level gate.

```aether
node execute_moderation
  in:  action: String @mod @constraint("> 0.9")
  out: result: Record @mod
  effects: [database.write]
  contracts:
    post: result.executed = true
  recovery:
    execution_failed -> escalate("moderation action failed")
  confidence: 0.95
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "id": "execute_moderation",
  "in": {
    "action": {
      "type": "String",
      "domain": "moderation",
      "constraint": "> 0.9"
    }
  },
  "out": {
    "result": { "type": "Record", "domain": "moderation" }
  },
  "contract": {
    "post": ["result.executed = true"]
  },
  "effects": ["database.write"],
  "confidence": 0.95,
  "recovery": {
    "execution_failed": {
      "action": "rollback",
      "params": { "message": "moderation action failed" }
    }
  }
}
```

</details>

**When to use:** Any high-stakes action that should only execute with high confidence. The `@constraint("> 0.9")` means this node structurally cannot receive inputs with propagated confidence <= 0.9.

## Pattern 8: Supervised Block

A node that can't be fully verified but is explicitly tracked.

```aether
node clean_nulls
  in:  data: List<Record>
  out: cleaned: List<Record>
  contracts:
    post: cleaned.length <= data.length
  pure
  supervised: "null handling strategy is domain-specific and non-deterministic" pending
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "id": "clean_nulls",
  "in": {
    "data": { "type": "List<Record>" }
  },
  "out": {
    "cleaned": { "type": "List<Record>" }
  },
  "contract": {
    "post": ["cleaned.length ≤ data.length"]
  },
  "effects": [],
  "pure": true,
  "supervised": {
    "reason": "null handling strategy is domain-specific and non-deterministic",
    "review_status": "pending"
  }
}
```

</details>

**When to use:** Nodes where verification is undecidable (ML outputs, heuristic logic, domain-specific rules). The supervised block is the honest escape hatch -- it degrades the verification score but never hides uncertainty.

## Pattern 9: State Transition Node

A node that transitions a state machine from one state to another.

```aether
node process_payment
  in:  order: Record @state_type("OrderLifecycle"), payment: Record @payment
  out: order: Record @state_type("OrderLifecycle"), receipt: Record @payment
  effects: [payment_gateway.write, database.write]
  contracts:
    pre:  order.status = "created"
    post: order.status = "paid"
    post: receipt.amount = payment.amount
  recovery:
    payment_declined -> respond(402, "payment declined")
    gateway_timeout -> retry(3, exponential)
  confidence: 0.90
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "id": "process_payment",
  "in": {
    "order": { "type": "Record", "state_type": "OrderLifecycle" },
    "payment": { "type": "Record", "domain": "payment" }
  },
  "out": {
    "order": { "type": "Record", "state_type": "OrderLifecycle" },
    "receipt": { "type": "Record", "domain": "payment" }
  },
  "contract": {
    "pre": ["order.status = \"created\""],
    "post": ["order.status = \"paid\"", "receipt.amount = payment.amount"]
  },
  "effects": ["payment_gateway.write", "database.write"],
  "confidence": 0.90,
  "recovery": {
    "payment_declined": {
      "action": "respond",
      "params": { "status": 402, "body": "payment declined" }
    },
    "gateway_timeout": {
      "action": "retry",
      "params": { "count": 3, "backoff": "exponential" }
    }
  }
}
```

</details>

**When to use:** Any state machine transition. The `@state_type("OrderLifecycle")` annotation on the port links to a declared StateType. The pre/postconditions encode the transition: `created -> paid`.

## Pattern 10: Complete Edge Wiring

How to connect nodes with edges:

```aether
edge validate_email.normalized -> check_uniqueness.email
edge validate_email.normalized -> create_user.email
edge check_uniqueness.unique -> create_user.unique
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "edges": [
    { "from": "validate_email.normalized", "to": "check_uniqueness.email" },
    { "from": "validate_email.normalized", "to": "create_user.email" },
    { "from": "check_uniqueness.unique", "to": "create_user.unique" }
  ]
}
```

</details>

**Rules:**
- `from` MUST reference a node's `out` port
- `to` MUST reference a node's `in` port
- Every input port should have exactly one incoming edge (or be a graph-level input)
- The graph must remain acyclic

## Pattern 11: Graph with SLA and Metadata

Complete graph-level configuration:

```aether
graph product_recommendations_api v1
  effects: [database, ml_model, cache]

  metadata:
    description: "Product recommendation endpoint"
    safety_level: medium
    human_oversight: "confidence < 0.7"
    sla:
      latency_ms: 200
      availability: 99.9

  // ... nodes and edges ...

end // graph
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "id": "product_recommendations_api",
  "version": 1,
  "effects": ["database", "ml_model", "cache"],
  "sla": { "latency_ms": 200, "availability": 99.9 },
  "metadata": {
    "description": "Product recommendation endpoint",
    "safety_level": "medium",
    "human_oversight": { "required_when": "confidence < 0.7" }
  },
  "nodes": [],
  "edges": []
}
```

</details>

## Pattern 12: Template Instantiation

Using a stdlib template:

```aether
use crud-entity as user_crud
  Entity = Record @auth
  IdType = String @uuid @auth
  storage_effect = database.write
end
```

<details><summary>IR equivalent (JSON)</summary>

```json
{
  "templates": [],
  "template_instances": [
    {
      "id": "user_crud",
      "template": "crud-entity",
      "bindings": {
        "Entity": { "type": "Record", "domain": "authentication" },
        "IdType": { "type": "String", "domain": "authentication", "format": "uuid_v4" },
        "storage_effect": "database.write"
      }
    }
  ]
}
```

</details>

**Available stdlib templates:** `crud-entity`, `retry-with-fallback`, `auth-gate`, `confidence-cascade`.

## Pattern 13: Real-World Data Pipeline

A complete sales analytics pipeline processing 500 CSV rows through validation, deduplication, anomaly detection, parallel analytics, report generation, archival, and email delivery.

**10 nodes, 3 parallel waves in the analytics section, 4 effect types.**

```
fetch_csv_data -> validate_records -> clean_and_normalize -> detect_anomalies ->+
    +-> calculate_revenue_by_region ->+                                         |
    +-> calculate_top_products -------+-> generate_report -> archive_report -> email_report
    +-> calculate_growth_trends -----+
```

Key patterns:
- **Filesystem effects** for CSV ingestion and report archival
- **ML inference** for anomaly detection with `confidence: 0.82` and adversarial check
- **Parallel analytics** -- 3 independent calculations run in a single wave
- **Cascading recovery** -- archive failure escalates; email failure retries 3x
- **Precondition gate** -- `email_report` requires `archived == true`

See `src/ir/examples/real-world/sales-analytics.aether` for the complete program (or `sales-analytics.json` for the IR).

## Pattern 14: Real-World API Orchestration

An e-commerce order API: JWT authentication, inventory reservation, payment processing, shipment creation, and email confirmation.

**7 nodes across 4 waves.**

```
authenticate_user -> check_inventory_api -> process_order_payment -> create_order_record_api ->+
                                                                                               +-> respond_success
    create_shipment_api -> send_order_confirmation -----------------------------------------------+
```

Key patterns:
- **Respond recovery** -- auth failure returns 401, out of stock returns 409, payment declined returns 402
- **Retry recovery** -- payment gateway timeout retries 3x with exponential backoff
- **Confidence-based oversight** -- payment processing has `confidence: 0.80` with adversarial check on overcharge
- **Effect variety** -- auth.verify, database.read/write, payment_gateway.write, shipping.write, email

See `src/ir/examples/real-world/api-orchestration.aether` for the complete program (or `api-orchestration.json` for the IR).

## Generation Self-Check

Before submitting a generated program, verify:

- [ ] Every node has `contracts` with at least one `post` entry
- [ ] Every effectful node has `recovery`
- [ ] Every node with `confidence < 0.85` has `adversarial` with `break_if`
- [ ] Every `edge` goes from an `out` port to an `in` port
- [ ] The graph is acyclic
- [ ] PII fields have `@pii` annotation
- [ ] Domain-specific values have `@auth`, `@commerce`, `@payment`, etc.
- [ ] Run `npx tsx src/cli.ts parse <file.aether>` to validate
