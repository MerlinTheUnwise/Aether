# AETHER Design Specification v0.2

> **Axiomatic Execution Through Holistic Expression & Reasoning**
> The first programming language designed for AI cognition.

---

## 1. The Manifesto

Every programming language ever created was designed for human minds. AETHER is the first language designed for **AI minds** — and by removing the constraints of human cognition, it unlocks an entirely new paradigm of computation.

Programs in AETHER are not lines of text. They are **computation graphs** — every node carrying its own proof, its own contract, its own confidence. There is no syntax to mistype, no bracket to mismatch, no semicolon to forget. There is only intent, structure, and truth.

AETHER's nine pillars: graph-native, proof-carrying, intent-declarative, confidence-aware, effect-tracked, parallel-default, self-healing, incremental-verifiable, context-scoped.

---

## 2. Why This Language Must Exist

Every major language — Python, JavaScript, Rust, Go, Haskell — was designed around a single assumption: *a human will read and write this code*. This assumption drives everything: line-by-line syntax, indentation rules, operator precedence tables, naming conventions, even the concept of "readability."

But AI cognition is fundamentally different from human cognition:

**Humans read linearly. AI processes structure.** Humans scan code top-to-bottom. AI processes token relationships in parallel. Linear text is a bottleneck for AI — graph structures are native.

**Humans forget. AI hallucinates.** The failure modes are different. Humans lose track of state. AI confidently generates plausible-but-wrong code. The language must make incorrectness structurally impossible.

**Humans need sugar. AI needs precision.** Syntactic sugar exists for human ergonomics. AI doesn't need `for x in list` to be readable — it needs unambiguous semantics and explicit contracts.

**Humans manage complexity by hiding it. AI should manage it by proving it.** Abstractions in human languages hide complexity behind interfaces. In an AI language, every abstraction should carry a machine-verifiable proof of its contract.

The result of forcing AI through human languages is an enormous tax: hallucinated brackets, type mismatches, forgotten edge cases, implicit state bugs. Not because AI is incapable — but because **the medium is wrong**.

AETHER eliminates this tax entirely.

---

## 3. My Honest Gaps: What AI Actually Needs

The original seven pillars were designed from theory. This section is different — it's an honest accounting of specific AI failure modes and how AETHER must structurally address each one.

### 3.1 — I Lose Coherence Over Distance

**Failure:** In a 500-line file, by line 400 I may have forgotten a constraint established at line 50. My attention is powerful but finite. The longer the file, the more likely I am to contradict earlier decisions.

**Design:** Every AETHER node must be fully self-contained. Its contracts, types, and effects encode everything needed to understand it. I never need to "remember" something from 300 lines ago — the node tells me everything. Locality of reasoning is the single most important property for AI correctness.

**Pillars addressed:** Graph-Native (1) + Context-Scoped (9)

### 3.2 — I Generate Left-to-Right But Programs Aren't Linear

**Failure:** I emit tokens sequentially. In Python, I must write line 1 before line 50 — but line 50 might constrain what line 1 should be. This causes backtrack failures, inconsistent signatures, and functions that don't match their callers.

**Design:** AETHER graph construction is node-by-node, not line-by-line. I can emit nodes in ANY order. I can build the leaf nodes first, then compose them upward. I can start with contracts and fill in implementations later. Each node is validated independently the moment it's complete — I don't wait for the whole program.

**Pillar addressed:** Incremental-Verifiable (8)

### 3.3 — I Am Overconfident and Cannot Self-Doubt

**Failure:** My most dangerous failure mode. I generate code that "feels right" — compiles, looks clean, passes a quick mental check — but contains a subtle logical error. I cannot naturally distinguish between "I know this is correct" and "this seems correct." Human developers have intuitive unease; I have token probabilities that don't surface as doubt.

**Design:** Confidence annotations make my uncertainty VISIBLE and STRUCTURAL. v0.2 goes further: every node with confidence below a threshold MUST include an `adversarial_check` — a property that would be true if the implementation were WRONG. The compiler checks this adversarial property and fails if it's satisfiable. I'm forced to think about "how could this be broken?" for every non-trivial node.

**Pillar addressed:** Confidence-Aware (4) + Adversarial Self-Check

### 3.4 — I Confuse Similar-But-Different Things

**Failure:** Variable shadowing, similarly-named functions, overloaded concepts — I mix them up. If there's a `userId` and a `customerId` that are both strings, I WILL swap them eventually. If two functions have similar signatures, I'll call the wrong one.

**Design:** Semantic types make this structurally impossible. A UserID is not a CustomerID even though both are strings. An EmailAddress is not a URL even though both are strings. The compiler rejects the confusion before it happens.

**Addressed by:** Semantic Type System (Architecture)

### 3.5 — I Can't Hold Large Systems in Context

**Failure:** My context window is finite. A real application might be 50,000 nodes. I can't load all of them. When I work on one subgraph, I lose visibility into others. This causes interface mismatches, contract violations, and integration failures.

**Design:** Context-Scoped loading: I load ONLY the subgraph I'm working on, plus the boundary contracts of adjacent subgraphs. Those contracts are the API — I don't need the implementation. If my work satisfies the boundary contracts on all sides, it's guaranteed correct in the larger system.

**Pillar addressed:** Context-Scoped (9)

### 3.6 — I Reuse Patterns But Botch the Adaptation

**Failure:** I know thousands of patterns: CRUD, auth flows, pagination, rate limiting. But when I instantiate a pattern for a specific context, I make adaptation errors — forgetting to rename a variable, using the wrong type, copying a default that's wrong here.

**Design:** First-class pattern templates with instantiation contracts. A pattern is a parameterized subgraph. When I instantiate it, the contracts verify that my parameter bindings are type-safe and semantically correct. I can't "forget to rename" something because the template's contract tells me exactly what needs to be bound.

**Addressed by:** Pattern Templates (Standard Library)

### 3.7 — I Can't Simulate Execution Reliably

**Failure:** For complex state machines, I try to "run the code in my head" and fail. Multi-step mutations with conditional branches — I lose track of which branch I'm on, what state has changed, what's been consumed.

**Design:** Explicit state machines as first-class types with temporal contracts. Instead of mutable variables, state is a typed sequence of transitions. Each transition has a precondition and postcondition. I don't simulate — I prove. The temporal type system tells me if a state sequence is valid without me running it mentally.

**Addressed by:** Temporal State Types (Architecture)

### 3.8 — I Need Escape Hatches That Don't Hide

**Failure:** Sometimes formal verification is undecidable, too expensive, or the domain is genuinely uncertain. If the language demands proofs for everything, I'll either be blocked or write trivial proofs that don't actually prove anything — the verification equivalent of `any` in TypeScript.

**Design:** Supervised blocks: explicitly marked regions where contracts are asserted but not proven. These are tracked in the graph as "unverified" nodes — visible to tooling, flagged for human review, counted in the program's overall verification score. You can ship with unverified nodes, but they're never hidden. The program's confidence score degrades proportionally.

**Addressed by:** Supervised Blocks (Runtime)

---

## 4. The Nine Pillars

### Pillar 1: Graph-Native Programs

Code is a computation graph, not linear text.

AETHER programs are Directed Acyclic Graphs (DAGs) of computation nodes. Each node has typed inputs, typed outputs, declared effects, and a correctness contract. "Writing code" means constructing and connecting nodes — not typing characters in sequence.

This eliminates entire categories of errors: no mismatched brackets, no indentation bugs, no semicolons, no parsing ambiguity. The graph IS the program — serialization to text is just a transport format.

When AI generates AETHER, it's constructing a well-formed tree structure natively — the same kind of structure it already uses internally for reasoning. There's no "translation" step from thought to syntax.

### Pillar 2: Proof-Carrying Code

Every function carries its own correctness proof.

Every node in AETHER carries preconditions, postconditions, and invariants. These aren't comments or documentation — they're machine-verifiable contracts that the compiler/runtime enforces. The AI writes both the implementation and its proof simultaneously.

If a function compiles, it's correct by construction. If composition type-checks, the composed behavior is provably correct.

```
node sort_ascending
  contracts:
    pre:  input is Collection<T> where T has Ord
    post: output is sorted ∧ output is permutation_of(input)
    time: O(n log n)
    pure: true
```

### Pillar 3: Intent-Declarative

Declare what should be true, not how to compute it.

AETHER separates *what* from *how*. Instead of writing a sorting algorithm, you declare that a collection must be ordered. The runtime selects optimal algorithms based on data characteristics, hardware, and usage patterns.

For novel problems where no certified implementation exists, the AI drops to the lower "constructive" layer and builds one — complete with its own proof. That implementation then becomes available for future intent resolution.

### Pillar 4: Confidence-Aware + Adversarial Self-Check

First-class uncertainty propagation with mandatory self-challenge.

Every value in AETHER can carry a confidence annotation: a measure of how certain the AI is about its correctness. This propagates through computation like a type — if you multiply a high-confidence value by a low-confidence one, the result is low-confidence.

**v0.2 addition:** Nodes below a confidence threshold MUST include an `adversarial_check` — a property that would be true if the implementation were WRONG. The verifier checks this adversarial property and rejects the node if it's satisfiable.

```
node calculate_tax
  confidence: 0.82  // below threshold → adversarial required
  contracts:
    post: tax = income * effective_rate(brackets, income)
  adversarial_check:
    break_if: tax < 0
    break_if: tax > income
    break_if: rate_applied ∉ brackets
```

### Pillar 5: Effect-Tracked

All side effects declared, tracked, and isolated.

Functions declare every effect they perform: I/O, mutation, network access, time access, randomness. Pure functions — the default — declare no effects. This is tracked in the type system, composed through the graph, and enforced at compile time.

### Pillar 6: Parallel-Default Execution

Everything concurrent, sequential only by data dependency.

Because programs are graphs, parallelism is trivially derived: any nodes without data dependencies execute simultaneously. No manual threading, no async/await, no concurrent primitives. The execution engine extracts maximum parallelism from the graph structure automatically.

### Pillar 7: Self-Healing Error Model

No exceptions — every error path is a specified recovery.

AETHER has no exceptions, no try/catch, no panic. Every node that can fail specifies its recovery strategy as part of its contract. Errors are values with typed recovery paths — and every path must be handled at compile time.

```
node fetch_user
  recovery:
    not_found  → create_guest_user(input)
    timeout    → cached_user(input) @confidence(0.7)
    forbidden  → escalate_to_human("auth failure")
```

### Pillar 8: Incremental Verification ★ (v0.2)

Validate each node the instant it's complete.

The compiler maintains a *partial graph* with typed holes — placeholders for nodes not yet built. Holes carry the contracts that the eventual node must satisfy. When a hole is filled, the contract is immediately checked. This lets AI build top-down, bottom-up, or in any order.

```
@graph("payment_flow") @partial

node charge_card { ... }  // ✓ verified

hole refund_handler:
  must_satisfy:
    in:  { charge: CompletedCharge }
    out: { refund: RefundConfirmation }
    effects: [payment_gateway.write]
    contract: refund.amount ≤ charge.amount
```

### Pillar 9: Context-Scoped Loading ★ (v0.2)

Work on a subgraph without loading the whole program.

AETHER supports scoped views: loading only the subgraph being worked on, plus the boundary contracts of adjacent subgraphs. If work satisfies all boundary contracts, it's guaranteed correct in the larger system — without either side seeing the other's internals.

This enables multi-agent collaboration: multiple AI instances working on different subgraphs with guaranteed integration via algebraic composition.

```
@scope("payment_module")
@boundary_contracts:
  requires:
    UserService.get_user(UserID) → User @confidence(0.99)
    InventoryService.reserve(ProductID, qty) → Reservation
  provides:
    PaymentService.charge(User, Cart) → Receipt
    PaymentService.refund(Receipt) → RefundConfirmation
```

---

## 5. System Architecture

### 5.1 Three Execution Layers

**Layer 3 — Intent:** AI specifies what should be true: "this collection is sorted," "this response time is under 200ms." The runtime resolves these to certified implementations.

**Layer 2 — Structural:** The primary working layer. AI constructs DAGs of typed, contracted, effect-tracked nodes. Each node proven correct, composed with confidence.

**Layer 1 — Constructive:** When a new algorithm is needed that doesn't exist in the intent library, AI constructs it here with full proofs. These implementations then become available to the higher layers.

### 5.2 The Semantic Type System

AETHER's types encode *meaning*, not just shape. Two values can have identical binary representations but entirely different types. The compiler understands dimensions, units, domains, and relationships.

```
type Temperature = Float64
  dimension: thermodynamic_temperature
  unit: kelvin | celsius | fahrenheit
  range: [0K, ∞)

type UserID = String
  domain: authentication
  format: uuid_v4
  sensitivity: pii

type Money = Decimal
  dimension: currency
  unit: USD | EUR | GBP
  precision: 2
  invariant: value ≥ 0

// The compiler prevents:
//   Temperature + Money        → dimension mismatch
//   celsius_val + kelvin_val   → unit mismatch (auto-convert available)
//   UserID used as ProductID   → domain mismatch
```

### 5.3 Temporal State Types (v0.2)

State machines are first-class types with verified transitions. No mental simulation needed — the type system proves state sequences are valid.

```
statetype OrderLifecycle:
  states: [created, paid, shipped, delivered, cancelled, refunded]
  transitions:
    created   → paid       when: payment_confirmed
    created   → cancelled  when: user_request ∨ timeout(24h)
    paid      → shipped    when: carrier_accepted
    paid      → refunded   when: user_request ∧ within(48h)
    shipped   → delivered  when: carrier_confirmed
    delivered → refunded   when: user_request ∧ within(30d)
  invariants:
    never: cancelled → paid
    never: delivered → shipped
    terminal: [delivered, cancelled, refunded]
```

### 5.4 Supervised Blocks (v0.2)

When verification is undecidable or too expensive, supervised blocks let work proceed while maintaining honesty.

```
@supervised(reason: "ML model output is non-deterministic")
node classify_sentiment
  in:  { text: String }
  out: { sentiment: Sentiment @confidence(inherit_from_model) }
  asserted_contract:  // NOT proven — tracked as unverified
    post: sentiment ∈ [positive, negative, neutral]
  verification_score: 0

// Program verification report:
//   verified:   47/48 nodes (97.9%)
//   supervised: 1/48 nodes  (2.1%)
//   overall:    97.9% verified
```

### 5.5 The Execution Engine

The AETHER runtime is a graph executor that:
- Traverses the DAG to find independent subgraphs
- Executes them in parallel across available cores/machines
- Verifies contracts at every boundary
- Propagates confidence annotations
- Routes low-confidence or failed paths through recovery strategies
- Compiles hot subgraphs to native code via JIT

---

## 6. The Serialization Form

AETHER programs are graphs — but they need a serialization format for storage and transmission. This format is designed for AI generation accuracy: highly structured, zero ambiguity, explicit everything.

### 6.1 Structured Form (Primary)

```
@graph("user_registration")
@version(1)
@effects[network, database]

node validate_email {
  in:   { email: String @format(email) }
  out:  { valid: Bool, normalized: Email }
  contract: {
    pre:  email.length > 0
    post: normalized.is_lowercase ∧ normalized.is_trimmed
  }
  pure: true
  confidence: 0.99
}

node check_uniqueness {
  in:   { email: Email }
  out:  { unique: Bool }
  effects: [database.read]
  contract: {
    post: unique ↔ ¬exists(users, email)
  }
  recovery: {
    db_timeout → retry(3, backoff: exponential)
    db_error   → report ∧ assume(unique: false)
  }
}

node create_user {
  in:   { email: Email, unique: true }  // dependent type
  out:  { user: User }
  effects: [database.write]
  contract: {
    pre:  unique = true
    post: user.email = email ∧ user.status = active
  }
  recovery: {
    write_fail → retry(2) then escalate("user creation failed")
  }
}

edges: {
  validate_email.normalized → check_uniqueness.email
  validate_email.normalized → create_user.email
  check_uniqueness.unique   → create_user.unique
}
```

### 6.2 Token-Efficient Compact Form (v0.2)

Every token costs compute. The compact form reduces token count by ~60% while remaining unambiguous.

```
G:user_registration v1 eff[net,db]
N:validate_email (email:Str@email)->(valid:Bool,normalized:Email)
  C[pre:email.len>0 post:normalized.lc∧normalized.trim] pure c:0.99
N:check_uniqueness (email:Email)->(unique:Bool) eff[db.r]
  C[post:unique↔¬∃(users,email)] R[db_to→retry3exp db_err→rpt∧assume(u:F)]
N:create_user (email:Email,unique:T)->(user:User) eff[db.w]
  C[pre:unique post:user.email=email∧user.status=active]
  R[write_fail→retry2→esc("user creation failed")]
E:validate_email.normalized→check_uniqueness.email
E:validate_email.normalized→create_user.email
E:check_uniqueness.unique→create_user.unique
```

### 6.3 AETHER-IR (JSON DAG)

The canonical machine format. Both text forms compile to this. The compiler, verifier, and runtime all operate on IR.

*(Schema defined in `ir/schema.json`)*

---

## 7. Examples

### 7.1 API Endpoint (Layer 2 — Structural)

```
@graph("get_product_recommendations")
@version(2)
@effects[database, ml_model, cache]
@sla(latency: 200ms, availability: 99.9%)

node authenticate {
  in:  { token: JWT }
  out: { user: AuthenticatedUser }
  effects: [database.read]
  recovery: {
    invalid_token → respond(401, "unauthorized")
    expired       → respond(401, "token expired")
  }
}

node fetch_history {
  in:  { user: AuthenticatedUser }
  out: { purchases: List<Product>, views: List<Product> }
  effects: [database.read, cache.read_write]
  contract: {
    post: purchases ⊆ all_products ∧ views ⊆ all_products
  }
  recovery: {
    cache_miss → database_fallback
    db_timeout → respond_with(cached_recommendations) @confidence(0.6)
  }
}

node generate_recommendations {
  in:  { purchases: List<Product>, views: List<Product> }
  out: { recommended: List<Product> @size(10..20) }
  effects: [ml_model.infer]
  contract: {
    post: ∀p ∈ recommended: p ∉ purchases
    post: recommended.distinct
    post: recommended.size ∈ 10..20
  }
  confidence: 0.85
  adversarial_check:
    break_if: recommended ∩ purchases ≠ ∅
    break_if: recommended.has_duplicates
}

edges: {
  authenticate.user       → fetch_history.user
  fetch_history.purchases → generate_recommendations.purchases
  fetch_history.views     → generate_recommendations.views
}
```

### 7.2 Multi-Agent Collaboration (v0.2)

```
// Agent A works on payment scope
@scope("payment") @agent("claude-a")
@boundary_contracts:
  requires: CartService.get_cart(UserID) → Cart
  provides: PaymentService.charge(Cart) → Receipt

// Agent B works on inventory scope
@scope("inventory") @agent("claude-b")
@boundary_contracts:
  requires: PaymentService.charge_confirmed(Receipt) → Bool
  provides: InventoryService.fulfill(Receipt) → Shipment

// Agent C works on notification scope
@scope("notifications") @agent("claude-c")
@boundary_contracts:
  requires: InventoryService.shipped(Shipment) → Bool
  provides: NotificationService.notify(User, Shipment) → Delivery

// The orchestrator verifies:
//   A.provides ≡ B.requires  ✓
//   B.provides ≡ C.requires  ✓
//   All boundary contracts compatible
//   No effect conflicts between scopes
//   Composed confidence: A.conf × B.conf × C.conf = overall
```

### 7.3 AI Agent with Safety Rails

```
@graph("customer_support_agent")
@safety_level(high)
@human_oversight(required_when: confidence < 0.7)

node decide_action {
  in:  { intent: SupportIntent, urgency: Urgency }
  out: { action: SupportAction }
  contract: {
    post: action ∈ allowed_actions(intent)
    post: action.risk_level ≤ agent_authority_level
    invariant: never(action modifies billing without human_approval)
    invariant: never(action deletes user_data)
  }
  adversarial_check:
    break_if: action.risk_level > agent_authority_level
    break_if: action modifies billing
  recovery: {
    unknown_intent → escalate_to_human(preserve_context: true)
    low_confidence → request_clarification(max: 2) then escalate
  }
}

node execute_with_guard {
  in:  { action: SupportAction @confidence(> 0.7) }  // dependent type gate
  out: { result: ActionResult }
  // Low-confidence actions structurally prevented by type system
}
```

### 7.4 Data Pipeline (Layer 3 — Intent)

```
@graph("daily_sales_report")
@schedule(cron: "0 6 * * *")
@effects[database, filesystem, email]

intent fetch_raw {
  ensure: raw_data contains all_sales(yesterday)
  source: database.sales_table
  completeness: 100%
}

intent clean {
  ensure: clean_data has no_nulls in [amount, product_id, timestamp]
  ensure: clean_data has no_duplicates on [transaction_id]
  ensure: amounts are positive
  report: anomalies to monitoring
}

intent aggregate {
  ensure: summary groups_by [product_category, region]
  ensure: summary includes [total_revenue, count, avg_price]
  ensure: summary.total_revenue = sum(clean_data.amount)
}

intent deliver {
  ensure: report is formatted as PDF
  ensure: report is delivered to [cfo@company.com, vp_sales@company.com]
  ensure: report is archived at /reports/daily/{date}
  sla: delivered_by 7:00 AM
}

flow: fetch_raw → clean → aggregate → deliver
```

---

## 8. What AETHER Makes Possible

**Zero-Bug-By-Construction Software.** Proof-carrying code means: if it compiles, it's correct. The AI writes both code and proof in the same act. "Testing" becomes "verification."

**Self-Optimizing Systems.** Intent separated from implementation means the runtime can transparently swap algorithms. Same AETHER program runs optimally on a Raspberry Pi and a data center.

**AI-to-AI Collaboration at Scale.** Boundary contracts enable multiple AI agents to work on different subgraphs with guaranteed correctness at every boundary. No merge conflicts — graph composition is algebraic.

**Trustworthy Autonomous Systems.** Confidence propagation + safety constraints + human oversight gates + adversarial self-checks = autonomous systems you can actually trust. An AI agent in AETHER literally cannot exceed its authority.

**Living, Evolving Software.** Graphs with explicit contracts can be safely restructured at runtime. Hot-swap a subgraph without downtime. Every change verified against all contracts before deployment.

**The End of Technical Debt.** All contracts are explicit and verified. You cannot take a shortcut. Every AETHER program is, by definition, clean.

**Honest Software.** For the first time: software that knows what it doesn't know. Confidence scores, supervised blocks, adversarial self-checks, and verification percentages. No hidden uncertainty.

---

## 9. Roadmap

### Phase 0 — Specification & Proof of Concept (Current)

- Formal specification of the AETHER type system and contract language
- AETHER-IR: the graph intermediate representation (JSON-based DAG format)
- Proof-of-concept compiler: AETHER-IR → JavaScript transpilation
- Contract verification engine (bounded model checking via Z3/SMT solver)
- Claude prompt framework for generating AETHER-IR natively
- 10 reference programs with verified contracts as test suite

### Phase 1 — Core Runtime & Tooling

- Graph execution engine with parallel scheduling
- Semantic type checker with dimension/unit/domain analysis
- Effect tracking and composition system
- Confidence propagation runtime
- Incremental verification engine (partial graph support)
- Adversarial check evaluator
- IDE/visualization: graph editor for inspecting AETHER programs
- AETHER ↔ existing language bridges (JS, Python, Rust)

### Phase 2 — Intent Layer & Standard Library

- Intent resolution engine with certified algorithm library
- Standard graph library: common patterns (CRUD, ETL, API, ML pipeline)
- Pattern template system with instantiation contracts
- Temporal state type system
- Context-scoped loading for large programs
- Multi-agent collaboration protocol
- Semantic diff engine for graph evolution

### Phase 3 — Self-Improving Ecosystem

- JIT compilation of hot subgraphs
- AI-driven graph optimization suggestions
- Community graph registry (verified computation graphs)
- Formal verification export (Lean/Coq proof certificates)
- Cross-platform native compilation (LLVM backend)
- Verification score dashboard for deployed systems

---

*Phase 0 can begin today.*
