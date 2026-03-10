import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("VS Code Syntax Grammar", () => {
  const grammarPath = join(process.cwd(), "editor-support/aether.tmLanguage.json");
  const langConfigPath = join(process.cwd(), "editor-support/language-configuration.json");
  const pkgPath = join(process.cwd(), "editor-support/package.json");

  it("grammar file is valid JSON", () => {
    const content = readFileSync(grammarPath, "utf-8");
    const grammar = JSON.parse(content);
    expect(grammar.name).toBe("AETHER");
    expect(grammar.scopeName).toBe("source.aether");
    expect(grammar.fileTypes).toContain("aether");
  });

  it("grammar has patterns array", () => {
    const grammar = JSON.parse(readFileSync(grammarPath, "utf-8"));
    expect(Array.isArray(grammar.patterns)).toBe(true);
    expect(grammar.patterns.length).toBeGreaterThan(0);
  });

  it("all control keywords matched by grammar", () => {
    const grammar = JSON.parse(readFileSync(grammarPath, "utf-8"));
    const keywordPattern = grammar.patterns.find(
      (p: any) => p.name === "keyword.control.aether"
    );
    expect(keywordPattern).toBeDefined();

    const keywords = [
      "graph", "node", "edge", "end", "hole", "intent",
      "scope", "template", "use", "statetype", "supervised",
    ];
    for (const kw of keywords) {
      const re = new RegExp(keywordPattern.match);
      expect(re.test(kw)).toBe(true);
    }
  });

  it("annotations matched by grammar", () => {
    const grammar = JSON.parse(readFileSync(grammarPath, "utf-8"));
    const annoPattern = grammar.patterns.find(
      (p: any) => p.name === "variable.annotation.aether"
    );
    expect(annoPattern).toBeDefined();

    const re = new RegExp(annoPattern.match);
    expect(re.test("@email")).toBe(true);
    expect(re.test("@pii")).toBe(true);
    expect(re.test("@domain")).toBe(true);
  });

  it("comments matched by grammar", () => {
    const grammar = JSON.parse(readFileSync(grammarPath, "utf-8"));
    const commentPattern = grammar.patterns.find(
      (p: any) => p.name === "comment.line.double-slash.aether"
    );
    expect(commentPattern).toBeDefined();

    const re = new RegExp(commentPattern.match);
    expect(re.test("// this is a comment")).toBe(true);
  });

  it("strings matched by grammar", () => {
    const grammar = JSON.parse(readFileSync(grammarPath, "utf-8"));
    const stringPattern = grammar.patterns.find(
      (p: any) => p.name === "string.quoted.double.aether"
    );
    expect(stringPattern).toBeDefined();
    expect(stringPattern.begin).toBe('"');
    expect(stringPattern.end).toBe('"');
  });

  it("arrow operator matched by grammar", () => {
    const grammar = JSON.parse(readFileSync(grammarPath, "utf-8"));
    const arrowPattern = grammar.patterns.find(
      (p: any) => p.name === "keyword.operator.arrow.aether"
    );
    expect(arrowPattern).toBeDefined();
    const re = new RegExp(arrowPattern.match);
    expect(re.test("->")).toBe(true);
  });

  it("language configuration is valid JSON", () => {
    const config = JSON.parse(readFileSync(langConfigPath, "utf-8"));
    expect(config.comments.lineComment).toBe("//");
    expect(config.folding).toBeDefined();
    expect(config.folding.markers.start).toBeTruthy();
    expect(config.folding.markers.end).toBeTruthy();
  });

  it("VS Code extension package.json is valid", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("aether-language");
    expect(pkg.contributes.languages).toHaveLength(1);
    expect(pkg.contributes.languages[0].extensions).toContain(".aether");
    expect(pkg.contributes.grammars).toHaveLength(1);
    expect(pkg.contributes.grammars[0].scopeName).toBe("source.aether");
  });
});
