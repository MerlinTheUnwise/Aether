import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { rmSync, existsSync } from "fs";
import { Registry } from "../../src/registry/index.js";
import { createPackage, type AetherGraph, type PackageManifest } from "../../src/registry/package.js";
import { resolveDependencies } from "../../src/registry/resolver.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const tmpDir = join(__dirname, "../../.test-tmp-resolver");

function makeGraph(id: string): AetherGraph {
  return {
    id,
    version: 1,
    nodes: [{ id: "n1", in: { x: { type: "String" } }, out: { y: { type: "String" } }, contract: {}, effects: [], pure: true }],
    edges: [],
    effects: [],
  };
}

function publishPkg(registry: Registry, name: string, version: string, deps: Record<string, string> = {}) {
  const graph = makeGraph(name.split("/")[1]);
  const pkg = createPackage(graph, {
    name,
    version,
    description: `Package ${name}`,
    dependencies: deps,
    verification: {
      percentage: 100,
      confidence: 1.0,
      supervised_count: 0,
      z3_verified: true,
      lean_proofs: false,
      last_verified: new Date().toISOString(),
    },
  });
  return registry.publish(pkg);
}

describe("Dependency Resolver", () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    Registry.init(tmpDir);
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves package with no dependencies as trivial tree", () => {
    const registry = new Registry(tmpDir);
    publishPkg(registry, "@aether/no-deps", "1.0.0");

    const manifest: PackageManifest = {
      name: "@aether/root",
      version: "1.0.0",
      description: "Root",
      author: "test",
      license: "MIT",
      provides: { type: "graph" },
      dependencies: {},
      verification: { percentage: 100, confidence: 1, supervised_count: 0, z3_verified: true, lean_proofs: false, last_verified: "" },
      aether_ir_version: "0.1.0",
      keywords: [],
    };

    const result = resolveDependencies(manifest, registry);
    expect(result.resolved).toBe(true);
    expect(result.tree.dependencies.length).toBe(0);
    expect(result.missing.length).toBe(0);
    expect(result.conflicts.length).toBe(0);
  });

  it("resolves package with one dependency as tree with one child", () => {
    const registry = new Registry(tmpDir);
    publishPkg(registry, "@aether/dep-a", "1.0.0");

    const manifest: PackageManifest = {
      name: "@aether/root",
      version: "1.0.0",
      description: "Root",
      author: "test",
      license: "MIT",
      provides: { type: "graph" },
      dependencies: { "@aether/dep-a": "^1.0.0" },
      verification: { percentage: 100, confidence: 1, supervised_count: 0, z3_verified: true, lean_proofs: false, last_verified: "" },
      aether_ir_version: "0.1.0",
      keywords: [],
    };

    const result = resolveDependencies(manifest, registry);
    expect(result.resolved).toBe(true);
    expect(result.tree.dependencies.length).toBe(1);
    expect(result.tree.dependencies[0].name).toBe("@aether/dep-a");
    expect(result.tree.dependencies[0].version).toBe("1.0.0");
  });

  it("resolves transitive dependencies into full tree", () => {
    const registry = new Registry(tmpDir);
    publishPkg(registry, "@aether/leaf", "1.0.0");
    publishPkg(registry, "@aether/mid", "1.0.0", { "@aether/leaf": "^1.0.0" });

    const manifest: PackageManifest = {
      name: "@aether/root",
      version: "1.0.0",
      description: "Root",
      author: "test",
      license: "MIT",
      provides: { type: "graph" },
      dependencies: { "@aether/mid": "^1.0.0" },
      verification: { percentage: 100, confidence: 1, supervised_count: 0, z3_verified: true, lean_proofs: false, last_verified: "" },
      aether_ir_version: "0.1.0",
      keywords: [],
    };

    const result = resolveDependencies(manifest, registry);
    expect(result.resolved).toBe(true);
    expect(result.tree.dependencies.length).toBe(1);
    expect(result.tree.dependencies[0].name).toBe("@aether/mid");
    expect(result.tree.dependencies[0].dependencies.length).toBe(1);
    expect(result.tree.dependencies[0].dependencies[0].name).toBe("@aether/leaf");
  });

  it("detects conflict when two packages need different versions", () => {
    const registry = new Registry(tmpDir);
    publishPkg(registry, "@aether/shared", "1.0.0");
    publishPkg(registry, "@aether/shared", "2.0.0");
    publishPkg(registry, "@aether/dep-x", "1.0.0", { "@aether/shared": "^1.0.0" });
    publishPkg(registry, "@aether/dep-y", "1.0.0", { "@aether/shared": "^2.0.0" });

    const manifest: PackageManifest = {
      name: "@aether/root",
      version: "1.0.0",
      description: "Root",
      author: "test",
      license: "MIT",
      provides: { type: "graph" },
      dependencies: { "@aether/dep-x": "^1.0.0", "@aether/dep-y": "^1.0.0" },
      verification: { percentage: 100, confidence: 1, supervised_count: 0, z3_verified: true, lean_proofs: false, last_verified: "" },
      aether_ir_version: "0.1.0",
      keywords: [],
    };

    const result = resolveDependencies(manifest, registry);
    expect(result.conflicts.length).toBeGreaterThan(0);
    const sharedConflict = result.conflicts.find(c => c.package === "@aether/shared");
    expect(sharedConflict).toBeDefined();
    expect(sharedConflict!.required.length).toBe(2);
  });

  it("reports missing package in missing array", () => {
    const registry = new Registry(tmpDir);

    const manifest: PackageManifest = {
      name: "@aether/root",
      version: "1.0.0",
      description: "Root",
      author: "test",
      license: "MIT",
      provides: { type: "graph" },
      dependencies: { "@aether/nonexistent": "^1.0.0" },
      verification: { percentage: 100, confidence: 1, supervised_count: 0, z3_verified: true, lean_proofs: false, last_verified: "" },
      aether_ir_version: "0.1.0",
      keywords: [],
    };

    const result = resolveDependencies(manifest, registry);
    expect(result.resolved).toBe(false);
    expect(result.missing).toContain("@aether/nonexistent");
  });

  it("version compatibility: breaking change between versions detected via registry", () => {
    const registry = new Registry(tmpDir);

    // Publish v1 and v2 with different graphs
    const graph1 = makeGraph("shared");
    const pkg1 = createPackage(graph1, {
      name: "@aether/shared",
      version: "1.0.0",
      description: "v1",
      verification: { percentage: 100, confidence: 1, supervised_count: 0, z3_verified: true, lean_proofs: false, last_verified: "" },
    });
    registry.publish(pkg1);

    const graph2: AetherGraph = {
      id: "shared",
      version: 2,
      nodes: [
        { id: "n1", in: { x: { type: "Int" } }, out: { y: { type: "Int" } }, contract: { post: ["y > 0"] }, effects: ["db.write"], pure: false },
        { id: "n2", in: { a: { type: "Bool" } }, out: { b: { type: "Bool" } }, contract: {}, effects: [], pure: true },
      ],
      edges: [{ from: "n1.y", to: "n2.a" }],
      effects: ["db.write"],
    };
    const pkg2 = createPackage(graph2, {
      name: "@aether/shared",
      version: "2.0.0",
      description: "v2 with breaking changes",
      verification: { percentage: 100, confidence: 1, supervised_count: 0, z3_verified: true, lean_proofs: false, last_verified: "" },
    });
    registry.publish(pkg2);

    const compat = registry.checkCompatibility("@aether/shared", "1.0.0", "2.0.0");
    expect(compat.diff).toBeDefined();
    expect(compat.diff.changes.length).toBeGreaterThan(0);
  });
});
