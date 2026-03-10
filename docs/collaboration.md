# Scopes & Multi-Agent Collaboration

> How to decompose programs into scopes, define boundary contracts, and orchestrate multi-agent collaboration.
>
> **Note:** Multi-agent collaboration is simulated within a single process. No distributed execution capability exists.

## When to Use Scopes

Use scopes when:
- The graph has 10+ nodes that form natural groupings
- Multiple AI instances should work on different parts simultaneously
- You want to verify parts of the program independently
- The system maps to organizational boundaries (payment team, fulfillment team, etc.)

Don't use scopes for:
- Small graphs (< 10 nodes) — overhead isn't worth it
- Tightly coupled logic where every node depends on every other
- Prototyping (add scopes when the design stabilizes)

## Defining Scopes

Each scope declares which nodes it owns and what it requires/provides at its boundaries.

```json
{
  "scopes": [
    {
      "id": "payment",
      "description": "Payment processing scope",
      "nodes": ["validate_payment", "authorize_card", "capture_funds"],
      "boundary_contracts": {
        "requires": [
          {
            "name": "get_order",
            "in": { "order_id": { "type": "String", "domain": "commerce" } },
            "out": { "order": { "type": "Record", "domain": "commerce" } },
            "confidence": 0.95
          }
        ],
        "provides": [
          {
            "name": "payment_complete",
            "in": { "order": { "type": "Record", "domain": "commerce" } },
            "out": { "receipt": { "type": "Record", "domain": "payment" } },
            "contract": {
              "post": ["receipt.amount = order.total", "receipt.status = \"captured\""]
            },
            "effects": ["payment_gateway.write"],
            "confidence": 0.90
          }
        ]
      }
    }
  ]
}
```

### Scope Rules

1. **Exhaustive assignment:** Every node must belong to exactly one scope (if scopes are defined). Unassigned nodes → error.
2. **No overlap:** A node cannot be in two scopes.
3. **Boundary coverage:** Every edge crossing a scope boundary must be covered by boundary contracts on both sides.
4. **Internal edges:** Edges between nodes in the same scope need no boundary contract.

### Boundary Contracts

**`requires`** — What this scope needs from other scopes. These become stub nodes when the scope is extracted for independent verification.

**`provides`** — What this scope exposes to other scopes. These are the interface that consumers depend on. Changes to `provides` contracts are checked for breaking changes.

## Scope Extraction

Extract a scope as a standalone, independently verifiable graph:

```
npx tsx src/cli.ts scope src/ir/examples/multi-scope-order.json payment
```

The extractor:
1. Collects all nodes in the scope
2. Creates stub nodes from boundary contracts (requires become input stubs, provides define output expectations)
3. Wires edges to stubs for boundary connections
4. Produces a valid AetherGraph that can run the full pipeline independently

**Key property:** If a scope passes validation, type checking, and verification independently, it's guaranteed correct in the larger system — without loading any other scope's internals.

## Boundary Compatibility

For two scopes A (provides) and B (requires):

1. **Type compatibility:** A's output types must match B's input types (same type checker rules)
2. **Contract implication:** A's postconditions must imply B's preconditions (Z3 check)
3. **Effect compatibility:** A's declared effects must be a subset of what B expects
4. **Confidence:** A's confidence must meet B's minimum requirement

Check all boundaries:
```
npx tsx src/cli.ts scope-check src/ir/examples/multi-scope-order.json
```

## Multi-Agent Collaboration

Multiple AI instances work on different scopes simultaneously, with guaranteed integration.

### Workflow

1. **Create session** from a scoped graph
2. **Assign agents** — each gets their scope's view (scope nodes + boundary stubs)
3. **Agents work** independently — filling in node implementations within their scope
4. **Agents submit** — submissions validated against boundary contracts immediately
5. **Integrate** — orchestrator checks all pairwise boundary compatibilities
6. **Export** — merged into a single validated graph

### Running Collaboration

```
npx tsx src/cli.ts collaborate src/ir/examples/multi-agent-marketplace.json
```

Output shows per-agent status, boundary compatibility, and composed confidence.

### Submission Validation

When an agent submits work:
1. All submitted nodes must belong to the assigned scope
2. Schema validation passes
3. Type checking passes on internal edges
4. The scope's `provides` contracts are satisfied by the submitted nodes
5. The scope's `requires` contracts are satisfiable given the structure

Rejected submissions get specific error messages explaining which requirement wasn't met.

### Integration Checks

Before merging:
1. **ID conflicts:** No two scopes produce nodes with the same ID
2. **Boundary compatibility:** Every requires/provides pair is type-compatible and contract-compatible
3. **Effect conflicts:** Two scopes writing to the same resource → warning
4. **Composed confidence:** Product of confidences across scope boundaries

### Algebraic Composition Property

If scope A satisfies its boundary contracts independently, and scope B satisfies its boundary contracts independently, and their shared boundary is compatible, then A∘B is correct. This is the mathematical guarantee that enables safe multi-agent collaboration.

## Example: E-Commerce System

```
┌─────────────────┐     ┌──────────────────┐
│   Order Scope   │────▶│  Payment Scope   │
│                 │     │                  │
│ validate_order  │     │ validate_payment │
│ check_inventory │     │ authorize_card   │
│                 │     │ capture_funds    │
└─────────────────┘     └──────────────────┘
                              │
                              ▼
┌─────────────────┐     ┌──────────────────┐
│ Fulfillment     │◀────│  Notification    │
│                 │     │                  │
│ create_shipment │     │ send_confirm     │
│ track_delivery  │     │ send_receipt     │
└─────────────────┘     └──────────────────┘
```

Each scope:
- Verified independently
- Worked on by a separate AI agent
- Connected via typed boundary contracts
- Integration guaranteed by algebraic composition
