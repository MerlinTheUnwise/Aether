import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { Registry, type PackageIndexEntry } from "../../src/registry/index.js";
import { createPackage, type AetherGraph } from "../../src/registry/package.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tmpDir = join(__dirname, "../../.test-tmp-registry");

function makeGraph(id: string, nodeCount: number = 2): AetherGraph {
  const nodes: any[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `node_${i}`,
      in: { data: { type: "String" } },
      out: { result: { type: "String" } },
      contract: { pre: ["input.data != null"], post: ["output.result != null"] },
      effects: [],
      pure: true,
    });
  }
  return {
    id,
    version: 1,
    nodes,
    edges: nodeCount > 1 ? [{ from: "node_0.result", to: "node_1.data" }] : [],
    effects: [],
  };
}

function makePkg(name: string, version: string, keywords: string[] = [], deps: Record<string, string> = {}): ReturnType<typeof createPackage> {
  const graph = makeGraph(name.split("/")[1]);
  return createPackage(graph, {
    name,
    version,
    description: `Test package ${name}`,
    keywords,
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
}

describe("Registry Index", () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("init creates directory structure and empty index", () => {
    const regPath = Registry.init(tmpDir);
    expect(existsSync(join(regPath, "index.json"))).toBe(true);
    expect(existsSync(join(regPath, "packages"))).toBe(true);

    const index = JSON.parse(readFileSync(join(regPath, "index.json"), "utf-8"));
    expect(index.version).toBe(1);
    expect(Object.keys(index.packages).length).toBe(0);
  });

  it("publish package appears in index", () => {
    Registry.init(tmpDir);
    const registry = new Registry(tmpDir);
    const pkg = makePkg("@aether/test-pkg", "1.0.0", ["test"]);

    const result = registry.publish(pkg);
    expect(result.success).toBe(true);
    expect(result.name).toBe("@aether/test-pkg");
    expect(result.version).toBe("1.0.0");

    const info = registry.info("@aether/test-pkg");
    expect(info).not.toBeNull();
    expect(info!.name).toBe("@aether/test-pkg");
    expect(info!.latest).toBe("1.0.0");
  });

  it("publish same name different version tracks both versions", () => {
    Registry.init(tmpDir);
    const registry = new Registry(tmpDir);

    registry.publish(makePkg("@aether/multi-ver", "1.0.0"));
    registry.publish(makePkg("@aether/multi-ver", "1.1.0"));

    const info = registry.info("@aether/multi-ver");
    expect(info).not.toBeNull();
    expect(Object.keys(info!.versions).length).toBe(2);
    expect(info!.versions["1.0.0"]).toBeDefined();
    expect(info!.versions["1.1.0"]).toBeDefined();
    expect(info!.latest).toBe("1.1.0");
  });

  it("search by keyword finds matching packages", () => {
    Registry.init(tmpDir);
    const registry = new Registry(tmpDir);

    registry.publish(makePkg("@aether/sort-algo", "1.0.0", ["sort", "algorithm"]));
    registry.publish(makePkg("@aether/filter-fn", "1.0.0", ["filter", "algorithm"]));
    registry.publish(makePkg("@aether/crud-ops", "1.0.0", ["crud", "database"]));

    const results = registry.search("sort");
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("@aether/sort-algo");
  });

  it("search with no results returns empty array", () => {
    Registry.init(tmpDir);
    const registry = new Registry(tmpDir);

    registry.publish(makePkg("@aether/test-pkg", "1.0.0", ["test"]));

    const results = registry.search("nonexistent-xyz");
    expect(results.length).toBe(0);
  });

  it("list all returns all packages sorted", () => {
    Registry.init(tmpDir);
    const registry = new Registry(tmpDir);

    registry.publish(makePkg("@aether/beta-pkg", "1.0.0"));
    registry.publish(makePkg("@aether/alpha-pkg", "1.0.0"));
    registry.publish(makePkg("@aether/gamma-pkg", "1.0.0"));

    const all = registry.list();
    expect(all.length).toBe(3);
    expect(all[0].name).toBe("@aether/alpha-pkg");
    expect(all[1].name).toBe("@aether/beta-pkg");
    expect(all[2].name).toBe("@aether/gamma-pkg");
  });

  it("info on existing package returns entry", () => {
    Registry.init(tmpDir);
    const registry = new Registry(tmpDir);
    registry.publish(makePkg("@aether/existing", "1.0.0", ["existing"]));

    const info = registry.info("@aether/existing");
    expect(info).not.toBeNull();
    expect(info!.name).toBe("@aether/existing");
  });

  it("info on missing package returns null", () => {
    Registry.init(tmpDir);
    const registry = new Registry(tmpDir);

    const info = registry.info("@aether/does-not-exist");
    expect(info).toBeNull();
  });
});
