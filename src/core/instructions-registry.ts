import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadTemplate } from "giget";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { IS_LOCAL_MODE } from "./constants";
import { isDirAsync } from "./fs";
import {
	DEFAULT_GITHUB_OWNER,
	DEFAULT_GITHUB_REPO,
	GITHUB_HEADERS,
	getLocalTemplatesRoot,
} from "./registry";
import { NON_TEMPLATE_DIR_NAMES } from "./template-registry";

/** Path segment for the instructions tree under templates or cwd. */
const INSTRUCTIONS_PATH = "instructions";

/**
 * Instruction categories:
 * - essential: Common coding styles (default)
 * - optional: Optional/situational (e.g. react, node); anything extra based on project setup
 * - language: Per-language (e.g. typescript); lives in templates/<lang>/instructions/
 * - project-spec: Per project-spec (e.g. package); lives in templates/<lang>/<project-spec>/instructions/
 * - template: Template-specific; lives in templates/<lang>/<project-spec>/<template>/instructions/
 */
export enum InstructionCategory {
	ESSENTIAL = "essential",
	OPTIONAL = "optional",
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

/**
 * Parsed frontmatter from a rule file.
 * Used as defaults when prompting for globs/alwaysApply.
 */
export type RuleFrontmatter = {
	description?: string;
	globs?: string[];
	paths?: string[];
	alwaysApply?: boolean;
	alwaysOn?: boolean;
};

/**
 * Result of reading an instruction file: content and optional frontmatter.
 */
export type InstructionWithFrontmatter = {
	content: string;
	frontmatter: RuleFrontmatter;
};

/** Categories that live under templates/instructions/. */
const GLOBAL_CATEGORIES = new Set<InstructionCategory>([
	InstructionCategory.ESSENTIAL,
	InstructionCategory.OPTIONAL,
]);

/**
 * Resolve directory for essential/optional: templates/instructions/<category>.
 * @param category - essential or optional.
 * @returns The directory path if found, null otherwise.
 */
async function getGlobalInstructionsDir(
	category: InstructionCategory,
): Promise<string | null> {
	const templatesRoot = await getLocalTemplatesRoot();
	if (!templatesRoot) return null;
	const dir = path.join(templatesRoot, INSTRUCTIONS_PATH, category);
	return (await isDirAsync(dir)) ? dir : null;
}

/**
 * Resolve the directory for an instruction category on the local filesystem.
 * essential/optional: templates/instructions/<category>.
 * language: templates/<lang>/instructions (requires context.lang).
 * project-spec: templates/<lang>/<projectSpec>/instructions (requires context.lang, context.projectSpec).
 * template: templates/<lang>/<projectSpec>/<template>/instructions (requires full context).
 * @param category - Instruction category.
 * @param context - Required for language, project-spec, template (lang, projectSpec, template).
 * @returns The directory path if found, null otherwise.
 */
async function getInstructionsCategoryDir(
	category: InstructionCategory,
	context?: InstructionContext,
): Promise<string | null> {
	if (GLOBAL_CATEGORIES.has(category))
		return getGlobalInstructionsDir(category);

	const templatesRoot = await getLocalTemplatesRoot();
	if (!templatesRoot || !context?.lang) return null;

	const langDir = path.join(templatesRoot, context.lang);
	if (!(await isDirAsync(langDir))) return null;

	if (category === InstructionCategory.LANGUAGE) {
		const dir = path.join(langDir, INSTRUCTIONS_PATH);
		return (await isDirAsync(dir)) ? dir : null;
	}

	if (category === InstructionCategory.PROJECT_SPEC && context.projectSpec) {
		const projectSpecDir = path.join(langDir, context.projectSpec);
		if (!(await isDirAsync(projectSpecDir))) return null;
		const dir = path.join(projectSpecDir, INSTRUCTIONS_PATH);
		return (await isDirAsync(dir)) ? dir : null;
	}

	if (
		category === InstructionCategory.TEMPLATE &&
		context.projectSpec &&
		context.template
	) {
		const templateDir = path.join(
			langDir,
			context.projectSpec,
			context.template,
		);
		if (!(await isDirAsync(templateDir))) return null;
		const dir = path.join(templateDir, INSTRUCTIONS_PATH);
		return (await isDirAsync(dir)) ? dir : null;
	}

	return null;
}

/**
 * List instruction file basenames (without extension) in a directory. Accepts .md and .mdc.
 * @param dir - Directory to scan.
 * @returns Sorted array of instruction names (no extension).
 */
async function listInstructionFiles(dir: string): Promise<string[]> {
	if (!(await isDirAsync(dir))) return [];
	const entries = await fs.promises.readdir(dir, { withFileTypes: true });
	const names = new Set<string>();
	for (const e of entries) {
		if (!e.isFile()) continue;
		for (const ext of INSTRUCTION_EXTENSIONS) {
			if (e.name.endsWith(ext)) {
				names.add(e.name.slice(0, -ext.length));
				break;
			}
		}
	}
	return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/**
 * Normalize gray-matter data into RuleFrontmatter (alwaysOn -> alwaysApply, paths -> globs).
 * @param data - Raw frontmatter object from gray-matter.
 * @returns Normalized RuleFrontmatter.
 */
function toRuleFrontmatter(data: Record<string, unknown>): RuleFrontmatter {
	const frontmatter: RuleFrontmatter = {};
	if (typeof data.description === "string")
		frontmatter.description = data.description;
	if (Array.isArray(data.globs))
		frontmatter.globs = data.globs.filter(
			(x): x is string => typeof x === "string",
		);
	if (Array.isArray(data.paths))
		frontmatter.paths = data.paths.filter(
			(x): x is string => typeof x === "string",
		);
	// Normalize alwaysOn -> alwaysApply; prefer explicit alwaysApply
	if (data.alwaysApply === true || data.alwaysApply === false)
		frontmatter.alwaysApply = data.alwaysApply;
	else if (data.alwaysOn === true || data.alwaysOn === false)
		frontmatter.alwaysApply = data.alwaysOn;
	if (
		Array.isArray(frontmatter.paths) &&
		frontmatter.paths.length > 0 &&
		!frontmatter.globs
	)
		frontmatter.globs = frontmatter.paths;
	return frontmatter;
}

/**
 * Parse optional YAML frontmatter from markdown content using gray-matter.
 * @param raw - Raw markdown string (may include frontmatter).
 * @returns Parsed content (trimmed) and normalized frontmatter.
 */
function parseFrontmatter(raw: string): InstructionWithFrontmatter {
	const { data, content } = matter(raw);
	const frontmatter = toRuleFrontmatter(
		(data ?? {}) as Record<string, unknown>,
	);
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
	for (const ext of INSTRUCTION_EXTENSIONS) {
		const fp = path.join(dir, `${name}${ext}`);
		try {
			await fs.promises.access(fp, fs.constants.R_OK);
			return fp;
		} catch {
			// continue
		}
	}
	return null;
}

/**
 * Build GitHub API Contents URL for an instructions category.
 * @param category - Instruction category.
 * @returns The GitHub API URL string.
 */
function buildContentsURL(category: InstructionCategory): string {
	return `https://api.github.com/repos/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/contents/${INSTRUCTIONS_PATH}/${category}`;
}

/**
 * Build giget spec for downloading an instructions category.
 * @param category - Instruction category.
 * @returns The giget spec string.
 */
function buildGigetSpec(category: InstructionCategory): string {
	return `github:${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/${INSTRUCTIONS_PATH}/${category}`;
}

/**
 * List instruction file basenames from GitHub API for a category. Accepts .md and .mdc.
 * @param category - Instruction category.
 * @returns Sorted array of instruction names.
 * @throws Error when the API request fails or response is invalid.
 */
async function listRemoteInstructionFiles(
	category: InstructionCategory,
): Promise<string[]> {
	const url = buildContentsURL(category);
	const res = await fetch(url, { headers: GITHUB_HEADERS });
	if (!res.ok)
		throw new Error(
			`Failed to fetch from GitHub API: ${res.status} ${res.statusText}`,
		);
	const data = (await res.json()) as { type?: string; name?: string }[];
	if (!Array.isArray(data))
		throw new Error(
			"Invalid response from GitHub API: expected array of contents",
		);
	const names = new Set<string>();
	for (const entry of data) {
		if (entry?.type !== "file" || typeof entry.name !== "string") continue;
		for (const ext of INSTRUCTION_EXTENSIONS) {
			if (entry.name.endsWith(ext)) {
				names.add(entry.name.slice(0, -ext.length));
				break;
			}
		}
	}
	return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/**
 * Download a remote instructions category to a temp directory.
 * @param category - Instruction category.
 * @returns Promise resolving to the path of the downloaded category directory.
 */
async function downloadRemoteCategory(
	category: InstructionCategory,
): Promise<string> {
	const spec = buildGigetSpec(category);
	const tmpRoot = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "yehle-instructions-"),
	);
	const res = await downloadTemplate(spec, { dir: tmpRoot, force: true });
	const candidates = [
		path.join(res.dir, INSTRUCTIONS_PATH, category),
		path.join(res.dir, category),
		res.dir,
	];
	for (const cand of candidates) {
		if (await isDirAsync(cand)) return cand;
	}
	return res.dir;
}

/**
 * Resolve the directory for an instruction category (local or remote).
 * For language, project-spec, template a context with lang (and projectSpec, template as needed) must be provided.
 * @param category - Instruction category.
 * @param context - Required for language, project-spec, template (lang, projectSpec, template).
 * @returns Promise resolving to the absolute path of the category directory.
 * @throws Error when the category is not found (local) or download fails (remote).
 */
export async function resolveInstructionsCategoryDir(
	category: InstructionCategory,
	context?: InstructionContext,
): Promise<string> {
	if (IS_LOCAL_MODE) {
		const dir = await getInstructionsCategoryDir(category, context);
		if (dir) return dir;

		const templatesRoot =
			(await getLocalTemplatesRoot()) || "<no templates root>";
		const hint = GLOBAL_CATEGORIES.has(category)
			? `Checked ${templatesRoot}/${INSTRUCTIONS_PATH}/${category}.`
			: context?.lang
				? `Checked ${templatesRoot}/${context.lang}/... for category "${category}".`
				: `Category "${category}" requires context (lang, projectSpec, template).`;
		throw new Error(
			`Local instructions not found for category "${category}". ${hint}`,
		);
	}
	// Remote mode: only essential and optional are fetched from GitHub instructions/.
	if (!GLOBAL_CATEGORIES.has(category))
		throw new Error(
			`Remote instructions for category "${category}" are not supported; use local templates.`,
		);
	return downloadRemoteCategory(category);
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
	if (IS_LOCAL_MODE) {
		const dir = await getInstructionsCategoryDir(category, context);
		if (!dir) return [];
		return listInstructionFiles(dir);
	}
	return listRemoteInstructionFiles(category);
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
	const dir = await resolveInstructionsCategoryDir(category, context);
	const filePath = await findInstructionFilePath(dir, name);

	if (!filePath)
		throw new Error(
			`Instruction "${name}" not found in ${category} (looked for .mdc and .md).`,
		);
	const raw = await fs.promises.readFile(filePath, "utf8");
	return parseFrontmatter(raw);
}

/**
 * List language directory names (e.g. "typescript") by scanning templates/.
 * Excludes shared and instructions (see NON_TEMPLATE_DIR_NAMES). Used by standalone instructions flow to discover languages.
 * @returns Promise resolving to sorted array of language names; empty if templates root not found.
 */
export async function listLanguageNames(): Promise<string[]> {
	const root = await getLocalTemplatesRoot();
	if (!root) return [];
	const entries = await fs.promises.readdir(root, { withFileTypes: true });
	const names = entries
		.filter(
			(e) =>
				e.isDirectory() && !NON_TEMPLATE_DIR_NAMES.has(e.name.toLowerCase()),
		)
		.map((e) => e.name)
		.sort((a, b) => a.localeCompare(b));
	return names;
}

/**
 * List project-spec directory names for a language (e.g. "package") by scanning templates/<lang>/.
 * Excludes shared and instructions (see NON_TEMPLATE_DIR_NAMES). Used by standalone instructions flow to discover project-specs.
 * @param lang - Language key (e.g. typescript).
 * @returns Promise resolving to sorted array of project-spec names; empty if lang dir not found.
 */
export async function listProjectSpecNames(lang: string): Promise<string[]> {
	const root = await getLocalTemplatesRoot();
	if (!root) return [];
	const langDir = path.join(root, lang);
	if (!(await isDirAsync(langDir))) return [];
	const entries = await fs.promises.readdir(langDir, { withFileTypes: true });
	const names = entries
		.filter(
			(e) =>
				e.isDirectory() && !NON_TEMPLATE_DIR_NAMES.has(e.name.toLowerCase()),
		)
		.map((e) => e.name)
		.sort((a, b) => a.localeCompare(b));
	return names;
}

/** Filename for the optional-instructions mapping in a template or project-spec dir. */
export const YEHLE_INSTRUCTIONS_FILENAME = "yehle.yaml";

/** Schema for yehle.yaml: optionalInstructions lists optional instruction names to apply for this template. */
export type YehleInstructionsMapping = {
	optionalInstructions?: string[];
};

/**
 * Read the optional instructions mapping from a template or project-spec directory.
 * Looks for yehle.yaml with optionalInstructions: string[]. No file or invalid/missing array returns [].
 * @param templateOrProjectSpecDir - Absolute path to the template dir (e.g. .../package/react) or project-spec dir.
 * @returns Promise resolving to the list of optional instruction names to apply; empty if not found or invalid.
 */
export async function readOptionalInstructionsMapping(
	templateOrProjectSpecDir: string,
): Promise<string[]> {
	const filePath = path.join(
		templateOrProjectSpecDir,
		YEHLE_INSTRUCTIONS_FILENAME,
	);
	try {
		const raw = await fs.promises.readFile(filePath, "utf8");
		const data = parseYaml(raw) as unknown;
		if (data && typeof data === "object") {
			const list = (data as YehleInstructionsMapping).optionalInstructions;
			if (Array.isArray(list)) return list;
		}
	} catch {
		// No file or invalid YAML
	}
	return [];
}
