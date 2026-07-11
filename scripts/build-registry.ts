#!/usr/bin/env node
/**
 * Compile atomic registry item folders into a single, lean registry.json at the
 * repo root.
 *
 * Each item lives in its own folder under registry/ as an atomic unit:
 *   registry/<…>/registry-item.json  (manifest)
 *   registry/<…>/<files...>          (colocated source files)
 *
 * The built index contains metadata ONLY — file content is NOT inlined. Each
 * file records a repo-relative `source` path; the CLI fetches the content at
 * install time from `${contentBaseUrl}/${source}` (or reads it locally when run
 * from source). This keeps registry.json small as the registry grows.
 *
 * Run via: pnpm run build:registry
 */

import fs from "node:fs";
import path from "node:path";
import mustache from "mustache";
import {
	REGISTRY_BASE_URL_ENV,
	REGISTRY_REPO_RAW_BASE,
} from "../src_old/core/constants";
import { scanItemFiles } from "../src_old/registry/loader";
import {
	normalizeRegistryDependency,
	resolveRegistryPlan,
} from "../src_old/registry/resolver";
import {
	INSTRUCTION_ITEM_TYPES,
	parseRegistryItemManifest,
	type RegistryDocument,
	type RegistryFile,
	type RegistryFileManifest,
	type RegistryInstallContext,
	type RegistryItem,
	type RegistryVariant,
	type RegistryVariantManifest,
	RegistryVisibility,
	validateRegistryCommandInputs,
} from "../src_old/registry/schema";
import { REGISTRY_COMMAND_INPUTS } from "./command-inputs";

const REPO_ROOT = path.resolve(__dirname, "..");
const REGISTRY_DIR = path.join(REPO_ROOT, "registry");
const OUTPUT_PATH = path.join(REPO_ROOT, "registry.json");

/** Built-in install context keys available to every registry item. */
const BUILTIN_CONTEXT_KEYS = new Set([
	"public",
	"includeInstructions",
	"framework",
	"lang",
	"tool",
	"packageManagerVersion",
	"templateHasPlayground",
	"authorName",
	"authorGitEmail",
	"authorGitUsername",
	"name",
	"instructionsIdeFormat",
]);

/**
 * Mask GitHub Actions `${{ ... }}` expressions before mustache parsing.
 * @param content - Template source content.
 * @returns Content with GHA expressions replaced by placeholders.
 */
function maskGithubActionsExpressions(content: string): string {
	return content.replaceAll(/\$\{\{[\s\S]*?\}\}/g, "");
}

/**
 * Extract mustache variable and section keys from template content.
 * @param content - Mustache template source.
 * @returns Set of referenced context keys.
 */
function extractMustacheKeys(content: string): Set<string> {
	const keys = new Set<string>();
	const masked = maskGithubActionsExpressions(content);
	for (const token of mustache.parse(masked)) {
		const [type, value] = token as [string, string, number, number];
		if (
			type === "name" ||
			type === "&" ||
			type === "{" ||
			type === "#" ||
			type === "^"
		)
			keys.add(value);
	}
	return keys;
}

/**
 * Collect declared input names for an item and its registry dependencies.
 * @param itemId - Root item id.
 * @param items - Built registry items keyed by id.
 * @returns Allowed mustache context keys for the item plan.
 */
function collectAllowedContextKeys(
	itemId: string,
	items: Record<string, RegistryItem>,
): Set<string> {
	const allowed = new Set(BUILTIN_CONTEXT_KEYS);
	const visiting = new Set<string>();

	const visit = (id: string): void => {
		if (visiting.has(id)) return;
		const item = items[id];
		if (!item) return;

		visiting.add(id);
		for (const input of item.inputs ?? []) allowed.add(input.name);
		for (const dependency of item.registryDependencies ?? []) {
			visit(normalizeRegistryDependency(dependency).ref.id);
		}
		for (const variant of item.variants) {
			for (const dependency of variant.registryDependencies ?? []) {
				visit(normalizeRegistryDependency(dependency).ref.id);
			}
		}
		visiting.delete(id);
	};

	visit(itemId);
	return allowed;
}

/**
 * Validate registry dependency references and detect dependency cycles.
 * @param items - Built registry items keyed by id.
 * @throws Error when a dependency is missing or a cycle is detected.
 */
function validateRegistryDependencies(
	items: Record<string, RegistryItem>,
): void {
	const visiting = new Set<string>();
	const visited = new Set<string>();

	const visit = (id: string): void => {
		if (visited.has(id)) return;
		if (visiting.has(id))
			throw new Error(`Registry dependency cycle detected at "${id}".`);

		const item = items[id];
		if (!item) throw new Error(`Registry item not found: "${id}".`);

		visiting.add(id);
		const deps = [
			...(item.registryDependencies ?? []),
			...item.variants.flatMap(
				(variant) => variant.registryDependencies ?? [],
			),
		];
		for (const dependency of deps) {
			const depId = normalizeRegistryDependency(dependency).ref.id;
			if (!items[depId])
				throw new Error(
					`Registry item "${id}" depends on missing item "${depId}".`,
				);
			visit(depId);
		}
		visiting.delete(id);
		visited.add(id);
	};

	for (const id of Object.keys(items)) visit(id);
}

/**
 * Validate instruction metadata and mustache variable usage across all items.
 * @param items - Built registry items keyed by id.
 * @param itemDirs - Map of item id to source folder path.
 * @throws Error when metadata or templates are inconsistent.
 */
function validateRegistryItemContent(
	items: Record<string, RegistryItem>,
	itemDirs: Map<string, string>,
): void {
	const validationContext: RegistryInstallContext = {
		public: true,
		includeInstructions: true,
		framework: "react",
		lang: "typescript",
	};

	for (const item of Object.values(items)) {
		resolveRegistryPlan(item.id, new Map(Object.entries(items)), validationContext);

		if (INSTRUCTION_ITEM_TYPES.has(item.type)) {
			if (!item.instructionName)
				throw new Error(
					`Registry item "${item.id}" is missing instructionName.`,
				);
		}

		const allowedKeys = collectAllowedContextKeys(item.id, items);
		const itemDir = itemDirs.get(item.id);
		if (!itemDir) continue;

		for (const variant of item.variants) {
			for (const file of variant.files) {
				if (!file.template) continue;

				const absolutePath = path.join(REPO_ROOT, file.source);
				const content = fs.readFileSync(absolutePath, "utf8");
				for (const key of extractMustacheKeys(content)) {
					if (allowedKeys.has(key)) continue;
					throw new Error(
						`Registry item "${item.id}" template "${path.relative(REPO_ROOT, absolutePath)}" references undeclared mustache key "${key}".`,
					);
				}
			}
		}
	}
}

/**
 * Recursively collect the folder of every registry-item.json under registry/.
 * @param dir - Directory to walk.
 * @returns Absolute paths to item folders (each containing a registry-item.json).
 */
function collectItemDirs(dir: string): string[] {
	const results: string[] = [];
	let entries: fs.Dirent[] = [];

	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return results;
	}

	if (entries.some((e) => e.isFile() && e.name === "registry-item.json")) {
		results.push(dir);
	}

	for (const entry of entries) {
		if (entry.isDirectory())
			results.push(...collectItemDirs(path.join(dir, entry.name)));
	}

	return results;
}

/**
 * Resolve file manifests for a variant, falling back to a full item-folder scan
 * when the variant omits an explicit files list (single-variant items only).
 * @param itemDir - Absolute path to the item folder.
 * @param variant - Variant manifest.
 * @param defaultVisibility - Item default visibility.
 * @param allowScan - Whether to auto-scan when files are omitted.
 * @returns File manifest entries relative to the item folder.
 */
function resolveVariantFiles(
	itemDir: string,
	variant: RegistryVariantManifest,
	defaultVisibility: RegistryVisibility | undefined,
	allowScan: boolean,
): RegistryFileManifest[] {
	if (variant.files && variant.files.length > 0) return variant.files;
	if (!allowScan) return [];
	return scanItemFiles(itemDir, defaultVisibility);
}

/**
 * Build lean file metadata with repo-relative sources.
 * @param itemDir - Absolute item folder.
 * @param itemId - Item id for errors.
 * @param files - File manifests relative to the item folder.
 * @param defaultVisibility - Optional default visibility.
 * @returns Built registry files.
 */
function buildRegistryFiles(
	itemDir: string,
	itemId: string,
	files: RegistryFileManifest[],
	defaultVisibility?: RegistryVisibility,
): RegistryFile[] {
	return files.map((file) => {
		const absolutePath = path.join(itemDir, file.path);
		if (!fs.existsSync(absolutePath))
			throw new Error(
				`Registry item "${itemId}" references missing file: ${path.relative(REPO_ROOT, absolutePath)}`,
			);
		const source = path
			.relative(REPO_ROOT, absolutePath)
			.split(path.sep)
			.join("/");
		const visibility = file.visibility ?? defaultVisibility;
		return {
			source,
			target: file.target,
			...(file.template ? { template: true } : {}),
			...(visibility ? { visibility } : {}),
		};
	});
}

/**
 * Build a single registry item from its folder into lean metadata.
 * @param itemDir - Absolute path to the item folder.
 * @returns Built registry item (no inlined content).
 */
function buildRegistryItem(itemDir: string): RegistryItem {
	const manifestPath = path.join(itemDir, "registry-item.json");
	const raw = fs.readFileSync(manifestPath, "utf8");
	const manifest = parseRegistryItemManifest(JSON.parse(raw) as unknown);

	const variants: RegistryVariant[] = [];
	const variantManifests = manifest.variants ?? [];
	const singleVariant = variantManifests.length === 1;

	for (const variantManifest of variantManifests) {
		const declaredFiles = variantManifest.files ?? [];
		const files =
			declaredFiles.length > 0
				? declaredFiles
				: resolveVariantFiles(
						itemDir,
						variantManifest,
						manifest.defaultVisibility,
						singleVariant,
					);

		if (files.length === 0)
			throw new Error(
				`Registry item "${manifest.id}" variant "${variantManifest.id}" has no files (declare files or add sources to ${path.relative(REPO_ROOT, itemDir)}).`,
			);

		variants.push({
			id: variantManifest.id,
			...(variantManifest.targets ? { targets: variantManifest.targets } : {}),
			files: buildRegistryFiles(
				itemDir,
				manifest.id,
				files,
				manifest.defaultVisibility,
			),
			...(variantManifest.dependencies
				? { dependencies: variantManifest.dependencies }
				: {}),
			...(variantManifest.devDependencies
				? { devDependencies: variantManifest.devDependencies }
				: {}),
			...(variantManifest.registryDependencies
				? { registryDependencies: variantManifest.registryDependencies }
				: {}),
		});
	}

	const {
		files: _files,
		targets: _targets,
		dependencies: _dependencies,
		devDependencies: _devDependencies,
		defaultVisibility: _defaultVisibility,
		variants: _variants,
		...rest
	} = manifest;

	return { ...rest, variants };
}

/**
 * Resolve the base URL from which file content is fetched at install time.
 * @param version - Package version used to pin the git tag.
 * @returns Content base URL (e.g. https://.../tuckshop/v0.2.1).
 */
function resolveContentBaseUrl(version: string): string {
	const override = process.env[REGISTRY_BASE_URL_ENV];
	if (override && override.length > 0) return override.replace(/\/+$/, "");
	return `${REGISTRY_REPO_RAW_BASE}/v${version}`;
}

/**
 * Compile all registry items into registry.json at the repo root.
 */
function buildRegistry(): void {
	const itemFolderPaths = collectItemDirs(REGISTRY_DIR);
	if (itemFolderPaths.length === 0)
		throw new Error(`No registry items found under ${REGISTRY_DIR}.`);

	const pkg = JSON.parse(
		fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
	) as { version: string };

	const items: Record<string, RegistryItem> = {};
	const itemDirsById = new Map<string, string>();
	for (const itemDir of itemFolderPaths) {
		const item = buildRegistryItem(itemDir);
		if (items[item.id])
			throw new Error(`Duplicate registry item id: "${item.id}".`);
		items[item.id] = item;
		itemDirsById.set(item.id, itemDir);
	}

	validateRegistryDependencies(items);
	validateRegistryItemContent(items, itemDirsById);

	const sortedItems = Object.fromEntries(
		Object.entries(items).sort(([a], [b]) => a.localeCompare(b)),
	);

	const document: RegistryDocument = {
		version: pkg.version,
		contentBaseUrl: resolveContentBaseUrl(pkg.version),
		items: sortedItems,
		commandInputs: validateRegistryCommandInputs(REGISTRY_COMMAND_INPUTS),
	};

	fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(document, null, 2)}\n`, "utf8");
	console.log(
		`Built ${Object.keys(sortedItems).length} registry items -> ${path.relative(REPO_ROOT, OUTPUT_PATH)}`,
	);
}

try {
	buildRegistry();
} catch (error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`build-registry failed: ${message}`);
	process.exit(1);
}
