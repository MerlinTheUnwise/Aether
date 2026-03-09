/**
 * Tests for AETHER Compact Form parse error handling
 */
import { describe, it, expect } from "vitest";
import { parseCompact } from "../../src/compiler/compact.js";

describe("Compact Form Parse Errors", () => {
  it("empty source throws error", () => {
    expect(() => parseCompact("")).toThrow("Empty compact source");
  });

  it("malformed node line (missing ports) still parses with empty ports", () => {
    const source = `G:test v1 eff[]\nN:bad_node\n`;
    const graph = parseCompact(source);
    const node = graph.nodes[0] as any;
    expect(node.id).toBe("bad_node");
    expect(Object.keys(node.in).length).toBe(0);
    expect(Object.keys(node.out).length).toBe(0);
  });

  it("invalid edge line throws error", () => {
    expect(() => parseCompact("G:test v1\nE:no_arrow_here\n")).toThrow();
  });

  it("bad type shorthand round-trips as literal type name", () => {
    const source = `G:test v1 eff[]\nN:node1 (x:UnknownType)->(y:AnotherType)\n`;
    const graph = parseCompact(source);
    const node = graph.nodes[0] as any;
    expect(node.in.x.type).toBe("UnknownType");
    expect(node.out.y.type).toBe("AnotherType");
  });

  it("edge with unknown node reference is captured in graph", () => {
    // Parser doesn't validate node existence — that's the validator's job
    const source = `G:test v1 eff[]\nE:missing.port→also_missing.port\n`;
    const graph = parseCompact(source);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0].from).toBe("missing.port");
  });

  it("hole line parses correctly", () => {
    const source = `G:test v1 eff[] partial\nH:my_hole (input:Str)->(output:Bool)\n`;
    const graph = parseCompact(source);
    expect(graph.partial).toBe(true);
    const hole = graph.nodes[0] as any;
    expect(hole.hole).toBe(true);
    expect(hole.id).toBe("my_hole");
    expect(hole.must_satisfy.in.input.type).toBe("String");
    expect(hole.must_satisfy.out.output.type).toBe("Bool");
  });

  it("comments are skipped during parsing", () => {
    const source = `G:test v1 eff[]\n// This is a comment\nN:node1 (x:Int)->(y:Bool) pure\n`;
    const graph = parseCompact(source);
    expect(graph.nodes.length).toBe(1);
  });
});
