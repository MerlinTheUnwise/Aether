# AETHER Recovery Specification

## 1. No Exceptions Principle

AETHER does not have throw/catch in the traditional sense. Instead, every failure mode is handled through **declared recovery blocks**. This is a core design principle: unhandled errors do not exist in a valid AETHER program.

## 2. Recovery Block Structure

Each effectful node declares recovery handlers keyed by failure condition:

```json
{
  "recovery": {
    "db_timeout": {
      "action": "retry",
      "params": { "attempts": 3, "backoff": "exponential" }
    },
    "db_error": {
      "action": "fallback",
      "params": { "assume_unique": false }
    }
  }
}
```

Each entry maps a **failure condition** (string key) to a **recovery action** with optional parameters.

## 3. Recovery Actions

| Action     | Semantics                                                        |
|------------|------------------------------------------------------------------|
| `retry`    | Re-execute the node. Params: `attempts` (int), `backoff` (strategy) |
| `fallback` | Use an alternative value or node. Params: strategy-specific       |
| `escalate` | Pause execution and notify a human. Params: `message`, `alert_level` |
| `respond`  | Return an error response (e.g., HTTP status). Params: `status`, `message` |
| `report`   | Log the failure and continue. Params: logging configuration       |
| `assume`   | Provide a default value with degraded confidence. Params: default value |

### Retry Semantics

```json
{
  "action": "retry",
  "params": {
    "attempts": 3,
    "backoff": "exponential"
  }
}
```

Backoff strategies: `"none"`, `"linear"`, `"exponential"`. The runtime retries up to `attempts` times before falling through to the next recovery option or propagating the failure.

### Fallback Semantics

Fallback provides an alternative execution path. The fallback value carries a degraded confidence (typically 0.5) to signal that the primary path failed.

### Escalate Semantics

Escalation pauses the graph and requires human intervention. The `preserve_context` flag (default: true) ensures the full execution state is available to the reviewer.

## 4. Chaining

Recovery actions can be chained with `then`:

```
retry(3) then escalate
```

This means: attempt retry 3 times; if all retries fail, escalate to a human. In the IR, chaining is expressed through the `then` field in params:

```json
{
  "action": "retry",
  "params": {
    "attempts": 3,
    "then": "escalate_to_human"
  }
}
```

## 5. Coverage Requirement

Every effectful node (`effects.length > 0` and `pure !== true`) **must** declare a `recovery` block. This is a structural validation rule:

- Missing recovery → validation error
- The recovery block must contain at least one handler
- Each handler must specify a valid action

## 6. Compile-Time Verification

The validator checks:
1. All effectful nodes have recovery blocks
2. Recovery actions reference valid action types
3. Required params are present for each action type

In future phases, the verifier will additionally check that recovery handlers cover all failure modes that each effect can produce (e.g., `database.read` can produce `timeout`, `connection_error`, `not_found`).

## 7. Transpilation

Recovery blocks are transpiled to try/catch wrappers around the node function:

```javascript
async function node_with_recovery(inputs) {
  try {
    return await node(inputs);
  } catch (error) {
    if (error.type === "db_timeout") {
      // retry logic
    }
    if (error.type === "db_error") {
      // fallback logic
    }
    throw error; // unhandled → propagate
  }
}
```

The orchestrator calls `node_with_recovery` instead of `node` directly.
