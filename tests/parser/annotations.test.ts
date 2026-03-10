import { describe, it, expect } from "vitest";
import { expandAnnotations, typeAnnotationToAnnotations } from "../../src/parser/annotations.js";
import type { ASTAnnotation } from "../../src/parser/ast.js";

function ann(name: string, args?: string[]): ASTAnnotation {
  return { name, args, loc: { line: 1, column: 1, length: 0 } };
}

describe("Annotation System", () => {
  it("@email → format: email", () => {
    const { typeAnnotation, warnings } = expandAnnotations("String", [ann("email")]);
    expect(typeAnnotation.format).toBe("email");
    expect(warnings).toHaveLength(0);
  });

  it("@auth → domain: authentication", () => {
    const { typeAnnotation } = expandAnnotations("String", [ann("auth")]);
    expect(typeAnnotation.domain).toBe("authentication");
  });

  it("@pii → sensitivity: pii", () => {
    const { typeAnnotation } = expandAnnotations("String", [ann("pii")]);
    expect(typeAnnotation.sensitivity).toBe("pii");
  });

  it("@USD → unit: USD, dimension: currency", () => {
    const { typeAnnotation } = expandAnnotations("Float64", [ann("USD")]);
    expect(typeAnnotation.unit).toBe("USD");
    expect(typeAnnotation.dimension).toBe("currency");
  });

  it("multiple annotations combine: @email @auth @pii", () => {
    const { typeAnnotation, warnings } = expandAnnotations("String", [
      ann("email"), ann("auth"), ann("pii"),
    ]);
    expect(typeAnnotation.format).toBe("email");
    expect(typeAnnotation.domain).toBe("authentication");
    expect(typeAnnotation.sensitivity).toBe("pii");
    expect(warnings).toHaveLength(0);
  });

  it("@constraint with args", () => {
    const { typeAnnotation } = expandAnnotations("Bool", [ann("constraint", ["= true"])]);
    expect(typeAnnotation.constraint).toBe("= true");
  });

  it("@range with numeric args", () => {
    const { typeAnnotation } = expandAnnotations("Int", [ann("range", ["0", "100"])]);
    expect(typeAnnotation.range).toEqual([0, 100]);
  });

  it("unknown annotation → warning", () => {
    const { warnings } = expandAnnotations("String", [ann("foobar")]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("W001");
    expect(warnings[0].message).toContain("@foobar");
  });

  it("reverse: TypeAnnotation → annotation strings", () => {
    const anns = typeAnnotationToAnnotations({
      type: "String",
      format: "email",
      domain: "authentication",
      sensitivity: "pii",
    });
    expect(anns).toContain("@email");
    expect(anns).toContain("@auth");
    expect(anns).toContain("@pii");
  });

  it("reverse: constraint and range", () => {
    const anns = typeAnnotationToAnnotations({
      type: "Int",
      constraint: "> 0",
      range: [0, 100],
    });
    expect(anns.find(a => a.includes("@constraint"))).toBeDefined();
    expect(anns.find(a => a.includes("@range"))).toBeDefined();
  });

  it("@celsius → unit: celsius, dimension: thermodynamic_temperature", () => {
    const { typeAnnotation } = expandAnnotations("Float64", [ann("celsius")]);
    expect(typeAnnotation.unit).toBe("celsius");
    expect(typeAnnotation.dimension).toBe("thermodynamic_temperature");
  });

  it("@ms → unit: ms, dimension: time", () => {
    const { typeAnnotation } = expandAnnotations("Int", [ann("ms")]);
    expect(typeAnnotation.unit).toBe("ms");
    expect(typeAnnotation.dimension).toBe("time");
  });
});
