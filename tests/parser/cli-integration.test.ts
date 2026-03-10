import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "child_process";
import { readFileSync, existsSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const CLI = "npx tsx src/cli.ts";
const cwd = process.cwd();

function run(cmd: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`${CLI} ${cmd}`, {
      cwd,
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

// Cleanup files after tests
const tempFiles: string[] = [];
afterAll(() => {
  for (const f of tempFiles) {
    if (existsSync(f)) unlinkSync(f);
  }
});

describe("CLI Integration", () => {
  it("parse command on valid .aether → Valid output", () => {
    // First create a .aether file from a JSON reference
    const jsonPath = "src/ir/examples/user-registration.json";
    const aetherPath = join(cwd, "test-cli-parse.aether");
    tempFiles.push(aetherPath);

    const r1 = run(`format ${jsonPath} --output ${aetherPath}`);
    expect(r1.exitCode).toBe(0);
    expect(existsSync(aetherPath)).toBe(true);

    const r2 = run(`parse ${aetherPath}`);
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toContain("✓");
    expect(r2.stdout).toContain("Valid");
  });

  it("parse command on invalid .aether → error output", () => {
    const badPath = join(cwd, "test-cli-bad.aether");
    tempFiles.push(badPath);

    writeFileSync(badPath, `graph broken v1
  effects: [database.read]
  node x
    in: a: String
    out: b: String
    effects: [database.read]
    contracts:
      post: b.length > 0
    confidence: 0.9
  end
end`, "utf-8");

    const r = run(`parse ${badPath}`);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("error");
  });

  it("format command: JSON → .aether → produces valid .aether", () => {
    const jsonPath = "src/ir/examples/user-registration.json";
    const aetherPath = join(cwd, "test-cli-format.aether");
    tempFiles.push(aetherPath);

    const r = run(`format ${jsonPath} --output ${aetherPath}`);
    expect(r.exitCode).toBe(0);
    expect(existsSync(aetherPath)).toBe(true);

    const content = readFileSync(aetherPath, "utf-8");
    expect(content).toContain("graph");
    expect(content).toContain("node");
    expect(content).toContain("end");
  });

  it("format command: .aether → JSON → produces valid JSON", () => {
    // First create a .aether
    const jsonPath = "src/ir/examples/user-registration.json";
    const aetherPath = join(cwd, "test-cli-tojson.aether");
    const outputJson = join(cwd, "test-cli-tojson.json");
    tempFiles.push(aetherPath, outputJson);

    run(`format ${jsonPath} --output ${aetherPath}`);

    const r = run(`format ${aetherPath} --output ${outputJson}`);
    expect(r.exitCode).toBe(0);
    expect(existsSync(outputJson)).toBe(true);

    const content = readFileSync(outputJson, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe("user_registration");
    expect(parsed.nodes).toBeDefined();
    expect(parsed.edges).toBeDefined();
  });

  it("init command → creates starter file that parses", () => {
    const initPath = join(cwd, "test-cli-init.aether");
    tempFiles.push(initPath);

    const r1 = run(`init ${initPath}`);
    expect(r1.exitCode).toBe(0);
    expect(existsSync(initPath)).toBe(true);

    const r2 = run(`parse ${initPath}`);
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toContain("✓");
  });

  it("validate on .aether file → works", () => {
    const jsonPath = "src/ir/examples/user-registration.json";
    const aetherPath = join(cwd, "test-cli-validate.aether");
    tempFiles.push(aetherPath);

    run(`format ${jsonPath} --output ${aetherPath}`);
    const r = run(`validate ${aetherPath}`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("✓");
  });

  it("execute on .aether file → works", () => {
    const jsonPath = "src/ir/examples/user-registration.json";
    const aetherPath = join(cwd, "test-cli-execute.aether");
    tempFiles.push(aetherPath);

    run(`format ${jsonPath} --output ${aetherPath}`);
    const r = run(`execute ${aetherPath}`);
    expect(r.exitCode).toBe(0);
  });

  it("report on .aether file → works", () => {
    const jsonPath = "src/ir/examples/rate-limiter.json";
    const aetherPath = join(cwd, "test-cli-report.aether");
    tempFiles.push(aetherPath);

    run(`format ${jsonPath} --output ${aetherPath}`);
    const r = run(`report ${aetherPath}`);
    // Report should succeed (may output verification results)
    expect(r.stdout.length).toBeGreaterThan(0);
  });
});
