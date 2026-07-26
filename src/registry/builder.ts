import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { readJSONFileAsync, writeFileAsync } from "../core/fs";
import {
	type Registry,
	type RegistryCondition,
	RegistryConditionInference,
	type RegistryConditionValue,
	type RegistryFile,
	type RegistryItem,
	RegistryItemType,
	type RegistryVariant,
} from "./schema";

/** Base URL for the raw registry source files on GitHub. */
const REGISTRY_REPO_RAW_BASE =
	"https://raw.githubusercontent.com/agrawal-rohit/tuckshop";

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

	// If the directory contains a registry-item.json, add it to the results
	if (entries.some((e) => e.isFile() && e.name === "registry-item.json"))
		results.push(dir);

	// If the directory contains a subdirectory, recursively collect the item folders
	for (const entry of entries)
		if (entry.isDirectory())
			results.push(...collectItemDirs(path.join(dir, entry.name)));

	return results;
}

/**
 * Assert a value is a non-empty string.
 * @param value - Value to check.
 * @param label - Label used in the error message.
 * @throws Error when the value is not a non-empty string.
 */
function assertNonEmptyString(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`${label} must be a non-empty string.`);
}

/**
 * Parse and validate a non-empty string array (npm deps, file lists, etc.).
 * @param raw - Raw array value.
 * @param label - Context label for error messages.
 * @returns Validated string array, or undefined when absent.
 * @throws Error when an entry is not a non-empty string.
 */
function parseStringArray(raw: unknown, label: string): string[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (!Array.isArray(raw)) throw new Error(`${label} must be an array.`);

	const result: string[] = [];
	for (const [index, entry] of raw.entries()) {
		assertNonEmptyString(entry, `${label}[${index}]`);
		result.push(entry);
	}

	return result.length > 0 ? result : undefined;
}

/**
 * Parse and validate a variant `when` matcher.
 * @param raw - Raw when value from the manifest.
 * @param label - Context label for error messages.
 * @returns Validated when map, or undefined when absent.
 * @throws Error when the when shape is invalid.
 */
function parseWhen(
	raw: unknown,
	label: string,
): Record<string, string> | undefined {
	// Check if the when is valid
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== "object" || Array.isArray(raw))
		throw new Error(`${label} when must be an object.`);

	// Parse the when object into a key-value map
	const when: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		assertNonEmptyString(key, `${label} when key`);
		assertNonEmptyString(value, `${label} when["${key}"]`);
		when[key] = value;
	}
	return Object.keys(when).length > 0 ? when : undefined;
}

/**
 * Build lean file metadata with repo-relative sources.
 * @param itemDir - Absolute item folder.
 * @param itemId - Item id for errors.
 * @param repoRoot - Absolute repo root for relative source paths.
 * @param files - Raw file entries from the variant or item manifest.
 * @returns Built registry files.
 * @throws Error when a file entry is invalid or the source path is missing.
 */
function buildRegistryFiles(
	itemDir: string,
	itemId: string,
	repoRoot: string,
	files: unknown[],
): RegistryFile[] {
	return files.map((rawFile, index) => {
		// Check if the file object is valid
		if (!rawFile || typeof rawFile !== "object" || Array.isArray(rawFile))
			throw new Error(
				`Registry item "${itemId}" file at index ${index} must be an object.`,
			);

		const file = rawFile as Record<string, unknown>;
		assertNonEmptyString(
			file.source,
			`Registry item "${itemId}" file[${index}].source`,
		);
		assertNonEmptyString(
			file.target,
			`Registry item "${itemId}" file[${index}].target`,
		);

		// Check if the file exists
		const absolutePath = path.join(itemDir, file.source);
		if (!fs.existsSync(absolutePath))
			throw new Error(
				`Registry item "${itemId}" references missing file: ${path.relative(repoRoot, absolutePath)}`,
			);

		// Convert the file path to a relative path
		const source = path
			.relative(repoRoot, absolutePath)
			.split(path.sep)
			.join("/");

		return { source, target: file.target };
	});
}

/**
 * Parse and validate a single registry item manifest into lean metadata.
 * @param itemDir - Absolute path to the item folder.
 * @param repoRoot - Absolute repo root for relative source paths.
 * @returns Built registry item (no inlined content).
 * @throws Error when the manifest is invalid or references missing files.
 */
function buildRegistryItem(itemDir: string, repoRoot: string): RegistryItem {
	const manifestPath = path.join(itemDir, "registry-item.json");
	const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;

	// Check if the manifest is valid
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw new Error(
			`Registry item manifest at "${path.relative(repoRoot, manifestPath)}" must be an object.`,
		);

	const manifest = raw as Record<string, unknown>;
	assertNonEmptyString(manifest.id, "Registry item id");
	assertNonEmptyString(manifest.title, `Registry item "${manifest.id}" title`);
	assertNonEmptyString(
		manifest.description,
		`Registry item "${manifest.id}" description`,
	);

	// Check if the type is valid
	const allTypes = new Set<string>(Object.values(RegistryItemType));
	if (typeof manifest.type !== "string" || !allTypes.has(manifest.type))
		throw new Error(
			`Registry item "${manifest.id}" has invalid type "${String(manifest.type)}" (expected one of: ${Object.values(RegistryItemType).join(", ")}).`,
		);

	// Check if the variants are valid
	if (!Array.isArray(manifest.variants) || manifest.variants.length === 0)
		throw new Error(
			`Registry item "${manifest.id}" must declare at least one variant.`,
		);

	const variants: RegistryVariant[] = [];
	for (const [variantIndex, rawVariant] of manifest.variants.entries()) {
		if (
			!rawVariant ||
			typeof rawVariant !== "object" ||
			Array.isArray(rawVariant)
		)
			throw new Error(
				`Registry item "${manifest.id}" variant at index ${variantIndex} must be an object.`,
			);

		const variantManifest = rawVariant as Record<string, unknown>;
		assertNonEmptyString(
			variantManifest.id,
			`Registry item "${manifest.id}" variant[${variantIndex}].id`,
		);
		assertNonEmptyString(
			variantManifest.title,
			`Registry item "${manifest.id}" variant "${variantManifest.id}" title`,
		);
		assertNonEmptyString(
			variantManifest.description,
			`Registry item "${manifest.id}" variant "${variantManifest.id}" description`,
		);

		if (
			!Array.isArray(variantManifest.files) ||
			variantManifest.files.length === 0
		)
			throw new Error(
				`Registry item "${manifest.id}" variant "${variantManifest.id}" has no files.`,
			);

		const files = buildRegistryFiles(
			itemDir,
			manifest.id,
			repoRoot,
			variantManifest.files,
		);

		const when = parseWhen(
			variantManifest.when,
			`Registry item "${manifest.id}" variant "${variantManifest.id}"`,
		);

		const variant: RegistryVariant = {
			id: variantManifest.id,
			title: variantManifest.title,
			description: variantManifest.description,
			...(when ? { when } : {}),
			files,
		};

		// Parse the dependencies
		if (Array.isArray(variantManifest.dependencies)) {
			const deps = parseStringArray(
				variantManifest.dependencies,
				`Registry item "${manifest.id}" variant "${variantManifest.id}" dependencies`,
			);
			if (deps) variant.dependencies = deps;
		}

		// Parse the dev dependencies
		if (Array.isArray(variantManifest.devDependencies)) {
			const deps = parseStringArray(
				variantManifest.devDependencies,
				`Registry item "${manifest.id}" variant "${variantManifest.id}" devDependencies`,
			);
			if (deps) variant.devDependencies = deps;
		}
		if (Array.isArray(variantManifest.registryDependencies))
			variant.registryDependencies =
				variantManifest.registryDependencies as RegistryVariant["registryDependencies"];

		variants.push(variant);
	}

	const sharedFiles =
		Array.isArray(manifest.files) && manifest.files.length > 0
			? buildRegistryFiles(itemDir, manifest.id, repoRoot, manifest.files)
			: undefined;
	const dependencies = parseStringArray(
		manifest.dependencies,
		`Registry item "${manifest.id}" dependencies`,
	);
	const devDependencies = parseStringArray(
		manifest.devDependencies,
		`Registry item "${manifest.id}" devDependencies`,
	);

	const item: RegistryItem = {
		id: manifest.id,
		title: manifest.title,
		description: manifest.description,
		type: manifest.type as RegistryItemType,
		...(sharedFiles ? { files: sharedFiles } : {}),
		...(dependencies ? { dependencies } : {}),
		...(devDependencies ? { devDependencies } : {}),
		variants,
	};

	if (Array.isArray(manifest.registryDependencies))
		item.registryDependencies =
			manifest.registryDependencies as RegistryItem["registryDependencies"];

	return item;
}

/**
 * Parse and validate the authored conditions map from registry/conditions.json.
 * @param raw - Raw JSON value.
 * @returns Validated conditions keyed by condition key, or undefined when absent/empty.
 * @throws Error when a condition entry is invalid.
 */
function parseConditions(
	raw: unknown,
): Record<string, RegistryCondition> | undefined {
	// Check if the raw conditions object is valid
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== "object" || Array.isArray(raw))
		throw new Error("Registry conditions must be an object.");

	// Parse the raw conditions object into a key-value map
	const source = raw as Record<string, unknown>;
	const conditions: Record<string, RegistryCondition> = {};

	for (const [key, rawCondition] of Object.entries(source)) {
		if (
			!rawCondition ||
			typeof rawCondition !== "object" ||
			Array.isArray(rawCondition)
		)
			throw new Error(`Registry condition "${key}" must be an object.`);

		const entry = rawCondition as Record<string, unknown>;
		assertNonEmptyString(entry.label, `Registry condition "${key}" label`);

		// Parse the inference mode if it is present
		let inference: RegistryConditionInference | undefined;
		if (entry.inference !== undefined) {
			assertNonEmptyString(
				entry.inference,
				`Registry condition "${key}" inference`,
			);
			const modes = new Set<string>(Object.values(RegistryConditionInference));
			if (!modes.has(entry.inference))
				throw new Error(
					`Registry condition "${key}" has invalid inference "${entry.inference}" (expected one of: ${Object.values(RegistryConditionInference).join(", ")}).`,
				);
			inference = entry.inference as RegistryConditionInference;
		}

		if (!Array.isArray(entry.values) || entry.values.length === 0)
			throw new Error(
				`Registry condition "${key}" must declare at least one value.`,
			);

		const seenValues = new Set<string>();
		const values: RegistryConditionValue[] = [];
		for (const [index, rawValue] of entry.values.entries()) {
			if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue))
				throw new Error(
					`Registry condition "${key}" values[${index}] must be an object.`,
				);

			const valueEntry = rawValue as Record<string, unknown>;
			assertNonEmptyString(
				valueEntry.value,
				`Registry condition "${key}" values[${index}].value`,
			);
			assertNonEmptyString(
				valueEntry.label,
				`Registry condition "${key}" values[${index}].label`,
			);
			if (seenValues.has(valueEntry.value))
				throw new Error(
					`Registry condition "${key}" has duplicate value "${valueEntry.value}".`,
				);
			seenValues.add(valueEntry.value);

			const files = parseStringArray(
				valueEntry.files,
				`Registry condition "${key}" values[${index}].files`,
			);

			values.push({
				value: valueEntry.value,
				label: valueEntry.label,
				...(files ? { files } : {}),
			});
		}

		conditions[key] = {
			label: entry.label,
			...(typeof entry.description === "string" && entry.description.length > 0
				? { description: entry.description }
				: {}),
			...(inference ? { inference } : {}),
			values,
		};
	}

	return Object.keys(conditions).length > 0 ? conditions : undefined;
}

/**
 * Ensure every variant `when` key/value is declared in the conditions map.
 * @param items - Built registry items.
 * @param conditions - Shared condition definitions (may be undefined).
 * @throws Error when a when key is unknown or a when value is undeclared.
 */
function crossValidateWhen(
	items: Record<string, RegistryItem>,
	conditions: Record<string, RegistryCondition> | undefined,
): void {
	// Check each item and variant's when keys and values against the conditions
	for (const item of Object.values(items)) {
		for (const variant of item.variants) {
			if (!variant.when) continue;

			// For each when key and value, check if it is declared in the conditions
			for (const [key, value] of Object.entries(variant.when)) {
				const condition = conditions?.[key];
				if (!condition)
					throw new Error(
						`Registry item "${item.id}" variant "${variant.id}" references unknown when key "${key}".`,
					);
				if (!condition.values.some((entry) => entry.value === value))
					throw new Error(
						`Registry item "${item.id}" variant "${variant.id}" uses undeclared when value "${value}" for key "${key}".`,
					);
			}
		}
	}
}

/**
 * Compile all registry items into registry.json at the repo root.
 * @param repoRoot - Absolute path to the repository root (defaults to process.cwd()).
 * @returns The built registry document that was written to disk.
 * @throws Error when no items are found, an item is invalid, or a duplicate id exists.
 */
export async function buildRegistry(
	repoRoot: string = process.cwd(),
): Promise<Registry> {
	const registryDir = path.join(repoRoot, "registry");
	const outputPath = path.join(repoRoot, "registry.json");

	const itemFolderPaths = collectItemDirs(registryDir);
	if (itemFolderPaths.length === 0)
		throw new Error(`No registry items found under ${registryDir}.`);

	const pkg = await readJSONFileAsync<{ version: string }>(
		path.join(repoRoot, "package.json"),
	);

	// Build the registry items
	const items: Record<string, RegistryItem> = {};
	for (const itemDir of itemFolderPaths) {
		const item = buildRegistryItem(itemDir, repoRoot);
		if (items[item.id])
			throw new Error(`Duplicate registry item id: "${item.id}".`);
		items[item.id] = item;
	}

	// Sort the items by id
	const sortedItems = Object.fromEntries(
		Object.entries(items).sort(([a], [b]) => a.localeCompare(b)),
	);

	// Read the conditions file if it exists
	const conditionsPath = path.join(registryDir, "conditions.json");
	let conditions: Record<string, RegistryCondition> | undefined;
	if (fs.existsSync(conditionsPath)) {
		const rawConditions = JSON.parse(
			fs.readFileSync(conditionsPath, "utf8"),
		) as unknown;
		conditions = parseConditions(rawConditions);
	}

	// Validate the when keys and values against the conditions
	crossValidateWhen(sortedItems, conditions);

	// Use the environment variable for the content base URL if it is set
	const override = process.env.TUCKSHOP_REGISTRY_BASE_URL;
	const contentBaseUrl =
		override && override.length > 0
			? override.replace(/\/+$/, "")
			: `${REGISTRY_REPO_RAW_BASE}/v${pkg.version}`;

	const document: Registry = {
		version: pkg.version,
		contentBaseUrl,
		...(conditions ? { conditions } : {}),
		items: sortedItems,
	};

	await writeFileAsync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
	console.log(
		`Built ${Object.keys(sortedItems).length} registry items at ${chalk.green(path.relative(repoRoot, outputPath))}.`,
	);

	return document;
}
