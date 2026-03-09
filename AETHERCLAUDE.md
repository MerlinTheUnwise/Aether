# AETHER — Project CLAUDE.md

> Axiomatic Execution Through Holistic Expression & Reasoning
> The first programming language designed for AI cognition.

## What Is This

AETHER is an AI-native programming language where programs are computation graphs (DAGs), not linear text. Every node carries typed contracts, confidence annotations, effect declarations, and recovery strategies. The language is designed to eliminate the structural causes of AI coding errors.

**Read `docs/index.md` first.** The `docs/` folder contains 8 reference documents covering the full language. When generating AETHER code or working on the toolchain, start there.

## Current State

4 phases complete. 1060 tests across 76 files. 14 reference programs. 10 published stdlib packages. 20+ CLI commands.

## Core Principles (The Nine Pillars)

1. **Graph-Native** — Programs are DAGs, not text files
2. **Proof-Carrying** — Every node has machine-verifiable contracts
3. **Intent-Declarative** — Declare properties, runtime selects algorithms
4. **Confidence-Aware** — Uncertainty is structural; adversarial self-checks required below 0.85
5. **Effect-Tracked** — All side effects declared and enforced at compile time
6. **Parallel-Default** — Concurrency derived from graph structure automatically
7. **Self-Healing** — No exceptions; every error path has typed recovery
8. **Incremental-Verifiable** — Each node validated the instant it's complete; partial graphs with typed holes
9. **Context-Scoped** — Work on subgraphs with boundary contracts; never need the full program loaded

## Project Structure

```
aether/
├── CLAUDE.md                          # This file
├── docs/                              # Full documentation (8 reference docs)
│   ├── index.md                       # START HERE — doc map
│   ├── language-guide.md              # Architecture, pillars, execution model
│   ├── ir-reference.md                # Complete IR schema spec (primary generation reference)
│   ├── type-system.md                 # Semantic types, temporal, dependent, templates
│   ├── contracts.md                   # Contracts, Z3, adversarial, confidence, supervised
│   ├── patterns.md                    # 12 complete IR examples (copy and adapt)
│   ├── cli-reference.md              # All 20+ CLI commands with flags
│   ├── collaboration.md              # Scopes, boundary contracts, multi-agent
│   └── native-compilation.md         # LLVM backend, C runtime, benchmarking
├── prompts/
│   └── generate-ir.md                # System prompt for AI IR generation
├── spec/                              # Formal language specifications
│   ├── type-system.md
│   ├── contracts.md
│   ├── effects.md
│   ├── confidence.md
│   └── recovery.md
├── src/
│   ├── ir/
│   │   ├── schema.json               # AETHER-IR JSON Schema (source of truth)
│   │   ├── validator.ts              # Validator + scope/state/template rules
│   │   └── examples/                 # 14 reference programs
│   ├── compiler/
│   │   ├── checker.ts                # Semantic type checker (6 dimensions)
│   │   ├── verifier.ts              # Z3 contract verification (WASM)
│   │   ├── transpiler.ts            # IR → JavaScript
│   │   ├── compact.ts               # Compact form ↔ structured form
│   │   ├── incremental.ts           # Incremental builder (partial graphs, holes)
│   │   ├── templates.ts             # Template engine
│   │   ├── scopes.ts                # Scope extractor + boundary checks
│   │   ├── resolver.ts              # Intent resolver (Layer 3)
│   │   ├── optimizer.ts             # AI-driven graph optimization (11 rules)
│   │   ├── diff.ts                  # Semantic diff + breaking change detection
│   │   └── llvm/                    # LLVM native compilation backend
│   │       ├── types.ts
│   │       ├── emitter.ts
│   │       ├── writer.ts
│   │       ├── pipeline.ts
│   │       ├── stubs.ts
│   │       ├── benchmark.ts
│   │       └── runtime/             # C runtime library (9 source files)
│   ├── runtime/
│   │   ├── executor.ts              # Graph executor (waves, confidence, recovery)
│   │   ├── confidence.ts            # Confidence propagation engine
│   │   ├── effects.ts               # Effect tracking + enforcement
│   │   ├── profiler.ts              # Execution profiler
│   │   └── jit.ts                   # JIT compiler (tiered: Tier 0/1/2)
│   ├── agents/
│   │   ├── protocol.ts              # Multi-agent collaboration
│   │   └── simulator.ts             # Agent simulation harness
│   ├── proofs/
│   │   ├── lean-types.ts            # AETHER → Lean 4 type mapping
│   │   ├── lean-contracts.ts        # Contract → Lean proposition translation
│   │   └── generate.ts              # Lean 4 proof certificate generator
│   ├── dashboard/
│   │   ├── collector.ts
│   │   ├── render.ts
│   │   └── diff-view.ts
│   ├── registry/
│   │   ├── package.ts
│   │   ├── index.ts
│   │   └── resolver.ts
│   ├── visualizer/
│   │   └── generate.ts
│   ├── stdlib/
│   │   ├── patterns/                # 4 template patterns
│   │   └── certified/              # 6 verified algorithms
│   └── cli.ts                       # CLI entry point (20+ commands)
├── scripts/
│   ├── build-runtime.ts
│   └── publish-stdlib.ts
└── tests/                            # 1060 tests across 76 files
```

## Development Rules

### When Generating AETHER-IR
1. Read `docs/ir-reference.md` for the full schema
2. Read `docs/patterns.md` for copy-and-adapt examples
3. Read `prompts/generate-ir.md` for the generation system prompt
4. Generate valid JSON conforming to `src/ir/schema.json`
5. Validate with: `npx tsx src/cli.ts generate <path>`
6. Fix any errors — every error message tells you exactly what to fix
7. Re-validate until STATUS: ACCEPTED

### When Modifying the Toolchain
- Run `npm test` before and after changes (1060 tests must pass)
- Run `npm run typecheck` (zero errors required)
- The IR schema (`src/ir/schema.json`) is the source of truth — all tools read it
- `additionalProperties: false` on all schema objects — no extra fields
- Z3 integration uses TypeScript API (z3-solver npm), NOT SMT-LIB2 strings
- AJV v8 requires `createRequire` workaround under NodeNext ESM

### Node Validation Rules (enforced by validator)
- Every node MUST have `contract.post` with ≥1 entry
- Non-pure effectful nodes MUST have `recovery`
- Nodes with `confidence < 0.85` MUST have `adversarial_check` with ≥1 `break_if`
- Edge `from` must reference an `out` port; `to` must reference an `in` port
- Graph must be acyclic (DAG)

### What NOT to Do
- Do not optimize for human readability at the expense of precision
- Do not skip contracts — contracts are the product
- Do not use `any` types or untyped escapes — use supervised blocks
- Do not build features requiring the full graph in context (use scoped loading)
- Do not generate SMT-LIB2 strings — use Z3 TypeScript API

## CLI Quick Reference

| Command | Purpose |
|---|---|
| `validate <path>` | Schema + structural validation |
| `check <path>` | Semantic type checking |
| `verify <path>` | Z3 contract verification |
| `generate <path>` | Validate with actionable feedback |
| `resolve <path>` | Resolve intent nodes to algorithms |
| `transpile <path>` | IR → JavaScript |
| `compact <path>` | IR → compact form (.aether) |
| `expand <path>` | Compact → IR JSON |
| `execute <path>` | Run graph (stub mode by default) |
| `jit <path>` | Profile + JIT compile + benchmark |
| `profile <path>` | Profile without compilation |
| `benchmark <path>` | Compare interpreted/JIT/native |
| `visualize <path>` | Generate HTML graph visualization |
| `dashboard <path>` | Full verification dashboard |
| `dashboard-diff <a> <b>` | Compare two dashboard snapshots |
| `optimize <path>` | AI-driven optimization suggestions |
| `diff <a> <b>` | Semantic diff between graph versions |
| `export-proofs <path>` | Lean 4 proof certificate export |
| `scope <path> <id>` | Extract and validate a scope |
| `scope-check <path>` | Validate all scopes + boundaries |
| `collaborate <path>` | Multi-agent collaboration simulation |
| `incremental` | Interactive graph builder REPL |
| `compile <path>` | LLVM native compilation |
| `build-runtime` | Compile C runtime library |
| `toolchain` | Check LLVM installation |
| `registry init/list/info` | Package registry management |
| `publish <path>` | Publish graph as package |
| `install <name>` | Install package from registry |
| `search <query>` | Search registry |
| `report <path>` | Full pipeline with summary |

## Three Execution Tiers

| Tier | Command | Use Case |
|---|---|---|
| Interpreted | `execute <path>` | Development, debugging |
| JIT | `execute <path> --jit` | Node.js production |
| Native | `compile <path>` | Maximum performance |

Same graph. Same contracts. Same confidence. Three performance levels.

## Key File Locations

| What | Where |
|---|---|
| IR Schema (source of truth) | `src/ir/schema.json` |
| Reference programs | `src/ir/examples/*.json` |
| Generation prompt | `prompts/generate-ir.md` |
| Stdlib templates | `src/stdlib/patterns/*.template.json` |
| Certified algorithms | `src/stdlib/certified/*.certified.json` |
| C runtime source | `src/compiler/llvm/runtime/` |
| Full documentation | `docs/` (start with `docs/index.md`) |
