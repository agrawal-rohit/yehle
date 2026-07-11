import fs from "node:fs";
import path from "node:path";
import {
	type InstallRegistryOptions,
	type InstallRegistryResult,
	installRegistryItem,
	type ResolveInputFn,
	templateHasPlayground,
} from "../registry/install";
import { ensureDirAsync } from "./fs";

export type WriteInstructionFn = NonNullable<
	InstallRegistryOptions["writeInstruction"]
>;

export type InstallTemplateOptions = {
	targetDir: string;
	itemName: string;
	lang: string;
	public: boolean;
	includeInstructions?: boolean;
	instructionsIdeFormat?: string;
	authorName?: string;
	authorGitUsername?: string;
	authorGitEmail?: string;
	name?: string;
	packageManagerVersion?: string;
	writeInstruction?: WriteInstructionFn;
	resolveInput?: ResolveInputFn;
};

/**
 * Creates the project directory based on the provided project name.
 * @param cwd - Current working directory (e.g., process.cwd()).
 * @param projectName - The name of the project, used as the directory name.
 * @returns The absolute path to the created project directory.
 */
export async function createProjectDirectory(
	cwd: string,
	projectName: string,
): Promise<string> {
	const targetDir = path.resolve(cwd, projectName);
	await ensureDirAsync(targetDir);
	return targetDir;
}

/**
 * Install a project template via the registry resolver.
 * @param options - Template install options.
 * @returns Install result from the registry pipeline.
 */
export async function installProjectTemplateFromRegistry(
	options: InstallTemplateOptions,
): Promise<InstallRegistryResult> {
	const hasPlayground = await templateHasPlayground(options.itemName);

	return installRegistryItem({
		targetDir: options.targetDir,
		itemName: options.itemName,
		context: {
			public: options.public,
			includeInstructions: Boolean(options.includeInstructions),
			instructionsIdeFormat: options.instructionsIdeFormat,
			authorName: options.authorName,
			authorGitUsername: options.authorGitUsername,
			authorGitEmail: options.authorGitEmail,
			name: options.name,
			lang: options.lang,
			packageManagerVersion: options.packageManagerVersion,
			templateHasPlayground: hasPlayground,
		},
		writeInstruction: options.writeInstruction,
		resolveInput: options.resolveInput,
	});
}

/**
 * Scan GitHub workflow files in the project for secrets.* references.
 * Returns the list of secret names (excluding GITHUB_TOKEN).
 *
 * @param targetDir - Absolute path to the project root (e.g. .github/workflows is under here).
 * @returns Promise resolving to a sorted array of secret names (e.g. ["NPM_TOKEN"]).
 */
export async function getRequiredGithubSecrets(
	targetDir: string,
): Promise<string[]> {
	const secrets = new Set<string>();

	try {
		const workflowsDir = path.join(targetDir, ".github", "workflows");
		const entries = await fs.promises.readdir(workflowsDir, {
			withFileTypes: true,
		});
		const files = entries
			.filter((e) => e.isFile())
			.map((e) => path.join(workflowsDir, e.name));

		const secretRegex = /secrets\.([A-Z0-9_]+)/g;
		for (const file of files) {
			const content = await fs.promises.readFile(file, "utf8");
			for (const match of content.matchAll(secretRegex)) {
				const key = match[1];
				if (key && key.toUpperCase() !== "GITHUB_TOKEN") {
					secrets.add(key);
				}
			}
		}
	} catch {
		// No workflows directory found; ignore
	}

	return Array.from(secrets).sort((a, b) => a.localeCompare(b));
}
