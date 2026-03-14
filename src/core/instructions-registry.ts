import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadTemplate } from "giget";
import { IS_LOCAL_MODE } from "./constants";
import { isDirAsync } from "./fs";

/** Path segment for instructions; lives at templates/instructions/. */
const INSTRUCTIONS_PATH = "instructions";

/** Default GitHub owner/repo for remote fetches. */
const DEFAULT_GITHUB_OWNER = "agrawal-rohit";
const DEFAULT_GITHUB_REPO = "yehle";

/** HTTP headers for GitHub API. */
const GITHUB_HEADERS = {
	"User-Agent": "yehle-cli",
	Accept: "application/vnd.github.v3+json",
} as const;

/**
 * Instruction categories:
 * - global-preferences: User-specific preferences applied to all code
 * - language: Coding standards for a particular language
 * - use-case: Instructions for use-case templates (e.g. open-source package vs API)
 * - template: Template-specific instructions (folder structure, libraries, recipes)
 */
export type InstructionCategory =
	| "global-preferences"
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

/**
 * Resolve the local templates root (process.cwd()/templates).
 */
async function getLocalTemplatesRoot(): Promise<string | null> {
	const root = path.resolve(process.cwd(), "templates");
	if (await isDirAsync(root)) return root;
	return null;
}

/**
 * Resolve the directory for an instruction category.
 */
async function getInstructionsCategoryDir(
	category: InstructionCategory,
): Promise<string | null> {
	const root = await getLocalTemplatesRoot();
	if (!root) return null;
	const dir = path.join(root, INSTRUCTIONS_PATH, category);
	if (await isDirAsync(dir)) return dir;
	return null;
}

/**
 * List instruction file basenames (without extension) in a directory.
 * Accepts both .md and .mdc files.
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
	return Array.from(names).sort();
}

/**
 * Parse optional YAML frontmatter from markdown content.
 * Handles description, globs/paths (arrays), alwaysApply/alwaysOn.
 */
function parseFrontmatter(raw: string): InstructionWithFrontmatter {
	const frontmatter: RuleFrontmatter = {};
	let content = raw;
	const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
	if (match) {
		content = match[2] ?? raw;
		const fm = (match[1] ?? "").trim();
		const lines = fm.split("\n");
		let currentKey: string | null = null;
		let currentArray: string[] = [];
		for (const line of lines) {
			const arrayItem = line.match(/^\s*-\s*["']?([^"']*)["']?\s*$/);
			if (arrayItem && currentKey) {
				currentArray.push(arrayItem[1]?.trim() ?? "");
				continue;
			}
			if (
				currentKey &&
				(frontmatter as Record<string, unknown>)[currentKey] === undefined
			) {
				(frontmatter as Record<string, unknown>)[currentKey] =
					currentArray.length > 0 ? [...currentArray] : true;
			}
			currentArray = [];
			const kv = line.match(/^(\w+):\s*(.*)$/);
			if (kv) {
				currentKey = kv[1] ?? null;
				const v = (kv[2] ?? "").trim();
				const key = currentKey;
				if (key === "globs" || key === "paths") {
					// Value might be inline array or start multi-line
					if (v === "[]" || v === "") currentArray = [];
					else if (v.startsWith("[")) {
						const inner = v.slice(1, -1).match(/["']([^"']*)["']/g);
						currentArray = inner ? inner.map((s) => s.slice(1, -1)) : [];
					}
				} else if (key && v === "true")
					(frontmatter as Record<string, unknown>)[key] = true;
				else if (key && v === "false")
					(frontmatter as Record<string, unknown>)[key] = false;
				else if (key && v.startsWith('"') && v.endsWith('"'))
					(frontmatter as Record<string, unknown>)[key] = v.slice(1, -1);
				else if (key && v.startsWith("'") && v.endsWith("'"))
					(frontmatter as Record<string, unknown>)[key] = v.slice(1, -1);
				else if (key && v && key !== "globs" && key !== "paths")
					(frontmatter as Record<string, unknown>)[key] = v;
			}
		}
		if (currentKey && currentArray.length > 0)
			(frontmatter as Record<string, unknown>)[currentKey] = [...currentArray];
		// Normalize alwaysOn -> alwaysApply
		if ("alwaysOn" in frontmatter && frontmatter.alwaysOn !== undefined) {
			frontmatter.alwaysApply = Boolean(frontmatter.alwaysOn);
		}
		if (
			Array.isArray(frontmatter.paths) &&
			frontmatter.paths.length > 0 &&
			!frontmatter.globs
		) {
			frontmatter.globs = frontmatter.paths;
		}
	}
	return { content: content.trim(), frontmatter };
}

/**
 * Find the first existing instruction file for a name (.mdc or .md).
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
 * Build GitHub API Contents URL.
 */
function buildContentsURL(category: InstructionCategory): string {
	return `https://api.github.com/repos/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/contents/templates/${INSTRUCTIONS_PATH}/${category}`;
}

/**
 * Build giget spec for downloading.
 */
function buildGigetSpec(category: InstructionCategory): string {
	return `github:${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/templates/${INSTRUCTIONS_PATH}/${category}`;
}

/**
 * List instruction file basenames from GitHub API.
 * Accepts .md and .mdc files.
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
	return Array.from(names).sort();
}

/**
 * Download remote instructions category to a temp dir.
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
		path.join(res.dir, "templates", INSTRUCTIONS_PATH, category),
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
 */
export async function resolveInstructionsCategoryDir(
	category: InstructionCategory,
): Promise<string> {
	if (IS_LOCAL_MODE) {
		const dir = await getInstructionsCategoryDir(category);
		if (dir) return dir;
		const root = (await getLocalTemplatesRoot()) || "<no templates root>";
		throw new Error(
			`Local instructions not found at ${root}/${INSTRUCTIONS_PATH}/${category}.`,
		);
	}
	return downloadRemoteCategory(category);
}

/**
 * List available instruction names for a category.
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
 * Read instruction content and parse frontmatter.
 * Tries .mdc first, then .md.
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
 * Read instruction content (strips frontmatter, returns body only).
 * For backwards compatibility.
 */
export async function getInstructionContent(
	category: InstructionCategory,
	name: string,
): Promise<string> {
	const { content } = await getInstructionWithFrontmatter(category, name);
	return content;
}
