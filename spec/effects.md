# AETHER Effect System Specification

## 1. Effect Tags

Every node declares its side effects via the `effects` array. Standard tags:

| Tag              | Category   | Description                         |
|------------------|------------|-------------------------------------|
| `database.read`  | Database   | Reads from a data store             |
| `database.write` | Database   | Writes to a data store              |
| `network`        | Network    | Makes network requests              |
| `cache.read`     | Cache      | Reads from cache                    |
| `cache.write`    | Cache      | Writes to cache                     |
| `cache.read_write`| Cache     | Reads and writes cache              |
| `filesystem`     | IO         | Accesses the filesystem             |
| `email`          | Messaging  | Sends email                         |
| `ticketing`      | External   | Interacts with ticketing system     |
| `llm.infer`      | AI         | Calls an LLM for inference          |
| `ml_model.infer` | AI         | Calls an ML model for inference     |

Domain-specific tags are permitted (e.g., `"billing"`, `"notification"`).

## 2. Effect Composition

A graph's effects are the **union** of its nodes' effects:

```
graph.effects = ∪ { node.effects | node ∈ graph.nodes }
```

The graph-level `effects` declaration in the IR is a manifest — the validator may check that it is a superset of the computed union.

## 3. Pure Declaration

A node with `"pure": true` is equivalent to `"effects": []`. Pure nodes:
- Have no side effects
- Are referentially transparent
- Can be safely memoized, reordered, or eliminated

## 4. Effect Isolation

Pure nodes **cannot** call effectful nodes. In the DAG model, this means: no edge may flow from an effectful node's output into a pure node's input if that would imply the pure node depends on a side effect.

> **Phase 0 note**: Effect isolation is tracked but not enforced at compile time. Full enforcement is planned for Phase 1.

## 5. Effect Algebra

Effects compose according to these rules:

| Operation            | Result            |
|----------------------|-------------------|
| `read + read`        | `read`            |
| `write + write`      | `write`           |
| `read + write`       | `read_write`      |
| `pure + pure`        | `pure`            |
| `pure + effectful`   | `effectful`       |

When composing two subgraphs, the resulting effect set is the union of both.

## 6. Recovery Requirement

Every node that has `effects.length > 0` and `pure !== true` **must** declare a `recovery` block. This ensures that all side effects have a defined failure handling strategy. Missing recovery on an effectful node is a validation error.
