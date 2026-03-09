# AETHER

**Programs are graphs, not text.**

AETHER is a programming language where programs are directed acyclic graphs (DAGs) with formal contracts, confidence tracking, and parallel-by-default execution. Every node declares its types, effects, preconditions, postconditions, and recovery strategies.

Three execution layers:

| Layer | How It Works |
|-------|-------------|
| **Interpreted** | Wave-based DAG executor with stub or real implementations |
| **JIT** | Tiered compilation (Tier 0/1/2) with profiling and deoptimization |
| **Native (LLVM)** | LLVM IR code generation with C runtime |

## Status

**1523 tests passing** across 105 test files. Zero TypeScript errors. 73 source files. 31 CLI commands.

16 reference programs including 2 real-world end-to-end workflows (500-row data pipeline, 7-node API orchestration).

All five phases complete.

## What It Does

1. **Graph-Native** — Programs are JSON DAGs, not text files
2. **Proof-Carrying** — Every node has contracts verified by Z3 SMT solver
3. **Intent-Declarative** — Declare what you want; runtime selects from 6 certified algorithms
4. **Confidence-Aware** — Uncertainty is structural; adversarial self-checks required below 0.85
5. **Effect-Tracked** — All side effects declared and enforced (hierarchy: parent covers children)
6. **Parallel-Default** — Concurrency derived from graph topology via wave scheduling
7. **Self-Healing** — Every error path has typed recovery (retry, fallback, escalate, respond, report)
8. **Incremental-Verifiable** — Partial graphs with typed holes; each node validated independently
9. **Context-Scoped** — Work on subgraphs with boundary contracts

## Quick Start

```bash
npm install
npm run typecheck
npm test
```

### Core Pipeline

```bash
# Full pipeline: validate → type-check → verify → execute → visualize
npx tsx src/cli.ts report src/ir/examples/user-registration.json

# Individual stages
npx tsx src/cli.ts validate src/ir/examples/user-registration.json
npx tsx src/cli.ts check src/ir/examples/user-registration.json
npx tsx src/cli.ts verify src/ir/examples/user-registration.json
npx tsx src/cli.ts execute src/ir/examples/user-registration.json
npx tsx src/cli.ts visualize src/ir/examples/user-registration.json
```

### Real Execution

```bash
# Execute with real implementations (not stubs)
npx tsx src/cli.ts execute src/ir/examples/real-world/api-orchestration.json \
  --real --seed test-data/api-orchestration/seed.json --contracts warn

# Sales analytics pipeline with 500-row CSV
npx tsx src/cli.ts execute src/ir/examples/real-world/sales-analytics.json \
  --real --seed test-data/sales-analytics/seed.json --contracts warn
```

### Native Compilation

```bash
npx tsx src/cli.ts toolchain           # Check LLVM toolchain
npx tsx src/cli.ts compile src/ir/examples/user-registration.json
npx tsx src/cli.ts emit-llvm src/ir/examples/user-registration.json
npx tsx src/cli.ts build-runtime
npx tsx src/cli.ts benchmark src/ir/examples/user-registration.json --runs 50
```

### Analysis & Optimization

```bash
npx tsx src/cli.ts generate my-program.json           # Validate AI-generated IR
npx tsx src/cli.ts resolve src/ir/examples/intent-data-pipeline.json  # Resolve intents
npx tsx src/cli.ts diff v1.json v2.json                # Semantic diff
npx tsx src/cli.ts export-proofs src/ir/examples/user-registration.json  # Lean 4 proofs
npx tsx src/cli.ts optimize src/ir/examples/user-registration.json      # Graph optimizer
npx tsx src/cli.ts profile src/ir/examples/user-registration.json --runs 20
npx tsx src/cli.ts jit src/ir/examples/user-registration.json
npx tsx src/cli.ts dashboard src/ir/examples/user-registration.json --open
```

### Collaboration & Composition

```bash
npx tsx src/cli.ts compact src/ir/examples/user-registration.json
npx tsx src/cli.ts expand program.aether
npx tsx src/cli.ts scope-check src/ir/examples/scoped-ecommerce.json
npx tsx src/cli.ts collaborate src/ir/examples/multi-agent-marketplace.json
```

## Reference Programs

16 example programs in `src/ir/examples/`:

| Program | Nodes | Key Features |
|---------|-------|-------------|
| `user-registration` | 3 | Contracts, PII sensitivity, recovery |
| `product-recommendations` | 2 | Adversarial checks, confidence degradation |
| `customer-support-agent` | 3 | Low confidence oversight |
| `content-moderation-agent` | 4 | Effect hierarchies, supervised execution |
| `payment-processing` | 4 | Financial domain types, multi-stage recovery |
| `data-pipeline-etl` | 4 | ETL pattern, data transformation |
| `rate-limiter` | 4 | State tracking, temporal contracts |
| `order-lifecycle` | 6 | State machine types, transition validation |
| `template-showcase` | 2+3 | Template instantiation, parameterized patterns |
| `scoped-ecommerce` | 8 | Scope boundaries, cross-scope contracts |
| `multi-scope-order` | 4 scopes | Multi-scope ordering, boundary compatibility |
| `multi-agent-marketplace` | 12 | 4-agent collaboration, integration verification |
| `intent-data-pipeline` | 6 | Intent nodes, certified algorithm resolution |
| `intent-data-pipeline-v2` | 7 | Version evolution, semantic diff target |
| `real-world/sales-analytics` | 10 | 500-row CSV pipeline: validate → deduplicate → anomaly detect → analytics → report → archive → email |
| `real-world/api-orchestration` | 7 | E-commerce order flow: auth → inventory → payment → order → shipment → email → response |

The two `real-world/` programs have full implementations (not stubs) with real computation, database queries, CSV parsing, and email sending.

## Project Structure

```
src/
  ir/
    schema.json              # JSON Schema for AetherGraph
    validator.ts             # Structural validator (7 rules + IntentNode + StateType)
    examples/                # 16 reference programs
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
    optimizer.ts             # Graph optimizer (11 optimization types)
    llvm/
      codegen.ts             # LLVM IR code generator
      types.ts               # AETHER → LLVM IR type mapper
      confidence.ts          # Confidence propagation IR generation
      pipeline.ts            # Full compilation pipeline (validate → binary)
      stubs.ts               # C stub implementation generator
      benchmark.ts           # Benchmark suite (interpreted vs JIT vs native)
      runtime/
        aether_runtime.c     # Native C runtime
        aether_runtime.h     # Runtime header
        build-runtime.ts     # Clang build script
        Makefile
  runtime/
    executor.ts              # DAG executor (wave scheduling, contracts, recovery)
    confidence.ts            # Confidence propagation engine
    effects.ts               # Effect tracking and enforcement
    profiler.ts              # Execution profiler (hot path detection)
    jit.ts                   # JIT compiler (tiered: Tier 0/1/2, deoptimization)
    evaluator/               # Expression evaluator (lexer, parser, checker)
  implementations/
    registry.ts              # Implementation resolution (exact ID, pattern, type sig)
    types.ts                 # NodeImplementation interface
    programs/                # Real implementations for all 16 programs
    services/
      container.ts           # Service container (dependency injection)
      database.ts            # In-memory database with query/create/update
      filesystem.ts          # In-memory filesystem with CSV support
      email.ts               # Email service (capture mode for testing)
      ml.ts                  # ML service (rule-based anomaly detection)
      http.ts                # HTTP client service
  proofs/
    lean-types.ts            # AETHER → Lean 4 type mapper
    lean-contracts.ts        # Contract → Lean 4 proposition translator
    generate.ts              # Lean 4 proof certificate generator
  dashboard/
    collector.ts             # Dashboard data aggregator
    render.ts                # Self-contained HTML dashboard generator
    diff-view.ts             # Dashboard diff view
  agents/
    protocol.ts              # Multi-agent collaboration protocol
    simulator.ts             # Agent simulation and integration testing
  visualizer/
    generate.ts              # SVG-based HTML graph visualization
  stdlib/
    certified/               # 6 verified algorithms
    patterns/                # 4 reusable templates
  cli.ts                     # Unified CLI (31 commands)
docs/                        # 9 reference documents
spec/                        # 5 formal specifications
tests/                       # 105 test files, 1523 tests
test-data/                   # Seed data and inputs for real-world programs
```

## Documentation

Documentation is in [`docs/`](docs/index.md):

| Document | Content |
|----------|---------|
| [Language Guide](docs/language-guide.md) | Architecture, execution model, real execution |
| [IR Reference](docs/ir-reference.md) | IR schema, implementations, service container |
| [Type System](docs/type-system.md) | Semantic types, state machines |
| [Contracts & Verification](docs/contracts.md) | Contract expressions, Z3 verification |
| [Patterns Cookbook](docs/patterns.md) | 14 IR patterns to copy and adapt |
| [CLI Reference](docs/cli-reference.md) | All 31 commands with flags |
| [Scopes & Collaboration](docs/collaboration.md) | Context-scoped loading, multi-agent protocol |
| [Native Compilation](docs/native-compilation.md) | LLVM backend, C runtime, benchmarking |

## Phases

- **Phase 0** — IR schema, validator, type checker, Z3 verifier, transpiler, CLI, formal specs
- **Phase 1** — DAG executor, compact form, incremental builder, visualization, confidence engine, effect tracker
- **Phase 2** — State types, templates, scopes, multi-agent collaboration, intent resolution, semantic diff
- **Phase 3** — JIT compiler, tiered optimization, graph optimizer, Lean 4 proof export, verification dashboard
- **Phase 4** — LLVM native backend, C runtime, compilation pipeline, stub generator, benchmarking
- **Phase 5** — Implementation registry, service container, real execution mode, expression evaluator, 16 program implementations, real-world end-to-end workflows
