# AETHER — Project CLAUDE.md

> Axiomatic Execution Through Holistic Expression & Reasoning
> The first programming language designed for AI cognition.

## What Is This

AETHER is an AI-native programming language where programs are computation graphs (DAGs), not linear text. Every node carries typed contracts, confidence annotations, effect declarations, and recovery strategies. The language is designed to eliminate the structural causes of AI coding errors.

## Core Principles (The Nine Pillars)

1. **Graph-Native** — Programs are DAGs, not text files
2. **Proof-Carrying** — Every node has machine-verifiable contracts
3. **Intent-Declarative** — Declare properties, runtime selects algorithms
4. **Confidence-Aware** — Uncertainty is structural, not hidden; adversarial self-checks required below threshold
5. **Effect-Tracked** — All side effects declared and enforced at compile time
6. **Parallel-Default** — Concurrency derived from graph structure automatically
7. **Self-Healing** — No exceptions; every error path has typed recovery
8. **Incremental-Verifiable** — Each node validated the instant it's complete; partial graphs with typed holes
9. **Context-Scoped** — Work on subgraphs with boundary contracts; never need the full program loaded

## Architecture

Three execution layers:
- **Layer 3 (Intent)**: Declare desired properties → runtime resolves to certified implementations
- **Layer 2 (Structural)**: Construct computation graphs with full contracts (primary working layer)
- **Layer 1 (Constructive)**: Build new verified algorithms when needed; they join the intent library

Key type system features:
- **Semantic types**: encode meaning (dimension, unit, domain, sensitivity), not just shape
- **Temporal state types**: first-class state machines with verified transitions
- **Dependent types**: `unique: true` as an input type prevents calling with unverified data
- **Supervised blocks**: explicit unverified regions tracked in verification score

## Serialization Formats

- **Structured form**: Primary, verbose, clear — for generation and review
- **Compact form**: ~60% fewer tokens — for bulk generation
- **AETHER-IR**: JSON-based DAG intermediate representation — compiler target

## Project Structure

```
aether/
├── CLAUDE.md              # This file
├── spec/                  # Formal language specification
│   ├── type-system.md     # Semantic types, temporal types, dependent types
│   ├── contracts.md       # Pre/post/invariant/adversarial contract spec
│   ├── effects.md         # Effect algebra and composition rules
│   ├── confidence.md      # Confidence propagation and threshold rules
│   └── recovery.md        # Error model and recovery strategy spec
├── ir/                    # AETHER-IR definition
│   ├── schema.json        # JSON schema for AETHER-IR graphs
│   ├── validator.ts       # IR validation engine
│   └── examples/          # Reference programs in IR format
├── compiler/              # Compiler pipeline
│   ├── parser.ts          # Structured form → AETHER-IR
│   ├── checker.ts         # Type checking, contract verification
│   ├── verifier.ts        # SMT solver integration (Z3)
│   ├── transpiler.ts      # AETHER-IR → JavaScript/TypeScript
│   └── compact.ts         # Compact form ↔ Structured form
├── runtime/               # Execution engine
│   ├── executor.ts        # Graph traversal and parallel scheduling
│   ├── confidence.ts      # Confidence propagation engine
│   └── recovery.ts        # Recovery strategy execution
├── stdlib/                # Standard graph library
│   ├── patterns/          # Parameterized pattern templates
│   └── certified/         # Verified algorithm implementations
├── tests/                 # Test suite
│   ├── reference/         # 10 reference programs with verified contracts
│   └── adversarial/       # Adversarial check test cases
└── docs/                  # Documentation
    └── design.md          # Full design document (from vision artifact)
```

## Development Rules

### Code Generation
- When generating AETHER code, always use the structured form first, compact form only for bulk operations
- Every node MUST have: typed inputs, typed outputs, at least one contract, effect declaration (even if `pure: true`)
- Nodes with confidence < 0.85 MUST have adversarial_check blocks
- Recovery blocks are required for any node with non-pure effects

### Verification
- Run contract verification on every node before connecting it to the graph
- Track verification percentage: aim for >95% verified, <5% supervised
- Supervised blocks require explicit `reason` string

### Architecture Decisions
- TypeScript for all tooling (compiler, runtime, CLI)
- Z3 WASM for contract verification in-browser
- JSON as the canonical IR format (not text-based syntax)
- The structured text form is a convenience layer over IR, not the source of truth

### What NOT To Do
- Do not optimize for human readability at the expense of precision
- Do not add syntactic sugar — every construct must be unambiguous
- Do not skip contracts "for now" — contracts are the product
- Do not use `any` types or untyped escape hatches — use supervised blocks instead
- Do not build features that require loading the full graph into context

## IR Generation

When asked to generate an AETHER program:
1. Read prompts/generate-ir.md for the full generation prompt
2. Generate valid AETHER-IR JSON conforming to src/ir/schema.json
3. Validate with: npx tsx src/cli.ts generate <path>
4. Fix any reported errors — every error message tells you exactly what to fix
5. Re-validate until STATUS: ACCEPTED

Common mistakes to avoid:
- Forgetting recovery on effectful nodes
- Forgetting adversarial_check when confidence < 0.85
- Edges pointing to wrong port direction (from must be out, to must be in)
- Trailing commas in JSON arrays/objects

## Phase 0 Priorities (Complete)

1. Define AETHER-IR JSON schema
2. Build 3 reference programs by hand in IR format
3. Type checker for semantic types (dimension/unit/domain)
4. Contract verification POC with Z3
5. IR → JavaScript transpiler (basic)
6. Prompt engineering: teach Claude to emit valid AETHER-IR

## Key Terminology

| Term | Meaning |
|------|---------|
| Node | A computation unit with typed I/O, contracts, effects, confidence |
| Edge | A typed data flow connection between nodes |
| Graph | A complete program (DAG of nodes + edges) |
| Contract | Machine-verifiable pre/post/invariant conditions |
| Adversarial Check | Property that would be true if implementation is WRONG |
| Confidence | Numeric certainty annotation that propagates through computation |
| Effect | Declared side effect (IO, network, database, etc.) |
| Recovery | Typed error handling strategy (no exceptions) |
| Hole | Typed placeholder in a partial graph |
| Scope | A loadable subgraph with boundary contracts |
| Supervised | Explicitly unverified code region (tracked, not hidden) |
| Intent | Layer 3 declaration of desired property (runtime resolves HOW) |
