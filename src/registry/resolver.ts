/**
 * AETHER Dependency Resolver
 * Resolves package dependencies with version compatibility checking.
 */

import type { PackageManifest } from "./package.js";
import { Registry, findMatchingVersion, type DependencyTree } from "./index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResolutionResult {
  resolved: boolean;
  tree: DependencyTree;
  conflicts: Array<{
    package: string;
    required: string[];
    resolved?: string;
  }>;
  missing: string[];
}

// ─── Resolution ──────────────────────────────────────────────────────────────

export function resolveDependencies(
  manifest: PackageManifest,
  registry: Registry,
): ResolutionResult {
  const missing: string[] = [];
  const versionRequirements = new Map<string, Set<string>>();
  const conflicts: ResolutionResult["conflicts"] = [];

  // Build the dependency tree
  const tree: DependencyTree = {
    name: manifest.name,
    version: manifest.version,
    dependencies: [],
  };

  const deps = manifest.dependencies ?? {};
  for (const [depName, depRange] of Object.entries(deps)) {
    const subtree = resolvePackage(depName, depRange, registry, missing, versionRequirements, new Set());
    if (subtree) {
      tree.dependencies.push(subtree);
    }
  }

  // Detect conflicts: same package required at incompatible versions
  for (const [pkgName, ranges] of versionRequirements) {
    if (ranges.size <= 1) continue;

    const rangeArray = [...ranges];
    const info = registry.info(pkgName);
    if (!info) continue;

    const availableVersions = Object.keys(info.versions);

    // Try to find a version satisfying all constraints
    let resolvedVersion: string | undefined;
    for (const v of availableVersions.sort().reverse()) {
      const satisfiesAll = rangeArray.every(range => {
        const match = findMatchingVersion([v], range);
        return match !== null;
      });
      if (satisfiesAll) {
        resolvedVersion = v;
        break;
      }
    }

    if (!resolvedVersion) {
      conflicts.push({
        package: pkgName,
        required: rangeArray,
      });
    } else {
      // Conflict resolved
      conflicts.push({
        package: pkgName,
        required: rangeArray,
        resolved: resolvedVersion,
      });
    }
  }

  const unresolvedConflicts = conflicts.filter(c => !c.resolved);

  return {
    resolved: missing.length === 0 && unresolvedConflicts.length === 0,
    tree,
    conflicts,
    missing: [...new Set(missing)],
  };
}

function resolvePackage(
  name: string,
  range: string,
  registry: Registry,
  missing: string[],
  versionRequirements: Map<string, Set<string>>,
  visited: Set<string>,
): DependencyTree | null {
  const info = registry.info(name);
  if (!info) {
    missing.push(name);
    return null;
  }

  // Track version requirements for conflict detection
  if (!versionRequirements.has(name)) {
    versionRequirements.set(name, new Set());
  }
  versionRequirements.get(name)!.add(range);

  const availableVersions = Object.keys(info.versions);
  const resolvedVersion = findMatchingVersion(availableVersions, range);

  if (!resolvedVersion) {
    missing.push(name);
    return null;
  }

  // Prevent circular resolution
  const visitKey = `${name}@${resolvedVersion}`;
  if (visited.has(visitKey)) {
    return { name, version: resolvedVersion, dependencies: [] };
  }
  visited.add(visitKey);

  const tree: DependencyTree = {
    name,
    version: resolvedVersion,
    dependencies: [],
  };

  // Resolve transitive dependencies
  const versionInfo = info.versions[resolvedVersion];
  const deps = versionInfo.dependencies ?? {};
  for (const [depName, depRange] of Object.entries(deps)) {
    const subtree = resolvePackage(depName, depRange, registry, missing, versionRequirements, new Set(visited));
    if (subtree) {
      tree.dependencies.push(subtree);
    }
  }

  return tree;
}
