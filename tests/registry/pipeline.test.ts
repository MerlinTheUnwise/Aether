import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, rmSync, existsSync } from "fs";
import { Registry } from "../../src/registry/index.js";
import { createPackage, loadPackage, validatePackage, type AetherGraph } from "../../src/registry/package.js";
import { publishStdlib } from "../../scripts/publish-stdlib.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const tmpDir = join(__dirname, "../../.test-tmp-pipeline");
const installDir = join(__dirname, "../../.test-tmp-pipeline-install");
const examplesDir = join(__dirname, "../../src/ir/examples");

describe("Registry Pipeline", () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    if (existsSync(installDir)) rmSync(installDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    if (existsSync(installDir)) rmSync(installDir, { recursive: true, force: true });
  });

  it("end-to-end: init → publish → search → install → verify installed graph", () => {
    // 1. Init registry
    const regPath = Registry.init(tmpDir);
    expect(existsSync(join(regPath, "index.json"))).toBe(true);

    // 2. Create and publish a package
    const graph: AetherGraph = JSON.parse(
      readFileSync(join(examplesDir, "user-registration.json"), "utf-8"),
    );
    const pkg = createPackage(graph, {
      name: "@aether/user-registration",
      version: "1.0.0",
      description: "User registration flow with email validation",
      keywords: ["user", "registration", "email"],
      verification: {
        percentage: 80,
        confidence: 0.8,
        supervised_count: 0,
        z3_verified: true,
        lean_proofs: false,
        last_verified: new Date().toISOString(),
      },
    });

    const registry = new Registry(tmpDir);
    const pubResult = registry.publish(pkg);
    expect(pubResult.success).toBe(true);

    // 3. Search for the package
    const searchResults = registry.search("registration");
    expect(searchResults.length).toBe(1);
    expect(searchResults[0].name).toBe("@aether/user-registration");

    // 4. Install the package
    const installResult = registry.install("@aether/user-registration", "1.0.0", installDir);
    expect(installResult.success).toBe(true);

    // 5. Verify installed graph is intact
    const installedPkg = loadPackage(join(installDir, "@aether", "user-registration"));
    expect(installedPkg.manifest.name).toBe("@aether/user-registration");
    expect(installedPkg.graph.id).toBe("user_registration");
    expect(installedPkg.graph.nodes.length).toBe(3);
    expect(installedPkg.graph.edges.length).toBe(3);

    const validation = validatePackage(installedPkg);
    expect(validation.valid).toBe(true);
  });

  it("version check between two versions of a package returns compatibility report", () => {
    Registry.init(tmpDir);
    const registry = new Registry(tmpDir);

    // Publish v1
    const graph1: AetherGraph = {
      id: "evolving-pkg",
      version: 1,
      nodes: [
        { id: "process", in: { data: { type: "String" } }, out: { result: { type: "String" } }, contract: { post: ["result != null"] }, effects: [], pure: true },
      ],
      edges: [],
      effects: [],
    };
    const pkg1 = createPackage(graph1, {
      name: "@aether/evolving-pkg",
      version: "1.0.0",
      description: "v1",
      verification: { percentage: 100, confidence: 1, supervised_count: 0, z3_verified: true, lean_proofs: false, last_verified: "" },
    });
    registry.publish(pkg1);

    // Publish v2 with changes
    const graph2: AetherGraph = {
      id: "evolving-pkg",
      version: 2,
      nodes: [
        { id: "process", in: { data: { type: "Int" } }, out: { result: { type: "Int" } }, contract: { post: ["result > 0"] }, effects: ["cache.read"], pure: false },
        { id: "validate", in: { input: { type: "Int" } }, out: { valid: { type: "Bool" } }, contract: {}, effects: [], pure: true },
      ],
      edges: [{ from: "process.result", to: "validate.input" }],
      effects: ["cache.read"],
    };
    const pkg2 = createPackage(graph2, {
      name: "@aether/evolving-pkg",
      version: "2.0.0",
      description: "v2 with type changes",
      verification: { percentage: 100, confidence: 1, supervised_count: 0, z3_verified: true, lean_proofs: false, last_verified: "" },
    });
    registry.publish(pkg2);

    // Check compatibility
    const compat = registry.checkCompatibility("@aether/evolving-pkg", "1.0.0", "2.0.0");
    expect(compat.diff).toBeDefined();
    expect(compat.diff.changes.length).toBeGreaterThan(0);
    // Type changed from String to Int and new node added = breaking
    expect(compat.diff.impact.nodes_added).toBeGreaterThan(0);
  });

  it("stdlib publish + list shows all packages categorized", () => {
    publishStdlib(tmpDir);
    const registry = new Registry(tmpDir);

    const all = registry.list();
    expect(all.length).toBe(10);

    // Check categorization
    const templates = all.filter(e => e.versions[e.latest]?.provides_type === "template");
    const certified = all.filter(e => e.versions[e.latest]?.provides_type === "certified-algorithm");
    expect(templates.length).toBe(4);
    expect(certified.length).toBe(6);
  });

  it("dependency tree resolution works with stdlib packages", () => {
    publishStdlib(tmpDir);
    const registry = new Registry(tmpDir);

    // Publish a package that depends on a stdlib package
    const graph: AetherGraph = {
      id: "app-with-deps",
      version: 1,
      nodes: [{ id: "n1", in: { x: { type: "String" } }, out: { y: { type: "String" } }, contract: {}, effects: [], pure: true }],
      edges: [],
      effects: [],
    };
    const pkg = createPackage(graph, {
      name: "@app/my-app",
      version: "1.0.0",
      description: "App using stdlib",
      dependencies: { "@aether/sort-ascending": "^1.0.0" },
      verification: { percentage: 100, confidence: 1, supervised_count: 0, z3_verified: true, lean_proofs: false, last_verified: "" },
    });
    registry.publish(pkg);

    const tree = registry.resolveDependencies("@app/my-app", "1.0.0");
    expect(tree.name).toBe("@app/my-app");
    expect(tree.dependencies.length).toBe(1);
    expect(tree.dependencies[0].name).toBe("@aether/sort-ascending");
  });
});
