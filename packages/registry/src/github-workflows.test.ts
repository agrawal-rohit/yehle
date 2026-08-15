import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const registryRoot = path.join(repoRoot, "packages/registry/registry");

interface RegistryFileEntry {
	source: string;
	target: string;
}

interface RegistryItemManifest {
	id: string;
	files?: RegistryFileEntry[];
	variants?: Array<{
		id: string;
		files: RegistryFileEntry[];
	}>;
}

/**
 * Recursively collect absolute paths to every registry-item.json under a directory.
 * @param dir - Directory to walk.
 * @returns Absolute paths to registry-item.json files.
 */
function collectManifestPaths(dir: string): string[] {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const absolute = path.join(dir, entry.name);
		if (entry.isDirectory()) results.push(...collectManifestPaths(absolute));
		else if (entry.isFile() && entry.name === "registry-item.json")
			results.push(absolute);
	}
	return results;
}

/**
 * Whether a registry install target is a dogfooded GitHub Actions workflow or composite action.
 * Config files under `.github/codeql/` and `.github/rulesets/` intentionally diverge per repo.
 * @param target - Destination path relative to a consuming project root.
 * @returns True when the target must match the repo-root `.github/` copy byte-for-byte.
 */
function isDogfoodedGithubTarget(target: string): boolean {
	return (
		target.startsWith(".github/workflows/") ||
		target.startsWith(".github/actions/")
	);
}

describe("dogfooded GitHub Actions files", () => {
	it("keeps .github/workflows and .github/actions identical to registry sources", () => {
		const mismatches: string[] = [];

		for (const manifestPath of collectManifestPaths(registryRoot)) {
			const itemDir = path.dirname(manifestPath);
			const manifest = JSON.parse(
				fs.readFileSync(manifestPath, "utf8"),
			) as RegistryItemManifest;

			const entries: RegistryFileEntry[] = [
				...(manifest.files ?? []),
				...(manifest.variants ?? []).flatMap((variant) => variant.files),
			];

			for (const file of entries) {
				if (!isDogfoodedGithubTarget(file.target)) continue;

				const registryPath = path.join(itemDir, file.source);
				const repoPath = path.join(repoRoot, file.target);

				if (!fs.existsSync(registryPath)) {
					mismatches.push(
						`missing registry source for ${manifest.id}: ${file.source}`,
					);
					continue;
				}
				if (!fs.existsSync(repoPath)) {
					mismatches.push(
						`missing repo copy of ${file.target} (edit ${path.relative(repoRoot, registryPath)}, then copy to ${file.target})`,
					);
					continue;
				}

				const registryContent = fs.readFileSync(registryPath, "utf8");
				const repoContent = fs.readFileSync(repoPath, "utf8");
				if (registryContent !== repoContent) {
					mismatches.push(
						`${file.target} drifted from registry. Edit ${path.relative(repoRoot, registryPath)}, then copy to ${file.target}.`,
					);
				}
			}
		}

		expect(mismatches, mismatches.join("\n")).toEqual([]);
	});
});
