# AETHER CLI Reference

> Every command, every flag, every output format.
> All commands: `npx tsx src/cli.ts <command> [args] [flags]`
>
> All `<path>` arguments accept both `.aether` and `.json` files. The `.aether` format is the recommended primary format.

## Pipeline Commands

### `validate <path>`
Run IR validator on a graph.

```
npx tsx src/cli.ts validate src/ir/examples/user-registration.aether
```

Output: `✓ Valid AETHER graph: user-registration (3 nodes, 3 edges)` or list of errors.

### `check <path>`
Run semantic type checker on all edges.

```
npx tsx src/cli.ts check src/ir/examples/user-registration.aether
```

Output: compatibility report with errors (DIMENSION_MISMATCH, DOMAIN_MISMATCH, SENSITIVITY_VIOLATION, BASE_TYPE_MISMATCH) and warnings (UNIT_MISMATCH, CONSTRAINT_WARNING).

### `verify <path>`
Run Z3 contract verifier.

```
npx tsx src/cli.ts verify src/ir/examples/user-registration.aether
```

Output: per-node verification results (verified/failed/unsupported) with overall percentage.

### `parse <path>`
Parse a `.aether` file, report syntax errors, and display a summary.

```
npx tsx src/cli.ts parse src/ir/examples/user-registration.aether
```

Output: `✓ Valid AETHER program: user_registration (3 nodes, 3 edges)` or detailed parse errors with line/column locations and suggestions.

### `generate <path>`
Validate freshly-generated IR with detailed, actionable feedback.

```
npx tsx src/cli.ts generate my-graph.aether
```

Runs 5-step gauntlet: parse → schema validation → structural validation → type checking → contract verification. Outputs `STATUS: ACCEPTED` or `STATUS: REJECTED` with specific fix instructions for every error.

### `resolve <path>`
Resolve intent nodes to certified algorithms.

```
npx tsx src/cli.ts resolve src/ir/examples/intent-data-pipeline.aether
```

Output: which intents resolved, which algorithm was chosen, and why unresolved intents couldn't be matched.

### `report <path>`
Run the full pipeline and produce a summary dashboard.

```
npx tsx src/cli.ts report src/ir/examples/payment-processing.aether
```

Runs: validate → check → verify → resolve → execute (stub) → visualize. Includes optimization suggestion count, proof readiness, and native compilation info.

## Transformation Commands

### `transpile <path> [--output <dir>]`
Generate JavaScript from an AETHER graph.

```
npx tsx src/cli.ts transpile src/ir/examples/user-registration.aether
```

Output: `{graph_id}.generated.js` with async functions, confidence propagation, and recovery wrappers.

### `format <path> [--output <path>]`
Convert between `.aether` and `.json` formats. The direction is inferred from the input file extension.

```
# .aether → .json
npx tsx src/cli.ts format src/ir/examples/user-registration.aether

# .json → .aether
npx tsx src/cli.ts format src/ir/examples/user-registration.json

# With explicit output path
npx tsx src/cli.ts format my-graph.json --output my-graph.aether
```

### `init <name>`
Generate a skeleton `.aether` file with a starter node and edge structure.

```
npx tsx src/cli.ts init my-pipeline.aether
```

Output: creates `my-pipeline.aether` with a minimal graph template ready to edit.

### `compact <path> [--output <path.aether>]`
Convert IR JSON to compact form (~60% fewer tokens).

```
npx tsx src/cli.ts compact src/ir/examples/user-registration.json
```

### `expand <path.aether> [--output <path.json>]`
Parse compact form back to IR JSON.

```
npx tsx src/cli.ts expand user-registration.aether
```

Round-trip guarantee: `expand(compact(graph))` validates identically to the original.

### `instantiate <template-path> --bindings <json>`
Instantiate a template with bindings.

```
npx tsx src/cli.ts instantiate src/stdlib/patterns/crud-entity.template.json \
  --bindings '{"Entity":"User","IdType":"UserID","storage_effect":"database.write"}'
```

## Execution Commands

### `execute <path> [flags]`
Execute a graph via the runtime.

```
npx tsx src/cli.ts execute src/ir/examples/user-registration.aether
npx tsx src/cli.ts execute src/ir/examples/user-registration.aether --jit
npx tsx src/cli.ts execute src/ir/examples/user-registration.aether --profile
npx tsx src/cli.ts execute src/ir/examples/user-registration.aether --inputs inputs.json
```

| Flag | Effect |
|---|---|
| `--jit` | Enable compiled optimization (compiles hot subgraphs to optimized JavaScript) |
| `--profile` | Enable profiling |
| `--inputs <path>` | Provide initial input values (JSON) |
| `--real` | Enable real execution mode (resolve implementations, enforce contracts) |
| `--seed <path>` | Seed database with initial data (JSON: `{ table: [records] }`) |
| `--contracts <mode>` | Contract enforcement: `enforce` (default with --real), `warn`, `skip` |
| `--inject-failures <json>` | Inject service failures for testing recovery |

Output: wave-by-wave execution log with confidence propagation and effect tracking. In `--real` mode, also shows node outputs and contract satisfaction report.

### `jit <path> [flags]`
Profile, compile hot subgraphs to optimized JavaScript, and benchmark.

```
npx tsx src/cli.ts jit src/ir/examples/user-registration.aether --runs 20
npx tsx src/cli.ts jit src/ir/examples/user-registration.aether --optimize --runs 20
```

| Flag | Effect |
|---|---|
| `--runs <N>` | Number of executions (default: 20) |
| `--threshold <T>` | Min executions before compiling (default: 10) |
| `--optimize` | Run static optimizer before compilation |

Output: hot path recommendations, compilation summary, before/after performance comparison.

### `profile <path> [--runs <N>]`
Profile without compilation.

```
npx tsx src/cli.ts profile src/ir/examples/user-registration.aether --runs 20
```

### `benchmark <path> [flags]`
Compare interpreted vs compiled vs native performance.

```
npx tsx src/cli.ts benchmark src/ir/examples/user-registration.aether --runs 50 --native
```

| Flag | Effect |
|---|---|
| `--runs <N>` | Executions per mode (default: 50) |
| `--native` | Include native compilation benchmark |

## Visualization Commands

### `visualize <path> [flags]`
Generate HTML graph visualization.

```
npx tsx src/cli.ts visualize src/ir/examples/user-registration.aether --open
npx tsx src/cli.ts visualize src/ir/examples/user-registration.aether --execute --open
```

| Flag | Effect |
|---|---|
| `--output <path.html>` | Output file path |
| `--open` | Open in default browser |
| `--execute` | Include execution overlay (run stub mode first) |

### `dashboard <path> [flags]`
Generate comprehensive verification dashboard.

```
npx tsx src/cli.ts dashboard src/ir/examples/payment-processing.aether --execute --optimize --open
```

| Flag | Effect |
|---|---|
| `--output <path.html>` | Output file path |
| `--open` | Open in browser |
| `--execute` | Include execution data |
| `--optimize` | Include optimization suggestions |
| `--proofs` | Include proof readiness |

### `dashboard-diff <path1> <path2> [--output <path.html>] [--open]`
Compare verification status between two graph versions.

## Analysis Commands

### `optimize <path> [flags]`
Analyze graph and suggest optimizations.

```
npx tsx src/cli.ts optimize src/ir/examples/payment-processing.aether
npx tsx src/cli.ts optimize src/ir/examples/payment-processing.aether --apply
npx tsx src/cli.ts optimize src/ir/examples/payment-processing.aether --profile profile.json
```

| Flag | Effect |
|---|---|
| `--apply` | Auto-apply safe suggestions, save to `{name}_optimized.json` |
| `--profile <json>` | Use profiling data for timing estimates |

### `diff <path1> <path2>`
Semantic diff between two graph versions.

```
npx tsx src/cli.ts diff intent-data-pipeline.json intent-data-pipeline-v2.json
```

Output: change list with breaking change warnings and affected nodes.

### `export-proofs <path> [--output <path.lean>]`
Generate Lean 4 proof skeletons. Most non-trivial contracts produce `sorry` placeholders requiring manual completion.

```
npx tsx src/cli.ts export-proofs src/ir/examples/user-registration.aether
```

## Scope & Collaboration Commands

### `scope <path> <scope-id>`
Extract and validate a single scope.

```
npx tsx src/cli.ts scope src/ir/examples/multi-scope-order.aether order
```

### `scope-check <path>`
Validate all scopes and boundary compatibility.

```
npx tsx src/cli.ts scope-check src/ir/examples/multi-scope-order.aether
```

### `collaborate <path>`
Simulate multi-agent collaboration.

```
npx tsx src/cli.ts collaborate src/ir/examples/multi-agent-marketplace.aether
```

### `incremental`
Start interactive incremental builder REPL.

```
npx tsx src/cli.ts incremental
```

Subcommands within REPL: `add-node`, `add-hole`, `fill-hole`, `add-edge`, `remove-node`, `status`, `finalize`.

## Native Compilation Commands

### `compile <path> [flags]`
Compile AETHER graph to native binary via LLVM.

```
npx tsx src/cli.ts compile src/ir/examples/user-registration.aether --verbose
npx tsx src/cli.ts compile src/ir/examples/user-registration.aether --target llvm-ir
npx tsx src/cli.ts compile src/ir/examples/user-registration.aether --stubs --harness
```

| Flag | Effect |
|---|---|
| `--target <type>` | `binary` (default), `object`, `llvm-ir`, `assembly` |
| `--output <dir>` | Output directory |
| `--name <n>` | Output filename |
| `--opt <level>` | Optimization: 0, 1, 2 (default), 3 |
| `--no-parallel` | Disable parallel wave execution |
| `--contracts <mode>` | `abort` (default), `log`, `count` |
| `--stubs` | Generate C stub implementations |
| `--harness` | Generate test harness (implies --stubs) |
| `--verbose` | Print each compilation stage |

### `build-runtime [flags]`
Build the native C runtime library.

```
npx tsx src/cli.ts build-runtime
npx tsx src/cli.ts build-runtime --compiler gcc
```

### `toolchain`
Check LLVM installation status.

```
npx tsx src/cli.ts toolchain
```

## Registry Commands

### `registry init`
Initialize local package registry.

### `registry list`
List all packages in the registry.

### `registry info <name>`
Show package details, versions, verification status.

### `registry check <name> <from-version> <to-version>`
Check version compatibility using semantic diff.

### `publish <path> [--name <n>] [--version <v>]`
Publish a graph as a registry package.

### `install <name> [--version <v>]`
Install a package to `./aether_packages/`.

### `search <query>`
Search packages by keyword.

## Interactive Tools

### `editor [path] [--output <p>] [--open]`
Open interactive visual graph editor in browser.

```
npx tsx src/cli.ts editor src/ir/examples/user-registration.aether --open
npx tsx src/cli.ts editor --open  # empty editor
```

| Flag | Effect |
|---|---|
| `--output <path>` | Output file path (default: `<id>-editor.html`) |
| `--open` | Open in default browser |

### `demo [--output <p>] [--open]`
Generate interactive demo application — describe pipelines in natural language, generate AETHER-IR via Anthropic API, validate, visualize, verify, and simulate execution in-browser.

```
npx tsx src/cli.ts demo --open
npx tsx src/cli.ts demo --output my-demo.html
```

| Flag | Effect |
|---|---|
| `--output <path>` | Output file path (default: `aether-demo.html`) |
| `--open` | Open in default browser |

Includes 4 pre-built examples (user registration, payment processing, content moderation, ETL pipeline) and LLM generation with auto-fix loop (up to 3 attempts).

## AI Generation Commands

### `ai <description> [flags]`
Generate an AETHER program from a natural language description using an LLM.

```
npx tsx src/cli.ts ai "Build a user signup flow with email validation" --format aether
npx tsx src/cli.ts ai "Payment processing pipeline with retry" --format json
```

| Flag | Effect |
|---|---|
| `--format <fmt>` | Output format: `aether` (default) or `json` |

Output: generates a complete, validated program and writes it to disk. Default format is `.aether`.

## General

### `help`
Show command list and usage.
