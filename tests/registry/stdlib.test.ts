import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { rmSync, existsSync } from "fs";
import { Registry } from "../../src/registry/index.js";
import { publishStdlib } from "../../scripts/publish-stdlib.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const tmpDir = join(__dirname, "../../.test-tmp-stdlib");
const installDir = join(__dirname, "../../.test-tmp-stdlib-install");

describe("Stdlib Registry", () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    if (existsSync(installDir)) rmSync(installDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    if (existsSync(installDir)) rmSync(installDir, { recursive: true, force: true });
  });

  it("publishes all 10 stdlib packages successfully", () => {
    const { published, errors } = publishStdlib(tmpDir);
    expect(errors.length).toBe(0);
    expect(published.length).toBe(10);
  });

  it("all published packages have verification >= 88%", () => {
    publishStdlib(tmpDir);
    const registry = new Registry(tmpDir);
    const all = registry.list();

    for (const entry of all) {
      const latest = entry.versions[entry.latest];
      expect(latest.verification_percentage).toBeGreaterThanOrEqual(88);
    }
  });

  it("installs a template package with files appearing", () => {
    publishStdlib(tmpDir);
    const registry = new Registry(tmpDir);

    const result = registry.install("@aether/crud-entity", "1.0.0", installDir);
    expect(result.success).toBe(true);
    expect(result.installed.length).toBeGreaterThanOrEqual(1);
    expect(result.installed[0].name).toBe("@aether/crud-entity");

    // Check files exist
    expect(existsSync(join(installDir, "@aether", "crud-entity", "aether.pkg.json"))).toBe(true);
    expect(existsSync(join(installDir, "@aether", "crud-entity", "graph.json"))).toBe(true);
  });

  it("installs a certified algorithm with files appearing", () => {
    publishStdlib(tmpDir);
    const registry = new Registry(tmpDir);

    const result = registry.install("@aether/sort-ascending", "1.0.0", installDir);
    expect(result.success).toBe(true);
    expect(result.installed[0].name).toBe("@aether/sort-ascending");

    expect(existsSync(join(installDir, "@aether", "sort-ascending", "aether.pkg.json"))).toBe(true);
    expect(existsSync(join(installDir, "@aether", "sort-ascending", "graph.json"))).toBe(true);
  });

  it("search 'sort' finds sort-ascending", () => {
    publishStdlib(tmpDir);
    const registry = new Registry(tmpDir);

    const results = registry.search("sort");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.name === "@aether/sort-ascending")).toBe(true);
  });

  it("search 'crud' finds crud-entity", () => {
    publishStdlib(tmpDir);
    const registry = new Registry(tmpDir);

    const results = registry.search("crud");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.name === "@aether/crud-entity")).toBe(true);
  });

  it("published templates have type 'template'", () => {
    publishStdlib(tmpDir);
    const registry = new Registry(tmpDir);

    const templateNames = [
      "@aether/crud-entity",
      "@aether/retry-fallback",
      "@aether/auth-gate",
      "@aether/confidence-cascade",
    ];

    for (const name of templateNames) {
      const info = registry.info(name);
      expect(info).not.toBeNull();
      const latest = info!.versions[info!.latest];
      expect(latest.provides_type).toBe("template");
    }
  });

  it("published certified algorithms have type 'certified-algorithm'", () => {
    publishStdlib(tmpDir);
    const registry = new Registry(tmpDir);

    const certNames = [
      "@aether/sort-ascending",
      "@aether/filter-predicate",
      "@aether/deduplicate",
      "@aether/aggregate-sum",
      "@aether/validate-schema",
      "@aether/lookup-by-key",
    ];

    for (const name of certNames) {
      const info = registry.info(name);
      expect(info).not.toBeNull();
      const latest = info!.versions[info!.latest];
      expect(latest.provides_type).toBe("certified-algorithm");
    }
  });
});
