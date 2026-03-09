# AETHER

> *In the beginning, man made machine around current language standards, now we create the language for the machine.*

**Programs are graphs, not text.**

AETHER is an AI-native programming language where programs are directed acyclic graphs (DAGs) with formal contracts, confidence tracking, and parallel-by-default execution. Every node declares its types, effects, preconditions, postconditions, and recovery strategies — making programs verifiable, auditable, and safe for AI-generated logic.

## Why AETHER?

Traditional languages let you write anything and hope tests catch bugs. AETHER inverts this: programs must declare *what they promise* (contracts), *how confident they are* (confidence scores), *what side effects they cause* (effect tags), and *what happens when things fail* (recovery blocks). An SMT solver (Z3) formally verifies these properties before code ever runs.

## Status

**476 tests passing** across 38 test files. Zero TypeScript errors.

Phases 0, 1, and 2 are complete. The CLI has 15 commands spanning validation, execution, visualization, collaboration, and semantic analysis.

## The Eight Pillars

1. **Graph-Native** — Programs are DAGs, not text files
2. **Contracts Everywhere** — Pre/post/invariants on every node, verified by Z3
3. **Confidence Tracking** — Every node declares confidence; below 0.85 requires adversarial checks
4. **Effect System** — Side effects are declared, tracked, and require recovery handlers
5. **Recovery by Design** — No unhandled exceptions; every failure mode has a declared strategy
6. **Parallel by Default** — Independent nodes execute concurrently via `Promise.all`
7. **Intent Resolution** — Declare *what* you need; the runtime resolves *how* from certified algorithms
8. **Multi-Agent Composition** — Graphs decompose into scopes that independent agents build and integrate

## Quick Start

```bash
npm install
npm run typecheck    # Zero errors
npm test             # 476 tests passing
```

### CLI Commands

```bash
# Core pipeline
npx tsx src/cli.ts validate src/ir/examples/user-registration.json
npx tsx src/cli.ts check src/ir/examples/user-registration.json
npx tsx src/cli.ts verify src/ir/examples/user-registration.json
npx tsx src/cli.ts transpile src/ir/examples/user-registration.json
npx tsx src/cli.ts execute src/ir/examples/user-registration.json
npx tsx src/cli.ts visualize src/ir/examples/user-registration.json
npx tsx src/cli.ts report src/ir/examples/user-registration.json

# Compact form (60-70% smaller than JSON)
npx tsx src/cli.ts compact src/ir/examples/user-registration.json
npx tsx src/cli.ts expand program.aether

# Intent resolution
npx tsx src/cli.ts resolve src/ir/examples/intent-data-pipeline.json

# Semantic diff between graph versions
npx tsx src/cli.ts diff src/ir/examples/intent-data-pipeline.json src/ir/examples/intent-data-pipeline-v2.json

# Scopes and multi-agent collaboration
npx tsx src/cli.ts scope-check src/ir/examples/scoped-ecommerce.json
npx tsx src/cli.ts collaborate src/ir/examples/multi-agent-marketplace.json

# Templates
npx tsx src/cli.ts instantiate src/ir/examples/template-showcase.json
```

The `report` command runs the full pipeline and produces a dashboard:

```
═══════════════════════════════════════════════════
AETHER Report: daily-report (v1)
═══════════════════════════════════════════════════
Schema:         ✓ valid
DAG:            ✓ acyclic (6 nodes, 6 edges)
Types:          ✓ 6/6 edges compatible
Verification:   0/3 nodes verified (0%)
Intents:        3/3 resolved
                sort_results → sort-ascending
                remove_dupes → deduplicate
                sum_revenue → aggregate-sum
Execution:      ✓ 3 nodes in 2 waves (stub mode)
                Final confidence: 1.00
                Effects: database.read, email
Visualization:  ✓ daily-report.html generated
═══════════════════════════════════════════════════
```

## Reference Programs

12 example programs demonstrate the full feature set:

| Program | Nodes | Features |
|---------|-------|----------|
| `user-registration` | 3 | Contracts, PII sensitivity, recovery strategies |
| `product-recommendations` | 2 | Adversarial checks, confidence degradation, SLA |
| `customer-support-agent` | 3 | Low confidence oversight, authority rails |
| `content-moderation-agent` | 4 | Effect hierarchies, supervised execution |
| `payment-processing` | 4 | Financial domain types, multi-stage recovery |
| `rate-limiter` | 4 | State tracking, temporal contracts |
| `order-lifecycle` | 6 | State machine types, transition validation |
| `template-showcase` | 2+3 | Template instantiation, parameterized patterns |
| `scoped-ecommerce` | 8 | Scope boundaries, cross-scope contracts |
| `multi-scope-order` | 4 scopes | Multi-scope ordering, boundary compatibility |
| `multi-agent-marketplace` | 12 | 4-agent collaboration, integration verification |
| `intent-data-pipeline` | 6 | Intent nodes, certified algorithm resolution |

## Project Structure

```
src/
  ir/
    schema.json              # JSON Schema for AetherGraph
    validator.ts             # Structural validator (7 rules + IntentNode + StateType)
    examples/                # 12 reference programs
  compiler/
    checker.ts               # Semantic type checker
    verifier.ts              # Z3 contract verifier + state type invariants
    transpiler.ts            # IR → JavaScript transpiler
    compact.ts               # Bidirectional compact form (.aether ↔ .json)
    resolver.ts              # Intent → certified algorithm resolution
    diff.ts                  # Semantic diff engine (breaking change detection)
    templates.ts             # Template engine (validate, instantiate, substitute)
    scopes.ts                # Scope extraction and boundary verification
    incremental.ts           # Incremental builder (partial graphs)
  runtime/
    confidence.ts            # Confidence propagation engine
    effects.ts               # Effect tracking and enforcement
    executor.ts              # DAG executor (wave scheduling, contracts, recovery)
  agents/
    protocol.ts              # Multi-agent collaboration protocol
    simulator.ts             # Agent simulation and integration testing
  visualizer/
    generate.ts              # SVG-based HTML graph visualization
  stdlib/
    certified/               # 6 verified algorithms (sort, filter, dedup, aggregate, validate, lookup)
    patterns/                # 4 reusable templates (CRUD, retry, auth-gate, confidence-cascade)
  cli.ts                     # Unified CLI (15 commands)
spec/                        # Formal specifications
tests/                       # 38 test files, 476 tests
```

## Roadmap

- **Phase 0** — IR, validator, type checker, verifier, transpiler, CLI, specs *(complete)*
- **Phase 1** — Execution engine, compact form, incremental builder, visualization *(complete)*
- **Phase 2** — State types, templates, scopes, multi-agent collaboration, intent resolution, semantic diff *(complete)*
- **Phase 3** — TBD
