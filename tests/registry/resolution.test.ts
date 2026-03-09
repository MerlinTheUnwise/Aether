/**
 * Tests: Implementation Registry — Resolution
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ImplementationRegistry } from "../../src/implementations/registry.js";
import { registerProgramImplementations, getProgramImplementations } from "../../src/implementations/programs/index.js";
import type { AetherNode, AetherGraph } from "../../src/ir/validator.js";
import type { RegisteredImplementation, NodeImplementation } from "../../src/implementations/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makeNode(id: string, overrides: Partial<AetherNode> = {}): AetherNode {
  return {
    id,
    in: overrides.in ?? { x: { type: "String" } },
    out: overrides.out ?? { y: { type: "String" } },
    contract: overrides.contract ?? {},
    effects: overrides.effects ?? [],
    ...overrides,
  } as AetherNode;
}

function makeGraph(nodes: AetherNode[]): AetherGraph {
  return {
    id: "test-graph",
    version: 1,
    effects: [],
    nodes,
    edges: [],
  } as any;
}

function makeImpl(id: string): RegisteredImplementation {
  return {
    meta: {
      id,
      description: `impl for ${id}`,
      inputTypes: {},
      outputTypes: {},
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: async () => ({ result: id }),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("ImplementationRegistry — Resolution", () => {
  let registry: ImplementationRegistry;

  beforeEach(() => {
    registry = new ImplementationRegistry();
  });

  it("resolves by exact ID", () => {
    const impl = makeImpl("validate_email");
    registry.registerById("validate_email", impl);

    const node = makeNode("validate_email");
    const resolved = registry.resolve(node);

    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe("id");
    expect(resolved!.matchReason).toContain("validate_email");
  });

  it("resolves by pattern (regex)", () => {
    const impl = makeImpl("generic_validate");
    registry.registerByPattern(/^validate_/, impl);

    const node = makeNode("validate_username");
    const resolved = registry.resolve(node);

    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe("pattern");
    expect(resolved!.matchReason).toContain("validate_username");
  });

  it("resolves by type signature", () => {
    const impl = makeImpl("sort_list");
    registry.registerBySignature(
      { inputTypes: { data: "List" }, outputTypes: { sorted: "List" } },
      impl,
    );

    const node = makeNode("my_sort", {
      in: { data: { type: "List" } as any },
      out: { sorted: { type: "List" } as any },
    });
    const resolved = registry.resolve(node);

    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe("signature");
  });

  it("resolves by signature with effects", () => {
    const impl = makeImpl("email_sender");
    registry.registerBySignature({ effects: ["email"] }, impl);

    const node = makeNode("send_notification", { effects: ["email"] });
    const resolved = registry.resolve(node);

    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe("signature");
  });

  it("override takes priority over all other matches", () => {
    const impl = makeImpl("validate_email");
    registry.registerById("validate_email", impl);

    const overrideFn: NodeImplementation = async () => ({ overridden: true });
    registry.override("validate_email", overrideFn);

    const node = makeNode("validate_email");
    const resolved = registry.resolve(node);

    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe("override");
  });

  it("returns null when no match found", () => {
    const node = makeNode("unknown_node_xyz");
    const resolved = registry.resolve(node);
    expect(resolved).toBeNull();
  });

  it("resolveAll reports resolved, unresolved, stubbed", () => {
    registry.registerById("a", makeImpl("a"));
    registry.registerById("b", makeImpl("b"));

    const graph = makeGraph([
      makeNode("a"),
      makeNode("b"),
      makeNode("c"), // no impl
    ]);

    const resolution = registry.resolveAll(graph);

    expect(resolution.resolved.size).toBe(2);
    expect(resolution.unresolved).toEqual(["c"]);
    expect(resolution.stubbed).toEqual(["c"]);
    expect(resolution.report).toContain("2 resolved");
    expect(resolution.report).toContain("1 unresolved");
  });

  it("registerCore loads all core implementations", () => {
    registry.registerCore();

    const node = makeNode("validate_email", {
      in: { email: { type: "String" } as any },
      out: { valid: { type: "Bool" } as any, normalized: { type: "String" } as any },
    });

    const resolved = registry.resolve(node);
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe("id");
  });

  it("list returns all registered implementations", () => {
    registry.registerById("a", makeImpl("a"));
    registry.registerById("b", makeImpl("b"));
    registry.registerByPattern(/^test_/, makeImpl("test_pattern"));

    const list = registry.list();
    expect(list.length).toBe(3);
  });

  it("exact ID takes priority over pattern", () => {
    const exactImpl = makeImpl("validate_email_exact");
    const patternImpl = makeImpl("validate_pattern");
    registry.registerById("validate_email", exactImpl);
    registry.registerByPattern(/^validate_/, patternImpl);

    const node = makeNode("validate_email");
    const resolved = registry.resolve(node);

    expect(resolved!.source).toBe("id");
  });

  it("pattern takes priority over signature", () => {
    const patternImpl = makeImpl("pattern_match");
    const sigImpl = makeImpl("sig_match");
    registry.registerByPattern(/^fetch_/, patternImpl);
    registry.registerBySignature({ inputTypes: { query: "String" } }, sigImpl);

    const node = makeNode("fetch_data", {
      in: { query: { type: "String" } as any },
    });
    const resolved = registry.resolve(node);

    expect(resolved!.source).toBe("pattern");
  });

  it("registerProgramImplementations registers all program implementations", () => {
    registry.registerCore();
    registerProgramImplementations(registry);

    // Should resolve common node IDs
    const validateEmail = registry.resolve(makeNode("validate_email"));
    expect(validateEmail).not.toBeNull();

    const authenticate = registry.resolve(makeNode("authenticate"));
    expect(authenticate).not.toBeNull();

    const createUser = registry.resolve(makeNode("create_user"));
    expect(createUser).not.toBeNull();
  });

  it("getProgramImplementations returns non-empty list", () => {
    const impls = getProgramImplementations();
    expect(impls.length).toBeGreaterThan(30);
  });
});
