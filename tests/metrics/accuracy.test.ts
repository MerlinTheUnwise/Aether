/**
 * Metrics accuracy test — ensures reported numbers in README match reality.
 * Prevents metric drift: if we add tests but don't update README, this catches it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/** Count it() blocks across all test files using word-boundary regex */
function countItBlocks(): number {
  const testDir = join(process.cwd(), "tests");
  const pattern = /\bit\s*\(/g;
  let count = 0;

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        const content = readFileSync(full, "utf-8");
        const matches = content.match(pattern);
        if (matches) count += matches.length;
      }
    }
  }

  walk(testDir);
  return count;
}

/** Extract the test count number from README */
function getReadmeTestCount(): number | null {
  const readme = readFileSync("README.md", "utf-8");
  // Match patterns like "1,617" or "1617" followed by "test" or "it block" etc.
  // Look in the Verified Metrics table
  const match = readme.match(/Test cases \(it blocks\)\s*\|\s*([\d,]+)/);
  if (!match) return null;
  return parseInt(match[1].replace(/,/g, ""), 10);
}

describe("Reported metrics match reality", () => {
  it("README test count matches actual it() count within 5%", () => {
    const actual = countItBlocks();
    const reported = getReadmeTestCount();

    expect(reported).not.toBeNull();
    if (reported !== null) {
      const tolerance = Math.ceil(actual * 0.05);
      expect(Math.abs(reported - actual)).toBeLessThan(tolerance);
    }
  });

  it("README does not claim Z3 proves more than 5% of postconditions", () => {
    const readme = readFileSync("README.md", "utf-8");
    // Z3 proof rate line should say ~1% or a similarly low number
    const match = readme.match(/Z3 formal proof rate\s*\|\s*([\d.]+)%/);
    expect(match).not.toBeNull();
    if (match) {
      const claimedRate = parseFloat(match[1]);
      expect(claimedRate).toBeLessThan(5);
    }
  });

  it("README does not contain 'Production-ready' as a status label", () => {
    const readme = readFileSync("README.md", "utf-8");
    // Allow "Production-ready" in general text but not in status tables
    const tableRows = readme
      .split("\n")
      .filter(line => line.startsWith("|") && line.includes("Production-ready"));
    expect(tableRows).toHaveLength(0);
  });

  it("AETHERCLAUDE.md does not contain 'Production-ready' as a status label", () => {
    const claude = readFileSync("AETHERCLAUDE.md", "utf-8");
    const tableRows = claude
      .split("\n")
      .filter(line => line.startsWith("|") && line.includes("Production-ready"));
    expect(tableRows).toHaveLength(0);
  });

  it("program count in README matches actual examples", () => {
    const examplesDir = join(process.cwd(), "src", "ir", "examples");
    const jsonFiles = readdirSync(examplesDir).filter(f => f.endsWith(".json"));
    const realWorldDir = join(examplesDir, "real-world");
    let realWorldCount = 0;
    try {
      realWorldCount = readdirSync(realWorldDir).filter(f => f.endsWith(".json")).length;
    } catch {}
    const total = jsonFiles.length + realWorldCount;

    const readme = readFileSync("README.md", "utf-8");
    const match = readme.match(/Reference programs\s*\|\s*(\d+)/);
    expect(match).not.toBeNull();
    if (match) {
      expect(parseInt(match[1], 10)).toBe(total);
    }
  });
});
