# AETHER — Project CLAUDE.md

> Axiomatic Execution Through Holistic Expression & Reasoning
> An intermediate representation format designed for AI-generated safety-critical workflows.

## What Is This

AETHER is a TypeScript toolchain for authoring, validating, verifying, and executing programs expressed as JSON-encoded DAGs. Every node carries typed contracts, confidence annotations, effect declarations, and recovery strategies. Designed as an intermediate representation for AI-generated programs.

**Read `docs/index.md` first.** The `docs/` folder contains 8 reference documents covering the full language. When generating AETHER code or working on the toolchain, start there.

## Current State

7 phases complete + Phase 8 Sessions 1–4. ~1,669 test cases (it blocks) across 165 files. 17 reference programs. 10 published stdlib packages. 43 CLI commands. Z3 proves ~78% of postconditions formally (with implementation axioms); runtime evaluator covers 100%. Lean 4 generates proof skeletons (74% tactic-proved, never compiler-verified). Zero native dependencies — pure WASM SQLite (sql.js), runs on any OS with Node.js 18+.

## Core Principles (The Nine Pillars)

1. **Graph-Native** — Programs are DAGs, not text files
2. **Contract-Verified** — Contracts verified by Z3; optional Lean 4 proof skeleton export
3. **Intent-Declarative** — Declare properties, runtime selects algorithms
4. **Confidence-Aware** — Uncertainty is structural; adversarial self-checks required below 0.85
5. **Effect-Tracked** — All side effects declared and enforced at runtime
6. **Parallel-Default** — Concurrency derived from graph structure automatically
7. **Self-Healing** — No exceptions; every error path has typed recovery
8. **Incremental-Verifiable** — Each node validated the instant it's complete; partial graphs with typed holes
9. **Context-Scoped** — Work on subgraphs with boundary contracts; never need the full program loaded

## Project Structure

```
aether/
├── AETHERCLAUDE.md                    # This file
├── docs/                              # Full documentation (8 reference docs)
│   ├── index.md                       # START HERE — doc map
│   ├── language-guide.md              # Architecture, pillars, execution model
│   ├── ir-reference.md                # Complete IR schema spec (primary generation reference)
│   ├── type-system.md                 # Semantic types, temporal, dependent, templates
│   ├── contracts.md                   # Contracts, Z3, adversarial, confidence, supervised
│   ├── patterns.md                    # 14 complete IR examples (copy and adapt)
│   ├── cli-reference.md              # All CLI commands with flags
│   ├── collaboration.md              # Scopes, boundary contracts, multi-agent (single-process)
│   ├── native-compilation.md         # LLVM backend (experimental), C runtime, benchmarking
│   └── syntax-reference.md          # Complete .aether syntax reference
├── prompts/
│   ├── generate-ir.md                # System prompt for AI IR generation (JSON)
│   └── generate-aether.md           # System prompt for AI .aether generation
├── editor-support/                    # VS Code extension for .aether syntax highlighting
│   ├── aether.tmLanguage.json        # TextMate grammar
│   ├── language-configuration.json   # Bracket matching, folding, comments
│   └── package.json                  # VS Code extension manifest
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
│   │   └── examples/                 # 17 reference programs (.json + .aether, 14 standard + 3 real-world)
│   ├── compiler/
│   │   ├── checker.ts                # Semantic type checker (6 dimensions)
│   │   ├── verifier.ts              # Z3 contract verification (WASM)
│   │   ├── transpiler.ts            # IR → JavaScript
│   │   ├── compact.ts               # Compact form ↔ structured form
│   │   ├── incremental.ts           # Incremental builder (partial graphs, holes)
│   │   ├── templates.ts             # Template engine
│   │   ├── scopes.ts                # Scope extractor + boundary checks
│   │   ├── resolver.ts              # Intent resolver (Layer 3)
│   │   ├── optimizer.ts             # Static graph optimizer (11 rule-based analysis passes)
│   │   ├── diff.ts                  # Semantic diff + breaking change detection
│   │   └── llvm/                    # LLVM native compilation backend (experimental)
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
│   │   └── jit.ts                   # Runtime code generator (tiered: Tier 0/1/2)
│   ├── agents/
│   │   ├── protocol.ts              # Multi-agent collaboration protocol
│   │   └── simulator.ts             # Agent simulation harness (single-process)
│   ├── proofs/
│   │   ├── lean-types.ts            # AETHER → Lean 4 type mapping
│   │   ├── lean-contracts.ts        # Contract → Lean proposition translation
│   │   └── generate.ts              # Lean 4 proof skeleton generator
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
│   ├── editor/
│   │   ├── generate.ts                # Interactive visual graph editor
│   │   └── templates.ts               # Editor CSS/JS/HTML templates
│   ├── demo/
│   │   └── generate.ts                # Interactive demo application generator
│   ├── stdlib/
│   │   ├── patterns/                # 4 template patterns
│   │   └── certified/              # 6 verified algorithms
│   └── cli.ts                       # CLI entry point (43 commands)
├── scripts/
│   ├── build-runtime.ts
│   ├── publish-stdlib.ts
│   └── verify-clean-install.ts       # Verifies sql.js works without native deps
└── tests/                            # ~1,669 test cases (it blocks) across 165 files
```

## Development Rules

### When Generating AETHER Programs
1. **Default format: `.aether`** — generate `.aether` syntax, not JSON
2. Read `docs/syntax-reference.md` for the complete `.aether` syntax
3. Read `docs/patterns.md` for copy-and-adapt examples
4. Read `prompts/generate-aether.md` for the AI generation prompt (`.aether` format)
5. Read `prompts/generate-ir.md` for legacy JSON generation prompt
6. Validate with: `npx tsx src/cli.ts parse <path.aether>`
7. Fix any errors — parser errors include line numbers and suggestions
8. For AI generation: `npx tsx src/cli.ts ai "description" --format aether`
9. JSON is the IR that tools pass around internally — humans write `.aether`

### When Modifying the Toolchain
- Run `npm test` before and after changes (all tests must pass)
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
| `jit <path>` | Compile hot subgraphs + benchmark |
| `profile <path>` | Profile without compilation |
| `benchmark <path>` | Compare interpreted/compiled/native |
| `visualize <path>` | Generate HTML graph visualization |
| `dashboard <path>` | Full verification dashboard |
| `dashboard-diff <a> <b>` | Compare two dashboard snapshots |
| `optimize <path>` | Static graph optimization suggestions |
| `diff <a> <b>` | Semantic diff between graph versions |
| `export-proofs <path>` | Lean 4 proof skeleton export |
| `scope <path> <id>` | Extract and validate a scope |
| `scope-check <path>` | Validate all scopes + boundaries |
| `collaborate <path>` | Multi-agent collaboration simulation (single-process) |
| `incremental` | Interactive graph builder REPL |
| `compile <path>` | LLVM native compilation (experimental) |
| `build-runtime` | Compile C runtime library |
| `toolchain` | Check LLVM installation |
| `registry init/list/info` | Local package registry management |
| `publish <path>` | Publish graph as package |
| `install <name>` | Install package from registry |
| `search <query>` | Search registry |
| `editor [path]` | Interactive visual graph editor |
| `demo` | Interactive pipeline demo HTML |
| `report <path>` | Full pipeline with summary |

## Three Execution Tiers

| Tier | Command | Status |
|---|---|---|
| Interpreted | `execute <path>` | Feature-complete and tested |
| Compiled optimization | `execute <path> --jit` | Feature-complete and tested — compiles to optimized JavaScript |
| Native (LLVM) | `compile <path>` | Experimental — generates LLVM IR, end-to-end execution not yet verified |

Same graph. Same contracts. Same confidence. Three performance levels.

## Known Limitations

- Z3 proves ~78% of postconditions formally using implementation axioms (was ~1%
  before axioms). Axioms are implementation guarantees that Z3 assumes as true;
  if axioms are correct, proofs are sound. Remaining ~22% are either unsupported
  expressions or postconditions whose axioms are incomplete. Runtime contract
  enforcement covers 100% of expressions.
- Test count: vitest reports ~2,300 including describe blocks and parameterized
  expansions. Actual it() blocks: ~1,669.
- Lean 4 export generates syntactically valid Lean but has never been verified by
  an actual Lean 4 compiler. Most non-trivial proofs contain sorry placeholders.
  74% of theorems have tactic proofs, 26% have sorry.
- The LLVM native backend generates valid LLVM IR but end-to-end compilation
  to running binaries has not been verified in the test suite.
- Service implementations (database, filesystem, email, HTTP, ML) use
  in-memory simulation. SQLite adapter uses sql.js (pure WASM) — no native
  dependencies. Data auto-saves to file for file-based databases.
- The graph optimizer uses rule-based static analysis, not machine learning.
- Multi-agent collaboration is simulated within a single process.
  No distributed execution capability exists.
- Programs are authored as JSON (by AI or by hand). The visual editor and demo are read-only viewers, not full authoring environments.

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
