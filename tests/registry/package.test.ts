import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import {
  createPackage,
  validatePackage,
  savePackage,
  loadPackage,
  type AetherGraph,
  type Package,
} from "../../src/registry/package.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadGraph(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, `${name}.json`), "utf-8"));
}

const tmpDir = join(__dirname, "../../.test-tmp-pkg");

describe("Package Format", () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates package from user-registration graph with valid manifest", () => {
    const graph = loadGraph("user-registration");
    const pkg = createPackage(graph, {
      name: "@aether/user-registration",
      version: "1.0.0",
      description: "User registration flow",
    });

    expect(pkg.manifest.name).toBe("@aether/user-registration");
    expect(pkg.manifest.version).toBe("1.0.0");
    expect(pkg.manifest.provides.type).toBe("graph");
    expect(pkg.graph.id).toBe("user_registration");
    expect(pkg.graph.nodes.length).toBe(3);
    expect(pkg.manifest.keywords).toContain("user_registration");
  });

  it("package includes verification report", () => {
    const graph = loadGraph("user-registration");
    const pkg = createPackage(graph, {
      name: "@aether/user-registration",
      verification: {
        percentage: 66,
        confidence: 0.66,
        supervised_count: 0,
        z3_verified: true,
        lean_proofs: false,
        last_verified: new Date().toISOString(),
      },
    });

    expect(pkg.manifest.verification.percentage).toBe(66);
    expect(pkg.manifest.verification.z3_verified).toBe(true);
    expect(pkg.verification).toBeDefined();
    expect(pkg.verification.graph_id).toBe("user_registration");
  });

  it("package includes compact form when requested", () => {
    const graph = loadGraph("user-registration");
    const pkg = createPackage(graph, {
      name: "@aether/user-registration",
    }, { includeCompact: true });

    expect(pkg.compact).toBeDefined();
    expect(pkg.compact!.length).toBeGreaterThan(0);
    expect(pkg.compact).toContain("user_registration");
  });

  it("package includes proofs when set", () => {
    const graph = loadGraph("user-registration");
    const pkg = createPackage(graph, { name: "@aether/user-registration" });
    pkg.proofs = "-- Lean 4 proof\ntheorem test : True := trivial";

    expect(pkg.proofs).toContain("Lean 4");
  });

  it("invalid graph (missing id) fails package creation", () => {
    expect(() => {
      createPackage({ nodes: [] } as any, { name: "@aether/bad" });
    }).toThrow("Invalid graph");
  });

  it("validates a well-formed package", () => {
    const graph = loadGraph("user-registration");
    const pkg = createPackage(graph, {
      name: "@aether/user-registration",
      version: "1.0.0",
      description: "User reg",
    });

    const result = validatePackage(pkg);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("validation rejects package with missing manifest fields", () => {
    const pkg: Package = {
      manifest: {} as any,
      graph: { id: "test", version: 1, nodes: [], edges: [], effects: [] },
      verification: {} as any,
    };

    const result = validatePackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("save and load package from disk preserves all fields", () => {
    const graph = loadGraph("user-registration");
    const pkg = createPackage(graph, {
      name: "@aether/user-registration",
      version: "1.0.0",
      description: "User registration flow",
    }, { includeCompact: true });

    pkg.readme = "# Test Package\nThis is a test.";
    pkg.proofs = "-- Lean proof\ntheorem t : True := trivial";

    const pkgPath = join(tmpDir, "test-pkg");
    savePackage(pkg, pkgPath);

    const loaded = loadPackage(pkgPath);

    expect(loaded.manifest.name).toBe("@aether/user-registration");
    expect(loaded.manifest.version).toBe("1.0.0");
    expect(loaded.graph.id).toBe("user_registration");
    expect(loaded.graph.nodes.length).toBe(3);
    expect(loaded.verification).toBeDefined();
    expect(loaded.compact).toBeDefined();
    expect(loaded.proofs).toContain("Lean proof");
    expect(loaded.readme).toContain("Test Package");
  });

  it("detects template provides type from graph with parameters", () => {
    const graph: any = {
      id: "my-template",
      version: 1,
      nodes: [{ id: "n1", in: {}, out: {}, contract: {}, effects: [] }],
      edges: [],
      effects: [],
      parameters: [{ name: "T", kind: "type" }],
    };

    const pkg = createPackage(graph, { name: "@aether/my-template" });
    expect(pkg.manifest.provides.type).toBe("template");
  });

  it("detects certified-algorithm from single pure node", () => {
    const graph: AetherGraph = {
      id: "my-algo",
      version: 1,
      nodes: [{ id: "impl", in: {}, out: {}, contract: { post: ["x > 0"] }, effects: [], pure: true }],
      edges: [],
      effects: [],
    };

    const pkg = createPackage(graph, { name: "@aether/my-algo" });
    expect(pkg.manifest.provides.type).toBe("certified-algorithm");
  });
});
