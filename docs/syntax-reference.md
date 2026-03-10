# .aether Syntax Reference

The `.aether` format is a human-readable surface syntax for AETHER's graph IR. Each `.aether` file describes a directed acyclic graph (DAG) of typed, contracted computation nodes.

This reference covers the full `.aether` surface syntax parsed by `src/parser/parser.ts`. For the compact token-efficient format (`G:`, `N:`, `E:`, `H:`, `I:` prefixes), see `src/compiler/compact.ts`.

---

## 1. Graph Declaration

Every `.aether` file contains exactly one graph block.

```aether
graph <id> v<version>
  effects: [<effect1>, <effect2>, ...]

  metadata:
    description: "<text>"
    safety_level: <high|medium|low>

  // ... nodes, edges, state types, scopes, templates ...

end
```

- **id**: Graph identifier (alphanumeric, hyphens, underscores).
- **version**: Integer version number prefixed with `v`.
- **effects**: List of effects the graph may produce. Must cover all node-level effects.
- **metadata** (optional): Description and safety level.

Example:

```aether
graph user_registration v1
  effects: [database.read, database.write]

  // nodes and edges go here

end
```

---

## 2. Node Blocks

Nodes are the core computation units. Each node declares typed input/output ports, contracts, effects, and recovery strategies.

```aether
node <id>
  in:  <port>: <Type> [@annotation ...], ...
  out: <port>: <Type> [@annotation ...], ...
  effects: [<effect>, ...]
  contracts:
    pre:  <expression>
    post: <expression>
    break_if: <expression>
  confidence: <0.0-1.0>
  pure
  supervised: "<reason>"
  recovery:
    <condition> -> <action>(<params>)
end
```

### Fields

| Field | Required | Description |
|---|---|---|
| `in` | Yes | Input ports with types and annotations |
| `out` | Yes | Output ports with types and annotations |
| `effects` | No | Side effects this node performs (required if not `pure`) |
| `contracts` | No | Pre/postconditions and adversarial break_if checks |
| `confidence` | No | Float 0.0-1.0. Below 0.85 requires `break_if` |
| `pure` | No | Marks node as side-effect-free |
| `supervised` | No | Flags node for human review |
| `recovery` | No | Error handling strategies (required for effectful nodes) |

### Port Types

Base types: `String`, `Bool`, `Int`, `Float64`, `Decimal`, `Null`.
Generic types: `List<T>`, `Map<K,V>`, custom types like `User`, `Order`, `HTTPRequest`.

### Contracts

```aether
contracts:
  pre:  email.length > 0
  pre:  amount > 0
  post: normalized.is_lowercase
  post: status == "created"
  break_if: input_length > 10000
```

Multiple `pre` and `post` lines are allowed. `break_if` lines define adversarial checks -- they are required when `confidence` is below 0.85.

### Recovery Actions

```aether
recovery:
  db_timeout    -> retry(3, exponential)
  db_error      -> fallback(assume_unique: false)
  write_fail    -> escalate("user creation failed", max_retries: 2)
  not_found     -> respond(404)
  declined      -> respond(402, "payment declined")
  email_failed  -> report(channel: notification-failures)
```

Available strategies:
- `retry(count, backoff)` -- Retry with optional backoff (`exponential`, `linear`).
- `fallback(key: value)` -- Use a fallback value.
- `escalate("message")` -- Escalate to human/supervisor.
- `respond(status_code, "body")` -- Return an error response.
- `report(channel: name)` -- Log to a reporting channel.

### Full Node Example

```aether
node check_uniqueness
  in:  email: String @email @auth @pii
  out: unique: Bool
  effects: [database.read]
  contracts:
    post: unique <=> !exists(users, email)
  recovery:
    db_timeout -> retry(3, exponential)
    db_error -> fallback(assume_unique: false)
end
```

---

## 3. Hole Blocks

Holes represent incomplete parts of a graph -- placeholders that must be filled before execution.

```aether
hole <id>
  in:  <port>: <Type>, ...
  out: <port>: <Type>, ...
  effects: [<effect>, ...]
  contracts:
    pre:  <expression>
    post: <expression>
end
```

Holes define the interface a future implementation must satisfy (ports, effects, contracts) without providing the implementation itself. They enable incremental graph construction.

---

## 4. Intent Blocks

Intents describe *what* a node should do without specifying *how*. They are resolved to certified algorithm implementations at compile time.

```aether
intent <id>
  in:  <port>: <Type>, ...
  out: <port>: <Type>, ...
  ensure: <natural language requirement>
  ensure: <another requirement>
  constraints:
    time_complexity: O(n log n)
    space_complexity: O(n)
    deterministic: true
    latency_ms: 100
  confidence: <0.0-1.0>
end
```

### Fields

| Field | Required | Description |
|---|---|---|
| `in` / `out` | Yes | Typed ports (same as nodes) |
| `ensure` | Yes (1+) | Natural-language behavioral requirements |
| `constraints` | No | Performance and determinism constraints |
| `confidence` | No | Confidence in the resolved implementation |

### Example

```aether
intent sort_results
  in:  collection: List<Transaction>
  out: sorted: List<Transaction>
  ensure: output is sorted by date
  ensure: output is permutation of input
  ensure: length preserved
  constraints:
    time_complexity: O(n log n)
    deterministic: true
end
```

Intents are resolved against certified algorithms in `src/stdlib/certified/`. The resolver matches `ensure` clauses to algorithm guarantees using synonym-based matching.

---

## 5. Edge Declarations

Edges connect output ports to input ports, forming the DAG.

```aether
edge <source_node>.<output_port> -> <target_node>.<input_port>
```

Rules:
- The source must be an output port (`out`).
- The target must be an input port (`in`).
- Types must be compatible across the edge.
- Cycles are not allowed (the graph must be a DAG).

```aether
edge validate_email.normalized -> check_uniqueness.email
edge validate_email.normalized -> create_user.email
edge check_uniqueness.unique -> create_user.unique
```

---

## 6. State Types

State types define verified state machines with transitions, invariants, and terminal states.

```aether
statetype <id>
  states: [<state1>, <state2>, ...]
  transitions:
    <from> -> <to> when <condition>
  never:
    <from> -> <to>
  terminal: [<state>, ...]
  initial: <state>
end
```

### Fields

| Field | Required | Description |
|---|---|---|
| `states` | Yes | All valid states |
| `transitions` | Yes | Allowed transitions with conditions |
| `never` | No | Explicitly forbidden transitions (verified via Z3) |
| `terminal` | No | States with no outgoing transitions |
| `initial` | No | The starting state |

### Example

```aether
statetype OrderLifecycle
  states: [created, paid, shipped, delivered, cancelled, refunded]
  transitions:
    created -> paid when payment_confirmed
    created -> cancelled when customer_cancelled
    paid -> shipped when shipment_dispatched
    paid -> refunded when refund_requested
    shipped -> delivered when delivery_confirmed
    delivered -> refunded when return_approved
  never:
    cancelled -> paid
    delivered -> shipped
  terminal: [cancelled, refunded]
  initial: created
end
```

Nodes reference state types through the `@state_type("Name")` annotation on ports:

```aether
out: status: String @commerce @state_type("OrderLifecycle")
```

---

## 7. Scope Blocks

Scopes partition a graph into isolated subgraphs with explicit boundary contracts for cross-scope communication.

```aether
scope <id>
  nodes: [<node_id>, ...]
  requires:
    <contract_name>: (<port>: <Type>, ...) -> ()
  provides:
    <contract_name>: () -> (<port>: <Type>, ...)
end
```

### Fields

| Field | Required | Description |
|---|---|---|
| `nodes` | Yes | Node IDs belonging to this scope |
| `requires` | No | Boundary contracts this scope depends on |
| `provides` | No | Boundary contracts this scope exposes |

A scope that `provides` a contract must have nodes producing those ports. A scope that `requires` a contract consumes data from another scope's `provides`.

### Example

```aether
scope order
  nodes: [validate_order, check_inventory]
  provides:
    order_data: () -> (total_amount: Float64 @USD, available: Bool)
end

scope payment
  nodes: [process_payment]
  requires:
    order_data: (total_amount: Float64 @USD, available: Bool) -> ()
  provides:
    payment_result: () -> (transaction_id: String @payment)
end
```

---

## 8. Template and Use Blocks

Templates define reusable graph patterns with parameterized types and effects. `use` blocks instantiate templates with concrete bindings.

### Template Definition

```aether
template <id>
  params:
    $<Param>: type
    $<Param>: effect

  node <node_id>
    in:  data: $Param
    out: result: $Param
    effects: [$effect_param]
    // ... contracts, recovery, etc.
  end

  edge <node1>.<port> -> <node2>.<port>
end
```

Parameter names are prefixed with `$`. They can be of kind `type` or `effect`. During instantiation, all occurrences of `$Param` in the template are substituted with concrete values.

### Template Instantiation

```aether
use <template_id> as <instance_id>
  <Param> = <value>
  <Param> = <value>
end
```

Instantiated node IDs are prefixed with `<instance_id>_` to avoid collisions.

### Example

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
      pre:  input.data != null
      post: output.validated != null
    pure
  end

  node create_entity
    in:  data: $Entity
    out: entity: $Entity, success: Bool
    effects: [$storage_effect]
    recovery:
      storage_failure -> retry
  end

  edge validate_input.validated -> create_entity.data
end

use crud-entity as user_crud
  Entity = User
  IdType = String
  storage_effect = database.write
end
```

---

## 9. Type Annotations

Annotations add semantic metadata to port types. They follow the type name, prefixed with `@`.

```aether
in:  email: String @email @pii
out: amount: Float64 @USD @constraint("> 0") @range(0, 10000)
out: status: String @state_type("OrderLifecycle")
```

### Built-in Annotations

| Annotation | Maps to | Description |
|---|---|---|
| `@email` | `format: "email"` | Email format validation |
| `@pii` | `sensitivity: "pii"` | Personally identifiable information |
| `@uuid` | `format: "uuid_v4"` | UUID v4 format |
| `@public` | `sensitivity: "public"` | Public data |
| `@internal` | `sensitivity: "internal"` | Internal data |
| `@auth` | `sensitivity: "auth"` | Authentication-related |
| `@iso8601` | `format: "iso8601"` | ISO 8601 date format |

### Parameterized Annotations

| Annotation | Example | Description |
|---|---|---|
| `@domain` | `@commerce`, `@payment` | Domain tag (custom) |
| `@format` | `@iso8601` | Custom format identifier |
| `@constraint` | `@constraint("== true")` | Value constraint expression |
| `@range` | `@range(0, 10000)` | Numeric range bounds |
| `@state_type` | `@state_type("OrderLifecycle")` | Links port to a state type |
| `@USD`, `@EUR` | `Float64 @USD` | Currency/unit annotation |

Any unrecognized `@name` is treated as a domain or format annotation (triggers warning `W001` if truly unknown).

---

## 10. Comments

Line comments start with `//` and continue to the end of the line.

```aether
// This is a comment
node validate_email  // inline comment
  in: email: String @email
  // ...
end
```

Comments can appear anywhere: at the top level, inside blocks, or at the end of lines.

---

## 11. Parser Error Codes

The parser (`src/parser/errors.ts`) produces structured errors with codes, line/column locations, source context, and suggestions.

### Lexer Errors

| Code | Message | Description |
|---|---|---|
| `E001` | Unexpected character | Character not recognized by the lexer |
| `E002` | Unterminated string literal | String opened but never closed |

### Structural Errors

| Code | Message | Description |
|---|---|---|
| `E010` | Expected 'end' to close block | Missing `end` keyword for node/scope/template/etc. |
| `E011` | Expected keyword | Expected a keyword like `graph`, `node`, `edge`, etc. |
| `E012` | Unexpected token | Token does not fit the current parse context |
| `E013` | Expected identifier | Expected a name/ID where none was found |
| `E014` | Expected version number | Missing or malformed `vN` after graph ID |
| `E015` | Expected colon | Missing `:` separator (e.g., in port declarations) |
| `E016` | Expected arrow (->) | Missing `->` in edge or transition declaration |
| `E017` | Duplicate node id | Two nodes/holes/intents share the same ID |
| `E018` | Duplicate edge | Same edge declared twice |

### Semantic Errors

| Code | Message | Description |
|---|---|---|
| `E020` | Effectful node missing recovery block | Non-pure node with effects must have `recovery` |
| `E021` | Low-confidence node missing adversarial check | Confidence < 0.85 requires `break_if` |
| `E022` | Contracts block missing postcondition | Contracts must include at least one `post` |
| `E023` | Edge references nonexistent port | Port name in edge not found on the node |
| `E024` | Edge source must be output port | Edge `from` must reference an `out` port |
| `E025` | Edge target must be input port | Edge `to` must reference an `in` port |
| `E026` | Graph effects should cover all node effects | Node declares effects not listed in graph `effects` |

### Warnings

| Code | Message | Description |
|---|---|---|
| `W001` | Unknown annotation | Annotation not in the built-in set |

Error output format:

```
error[E010]: expected 'end' to close block
  --> my-graph.aether:15:1
   |
 15 | edge foo.x -> bar.y
   | ^^^^
   = help: add 'end' after the node block
```

---

## 12. Comparison with JSON IR

The `.aether` format and JSON IR represent the same graph structure. The parser converts `.aether` to the JSON IR consumed by all downstream tools.

| Aspect | `.aether` | JSON IR |
|---|---|---|
| File extension | `.aether` | `.json` |
| Readability | Human-friendly, block-structured | Machine-friendly, verbose |
| Size | ~60-70% smaller than equivalent JSON | Full structural representation |
| Comments | Supported (`//`) | Not supported |
| Tool input | Parser required (`parse` command) | Direct consumption |
| Templates | Native `template`/`use` blocks | `templates` + `template_instances` arrays |
| Scopes | Native `scope` blocks | `scopes` array with node ID lists |
| State types | Native `statetype` blocks | `state_types` array |
| Intents | Native `intent` blocks | Node with `intent: true` flag |
| Holes | Native `hole` blocks | Node with `hole: true` flag |
| Ports | `in: name: Type @ann` | `{ "name": { "type": "...", "format": "..." } }` |
| Edges | `edge a.x -> b.y` | `{ "from": "a.x", "to": "b.y" }` |
| Contracts | `pre:` / `post:` / `break_if:` lines | `contract.pre[]`, `contract.post[]`, `adversarial_check.break_if[]` |
| Recovery | `condition -> action(params)` | `recovery: { "condition": { "action": "...", "params": {...} } }` |

---

## 13. Migration Guide: JSON to .aether

### Step 1: Graph Header

**JSON:**
```json
{
  "id": "user_registration",
  "version": 1,
  "effects": ["database.read", "database.write"]
}
```

**`.aether`:**
```aether
graph user_registration v1
  effects: [database.read, database.write]
```

### Step 2: Nodes

**JSON:**
```json
{
  "id": "validate_email",
  "in": { "email": { "type": "String", "format": "email", "sensitivity": "pii" } },
  "out": { "normalized": { "type": "String", "format": "email" } },
  "contract": { "pre": ["email.length > 0"], "post": ["normalized.is_lowercase"] },
  "effects": [],
  "pure": true,
  "confidence": 0.99
}
```

**`.aether`:**
```aether
node validate_email
  in:  email: String @email @pii
  out: normalized: String @email
  contracts:
    pre:  email.length > 0
    post: normalized.is_lowercase
  pure
  confidence: 0.99
end
```

### Step 3: Edges

**JSON:**
```json
{ "from": "validate_email.normalized", "to": "check_uniqueness.email" }
```

**`.aether`:**
```aether
edge validate_email.normalized -> check_uniqueness.email
```

### Step 4: State Types

**JSON:**
```json
{
  "id": "OrderLifecycle",
  "states": ["created", "paid"],
  "transitions": [{ "from": "created", "to": "paid", "when": "payment_confirmed" }],
  "never": [{ "from": "paid", "to": "created" }],
  "terminal": ["paid"],
  "initial": "created"
}
```

**`.aether`:**
```aether
statetype OrderLifecycle
  states: [created, paid]
  transitions:
    created -> paid when payment_confirmed
  never:
    paid -> created
  terminal: [paid]
  initial: created
end
```

### Step 5: Intents

**JSON:**
```json
{
  "id": "sort_results",
  "intent": true,
  "ensure": ["output is sorted by date"],
  "in": { "collection": { "type": "List<Transaction>" } },
  "out": { "sorted": { "type": "List<Transaction>" } },
  "constraints": { "deterministic": true }
}
```

**`.aether`:**
```aether
intent sort_results
  in:  collection: List<Transaction>
  out: sorted: List<Transaction>
  ensure: output is sorted by date
  constraints:
    deterministic: true
end
```

### Automated Conversion

Use the CLI to convert between formats:

```bash
# JSON -> .aether (compact form)
npx tsx src/cli.ts compact path/to/graph.json

# .aether -> JSON (expand)
npx tsx src/cli.ts expand path/to/graph.aether
```

Note: The `compact` command produces the token-efficient compact format (`G:`/`N:`/`E:` prefixes), not the full `.aether` surface syntax. The `expand` command converts compact form back to JSON. For the full `.aether` syntax, the parser in `src/parser/parser.ts` handles parsing, and `src/parser/emitter.ts` handles emission.
