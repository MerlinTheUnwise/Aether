# AETHER

**Programs are graphs, not text.**

AETHER is a TypeScript toolchain for authoring, validating, verifying, and executing
programs expressed as JSON-encoded directed acyclic graphs (DAGs). Each node declares
typed inputs/outputs, contracts verified by Z3, confidence annotations, side-effect
declarations, and recovery strategies.

It is designed as an intermediate representation for AI-generated programs —
specifically targeting safety-critical workflows where every node must declare its
contracts, effects, uncertainty, and failure handling.

## What It Actually Does

1. **Graph-Native** — Programs are JSON DAGs, not text files
2. **Contract-Verified** — Every node has contracts verified by Z3 SMT solver and optional Lean 4 proof export
3. **Intent-Declarative** — Declare what you want; runtime selects from 6 certified algorithms
4. **Confidence-Aware** — Uncertainty is structural; adversarial self-checks required below 0.85
5. **Effect-Tracked** — All side effects declared and enforced (hierarchy: parent covers children)
6. **Parallel-Default** — Concurrency derived from graph topology via wave scheduling
7. **Self-Healing** — Every error path has typed recovery (retry, fallback, escalate, respond, report)
8. **Incremental-Verifiable** — Partial graphs with typed holes; each node validated independently
9. **Context-Scoped** — Work on subgraphs with boundary contracts

## What Works Today

| Feature | Status | Details |
|---------|--------|---------|
| IR schema + validator | Feature-complete and tested | JSON Schema, 7 validation rules, DAG check |
| Semantic type checker | Feature-complete and tested | 6-dimension type compatibility (domain, unit, sensitivity, etc.) |
| Z3 contract verifier | Working | Translates 93% of contract expressions to Z3 AST, formally proves ~78% of postconditions (with implementation axioms). See Known Limitations |
| Interpreted executor | Feature-complete and tested | Wave-based parallel scheduling, confidence gating, recovery |
| Compiled optimization | Feature-complete and tested | Compiles hot subgraphs to optimized JavaScript functions (Tier 0/1/2) |
| Static graph optimizer | Feature-complete and tested | 11 rule-based analysis passes (merge, parallelize, eliminate, etc.) |
| Real execution mode | Feature-complete and tested | 17 programs with real computation logic and in-memory service simulation |
| Compact form | Feature-complete and tested | `.aether` text format, 60-70% smaller, round-trip guaranteed |
| Verification dashboard | Feature-complete and tested | Self-contained HTML with per-node verification breakdown |
| Interactive demo | Feature-complete and tested | Browser-based pipeline: describe → generate → validate → visualize → verify → execute |
| Visual graph editor | Feature-complete and tested | Browser-based interactive DAG editor with drag, zoom, port connection |
| Local package registry | Feature-complete and tested | Semver dependency resolution, 10 published stdlib packages |

## What's Experimental

| Feature | Status | What Works | What Doesn't |
|---------|--------|------------|-------------|
| LLVM native backend | Experimental | LLVM IR generation with experimental binary compilation (requires clang) | End-to-end compilation to running binaries not verified in test suite |
| Lean 4 proof export | Experimental | Generates proof skeletons for 74% of contracts, most with sorry placeholders | Never verified by an actual Lean 4 compiler |
| Multi-agent collaboration | Simulated | Protocol, scope assignment, integration checks | Single-process simulation only, no distributed execution |

## Quick Start

```bash
git clone https://github.com/MerlinTheUnwise/Aether
cd Aether
npm install          # No native dependencies — works on any OS with Node.js 18+
npm run typecheck    # Verify TypeScript
npm test             # Run all tests
```

**Requirements:** Node.js 18+ (for native fetch). No Python, C++ compiler, or platform-specific tools needed.

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
# Execute with real implementations (in-memory service simulation)
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

### Demo & Visualization

```bash
npx tsx src/cli.ts demo --open                                              # Interactive demo
npx tsx src/cli.ts editor src/ir/examples/user-registration.json --open     # Visual graph editor
npx tsx src/cli.ts dashboard src/ir/examples/user-registration.json --open  # Verification dashboard
```

### Analysis & Optimization

```bash
npx tsx src/cli.ts generate my-program.json           # Validate generated IR
npx tsx src/cli.ts resolve src/ir/examples/intent-data-pipeline.json  # Resolve intents
npx tsx src/cli.ts diff v1.json v2.json                # Semantic diff
npx tsx src/cli.ts export-proofs src/ir/examples/user-registration.json  # Lean 4 proof skeletons
npx tsx src/cli.ts optimize src/ir/examples/user-registration.json      # Static graph optimizer
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

17 example programs in `src/ir/examples/`:

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
| `multi-agent-marketplace` | 12 | 4-agent collaboration (single-process simulation), integration verification |
| `intent-data-pipeline` | 6 | Intent nodes, certified algorithm resolution |
| `intent-data-pipeline-v2` | 7 | Version evolution, semantic diff target |
| `real-world/sales-analytics` | 10 | 500-row CSV pipeline: validate → deduplicate → anomaly detect → analytics → report → archive → email |
| `real-world/api-orchestration` | 7 | E-commerce order flow: auth → inventory → payment → order → shipment → email → response |
| `real-world/transaction-analysis` | 5 | Financial transaction analysis pipeline |

The three `real-world/` programs have real computation logic (sorts actually sort, aggregations actually sum). All service I/O (database, filesystem, email) is in-memory simulation.

## Project Structure

```
src/
  ir/
    schema.json              # JSON Schema for AetherGraph
    validator.ts             # Structural validator (7 rules + IntentNode + StateType)
    examples/                # 17 reference programs (.json + .aether)
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
    optimizer.ts             # Static graph optimizer (11 rule-based analysis passes)
    llvm/
      codegen.ts             # LLVM IR code generator
      types.ts               # AETHER → LLVM IR type mapper
      confidence.ts          # Confidence propagation IR generation
      pipeline.ts            # Full compilation pipeline (validate → binary)
      stubs.ts               # C stub implementation generator
      benchmark.ts           # Benchmark suite (interpreted vs compiled vs native)
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
    jit.ts                   # Runtime code generator (tiered: Tier 0/1/2, deoptimization)
    evaluator/               # Expression evaluator (lexer, parser, checker)
  implementations/
    registry.ts              # Implementation resolution (exact ID, pattern, type sig)
    types.ts                 # NodeImplementation interface
    programs/                # Real implementations for all 16 programs
    services/
      container.ts           # Service container (dependency injection)
      database.ts            # In-memory database with query/create/update
      database-sqlite.ts     # SQLite adapter (sql.js WASM — no native deps)
      filesystem.ts          # In-memory filesystem with CSV support
      email.ts               # Email service (capture mode for testing)
      ml.ts                  # ML service (rule-based anomaly detection)
      http.ts                # HTTP client service
  proofs/
    lean-types.ts            # AETHER → Lean 4 type mapper
    lean-contracts.ts        # Contract → Lean 4 proposition translator
    generate.ts              # Lean 4 proof skeleton generator
  dashboard/
    collector.ts             # Dashboard data aggregator
    render.ts                # Self-contained HTML dashboard generator
    diff-view.ts             # Dashboard diff view
  agents/
    protocol.ts              # Multi-agent collaboration protocol
    simulator.ts             # Agent simulation and integration testing
  visualizer/
    generate.ts              # SVG-based HTML graph visualization
  editor/
    generate.ts              # Interactive visual graph editor
    templates.ts             # Editor CSS/JS/HTML templates
  demo/
    generate.ts              # Interactive demo application generator
  stdlib/
    certified/               # 6 verified algorithms
    patterns/                # 4 reusable templates
  cli.ts                     # Unified CLI (43 commands)
docs/                        # 9 reference documents
spec/                        # 5 formal specifications
tests/                       # 165 test files, ~1,669 it() blocks
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
| [CLI Reference](docs/cli-reference.md) | All 43 commands with flags |
| [Scopes & Collaboration](docs/collaboration.md) | Context-scoped loading, multi-agent protocol (single-process simulation) |
| [Native Compilation](docs/native-compilation.md) | LLVM backend (experimental), C runtime, benchmarking |

## Design Philosophy

The nine pillars are real design principles enforced throughout the toolchain — not claims about completeness:

1. **Graph-Native** — Programs are DAGs, not text files
2. **Contract-Verified** — Contracts verified by Z3; optional Lean 4 proof skeleton export
3. **Intent-Declarative** — Declare properties, runtime selects algorithms
4. **Confidence-Aware** — Uncertainty is structural; adversarial self-checks below 0.85
5. **Effect-Tracked** — All side effects declared and enforced
6. **Parallel-Default** — Concurrency derived from graph structure
7. **Self-Healing** — Every error path has typed recovery
8. **Incremental-Verifiable** — Each node validated independently; partial graphs supported
9. **Context-Scoped** — Subgraphs with boundary contracts

## Verified Metrics

| Metric | Count | Method |
|---|---|---|
| Test cases (it blocks) | 1,669 | `\bit\s*\(` across tests/ |
| Test files | 165 | `*.test.ts` in tests/ |
| Source files | 95 | `*.ts` in src/ |
| Source lines (non-blank) | 29,762 | counted programmatically |
| CLI commands | 43 | counted from cli.ts case statements |
| Reference programs | 17 | `src/ir/examples/` (14 standard + 3 real-world) |
| Z3 formal proof rate | 77.9% | 88/113 postconditions proved UNSAT (with implementation axioms) |
| Lean 4 proof rate | 74.2% tactic-proved, 25.8% sorry | 132/178 theorems |
| Lean 4 compiler-verified | 0 | no lean4 installation |

These numbers are generated by `scripts/count-metrics.ts` and verified against actual code.

**Note:** Vitest reports ~2,300 tests including describe blocks and parameterized expansions.
The 1,669 count reflects actual `it()` blocks in source.

## Known Limitations

- Z3 translates 93% of contract expressions to Z3 AST and formally proves ~78%
  of postconditions using implementation axioms. Axioms are implementation
  guarantees that Z3 assumes as true; proofs are sound if axioms are correct.
  Remaining ~22% are unsupported expressions or incomplete axioms.
  Runtime contract enforcement covers 100% of expressions.
- Test count: vitest reports ~2,300 including describe blocks and parameterized
  expansions. Actual it() blocks: ~1,669.
- Lean 4 export generates syntactically valid Lean but has never been verified by
  an actual Lean 4 compiler. Most non-trivial proofs contain sorry placeholders.
- The LLVM native backend generates valid LLVM IR but end-to-end compilation
  to running binaries has not been verified in the test suite.
- Service implementations (database, filesystem, email, HTTP, ML) use
  in-memory simulation. SQLite adapter uses sql.js (pure WASM) — no native
  dependencies required.
- The graph optimizer uses rule-based static analysis, not machine learning.
- Multi-agent collaboration is simulated within a single process.
  No distributed execution capability exists.
- Programs are authored as JSON (by AI or by hand). The visual editor and demo are read-only viewers, not full authoring environments.

## Phases

- **Phase 0** — IR schema, validator, type checker, Z3 verifier, transpiler, CLI, formal specs
- **Phase 1** — DAG executor, compact form, incremental builder, visualization, confidence engine, effect tracker
- **Phase 2** — State types, templates, scopes, multi-agent collaboration, intent resolution, semantic diff
- **Phase 3** — Runtime code generator, tiered compilation, static graph optimizer, Lean 4 proof export, verification dashboard
- **Phase 4** — LLVM native backend, C runtime, compilation pipeline, stub generator, benchmarking
- **Phase 5** — Implementation registry, service container, real execution mode, expression evaluator, 16 program implementations, end-to-end workflows with real computation and in-memory services
- **Phase 6** — Honest documentation, Z3 gap closure, real I/O adapters, LLVM end-to-end verification, Lean proof deepening, visual graph editor, interactive demo application
- **Phase 7** — `.aether` surface syntax as primary format, parser (lexer/parser/emitter/bridge), VS Code extension, ecosystem integration
- **Phase 8** — Metrics honesty, implementation axioms (Z3 proof rate 0.9% → 78%), compositional verification, universal services (sql.js replaces better-sqlite3), Z3 performance optimization (2s timeout, result caching, vitest workspace splitting)
