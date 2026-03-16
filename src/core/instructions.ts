import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import {
	IS_LOCAL_MODE,
	YEHLE_CONFIGURATION_FILENAME,
	type YehleConfiguration,
} from "./constants";
import { isDirAsync } from "./fs";
import { getLocalRoot, resolveLocalTemplatesSubpath } from "./registry.local";
import { listRemoteFilesViaAPI, resolveRemoteSubpath } from "./registry.remote";

/** Path segment for the instructions tree under templates. */
const INSTRUCTIONS_PATH = "instructions";
const TEMPLATES_SEGMENT = "templates";

/**
 * Instruction categories:
 * - essential: Essential instructions like code style, testing patterns, etc.
 * - tooling: Tool/framework-specific best-practice rules that apply when extra tools are present in the repo
 *            (e.g. React/Next.js/Vue conventions, Snyk/SonarQube usage, tracing/monitoring tools, CI providers).
 * - language: Language-specific instructions (e.g. typescript, python, etc.).
 * - project-spec: Project-spec-specific instructions (e.g. package, app, monorepo, etc.).
 * - template: Template-specific instructions like folder structure, commands, workflows, etc.
 * - skills: Specialised, multi-step workflows that describe how to execute complex tasks end-to-end
 *           (e.g. versioned deploy flows, performance optimisation loops, incident playbooks, migrations).
 */
export enum InstructionCategory {
	ESSENTIAL = "essential",
	TOOLING = "tooling",
	SKILLS = "skills",
	LANGUAGE = "language",
	PROJECT_SPEC = "project-spec",
	TEMPLATE = "template",
}

/** Context required to resolve scoped categories (language, project-spec, template). */
export type InstructionContext = {
	lang?: string;
	projectSpec?: string;
	template?: string;
};

/** File extensions for instruction rules (.md and .mdc). */
const INSTRUCTION_EXTENSIONS = [".mdc", ".md"] as const;

/** Frontmatter for a rule (non-skill instructions). */
export type RuleFrontmatter = {
	description?: string;
	paths?: string[];
	alwaysApply?: boolean;
};

/** Result of reading an instruction file: content and frontmatter.*/
export type InstructionWithFrontmatter = {
	content: string;
	frontmatter: RuleFrontmatter;
};

/**
 * List instruction file names in a directory.
 * @param dir - Directory to list instruction files from.
 * @returns Sorted array of instruction file names.
 */
async function listInstructionFiles(dir: string): Promise<string[]> {
	if (!(await isDirAsync(dir))) return [];
	const entries = await fs.promises.readdir(dir, { withFileTypes: true });
	const names = new Set<string>();

	// We need to filter out the entries that are not files.
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		for (const extension of INSTRUCTION_EXTENSIONS) {
			if (entry.name.endsWith(extension)) {
				names.add(entry.name.slice(0, -extension.length));
				break;
			}
		}
	}
	return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/**
 * Parse instruction file content and frontmatter.
 * @param raw - Raw instruction file content.
 * @returns Parsed content and frontmatter.
 */
function parseInstructionFile(raw: string): InstructionWithFrontmatter {
	const { data, content } = matter(raw);
	const fm = (data ?? {}) as Record<string, unknown>;

	const frontmatter: RuleFrontmatter = {};

	// Description
	if (typeof fm.description === "string")
		frontmatter.description = fm.description;

	// Paths
	const paths = Array.isArray(fm.paths)
		? fm.paths.filter((x): x is string => typeof x === "string")
		: [];
	if (paths.length > 0) frontmatter.paths = paths;

	// Always apply flag
	if (fm.alwaysApply === true || fm.alwaysApply === false)
		frontmatter.alwaysApply = fm.alwaysApply;

	return { content: content.trim(), frontmatter };
}

/**
 * Find the first existing instruction file for a name (.mdc or .md).
 * @param dir - Directory to look in.
 * @param name - Instruction basename (no extension).
 * @returns Full path to the file if found, null otherwise.
 */
async function findInstructionFilePath(
	dir: string,
	name: string,
): Promise<string | null> {
	for (const extension of INSTRUCTION_EXTENSIONS) {
		const filePath = path.join(dir, `${name}${extension}`);
		try {
			await fs.promises.access(filePath, fs.constants.R_OK);
			return filePath;
		} catch {
			// continue
		}
	}
	return null;
}

/**
 * Get the subpath for an instruction category.
 * @param category - Instruction category.
 * @param context - Required for language, project-spec, template.
 * @returns The subpath for the instruction category.
 */
function getInstructionsSubpath(
	category: InstructionCategory,
	context?: InstructionContext,
): string {
	switch (category) {
		case InstructionCategory.ESSENTIAL:
			return `${TEMPLATES_SEGMENT}/${INSTRUCTIONS_PATH}/${InstructionCategory.ESSENTIAL}`;

		case InstructionCategory.TOOLING:
			return `${TEMPLATES_SEGMENT}/${INSTRUCTIONS_PATH}/${InstructionCategory.TOOLING}`;

		case InstructionCategory.SKILLS:
			return `${TEMPLATES_SEGMENT}/${INSTRUCTIONS_PATH}/${InstructionCategory.SKILLS}`;

		case InstructionCategory.LANGUAGE:
			if (!context?.lang)
				throw new Error(
					`Instruction category "${category}" requires a language context.`,
				);
			return `${TEMPLATES_SEGMENT}/${context.lang}/${INSTRUCTIONS_PATH}`;

		case InstructionCategory.PROJECT_SPEC:
			if (!context?.lang || !context?.projectSpec)
				throw new Error(
					`Instruction category "${category}" requires language and projectSpec context.`,
				);
			return `${TEMPLATES_SEGMENT}/${context.lang}/${context.projectSpec}/${INSTRUCTIONS_PATH}`;

		case InstructionCategory.TEMPLATE:
			if (!context?.lang || !context?.projectSpec || !context?.template)
				throw new Error(
					`Instruction category "${category}" requires language, projectSpec, and template context.`,
				);
			return `${TEMPLATES_SEGMENT}/${context.lang}/${context.projectSpec}/${context.template}/${INSTRUCTIONS_PATH}`;

		default:
			throw new Error(`Unknown instruction category: "${category}".`);
	}
}

/**
 * Download a remote instructions category to a temp directory.
 * Path matches local layout (same as getLocalInstructionsDir).
 * @param category - Instruction category.
 * @param context - Required for language, project-spec, template.
 * @returns Promise resolving to the path of the downloaded category directory.
 * @throws Error when context is missing for scoped category or download fails.
 */
async function downloadRemoteInstructionsDir(
	category: InstructionCategory,
	context?: InstructionContext,
): Promise<string> {
	const subpath = getInstructionsSubpath(category, context);
	const remoteDir = await resolveRemoteSubpath(
		subpath,
		"yehle-instructions-",
		async (downloadedDir) => {
			const candidateDir = path.join(downloadedDir, ...subpath.split("/"));
			return (await isDirAsync(candidateDir)) ? candidateDir : downloadedDir;
		},
	);
	return remoteDir;
}

/**
 * Resolve the directory for an instruction category (local or remote).
 * For language, project-spec, template a context with lang (and projectSpec, template as needed) must be provided.
 * @param category - Instruction category.
 * @param context - Required for language, project-spec, template (lang, projectSpec, template).
 * @returns Promise resolving to the absolute path of the category directory.
 * @throws Error when the category is not found (local) or download fails (remote).
 */
export async function resolveInstructionsDir(
	category: InstructionCategory,
	context?: InstructionContext,
): Promise<string> {
	// Local mode
	if (IS_LOCAL_MODE) {
		const subpath = getInstructionsSubpath(category, context);
		const dir = await resolveLocalTemplatesSubpath(subpath);
		if (dir && (await isDirAsync(dir))) return dir;

		const root = await getLocalRoot("templates");
		if (!root) throw new Error(`No local templates root found.`);

		const expectedPath = getInstructionsSubpath(category, context);
		throw new Error(
			`Local instructions not found for category "${category}". Expected directory at ${path.join(
				root,
				...expectedPath.split("/").slice(1),
			)}.`,
		);
	}

	// Remote mode
	return await downloadRemoteInstructionsDir(category, context);
}

/**
 * List available instruction names (basenames without extension) for a category.
 * For language, project-spec, template pass context so the correct directory is resolved.
 * @param category - Instruction category.
 * @param context - Required for language, project-spec, template.
 * @returns Promise resolving to a sorted array of instruction names.
 * @throws Error when the GitHub API fails in remote mode.
 */
export async function listAvailableInstructions(
	category: InstructionCategory,
	context?: InstructionContext,
): Promise<string[]> {
	const subpath = getInstructionsSubpath(category, context);

	// Local mode
	if (IS_LOCAL_MODE) {
		const dir = await resolveLocalTemplatesSubpath(subpath);
		if (!dir) return [];
		return listInstructionFiles(dir);
	}

	// Remote mode
	return listRemoteFilesViaAPI(subpath, INSTRUCTION_EXTENSIONS);
}

/**
 * Read an instruction file and parse its content and frontmatter. Tries .mdc first, then .md.
 * For language, project-spec, template pass context so the correct directory is resolved.
 * @param category - Instruction category.
 * @param name - Instruction name (basename without extension).
 * @param context - Required for language, project-spec, template.
 * @returns Promise resolving to content (body) and normalized frontmatter.
 * @throws Error when the instruction is not found or file read fails.
 */
export async function getInstructionWithFrontmatter(
	category: InstructionCategory,
	name: string,
	context?: InstructionContext,
): Promise<InstructionWithFrontmatter> {
	const dir = await resolveInstructionsDir(category, context);
	const filePath = await findInstructionFilePath(dir, name);

	if (!filePath)
		throw new Error(
			`Instruction "${name}" not found in ${category} (looked for .mdc and .md).`,
		);
	const raw = await fs.promises.readFile(filePath, "utf8");
	return parseInstructionFile(raw);
}

/**
 * Read the tooling instructions mapping from a template or project-spec directory.
 * Looks for yehle.yaml with toolingInstructions: string[].
 * No file or invalid/missing array returns [].
 * @param templateOrProjectSpecDir - Absolute path to the template dir (e.g. .../package/react) or project-spec dir.
 * @returns Promise resolving to the list of tooling instruction names to apply; empty if not found or invalid.
 */
export async function readToolingInstructionsMapping(
	templateOrProjectSpecDir: string,
): Promise<string[]> {
	const filePath = path.join(
		templateOrProjectSpecDir,
		YEHLE_CONFIGURATION_FILENAME,
	);

	try {
		const raw = await fs.promises.readFile(filePath, "utf8");
		const data = parseYaml(raw) as unknown;
		if (data && typeof data === "object") {
			const cfg = data as YehleConfiguration;
			if (Array.isArray(cfg.toolingInstructions))
				return cfg.toolingInstructions;
		}
	} catch {
		// No file or invalid YAML
	}
	return [];
}

/**
 * Read the skills mapping from a template or project-spec directory.
 * Looks for yehle.yaml with skills: string[]. No file or invalid/missing array returns [].
 * @param templateOrProjectSpecDir - Absolute path to the template dir (e.g. .../package/react) or project-spec dir.
 * @returns Promise resolving to the list of skill instruction names to apply; empty if not found or invalid.
 */
export async function readSkillsMapping(
	templateOrProjectSpecDir: string,
): Promise<string[]> {
	const filePath = path.join(
		templateOrProjectSpecDir,
		YEHLE_CONFIGURATION_FILENAME,
	);

	try {
		const raw = await fs.promises.readFile(filePath, "utf8");
		const data = parseYaml(raw) as unknown;
		if (data && typeof data === "object") {
			const list = (data as YehleConfiguration).skills;
			if (Array.isArray(list)) return list;
		}
	} catch {
		// No file or invalid YAML
	}
	return [];
}
