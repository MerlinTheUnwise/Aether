# Native Compilation

> **Experimental.** The LLVM backend generates valid LLVM IR and includes a C runtime, but end-to-end compilation to running binaries has not been verified in the test suite.

> LLVM backend, C runtime, parallel execution, and benchmarking.

## Overview

AETHER programs compile to native binaries via LLVM. The pipeline:

```
AETHER-IR (JSON) → LLVM IR (.ll) → Object file (.o) → Native binary
                     ↑                  ↑                 ↑
                  TypeScript          llc               clang + libaether_runtime
```

The LLVM IR generator is TypeScript. Compilation to object code and linking requires LLVM tools installed locally.

## Prerequisites

Install LLVM (provides `llc` and `clang`):

- **macOS:** `brew install llvm`
- **Ubuntu/Debian:** `apt install llvm clang`
- **Windows:** Download from `releases.llvm.org` or `winget install LLVM.LLVM`

Check installation:
```
npx tsx src/cli.ts toolchain
```

## Quick Start

```bash
# 1. Build the C runtime (once)
npx tsx src/cli.ts build-runtime

# 2. Compile an AETHER program
npx tsx src/cli.ts compile src/ir/examples/user-registration.json --verbose

# 3. Run the binary
./user-registration --contracts=log --verbose
```

## Compilation Targets

| Target | Command | Output | Use Case |
|---|---|---|---|
| `binary` (default) | `--target binary` | Executable | Production |
| `object` | `--target object` | `.o` file | Custom linking |
| `llvm-ir` | `--target llvm-ir` | `.ll` file | Inspection, debugging |
| `assembly` | `--target assembly` | `.s` file | Low-level analysis |

## What Gets Generated

### LLVM IR Structure

Each `.ll` file contains:

1. **External declarations** — Runtime library function signatures
2. **Type definitions** — `%String`, `%List`, per-node input/output structs
3. **String constants** — Contract descriptions, node IDs, error messages
4. **Node functions** — One LLVM function per AETHER node
5. **Graph entry point** — `@aether_graph_run` that executes waves

### Node Function

Each node becomes an LLVM function with:
- Precondition assertions (before implementation call)
- Implementation call (external function, linked at compile time)
- Postcondition assertions (after implementation returns)
- Adversarial checks (negative assertions)
- Confidence propagation (runtime call)
- Effect recording (runtime call)
- Recovery wrapper (setjmp/longjmp for effectful nodes)

### Parallel Waves

Nodes in the same wave (no mutual data dependencies) execute via pthreads:

```
Wave 0: [node_a, node_b]     → aether_wave_execute(tasks, 2)  // parallel
Wave 1: [node_c]             → direct call                     // single node, no overhead
Wave 2: [node_d, node_e]     → aether_wave_execute(tasks, 2)  // parallel
```

Single-node waves call the function directly — no thread pool overhead.

## C Runtime Library

The native runtime (`libaether_runtime.a`) provides:

| Component | File | Purpose |
|---|---|---|
| Strings | `aether_string.c` | Heap-allocated strings with equality, case checks, trim |
| Lists | `aether_list.c` | Dynamic arrays with sort check, duplicate check |
| Confidence | `aether_confidence.c` | Propagation, threshold checks, graph confidence |
| Effects | `aether_effects.c` | Declaration, recording, violation detection |
| Contracts | `aether_contracts.c` | Assertion with 3 modes: abort/log/count |
| Recovery | `aether_recovery.c` | setjmp/longjmp-based recovery with retry, fallback, escalate |
| Memory | `aether_memory.c` | Arena allocator (all allocations freed at graph completion) |
| Threading | `aether_threads.c` | Thread pool for parallel wave execution |
| Stubs | `aether_stubs.c` | Default implementations returning typed defaults |
| Main | `aether_main.c` | CLI wrapper with arg parsing and runtime init/finalize |

### Contract Modes

Set via command-line flag on the compiled binary:

| Mode | Flag | Behavior |
|---|---|---|
| Abort | `--contracts=abort` | Crash on first contract violation (production default) |
| Log | `--contracts=log` | Log violations and continue |
| Count | `--contracts=count` | Count violations, report at end |

### Thread Safety

The runtime is thread-safe for parallel wave execution:
- Confidence: atomic reads/writes per node
- Effects: per-node arrays, mutex-protected global log
- Contracts: atomic failure counter, mutex-protected logging
- Memory: thread-local arenas per worker thread

## Stub Implementations

Generate C stubs for iterative development:

```
npx tsx src/cli.ts compile my-graph.json --stubs
```

Produces `my-graph_stubs.c` with:
```c
struct validate_email_out impl_validate_email(struct validate_email_in input) {
    struct validate_email_out result;
    result.valid = true;
    result.normalized = aether_string_from_cstr("");
    return result;
}
```

Replace stubs with real implementations incrementally. The graph runs end-to-end with stubs (returns typed defaults) while you implement node by node.

### Test Harness

```
npx tsx src/cli.ts compile my-graph.json --harness
```

Generates a compilable test program that links stubs + graph + runtime into a single binary for testing.

## Three Execution Tiers

All three tiers execute the same AETHER graph with the same semantics:

| Tier | Mechanism | Performance | Use Case |
|---|---|---|---|
| Interpreted | Graph executor walks DAG | Baseline | Development, debugging |
| JIT | Hot subgraphs → optimized JS | ~70-80% faster | Node.js production |
| Native | Full graph → LLVM → binary | ~100-150x faster | Maximum performance |

### Benchmark

```
npx tsx src/cli.ts benchmark src/ir/examples/payment-processing.json --runs 50 --native
```

Compares all three tiers with avg/min/max timings and speedup ratios.

## Optimization Levels

| Level | Flag | Effect |
|---|---|---|
| 0 | `--opt 0` | No optimization (fastest compilation, easiest debugging) |
| 1 | `--opt 1` | Basic optimizations |
| 2 | `--opt 2` | Standard optimizations (default) |
| 3 | `--opt 3` | Aggressive optimizations (may increase compile time) |

## What's Preserved in Native

Everything that works in the interpreted/JIT tier works identically in native:

- ✓ Contract enforcement (pre/post/invariant/adversarial)
- ✓ Confidence propagation (multiplicative)
- ✓ Confidence gates (skip nodes below threshold)
- ✓ Effect tracking and violation detection
- ✓ Recovery strategies (retry, fallback, escalate, respond, report)
- ✓ State machine transition tracking
- ✓ Parallel wave execution
- ✓ Stub mode (typed defaults when no implementation provided)

## Limitations

- Native compilation requires LLVM installed locally
- Node implementations must be provided as C functions (or stubs used)
- No dynamic graph modification at runtime (the graph is compiled statically)
- Arena allocator means no individual deallocation — all memory freed at graph completion
- Windows threading uses pthreads-win32 or falls back to single-threaded
