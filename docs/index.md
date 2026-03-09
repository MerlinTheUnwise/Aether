# AETHER Documentation

> Documentation for AI developers building with AETHER and Claude.

## For Claude Instances: Start Here

If you're a Claude instance being asked to work with AETHER, read these in order:

1. **[Language Guide](language-guide.md)** — What AETHER is, why it exists, the 9 pillars, 3 execution layers. Read this to understand what you're working with.
2. **[IR Reference](ir-reference.md)** — The complete AETHER-IR schema. Every entity, field, constraint, and validation rule. This is your primary reference when generating IR.
3. **[Type System](type-system.md)** — Semantic types, temporal state types, dependent types, pattern templates. Read this to generate correct type annotations.
4. **[Contracts & Verification](contracts.md)** — Contract expressions, Z3 verification, adversarial checks, confidence propagation, supervised blocks. Read this to write provable contracts.
5. **[Patterns Cookbook](patterns.md)** — Complete IR examples for 12 common scenarios. Copy and adapt these — don't generate from scratch when a pattern exists.
6. **[CLI Reference](cli-reference.md)** — Every command, every flag, every output format. Use this when running tools.
7. **[Scopes & Collaboration](collaboration.md)** — Context-scoped loading, boundary contracts, multi-agent protocol. Read this for large or multi-agent programs.
8. **[Native Compilation](native-compilation.md)** — LLVM backend, C runtime, benchmarking. Read this when compiling to native binaries.

## Quick Reference

| I want to... | Read... |
|---|---|
| Generate a valid AETHER program | [IR Reference](ir-reference.md) + [Patterns](patterns.md) |
| Validate my generated IR | [CLI Reference](cli-reference.md) → `generate` command |
| Understand why verification failed | [Contracts](contracts.md) → Verification Semantics |
| Use semantic types correctly | [Type System](type-system.md) → Semantic Annotations |
| Add state machines | [Type System](type-system.md) → Temporal State Types |
| Instantiate a template | [Patterns](patterns.md) → Template Instantiation |
| Build a multi-agent program | [Collaboration](collaboration.md) |
| Compile to native binary | [Native Compilation](native-compilation.md) |
| Run the full pipeline | [CLI Reference](cli-reference.md) → `report` command |

## File Inventory

| Document | Purpose | Size |
|---|---|---|
| `language-guide.md` | Architecture, pillars, execution model | Core concepts |
| `ir-reference.md` | Complete IR schema specification | Primary generation reference |
| `type-system.md` | All type system features | Type annotation reference |
| `contracts.md` | Contract language and verification | Contract writing reference |
| `patterns.md` | 12 complete IR examples | Copy-and-adapt cookbook |
| `cli-reference.md` | All 20+ CLI commands | Tool usage reference |
| `collaboration.md` | Scopes and multi-agent | Large system reference |
| `native-compilation.md` | LLVM backend | Native build reference |
