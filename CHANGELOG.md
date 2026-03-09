# AETHER Changelog

## Phase 1 — Complete (2026-03-08)

Four sessions building the full AETHER toolchain on top of the Phase 0 IR foundation.

### Session 1: AI Generation Framework
- **Generation prompt** (`prompts/generate-ir.md`) — structured prompt for LLMs to produce valid AETHER IR
- **`generate` CLI command** — validates AI-generated IR with actionable, per-node feedback
- **8 reference programs** covering all 9 pillars (up from 3):
  - `user-registration`, `payment-processing`, `product-recommendations`
  - `customer-support-agent`, `data-pipeline-etl`, `rate-limiter`
  - `multi-scope-order`, `content-moderation-agent`
- **Tests:** generation feedback quality, example coverage (55 new tests)

### Session 2: Incremental Builder & Compact Form
- **Partial graphs** — `AetherHole` type in schema + validator support for incomplete graphs
- **Incremental builder** (`src/compiler/incremental.ts`) — add/remove nodes one at a time with instant verification
- **Compact form** (`src/compiler/compact.ts`) — bidirectional `.aether` text format, 60-70% smaller than JSON, round-trip guaranteed
- **Enhanced expression parser** — chained comparisons, implication, string equality, `list.length` in Z3 verifier
- **CLI commands:** `incremental`, `compact`, `expand`
- **Tests:** compact round-trip (64 tests), parse errors, builder tests (80 new tests)

### Session 3: Execution Engine
- **Confidence engine** (`src/runtime/confidence.ts`) — propagation through DAG, oversight detection, critical path analysis
- **Effect tracker** (`src/runtime/effects.ts`) — enforcement with hierarchy (`parent` covers children, `read_write` covers `read`+`write`)
- **Graph executor** (`src/runtime/executor.ts`) — parallel wave scheduling via `Promise.all`, confidence-gated execution, contract checking, stub mode
- **Recovery strategies** — retry (exponential/linear backoff), fallback, escalate, respond, report
- **CLI command:** `execute`
- **Tests:** confidence, effects, executor (40 new tests)

### Session 4: Visualization & Integration
- **HTML graph visualization** (`src/visualizer/generate.ts`) — standalone SVG, no external dependencies
  - Nodes arranged by wave, color-coded: blue (pure), orange (effectful), yellow (supervised), gray (hole)
  - Confidence badges (green/yellow/red), effect pills, edge arrows with markers
  - Execution overlay: wave labels, per-node timing, skipped-node styling, summary panel
  - Legend with color key, confidence scale, graph metadata
- **CLI command:** `visualize` with `--execute`, `--output`, `--open` flags
- **Updated `report` command** — full 5-stage pipeline: validate, type check, verify, execute, visualize
  - Failure cascading: if any stage fails, subsequent stages show "skipped"
- **Tests:** visualizer (11 tests), full pipeline integration (6 tests)

### Totals
- **251 tests** across 16 test files
- **11 CLI commands:** validate, check, verify, transpile, generate, incremental, compact, expand, execute, visualize, report
- **29 files changed**, ~6800 lines added

---

## Phase 0 — Complete (2025-12-28)

Foundation: IR schema, validator, type checker, Z3 contract verifier, JS transpiler, CLI.

- `src/ir/schema.json` — JSON Schema draft-07 for AetherGraph
- `src/ir/validator.ts` — 7-rule validator (schema, DAG, edge refs, port direction, confidence, recovery, supervised)
- `src/compiler/checker.ts` — semantic type checker (domain, unit, dimension, sensitivity, format, range, constraint)
- `src/compiler/verifier.ts` — Z3 SMT contract verifier with graceful degradation
- `src/compiler/transpiler.ts` — IR to JavaScript transpiler (parallel waves, confidence, recovery)
- `src/cli.ts` — unified CLI (validate, check, verify, transpile, report)
- 3 reference examples, 5 formal spec files
- **53 tests** across 4 test files
