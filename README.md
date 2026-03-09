# AETHER

> *In the beginning, man made machine around current language standards, now we create the language for the machine.*

**Programs are graphs, not text.**

AETHER is an AI-native programming language where programs are directed acyclic graphs (DAGs) with formal contracts, confidence tracking, and parallel-by-default execution. Every node declares its types, effects, preconditions, postconditions, and recovery strategies — making programs verifiable, auditable, and safe for AI-generated logic.

Three execution layers give you the right trade-off for any context:

| Layer | Speed | Use Case |
|-------|-------|----------|
| **Interpreted** | Instant feedback | Development, debugging, stub mode |
| **JIT** | Adaptive optimization | Profiling, hot-path compilation, tiered execution |
| **Native (LLVM)** | Maximum performance | Production binaries via `compile` pipeline |

## Status

**1060 tests passing** across 76 test files. Zero TypeScript errors.

All four phases complete. The CLI has 25+ commands spanning validation, execution, visualization, native compilation, benchmarking, collaboration, and semantic analysis.

## The Nine Pillars

1. **Graph-Native** — Programs are DAGs, not text files
2. **Proof-Carrying** — Every node has machine-verifiable contracts (Z3 SMT solver)
3. **Intent-Declarative** — Declare properties, runtime selects algorithms from certified library
4. **Confidence-Aware** — Uncertainty is structural; adversarial self-checks required below 0.85
5. **Effect-Tracked** — All side effects declared and enforced at compile time
6. **Parallel-Default** — Concurrency derived from graph structure automatically
7. **Self-Healing** — No exceptions; every error path has typed recovery
8. **Incremental-Verifiable** — Each node validated the instant it's complete; partial graphs with typed holes
9. **Context-Scoped** — Work on subgraphs with boundary contracts; never need the full program loaded

## Quick Start

```bash
npm install
npm run typecheck    # Zero errors
npm test             # 1060 tests passing
```

### Core Pipeline

```bash
# Validate → type-check → verify → execute → visualize (all in one)
npx tsx src/cli.ts report src/ir/examples/user-registration.json

# Individual stages
npx tsx src/cli.ts validate src/ir/examples/user-registration.json
npx tsx src/cli.ts check src/ir/examples/user-registration.json
npx tsx src/cli.ts verify src/ir/examples/user-registration.json
npx tsx src/cli.ts execute src/ir/examples/user-registration.json
npx tsx src/cli.ts visualize src/ir/examples/user-registration.json
```

### Native Compilation

```bash
# Check if LLVM toolchain is installed
npx tsx src/cli.ts toolchain

# Full pipeline: validate → type-check → verify → emit IR → compile → link
npx tsx src/cli.ts compile src/ir/examples/user-registration.json

# Just emit LLVM IR (no toolchain required)
npx tsx src/cli.ts emit-llvm src/ir/examples/user-registration.json

# Build the C runtime library
npx tsx src/cli.ts build-runtime

# Benchmark interpreted vs JIT vs native
npx tsx src/cli.ts benchmark src/ir/examples/user-registration.json --runs 50
```

### AI Tooling

```bash
# Validate AI-generated IR with actionable feedback
npx tsx src/cli.ts generate my-program.json

# Resolve intent nodes against certified algorithm library
npx tsx src/cli.ts resolve src/ir/examples/intent-data-pipeline.json

# Semantic diff between graph versions (breaking change detection)
npx tsx src/cli.ts diff v1.json v2.json

# Export Lean 4 proof certificates
npx tsx src/cli.ts export-proofs src/ir/examples/user-registration.json
```

### Collaboration & Composition

```bash
# Compact form (60-70% smaller than JSON)
npx tsx src/cli.ts compact src/ir/examples/user-registration.json
npx tsx src/cli.ts expand program.aether

# Scopes and multi-agent collaboration
npx tsx src/cli.ts scope-check src/ir/examples/scoped-ecommerce.json
npx tsx src/cli.ts collaborate src/ir/examples/multi-agent-marketplace.json

# Performance profiling and JIT compilation
npx tsx src/cli.ts profile src/ir/examples/user-registration.json --runs 20
npx tsx src/cli.ts jit src/ir/examples/user-registration.json

# Verification dashboard
npx tsx src/cli.ts dashboard src/ir/examples/user-registration.json --open
```

### Report Output

The `report` command runs the full pipeline and produces a summary:

```
═══════════════════════════════════════════════════
AETHER Report: user_registration (v1)
═══════════════════════════════════════════════════
Schema:         ✓ valid
DAG:            ✓ acyclic (3 nodes, 3 edges)
Types:          ✓ 3/3 edges compatible
Verification:   3/3 nodes verified (100%)
Proofs:         6 theorems (4 proved, 1 sketched, 1 obligations)
Native:         ✓ user_registration.ll (186 lines, 2 waves parallel)
                To build: npx tsx src/cli.ts compile <path>
Execution:      ✓ 3 nodes in 2 waves (stub mode)
                Final confidence: 0.97
                Effects: database.read, database.write
Visualization:  ✓ user_registration.html generated
═══════════════════════════════════════════════════
```

## Reference Programs

14 example programs demonstrate the full feature set:

| Program | Nodes | Features |
|---------|-------|----------|
| `user-registration` | 3 | Contracts, PII sensitivity, recovery strategies |
| `product-recommendations` | 2 | Adversarial checks, confidence degradation, SLA |
| `customer-support-agent` | 3 | Low confidence oversight, authority rails |
| `content-moderation-agent` | 4 | Effect hierarchies, supervised execution |
| `payment-processing` | 4 | Financial domain types, multi-stage recovery |
| `data-pipeline-etl` | 4 | ETL pattern, data transformation pipeline |
| `rate-limiter` | 4 | State tracking, temporal contracts |
| `order-lifecycle` | 6 | State machine types, transition validation |
| `template-showcase` | 2+3 | Template instantiation, parameterized patterns |
| `scoped-ecommerce` | 8 | Scope boundaries, cross-scope contracts |
| `multi-scope-order` | 4 scopes | Multi-scope ordering, boundary compatibility |
| `multi-agent-marketplace` | 12 | 4-agent collaboration, integration verification |
| `intent-data-pipeline` | 6 | Intent nodes, certified algorithm resolution |
| `intent-data-pipeline-v2` | 7 | Version evolution, semantic diff target |

## Project Structure

```
src/
  ir/
    schema.json              # JSON Schema for AetherGraph
    validator.ts             # Structural validator (7 rules + IntentNode + StateType)
    examples/                # 14 reference programs
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
      types.ts               # AETHER → LLVM IR type mapper
      confidence.ts          # Confidence propagation IR generation
      codegen.ts             # Full LLVM IR code generator (1400+ lines)
      pipeline.ts            # Full compilation pipeline (validate → binary)
      stubs.ts               # C stub implementation generator
      benchmark.ts           # Benchmark suite (interpreted vs JIT vs native)
      runtime/
        aether_runtime.c     # Native C runtime (47 functions)
        aether_runtime.h     # Runtime header (structs + function signatures)
        build-runtime.ts     # Clang build script + signature catalog
        Makefile              # Static + shared library build
  runtime/
    confidence.ts            # Confidence propagation engine
    effects.ts               # Effect tracking and enforcement
    executor.ts              # DAG executor (wave scheduling, contracts, recovery)
    profiler.ts              # Execution profiler (hot path detection)
    jit.ts                   # JIT compiler (tiered: Tier 0/1/2, deoptimization)
  proofs/
    lean-types.ts            # AETHER → Lean 4 type mapper
    lean-contracts.ts        # Contract → Lean 4 proposition translator
    generate.ts              # Lean 4 proof certificate generator
  dashboard/
    collector.ts             # Dashboard data aggregator
    render.ts                # Self-contained HTML dashboard generator
    diff-view.ts             # Dashboard diff + HTML diff view
  agents/
    protocol.ts              # Multi-agent collaboration protocol
    simulator.ts             # Agent simulation and integration testing
  visualizer/
    generate.ts              # SVG-based HTML graph visualization
  stdlib/
    certified/               # 6 verified algorithms
    patterns/                # 4 reusable templates
  cli.ts                     # Unified CLI (25+ commands)
docs/                        # 8 reference documents
spec/                        # 5 formal specifications
tests/                       # 76 test files, 1060 tests
```

## Documentation

Full documentation lives in [`docs/`](docs/index.md):

| Document | Purpose |
|----------|---------|
| [Language Guide](docs/language-guide.md) | Architecture, pillars, execution model |
| [IR Reference](docs/ir-reference.md) | Complete IR schema specification |
| [Type System](docs/type-system.md) | Semantic types, state machines, dependent types |
| [Contracts & Verification](docs/contracts.md) | Contract expressions, Z3 verification, adversarial checks |
| [Patterns Cookbook](docs/patterns.md) | 12 complete IR examples to copy and adapt |
| [CLI Reference](docs/cli-reference.md) | Every command, every flag, every output format |
| [Scopes & Collaboration](docs/collaboration.md) | Context-scoped loading, multi-agent protocol |
| [Native Compilation](docs/native-compilation.md) | LLVM backend, C runtime, benchmarking |

## Roadmap

- **Phase 0** — IR, validator, type checker, verifier, transpiler, CLI, specs *(complete)*
- **Phase 1** — Execution engine, compact form, incremental builder, visualization *(complete)*
- **Phase 2** — State types, templates, scopes, multi-agent collaboration, intent resolution, semantic diff *(complete)*
- **Phase 3** — JIT compiler, tiered optimization, graph optimizer, Lean 4 proof export, verification dashboard, community registry *(complete)*
- **Phase 4** — LLVM native backend, C runtime, compilation pipeline, stub generator, benchmarking, documentation *(complete)*
