import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadTemplate } from "giget";
import matter from "gray-matter";
import { IS_LOCAL_MODE } from "./constants";
import { isDirAsync } from "./fs";
import {
	DEFAULT_GITHUB_OWNER,
	DEFAULT_GITHUB_REPO,
	GITHUB_HEADERS,
	getLocalInstructionsRoot,
	getLocalTemplatesRoot,
} from "./repo";

/** Path segment for the instructions tree (preferences, use-case, language). */
const INSTRUCTIONS_PATH = "instructions";

/**
 * Instruction categories:
 * - preferences: User preferences (coding style, personal quirks)
 * - language: Language & framework (best practices for a language/framework)
 * - use-case: Use case & architecture (UI, API, monorepo, OSS, extension, etc.)
 * - template: Template-specific (folder setup, commands, workflows; lives in templates/*)
 */
export type InstructionCategory =
	| "preferences"
	| "language"
	| "use-case"
	| "template";

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

const INSTRUCTIONS_UNDER_ROOT = new Set<InstructionCategory>([
	"preferences",
	"use-case",
	"language",
]);

/**
 * Resolve category dir from instructions root, then optional legacy templates/instructions path.
 * @param category - Instruction category (preferences, use-case, or language).
 * @returns The directory path if found, null otherwise.
 */
async function getInstructionsOrLegacyDir(
	category: InstructionCategory,
): Promise<string | null> {
	const instructionsRoot = await getLocalInstructionsRoot();
	if (instructionsRoot) {
		const dir = path.join(instructionsRoot, category);
		if (await isDirAsync(dir)) return dir;
	}
	if (category === "language") return null;
	const templatesRoot = await getLocalTemplatesRoot();
	if (!templatesRoot) return null;
	const legacyDir = path.join(templatesRoot, INSTRUCTIONS_PATH, category);
	return (await isDirAsync(legacyDir)) ? legacyDir : null;
}

/**
 * Resolve the directory for an instruction category on the local filesystem.
 * preferences/use-case/language: ./instructions/<category>; template: ./templates/instructions/<category>.
 * @param category - Instruction category.
 * @returns The directory path if found, null otherwise.
 */
async function getInstructionsCategoryDir(
	category: InstructionCategory,
): Promise<string | null> {
	if (INSTRUCTIONS_UNDER_ROOT.has(category))
		return getInstructionsOrLegacyDir(category);
	const templatesRoot = await getLocalTemplatesRoot();
	if (!templatesRoot) return null;
	const dir = path.join(templatesRoot, INSTRUCTIONS_PATH, category);
	return (await isDirAsync(dir)) ? dir : null;
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
 * @param category - Instruction category.
 * @returns Promise resolving to the absolute path of the category directory.
 * @throws Error when the category is not found (local) or download fails (remote).
 */
export async function resolveInstructionsCategoryDir(
	category: InstructionCategory,
): Promise<string> {
	if (IS_LOCAL_MODE) {
		const dir = await getInstructionsCategoryDir(category);
		if (dir) return dir;

		// Provide a helpful error that reflects the instructions/ layout (and legacy for template).
		const instructionsRoot =
			(await getLocalInstructionsRoot()) || "<no instructions root>";
		const extra =
			category === "template"
				? ` and ${(await getLocalTemplatesRoot()) || "<no templates root>"}/${INSTRUCTIONS_PATH}/${category}`
				: "";
		throw new Error(
			`Local instructions not found for category "${category}". Checked ${instructionsRoot}/${category}${extra}.`,
		);
	}
	return downloadRemoteCategory(category);
}

/**
 * List available instruction names (basenames without extension) for a category.
 * @param category - Instruction category.
 * @returns Promise resolving to a sorted array of instruction names.
 * @throws Error when the GitHub API fails in remote mode.
 */
export async function listAvailableInstructions(
	category: InstructionCategory,
): Promise<string[]> {
	if (IS_LOCAL_MODE) {
		const dir = await getInstructionsCategoryDir(category);
		if (!dir) return [];
		return listInstructionFiles(dir);
	}
	return listRemoteInstructionFiles(category);
}

/**
 * Read an instruction file and parse its content and frontmatter. Tries .mdc first, then .md.
 * @param category - Instruction category.
 * @param name - Instruction name (basename without extension).
 * @returns Promise resolving to content (body) and normalized frontmatter.
 * @throws Error when the instruction is not found or file read fails.
 */
export async function getInstructionWithFrontmatter(
	category: InstructionCategory,
	name: string,
): Promise<InstructionWithFrontmatter> {
	const dir = await resolveInstructionsCategoryDir(category);
	const filePath = await findInstructionFilePath(dir, name);

	if (!filePath)
		throw new Error(
			`Instruction "${name}" not found in ${category} (looked for .mdc and .md).`,
		);
	const raw = await fs.promises.readFile(filePath, "utf8");
	return parseFrontmatter(raw);
}

/**
 * Read instruction body only (strips frontmatter). Delegates to getInstructionWithFrontmatter.
 * @param category - Instruction category.
 * @param name - Instruction name (basename without extension).
 * @returns Promise resolving to the markdown body string.
 * @throws Error when the instruction is not found or file read fails.
 */
export async function getInstructionContent(
	category: InstructionCategory,
	name: string,
): Promise<string> {
	const { content } = await getInstructionWithFrontmatter(category, name);
	return content;
}
