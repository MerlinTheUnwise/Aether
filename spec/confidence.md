# AETHER Confidence Specification

## 1. Confidence Range

Every node may declare a `confidence` value in the range `[0.0, 1.0]`:

| Value | Meaning                                      |
|-------|----------------------------------------------|
| `1.0` | Fully proven / deterministic logic            |
| `0.85`| Threshold — below this, adversarial check required |
| `0.0` | No confidence / untested                      |

If `confidence` is omitted, it defaults to `1.0` (fully trusted).

## 2. Propagation Rule

When a node consumes inputs from upstream nodes, its output confidence is computed as:

```
output_confidence = node_confidence × min(input_confidences)
```

This is the **multiplicative propagation rule**: confidence can only decrease as data flows through the graph. A single low-confidence node degrades all downstream outputs.

### Example

```
Node A: confidence = 0.99
Node B: confidence = 0.85, inputs from A
Node C: confidence = 0.95, inputs from A and B

B.output_confidence = 0.85 × min(0.99) = 0.8415
C.output_confidence = 0.95 × min(0.99, 0.8415) = 0.7994
```

## 3. Adversarial Check Threshold: 0.85

Any node with `confidence < 0.85` **must** declare an `adversarial_check` block with at least one `break_if` entry. This is a structural validation rule enforced by the validator.

### Rationale

The 0.85 threshold is empirically chosen: at approximately 85% confidence, AI system error rates become significant enough that explicit adversarial testing is warranted. Below this threshold, the system must prove that specific bad outcomes cannot occur.

## 4. Human Oversight Gate

Graphs may declare a human oversight policy in metadata:

```json
{
  "metadata": {
    "human_oversight": {
      "required_when": "confidence < 0.7"
    }
  }
}
```

When the **propagated** confidence at any node drops below the configured threshold, execution pauses and requires human approval before proceeding.

## 5. Supervised Nodes

Nodes marked `supervised` contribute `0.0` to the verification score (their contracts are not formally proven). However, their declared `confidence` value still participates in propagation:

```
supervised node with confidence 0.9
→ downstream nodes receive 0.9 as an input confidence
→ but verification report shows 0% for this node
```

This creates a gap between the runtime confidence (which may be optimistic) and the verified confidence (which is conservative).

## 6. Graph-Level Confidence

The graph's overall confidence is the product of all node confidences along the **critical path** (longest dependency chain). In practice, the transpiler computes it as the product of all node output confidences:

```
graph_confidence = ∏ { node.output_confidence | node ∈ graph.nodes }
```

This gives a single number representing the system's end-to-end confidence.
