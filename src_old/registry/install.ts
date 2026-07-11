import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import mustache from "mustache";
import mitLicense from "spdx-license-list/licenses/MIT.json";
import { stripKeyFromJSONFile, writeFileAsync } from "../../src/core/fs";
import type { IdeFormat } from "../core/ide-formats";
import {
	type InstructionCategory,
	type RuleFrontmatter,
	resolveInstructionCategoryFromItemType,
} from "../core/instructions";
import { fetchRegistryFileContent, loadRegistry } from "./loader";
import {
	collectRegistryInputs,
	type ResolvedRegistryItem,
	resolveRegistryPlan,
} from "./resolver";
import {
	evaluateRegistryCondition,
	INSTRUCTION_ITEM_TYPES,
	type RegistryFile,
	type RegistryInput,
	type RegistryInstallContext,
	type RegistryItem,
	RegistryTransformOp,
	shouldInstallFileVisibility,
} from "./schema";

/** Action to take when an install target file already exists. */
export type FileConflictAction = "overwrite" | "skip";

/** Callback invoked when an install would overwrite an existing file. */
export type OnFileConflictFn = (
	targetPath: string,
) => Promise<FileConflictAction>;

/** Resolve a declared input's value (typically by prompting the user). */
export type ResolveInputFn = (
	input: RegistryInput,
	context: RegistryInstallContext,
) => Promise<string | boolean>;

export type InstallRegistryOptions = {
	targetDir: string;
	itemName: string;
	context: RegistryInstallContext;
	/** Supplies values for declared inputs not already present in the context. */
	resolveInput?: ResolveInputFn;
	writeInstruction?: (
		targetDir: string,
		name: string,
		content: string,
		ideFormat: IdeFormat,
		category: InstructionCategory,
		frontmatter: RuleFrontmatter,
	) => Promise<string>;
	/** Called when a file target already exists; defaults to overwrite. */
	onFileConflict?: OnFileConflictFn;
};

export type InstallRegistryResult = {
	itemName: string;
	dependencies: string[];
	devDependencies: string[];
	writtenPaths: string[];
};

/**
 * Render mustache content while preserving GitHub Actions expressions.
 * @param raw - Template source content.
 * @param data - Mustache context.
 * @returns Rendered content.
 */
export function renderMustacheContent(
	raw: string,
	data: Record<string, unknown>,
): string {
	const ghExprPattern = /\$\{\{[\s\S]*?\}\}/g;
	const ghExprs: string[] = [];
	const masked = raw.replaceAll(ghExprPattern, (match) => {
		const token = `__GH_EXPR_${ghExprs.length}__`;
		ghExprs.push(match);
		return token;
	});

	const previousEscape = mustache.escape;
	try {
		mustache.escape = (s: string) => s;
		let rendered = mustache.render(masked, data);
		ghExprs.forEach((expr, index) => {
			const token = `__GH_EXPR_${index}__`;
			rendered = rendered.split(token).join(expr);
		});
		return rendered;
	} finally {
		mustache.escape = previousEscape;
	}
}

/**
 * Apply declarative transforms from resolved registry items to the target directory.
 * @param targetDir - Project root.
 * @param items - Resolved registry items in install order.
 * @param context - Install context for conditional transforms.
 */
async function applyRegistryTransforms(
	targetDir: string,
	items: ResolvedRegistryItem[],
	context: RegistryInstallContext,
): Promise<void> {
	for (const { item } of items) {
		for (const transform of item.transforms ?? []) {
			if (!evaluateRegistryCondition(transform.when, context)) continue;

			const filePath = path.join(targetDir, transform.file);
			switch (transform.op) {
				case RegistryTransformOp.STRIP_JSON_KEY: {
					if (!transform.key)
						throw new Error(
							`Transform stripJsonKey requires key for item "${item.id}".`,
						);
					await stripKeyFromJSONFile(filePath, transform.key);
					break;
				}
				default: {
					const _exhaustive: never = transform.op;
					throw new Error(`Unsupported transform op: ${String(_exhaustive)}.`);
				}
			}
		}
	}
}

/**
 * Write an instruction-like registry item through the IDE output adapter.
 * @param targetDir - Project root.
 * @param item - Registry item of instruction/skill/subagent type.
 * @param rawContent - Fetched file content for the item's first file.
 * @param context - Install context including IDE format.
 * @param writeInstruction - IDE adapter callback.
 */
async function installInstructionItem(
	targetDir: string,
	item: RegistryItem,
	rawContent: string,
	context: RegistryInstallContext,
	writeInstruction: NonNullable<InstallRegistryOptions["writeInstruction"]>,
): Promise<string[]> {
	if (!context.instructionsIdeFormat)
		throw new Error(
			`Registry item "${item.id}" requires instructionsIdeFormat in context.`,
		);

	if (!item.instructionName)
		throw new Error(
			`Registry instruction item "${item.id}" is missing instructionName.`,
		);

	const category = resolveInstructionCategoryFromItemType(item.type, item.id);

	const { data, content } = matter(rawContent);
	const frontmatter = (data ?? {}) as RuleFrontmatter;

	const outputPath = await writeInstruction(
		targetDir,
		item.instructionName,
		content.trim(),
		context.instructionsIdeFormat as IdeFormat,
		category,
		frontmatter,
	);

	return [outputPath];
}

/**
 * Resolve declared inputs across a plan, filling missing values in the context.
 * Inputs already present in the context are kept; inputs whose `when` condition
 * fails are skipped. Missing required inputs throw when no resolver is provided.
 * @param inputs - Declared inputs from the resolved plan.
 * @param context - Install context (mutated in place with resolved values).
 * @param resolveInput - Optional callback to obtain missing values.
 */
export async function resolveRegistryInputs(
	inputs: RegistryInput[],
	context: RegistryInstallContext,
	resolveInput?: ResolveInputFn,
): Promise<void> {
	for (const input of inputs) {
		if (context[input.name] !== undefined) continue;
		if (input.when && !evaluateRegistryCondition(input.when, context)) continue;

		if (!resolveInput) {
			if (input.required)
				throw new Error(
					`Missing required registry input "${input.name}" (no resolver provided).`,
				);
			continue;
		}

		context[input.name] = await resolveInput(input, context);
	}
}

/**
 * Write an MIT LICENSE for public projects that declare an author.
 * @param targetDir - Project root.
 * @param context - Install context.
 * @returns The written license path, or an empty array when not applicable.
 */
async function writeLicenseIfPublic(
	targetDir: string,
	context: RegistryInstallContext,
): Promise<string[]> {
	if (!context.public || !context.authorName) return [];

	const licenseText = mitLicense.licenseText
		.replace("<year>", new Date().getFullYear().toString())
		.replace("<copyright holders>", String(context.authorName));
	const licensePath = path.join(targetDir, "LICENSE");
	await writeFileAsync(licensePath, licenseText);
	return [licensePath];
}

/**
 * Install a registry item (and dependencies) into a target directory.
 * @param options - Install options including target directory, item name, and context.
 * @returns Install result with dependency lists and written paths.
 */
export async function installRegistryItem(
	options: InstallRegistryOptions,
): Promise<InstallRegistryResult> {
	const { items: index, contentBaseUrl } = await loadRegistry();
	const context: RegistryInstallContext = { ...options.context };
	const plan = resolveRegistryPlan(options.itemName, index, context);

	await resolveRegistryInputs(
		collectRegistryInputs(plan.items),
		context,
		options.resolveInput,
	);

	const writtenPaths: string[] = [];
	// Later items win when two items target the same path (dependency-first order).
	const fileByTarget = new Map<string, RegistryFile>();

	for (const { item, variant } of plan.items) {
		const isInstruction = INSTRUCTION_ITEM_TYPES.has(item.type);
		if (!isInstruction) {
			for (const file of variant.files) fileByTarget.set(file.target, file);
			continue;
		}

		if (!options.writeInstruction || !context.includeInstructions) continue;
		const file = variant.files[0];
		if (!file)
			throw new Error(`Registry instruction item "${item.id}" has no files.`);
		const rawContent = await fetchRegistryFileContent(
			file.source,
			contentBaseUrl,
		);
		writtenPaths.push(
			...(await installInstructionItem(
				options.targetDir,
				item,
				rawContent,
				context,
				options.writeInstruction,
			)),
		);
	}

	for (const file of fileByTarget.values()) {
		if (!shouldInstallFileVisibility(file.visibility, context)) continue;

		let content = await fetchRegistryFileContent(file.source, contentBaseUrl);
		if (file.template) content = renderMustacheContent(content, context);

		const outputPath = path.join(options.targetDir, file.target);
		if (fs.existsSync(outputPath) && options.onFileConflict) {
			const action = await options.onFileConflict(outputPath);
			if (action === "skip") continue;
		}

		await writeFileAsync(outputPath, content);
		writtenPaths.push(outputPath);
	}

	await applyRegistryTransforms(options.targetDir, plan.items, context);
	writtenPaths.push(
		...(await writeLicenseIfPublic(options.targetDir, context)),
	);

	return {
		itemName: options.itemName,
		dependencies: plan.dependencies,
		devDependencies: plan.devDependencies,
		writtenPaths,
	};
}

/**
 * Check whether a template item has a playground directory in its files.
 * @param itemName - Registry template item id.
 * @returns True when playground files are present on any variant.
 */
export async function templateHasPlayground(
	itemName: string,
): Promise<boolean> {
	const { items } = await loadRegistry();
	const item = items.get(itemName);
	if (!item) return false;
	return item.variants.some((variant) =>
		variant.files.some((file) => file.target.startsWith("playground/")),
	);
}

/**
 * Ensure target directory is empty or does not exist.
 * @param targetDir - Absolute target path.
 * @throws Error when directory exists and is not empty.
 */
export async function assertEmptyTargetDirectory(
	targetDir: string,
): Promise<void> {
	if (!fs.existsSync(targetDir)) return;

	const files = await fs.promises.readdir(targetDir);
	if (files.length > 0)
		throw new Error(`Target directory is not empty: ${targetDir}`);
}
