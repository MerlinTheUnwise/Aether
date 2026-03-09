/**
 * AETHER Registry Index
 * Local file-based registry for sharing verified AETHER graphs.
 * Packages stored in directory structure with JSON index.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  type Package,
  type PackageManifest,
  type GraphVerificationReport,
  loadPackage,
  savePackage,
  validatePackage,
} from "./package.js";
import { diffGraphs, hasBreakingChanges } from "../compiler/diff.js";
import type { SemanticDiff } from "../compiler/diff.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RegistryIndex {
  version: 1;
  updated_at: string;
  packages: Record<string, PackageIndexEntry>;
}

export interface PackageIndexEntry {
  name: string;
  description: string;
  versions: Record<string, {
    published_at: string;
    verification_percentage: number;
    confidence: number;
    provides_type: string;
    effects: string[];
    dependencies: Record<string, string>;
    aether_ir_version: string;
  }>;
  latest: string;
  keywords: string[];
}

export interface PublishResult {
  success: boolean;
  name: string;
  version: string;
  verification: number;
  errors?: string[];
}

export interface InstallResult {
  success: boolean;
  installed: Array<{ name: string; version: string }>;
  errors?: string[];
}

export interface DependencyTree {
  name: string;
  version: string;
  dependencies: DependencyTree[];
}

export interface CompatibilityReport {
  compatible: boolean;
  breakingChanges: string[];
  diff: SemanticDiff;
}

// ─── Registry Class ──────────────────────────────────────────────────────────

export class Registry {
  private indexPath: string;
  private packagesPath: string;
  private index: RegistryIndex;

  constructor(registryPath?: string) {
    const basePath = registryPath ?? join(homedir(), ".aether", "registry");
    this.indexPath = join(basePath, "index.json");
    this.packagesPath = join(basePath, "packages");

    if (existsSync(this.indexPath)) {
      this.index = JSON.parse(readFileSync(this.indexPath, "utf-8"));
    } else {
      this.index = {
        version: 1,
        updated_at: new Date().toISOString(),
        packages: {},
      };
    }
  }

  /** Initialize the registry directory structure */
  static init(registryPath?: string): string {
    const basePath = registryPath ?? join(homedir(), ".aether", "registry");
    mkdirSync(join(basePath, "packages"), { recursive: true });

    const indexPath = join(basePath, "index.json");
    if (!existsSync(indexPath)) {
      const emptyIndex: RegistryIndex = {
        version: 1,
        updated_at: new Date().toISOString(),
        packages: {},
      };
      writeFileSync(indexPath, JSON.stringify(emptyIndex, null, 2), "utf-8");
    }

    return basePath;
  }

  /** Publish a package to the registry */
  publish(pkg: Package): PublishResult {
    const validation = validatePackage(pkg);
    if (!validation.valid) {
      return {
        success: false,
        name: pkg.manifest?.name ?? "unknown",
        version: pkg.manifest?.version ?? "0.0.0",
        verification: 0,
        errors: validation.errors,
      };
    }

    const { name, version } = pkg.manifest;

    // Save package files to registry
    const scope = name.split("/")[0]; // e.g., "@aether"
    const pkgName = name.split("/")[1]; // e.g., "crud-entity"
    const pkgDir = join(this.packagesPath, scope, pkgName, version);
    savePackage(pkg, pkgDir);

    // Update index
    if (!this.index.packages[name]) {
      this.index.packages[name] = {
        name,
        description: pkg.manifest.description,
        versions: {},
        latest: version,
        keywords: pkg.manifest.keywords,
      };
    }

    this.index.packages[name].versions[version] = {
      published_at: new Date().toISOString(),
      verification_percentage: pkg.manifest.verification.percentage,
      confidence: pkg.manifest.verification.confidence,
      provides_type: pkg.manifest.provides.type,
      effects: pkg.manifest.provides.effects ?? [],
      dependencies: pkg.manifest.dependencies ?? {},
      aether_ir_version: pkg.manifest.aether_ir_version,
    };

    // Update latest version
    const versions = Object.keys(this.index.packages[name].versions).sort(compareSemver);
    this.index.packages[name].latest = versions[versions.length - 1];
    this.index.packages[name].description = pkg.manifest.description;
    this.index.packages[name].keywords = pkg.manifest.keywords;

    this.index.updated_at = new Date().toISOString();
    this.saveIndex();

    return {
      success: true,
      name,
      version,
      verification: pkg.manifest.verification.percentage,
    };
  }

  /** Install a package to a local project directory */
  install(name: string, version?: string, targetDir?: string): InstallResult {
    const entry = this.index.packages[name];
    if (!entry) {
      return { success: false, installed: [], errors: [`Package not found: ${name}`] };
    }

    const resolvedVersion = version ?? entry.latest;
    if (!entry.versions[resolvedVersion]) {
      return {
        success: false,
        installed: [],
        errors: [`Version ${resolvedVersion} not found for ${name}. Available: ${Object.keys(entry.versions).join(", ")}`],
      };
    }

    const scope = name.split("/")[0];
    const pkgName = name.split("/")[1];
    const sourcePath = join(this.packagesPath, scope, pkgName, resolvedVersion);

    if (!existsSync(sourcePath)) {
      return { success: false, installed: [], errors: [`Package files not found at ${sourcePath}`] };
    }

    const installDir = targetDir ?? join(process.cwd(), "aether_packages");
    const destPath = join(installDir, scope, pkgName);
    mkdirSync(destPath, { recursive: true });

    // Copy package files
    const files = readdirSync(sourcePath);
    for (const file of files) {
      const src = join(sourcePath, file);
      const dst = join(destPath, file);
      cpSync(src, dst, { recursive: true });
    }

    const installed: Array<{ name: string; version: string }> = [
      { name, version: resolvedVersion },
    ];

    // Resolve and install dependencies
    const pkg = loadPackage(sourcePath);
    const deps = pkg.manifest.dependencies ?? {};
    for (const [depName, depRange] of Object.entries(deps)) {
      const depEntry = this.index.packages[depName];
      if (!depEntry) continue;
      const depVersion = findMatchingVersion(Object.keys(depEntry.versions), depRange);
      if (depVersion) {
        const depResult = this.install(depName, depVersion, installDir);
        if (depResult.success) {
          installed.push(...depResult.installed);
        }
      }
    }

    return { success: true, installed };
  }

  /** Search packages by keyword */
  search(query: string): PackageIndexEntry[] {
    const q = query.toLowerCase();
    return Object.values(this.index.packages).filter(entry => {
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.keywords.some(k => k.toLowerCase().includes(q))
      );
    });
  }

  /** List all packages */
  list(): PackageIndexEntry[] {
    return Object.values(this.index.packages).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Get info for a specific package */
  info(name: string): PackageIndexEntry | null {
    return this.index.packages[name] ?? null;
  }

  /** Resolve dependency tree for a package */
  resolveDependencies(name: string, version: string): DependencyTree {
    const tree: DependencyTree = { name, version, dependencies: [] };

    const entry = this.index.packages[name];
    if (!entry || !entry.versions[version]) return tree;

    const deps = entry.versions[version].dependencies;
    for (const [depName, depRange] of Object.entries(deps)) {
      const depEntry = this.index.packages[depName];
      if (!depEntry) continue;
      const depVersion = findMatchingVersion(Object.keys(depEntry.versions), depRange);
      if (depVersion) {
        tree.dependencies.push(this.resolveDependencies(depName, depVersion));
      }
    }

    return tree;
  }

  /** Check version compatibility using semantic diff */
  checkCompatibility(
    name: string,
    fromVersion: string,
    toVersion: string,
  ): CompatibilityReport {
    const scope = name.split("/")[0];
    const pkgName = name.split("/")[1];

    const fromPath = join(this.packagesPath, scope, pkgName, fromVersion);
    const toPath = join(this.packagesPath, scope, pkgName, toVersion);

    if (!existsSync(fromPath) || !existsSync(toPath)) {
      return {
        compatible: false,
        breakingChanges: [`Cannot load package versions for comparison`],
        diff: {
          graph_id: name,
          version_from: 0,
          version_to: 0,
          changes: [],
          impact: {
            contracts_changed: 0,
            types_changed: 0,
            effects_changed: 0,
            confidence_changed: 0,
            nodes_added: 0,
            nodes_removed: 0,
            breaking_changes: ["Cannot load package versions"],
            verification_needed: [],
          },
        },
      };
    }

    const fromPkg = loadPackage(fromPath);
    const toPkg = loadPackage(toPath);

    const diff = diffGraphs(fromPkg.graph as any, toPkg.graph as any);
    const breaking = hasBreakingChanges(diff);

    return {
      compatible: !breaking,
      breakingChanges: diff.impact.breaking_changes,
      diff,
    };
  }

  /** Get the raw index data */
  getIndex(): RegistryIndex {
    return this.index;
  }

  /** Get packages path */
  getPackagesPath(): string {
    return this.packagesPath;
  }

  private saveIndex(): void {
    mkdirSync(join(this.packagesPath, ".."), { recursive: true });
    writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), "utf-8");
  }
}

// ─── Semver Helpers ──────────────────────────────────────────────────────────

function parseSemver(v: string): [number, number, number] {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

function compareSemver(a: string, b: string): number {
  const [ma, mi, pa] = parseSemver(a);
  const [mb, mib, pb] = parseSemver(b);
  if (ma !== mb) return ma - mb;
  if (mi !== mib) return mi - mib;
  return pa - pb;
}

export function findMatchingVersion(versions: string[], range: string): string | null {
  if (!versions.length) return null;

  // Exact match
  if (versions.includes(range)) return range;

  // Support ^x.y.z (compatible with x.y.z, same major)
  const caretMatch = range.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (caretMatch) {
    const major = parseInt(caretMatch[1]);
    const minor = parseInt(caretMatch[2]);
    const patch = parseInt(caretMatch[3]);
    const matching = versions
      .filter(v => {
        const [vm, vmi, vp] = parseSemver(v);
        if (major === 0) {
          // ^0.y.z matches 0.y.z only (minor must match for 0.x)
          return vm === 0 && vmi === minor && vp >= patch;
        }
        return vm === major && (vmi > minor || (vmi === minor && vp >= patch));
      })
      .sort(compareSemver);
    return matching.length > 0 ? matching[matching.length - 1] : null;
  }

  // Support ~x.y.z (same minor)
  const tildeMatch = range.match(/^~(\d+)\.(\d+)\.(\d+)$/);
  if (tildeMatch) {
    const major = parseInt(tildeMatch[1]);
    const minor = parseInt(tildeMatch[2]);
    const patch = parseInt(tildeMatch[3]);
    const matching = versions
      .filter(v => {
        const [vm, vmi, vp] = parseSemver(v);
        return vm === major && vmi === minor && vp >= patch;
      })
      .sort(compareSemver);
    return matching.length > 0 ? matching[matching.length - 1] : null;
  }

  // Support >=x.y.z
  const gteMatch = range.match(/^>=(\d+)\.(\d+)\.(\d+)$/);
  if (gteMatch) {
    const major = parseInt(gteMatch[1]);
    const minor = parseInt(gteMatch[2]);
    const patch = parseInt(gteMatch[3]);
    const matching = versions
      .filter(v => {
        const [vm, vmi, vp] = parseSemver(v);
        return vm > major || (vm === major && (vmi > minor || (vmi === minor && vp >= patch)));
      })
      .sort(compareSemver);
    return matching.length > 0 ? matching[matching.length - 1] : null;
  }

  // Wildcard: *
  if (range === "*") {
    return versions.sort(compareSemver)[versions.length - 1];
  }

  // Fallback: return latest
  return versions.sort(compareSemver)[versions.length - 1];
}
