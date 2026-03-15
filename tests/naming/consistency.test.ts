import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "../..");

/**
 * Collect all .ts and .md files from a directory tree,
 * excluding node_modules, dist, .git, and dump files.
 */
function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git", ".claude"].includes(entry.name)) continue;
      results.push(...collectFiles(fullPath, exts));
    } else if (exts.includes(extname(entry.name))) {
      if (entry.name.includes("dump") || entry.name === "aether-full-dump.txt") continue;
      results.push(fullPath);
    }
  }
  return results;
}

describe("Naming Consistency", () => {
  const srcFiles = collectFiles(join(projectRoot, "src"), [".ts"]);
  const docFiles = collectFiles(join(projectRoot, "docs"), [".md"]);
  const readmePath = join(projectRoot, "README.md");
  const designPath = join(projectRoot, "design.md");

  const allFiles = [
    ...srcFiles,
    ...docFiles,
    readmePath,
    ...(existsSync(designPath) ? [designPath] : []),
  ];

  it("no source or doc file contains 'AI-driven'", () => {
    for (const file of allFiles) {
      const content = readFileSync(file, "utf-8");
      const matches = content.match(/AI-driven/gi);
      expect(matches, `Found "AI-driven" in ${file}`).toBeNull();
    }
  });

  it("no source or doc file contains 'AI optimizer'", () => {
    for (const file of allFiles) {
      const content = readFileSync(file, "utf-8");
      const matches = content.match(/AI optimizer/gi);
      expect(matches, `Found "AI optimizer" in ${file}`).toBeNull();
    }
  });

  it("no source or doc file contains 'proof-carrying'", () => {
    for (const file of allFiles) {
      const content = readFileSync(file, "utf-8");
      const matches = content.match(/proof-carrying/gi);
      expect(matches, `Found "proof-carrying" in ${file}`).toBeNull();
    }
  });

  it("no source or doc file contains 'proof certificate' (should be 'proof skeleton')", () => {
    for (const file of allFiles) {
      const content = readFileSync(file, "utf-8");
      const matches = content.match(/proof certificate/gi);
      expect(matches, `Found "proof certificate" in ${file}`).toBeNull();
    }
  });

  it("README does not contain 'first programming language'", () => {
    const content = readFileSync(readmePath, "utf-8");
    expect(content).not.toContain("first programming language");
  });

  it("README does not contain 'first language designed'", () => {
    const content = readFileSync(readmePath, "utf-8");
    expect(content).not.toMatch(/first.*language designed/i);
  });

  it("CLI help text uses 'Static graph' for optimizer, not 'AI-driven'", () => {
    const cliContent = readFileSync(join(projectRoot, "src/cli.ts"), "utf-8");
    expect(cliContent).not.toMatch(/AI-driven/i);
  });

  it("CLI help text uses 'proof skeleton' for export-proofs, not 'proof certificate'", () => {
    const cliContent = readFileSync(join(projectRoot, "src/cli.ts"), "utf-8");
    expect(cliContent).not.toMatch(/proof certificate/i);
    expect(cliContent).toContain("proof skeleton");
  });

  it("optimizer.ts header describes static/rule-based analysis, not AI", () => {
    const optimizerContent = readFileSync(join(projectRoot, "src/compiler/optimizer.ts"), "utf-8");
    expect(optimizerContent).toContain("rule-based");
    expect(optimizerContent).not.toMatch(/AI-driven/i);
  });

  it("jit.ts exports RuntimeCompiler, not JITCompiler", () => {
    const jitContent = readFileSync(join(projectRoot, "src/runtime/jit.ts"), "utf-8");
    expect(jitContent).toContain("export class RuntimeCompiler");
    expect(jitContent).not.toContain("export class JITCompiler");
  });

  it("jit.ts exports CompiledFunction, not JITCompiledFunction", () => {
    const jitContent = readFileSync(join(projectRoot, "src/runtime/jit.ts"), "utf-8");
    expect(jitContent).toContain("CompiledFunction");
    expect(jitContent).not.toContain("JITCompiledFunction");
  });

  it("profiler.ts exports CompilationRecommendation, not JITRecommendation", () => {
    const profilerContent = readFileSync(join(projectRoot, "src/runtime/profiler.ts"), "utf-8");
    expect(profilerContent).toContain("CompilationRecommendation");
    expect(profilerContent).not.toContain("JITRecommendation");
  });

  it("README 'What It Actually Does' uses 'Contract-Verified', not 'Proof-Carrying'", () => {
    const content = readFileSync(readmePath, "utf-8");
    expect(content).toContain("Contract-Verified");
    expect(content).not.toContain("Proof-Carrying");
  });

  it("README describes real-world programs honestly (in-memory simulation)", () => {
    const content = readFileSync(readmePath, "utf-8");
    expect(content).toContain("in-memory simulation");
  });

  it("README describes LLVM as experimental", () => {
    const content = readFileSync(readmePath, "utf-8");
    expect(content).toMatch(/LLVM.*experimental|experimental.*LLVM/i);
  });

  it("README has Known Limitations section", () => {
    const content = readFileSync(readmePath, "utf-8");
    expect(content).toContain("## Known Limitations");
  });

});
