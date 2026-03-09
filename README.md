# AETHER

> *In the beginning, man made machine around current language standards, now we create the language for the machine.*

**Programs are graphs, not text.**

AETHER is an AI-native programming language where programs are directed acyclic graphs (DAGs) with formal contracts, confidence tracking, and parallel-by-default execution. Every node declares its types, effects, preconditions, postconditions, and recovery strategies — making programs verifiable, auditable, and safe for AI-generated logic.

## Why AETHER?

Traditional languages let you write anything and hope tests catch bugs. AETHER inverts this: programs must declare *what they promise* (contracts), *how confident they are* (confidence scores), *what side effects they cause* (effect tags), and *what happens when things fail* (recovery blocks). An SMT solver (Z3) formally verifies these properties before code ever runs.

## Phase 0 — Foundation (Complete)

Phase 0 builds the core toolchain that proves the language design works:

| Component | File | Purpose |
|-----------|------|---------|
| IR Schema | `src/ir/schema.json` | JSON Schema defining AetherGraph structure |
| Validator | `src/ir/validator.ts` | Structural validation (DAG check, port wiring, confidence rules) |
| Type Checker | `src/compiler/checker.ts` | Semantic compatibility (dimension, unit, domain, sensitivity) |
| Contract Verifier | `src/compiler/verifier.ts` | Z3 SMT verification of pre/postconditions and adversarial checks |
| Transpiler | `src/compiler/transpiler.ts` | IR to JavaScript with parallel waves, confidence propagation, recovery |
| CLI | `src/cli.ts` | Unified interface for all tools |
| Specs | `spec/` | Formal specifications for types, contracts, effects, confidence, recovery |

### Six Pillars

1. **Graph-Native** — Programs are DAGs, not text files
2. **Contracts Everywhere** — Pre/post/invariants on every node, verified by Z3
3. **Confidence Tracking** — Every node declares confidence; below 0.85 requires adversarial checks
4. **Effect System** — Side effects are declared, tracked, and require recovery handlers
5. **Recovery by Design** — No unhandled exceptions; every failure mode has a declared strategy
6. **Parallel by Default** — Independent nodes execute concurrently via `Promise.all`

## Quick Start

```bash
npm install
npm run typecheck    # Zero errors
npm test             # 53 tests passing
```

### CLI Commands

```bash
# Run with tsx (recommended) or ts-node for single-file tools
npx tsx src/cli.ts validate src/ir/examples/user-registration.json
npx tsx src/cli.ts check src/ir/examples/user-registration.json
npx tsx src/cli.ts verify src/ir/examples/user-registration.json
npx tsx src/cli.ts transpile src/ir/examples/user-registration.json
npx tsx src/cli.ts report src/ir/examples/user-registration.json
```

The `report` command runs the full pipeline and produces a dashboard:

```
═══════════════════════════════════════
AETHER Report: user_registration (v1)
═══════════════════════════════════════
Schema:       ✓ valid
DAG:          ✓ acyclic (3 nodes, 3 edges)
Types:        ✓ 3/3 edges compatible
Verification: 0/1 nodes verified (0%)
              2/3 unsupported expressions
Transpiled:   ✓ user_registration.generated.js
═══════════════════════════════════════
```

## Reference Programs

Three example programs demonstrate the language features:

- **`user-registration.json`** — Email validation → uniqueness check → user creation. Shows dependent types (`constraint: "== true"`), PII sensitivity tracking, and recovery (retry, fallback, escalate).

- **`product-recommendations.json`** — Auth → purchase history → ML recommendations. Shows adversarial checks (no duplicate recommendations), confidence degradation (0.85), and SLA declarations.

- **`customer-support-agent.json`** — Intent classification → guarded execution. Shows low confidence (0.75) with mandatory adversarial checks, authority-level safety rails, and human oversight gates.

## Project Structure

```
src/
  ir/
    schema.json              # JSON Schema for AetherGraph
    validator.ts             # Structural validator
    examples/                # Reference programs
  compiler/
    checker.ts               # Semantic type checker
    verifier.ts              # Z3 contract verifier
    transpiler.ts            # IR → JavaScript transpiler
  cli.ts                     # Unified CLI
spec/
  type-system.md             # Type system specification
  contracts.md               # Contract specification
  effects.md                 # Effect system specification
  confidence.md              # Confidence propagation specification
  recovery.md                # Recovery strategy specification
tests/
  reference/                 # Validation + type check + transpile tests
  adversarial/               # Z3 verification tests
  transpiler/                # Transpiler unit tests
  integration/               # Full pipeline tests
```

## Roadmap

- **Phase 0** — IR, validator, type checker, verifier, transpiler, CLI, specs *(complete)*
- **Phase 1** — Graph execution engine, temporal state types, visualization IDE
- **Phase 2** — Pattern templates, certified stdlib, multi-graph composition
