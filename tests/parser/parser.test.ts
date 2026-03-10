import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/parser/lexer.js";
import { parse } from "../../src/parser/parser.js";

function parseSource(source: string) {
  const { tokens, errors: lexErrors } = tokenize(source);
  expect(lexErrors).toHaveLength(0);
  const sourceLines = source.split("\n");
  return parse(tokens, sourceLines);
}

describe("Parser", () => {
  it("parses minimal graph", () => {
    const result = parseSource(`graph my_graph v1\n  effects: []\nend`);
    expect(result.errors).toHaveLength(0);
    expect(result.ast).not.toBeNull();
    expect(result.ast!.graph.id).toBe("my_graph");
    expect(result.ast!.graph.version).toBe(1);
  });

  it("parses node with all fields", () => {
    const source = `graph test v1
  effects: [database.read]

  node validate_email
    in:  email: String @email
    out: valid: Bool, normalized: String @email @auth
    contracts:
      pre:  email.length > 0
      post: normalized.is_lowercase
      post: normalized.is_trimmed
    pure
    confidence: 0.99
  end

end`;
    const result = parseSource(source);
    expect(result.errors).toHaveLength(0);
    expect(result.ast).not.toBeNull();

    const node = result.ast!.graph.nodes[0];
    expect(node.kind).toBe("node");
    expect(node.id).toBe("validate_email");
    if (node.kind === "node") {
      expect(node.inputs).toHaveLength(1);
      expect(node.inputs[0].name).toBe("email");
      expect(node.inputs[0].typeRef.base).toBe("String");
      expect(node.inputs[0].typeRef.annotations).toHaveLength(1);
      expect(node.inputs[0].typeRef.annotations[0].name).toBe("email");

      expect(node.outputs).toHaveLength(2);
      expect(node.outputs[0].name).toBe("valid");
      expect(node.outputs[1].name).toBe("normalized");
      expect(node.outputs[1].typeRef.annotations).toHaveLength(2);

      expect(node.contracts).toBeDefined();
      expect(node.contracts!.pre).toHaveLength(1);
      expect(node.contracts!.post).toHaveLength(2);

      expect(node.pure).toBe(true);
      expect(node.confidence).toBe(0.99);
    }
  });

  it("parses edge declarations", () => {
    const source = `graph test v1
  effects: []
  node a
    in: x: String
    out: y: String
    contracts:
      post: y.length > 0
    pure
    confidence: 0.99
  end
  node b
    in: y: String
    out: z: String
    contracts:
      post: z.length > 0
    pure
    confidence: 0.99
  end
  edge a.y -> b.y
end`;
    const result = parseSource(source);
    expect(result.errors).toHaveLength(0);
    expect(result.ast!.graph.edges).toHaveLength(1);
    expect(result.ast!.graph.edges[0].from).toBe("a.y");
    expect(result.ast!.graph.edges[0].to).toBe("b.y");
  });

  it("parses state type", () => {
    const source = `graph test v1
  effects: []
  statetype OrderLifecycle
    states: [created, paid, shipped, delivered, cancelled, refunded]
    transitions:
      created -> paid when payment_confirmed
      created -> cancelled when user_request
      paid -> shipped when carrier_accepted
    never:
      cancelled -> paid
      delivered -> shipped
    terminal: [delivered, cancelled, refunded]
    initial: created
  end
end`;
    const result = parseSource(source);
    expect(result.errors).toHaveLength(0);
    const st = result.ast!.graph.stateTypes[0];
    expect(st.id).toBe("OrderLifecycle");
    expect(st.states).toHaveLength(6);
    expect(st.transitions).toHaveLength(3);
    expect(st.transitions[0].from).toBe("created");
    expect(st.transitions[0].to).toBe("paid");
    expect(st.transitions[0].when).toBe("payment_confirmed");
    expect(st.never).toHaveLength(2);
    expect(st.terminal).toEqual(["delivered", "cancelled", "refunded"]);
    expect(st.initial).toBe("created");
  });

  it("parses hole with must_satisfy", () => {
    const source = `graph test v1
  effects: []
  partial
  hole payment_handler
    must_satisfy:
      in:  charge: Record @payment
      out: refund: Record @payment
      effects: [payment_gateway.write]
      contracts:
        post: refund.amount <= charge.amount
  end
end`;
    const result = parseSource(source);
    expect(result.errors).toHaveLength(0);
    const hole = result.ast!.graph.nodes[0];
    expect(hole.kind).toBe("hole");
    expect(hole.id).toBe("payment_handler");
    if (hole.kind === "hole") {
      expect(hole.inputs).toHaveLength(1);
      expect(hole.outputs).toHaveLength(1);
      expect(hole.effects).toContain("payment_gateway.write");
    }
  });

  it("parses intent node", () => {
    const source = `graph test v1
  effects: []
  intent sort_results
    in:  data: List<Record>
    out: sorted: List<Record>
    ensure: output.is_sorted
    ensure: output.distinct
    constraints:
      time_complexity: O(n log n)
      deterministic: true
  end
end`;
    const result = parseSource(source);
    expect(result.errors).toHaveLength(0);
    const intent = result.ast!.graph.nodes[0];
    expect(intent.kind).toBe("intent");
    if (intent.kind === "intent") {
      expect(intent.ensure).toHaveLength(2);
      expect(intent.constraints?.time_complexity).toBe("O ( n log n )");
      expect(intent.constraints?.deterministic).toBe(true);
    }
  });

  it("parses scope", () => {
    const source = `graph test v1
  effects: []
  scope payment
    nodes: [validate_payment, authorize_card, capture_funds]
    requires:
      get_order: (order_id: String @commerce) -> (order: Record @commerce)
    provides:
      payment_complete: (order: Record @commerce) -> (receipt: Record @payment)
  end
end`;
    const result = parseSource(source);
    expect(result.errors).toHaveLength(0);
    const sc = result.ast!.graph.scopes[0];
    expect(sc.id).toBe("payment");
    expect(sc.nodes).toHaveLength(3);
    expect(sc.requires).toHaveLength(1);
    expect(sc.provides).toHaveLength(1);
    expect(sc.requires![0].name).toBe("get_order");
  });

  it("parses template + use", () => {
    const source = `graph test v1
  effects: []
  template crud_entity
    params:
      $Entity: type
      $IdType: type
    node validate
      in:  data: $Entity
      out: valid: Bool
      contracts:
        post: valid = true
      pure
      confidence: 0.99
    end
  end
  use crud_entity as user_crud
    Entity = Record @auth
    IdType = String @uuid @auth
  end
end`;
    const result = parseSource(source);
    expect(result.errors).toHaveLength(0);
    const tmpl = result.ast!.graph.templates[0];
    expect(tmpl.id).toBe("crud_entity");
    expect(tmpl.params).toHaveLength(2);
    expect(tmpl.params[0].name).toBe("Entity");
    expect(tmpl.params[0].kind).toBe("type");
    expect(tmpl.nodes).toHaveLength(1);

    const use = result.ast!.graph.templateUses[0];
    expect(use.id).toBe("user_crud");
    expect(use.templateId).toBe("crud_entity");
    expect(use.bindings).toHaveLength(2);
  });

  it("parses recovery block with actions", () => {
    const source = `graph test v1
  effects: [database.read]
  node fetch
    in: id: String
    out: data: String
    effects: [database.read]
    contracts:
      post: data.length > 0
    recovery:
      db_timeout -> retry(3, exponential)
      db_error   -> fallback(data: empty)
    confidence: 0.95
  end
end`;
    const result = parseSource(source);
    expect(result.errors).toHaveLength(0);
    const node = result.ast!.graph.nodes[0];
    if (node.kind === "node") {
      expect(node.recovery).toHaveLength(2);
      expect(node.recovery![0].condition).toBe("db_timeout");
      expect(node.recovery![0].action).toBe("retry");
      expect(node.recovery![0].args).toEqual(["3", "exponential"]);
    }
  });

  // --- Error tests ---

  it("reports missing end", () => {
    const source = `graph test v1
  effects: []
  node x
    in: a: String
    out: b: String
    pure
    confidence: 0.99`;
    const result = parseSource(source);
    expect(result.errors.length).toBeGreaterThan(0);
    const err = result.errors.find(e => e.code === "E010");
    expect(err).toBeDefined();
  });

  it("reports missing recovery on effectful node", () => {
    const source = `graph test v1
  effects: [database.read]
  node fetch
    in: id: String
    out: data: String
    effects: [database.read]
    contracts:
      post: data.length > 0
    confidence: 0.95
  end
end`;
    const result = parseSource(source);
    const err = result.errors.find(e => e.code === "E020");
    expect(err).toBeDefined();
    expect(err!.suggestion).toContain("recovery");
  });

  it("reports missing adversarial on low-confidence node", () => {
    const source = `graph test v1
  effects: []
  node risky
    in: x: String
    out: y: String
    contracts:
      post: y.length > 0
    pure
    confidence: 0.7
  end
end`;
    const result = parseSource(source);
    const err = result.errors.find(e => e.code === "E021");
    expect(err).toBeDefined();
    expect(err!.suggestion).toContain("adversarial");
  });

  it("reports missing postcondition in contracts", () => {
    const source = `graph test v1
  effects: []
  node bad
    in: x: String
    out: y: String
    contracts:
      pre: x.length > 0
    pure
    confidence: 0.99
  end
end`;
    const result = parseSource(source);
    const err = result.errors.find(e => e.code === "E022");
    expect(err).toBeDefined();
  });

  it("collects multiple errors without stopping at first", () => {
    const source = `graph test v1
  effects: []
  node a
    in: x: String
    out: y: String
    effects: [database.read]
    contracts:
      pre: x.length > 0
    confidence: 0.7
  end
end`;
    const result = parseSource(source);
    // Should get E020 (missing recovery), E021 (missing adversarial), E022 (missing postcondition)
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("reports nonexistent edge port", () => {
    const source = `graph test v1
  effects: []
  node a
    in: x: String
    out: y: String
    contracts:
      post: y.length > 0
    pure
    confidence: 0.99
  end
  node b
    in: y: String
    out: z: String
    contracts:
      post: z.length > 0
    pure
    confidence: 0.99
  end
  edge a.nonexistent -> b.y
end`;
    const result = parseSource(source);
    const err = result.errors.find(e => e.code === "E024");
    expect(err).toBeDefined();
    expect(err!.message).toContain("nonexistent");
  });

  it("all errors include line, column, context, pointer", () => {
    const source = `graph test v1
  effects: [database.read]
  node fetch
    in: id: String
    out: data: String
    effects: [database.read]
    confidence: 0.9
  end
end`;
    const result = parseSource(source);
    for (const err of result.errors) {
      expect(err.line).toBeGreaterThan(0);
      expect(err.column).toBeGreaterThan(0);
      expect(err.context).toBeDefined();
      expect(err.pointer).toBeDefined();
    }
  });

  it("preserves comments in AST", () => {
    const source = `// A test graph
// With multiple comment lines

graph test v1
  effects: []

  // Section: nodes
  node a
    in: x: String
    out: y: String
    contracts:
      post: y.length > 0
    pure
    confidence: 0.99
  end
end`;
    const result = parseSource(source);
    expect(result.errors).toHaveLength(0);
    expect(result.ast!.leadingComments.length).toBeGreaterThan(0);
    expect(result.ast!.leadingComments[0].text).toContain("A test graph");
  });
});
