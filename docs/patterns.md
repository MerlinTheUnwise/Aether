# AETHER Patterns Cookbook

> Complete IR examples for 12 common scenarios.
> When generating AETHER, copy and adapt these patterns — don't start from scratch.

## How to Use This Cookbook

Each pattern shows a **complete, valid IR fragment** that passes the full pipeline (validate → check → verify). Copy the relevant pattern, modify the domain-specific details, and validate with `npx tsx src/cli.ts generate <your-file.json>`.

## Pattern 1: Pure Validation Node

A stateless node that validates input and produces normalized output. No effects, no recovery needed.

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

**When to use:** Input validation, data normalization, format checking, parsing.
**Key properties:** `pure: true`, no recovery needed, high confidence.

## Pattern 2: Database Read with Recovery

A node that reads from a database with timeout and error recovery.

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

**When to use:** Any database lookup, cache check, external service query.
**Key properties:** `effects: ["database.read"]`, recovery for timeout + error, fallback returns safe default.

## Pattern 3: Database Write with Dependent Type Gate

A node that writes to a database, requiring a precondition from a previous node's output.

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

**When to use:** Any write operation that depends on a prior check.
**Key properties:** `constraint: "= true"` on input creates a dependent type gate — this node can only receive verified-true inputs.

## Pattern 4: ML Inference with Adversarial Checks

A node that calls an ML model with confidence below 0.85, requiring adversarial self-checks.

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

**When to use:** Any ML model call, AI inference, probabilistic output.
**Key rule:** confidence < 0.85 → `adversarial_check` is REQUIRED. Each `break_if` should describe a condition that would be true if the output is wrong.

## Pattern 5: Authentication Gate

A node that validates tokens and rejects unauthorized requests.

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

**When to use:** Any request authentication, token validation, permission checking.
**Key properties:** `respond` recovery returns HTTP-like status codes. Note sensitivity annotations: token is `internal`, user data is `pii`.

## Pattern 6: Safety-Constrained AI Agent

A node with safety invariants that prevent it from exceeding its authority.

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

**When to use:** Any autonomous AI agent action, decision-making node, automated workflow step.
**Key properties:** `invariants` declare what must NEVER happen. Adversarial checks mirror the invariants. Recovery escalates to humans when uncertain.

## Pattern 7: Confidence-Gated Execution

An input port with a confidence constraint, creating a type-level gate.

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

**When to use:** Any high-stakes action that should only execute with high confidence. The `constraint: "> 0.9"` means this node structurally cannot receive inputs with propagated confidence ≤ 0.9.

## Pattern 8: Supervised Block

A node that can't be fully verified but is explicitly tracked.

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

**When to use:** Nodes where verification is undecidable (ML outputs, heuristic logic, domain-specific rules). The supervised block is the honest escape hatch — it degrades the verification score but never hides uncertainty.

## Pattern 9: State Transition Node

A node that transitions a state machine from one state to another.

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

**When to use:** Any state machine transition. The `state_type` annotation on the port links to a declared StateType. The pre/postconditions encode the transition: `created → paid`.

## Pattern 10: Complete Edge Wiring

How to connect nodes with edges:

```json
{
  "edges": [
    { "from": "validate_email.normalized", "to": "check_uniqueness.email" },
    { "from": "validate_email.normalized", "to": "create_user.email" },
    { "from": "check_uniqueness.unique", "to": "create_user.unique" }
  ]
}
```

**Rules:**
- `from` MUST reference a node's `out` port
- `to` MUST reference a node's `in` port
- Every input port should have exactly one incoming edge (or be a graph-level input)
- The graph must remain acyclic

## Pattern 11: Graph with SLA and Metadata

Complete graph-level configuration:

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

## Pattern 12: Template Instantiation

Using a stdlib template:

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

**Available stdlib templates:** `crud-entity`, `retry-with-fallback`, `auth-gate`, `confidence-cascade`.

## Generation Self-Check

Before submitting generated IR, verify:

- [ ] Every node has `contract.post` with ≥1 entry
- [ ] Every effectful node has `recovery`
- [ ] Every node with `confidence < 0.85` has `adversarial_check`
- [ ] Every edge `from` references an `out` port
- [ ] Every edge `to` references an `in` port
- [ ] The graph is acyclic
- [ ] PII fields have `sensitivity: "pii"`
- [ ] Domain-specific values have `domain` annotations
- [ ] Output is valid JSON (no trailing commas, double quotes only)
