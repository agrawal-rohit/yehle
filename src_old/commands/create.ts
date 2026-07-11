import path from "node:path";
import chalk from "chalk";
import { primaryText } from "../cli/logger";
import tasks from "../cli/tasks";
import { Language } from "../core/constants";
import { initGitRepo, makeInitialCommit } from "../../src/core/git";
import { writeInstructionToFile } from "../core/ide-formats";
import {
	ensurePackageManager,
	getInstallScript,
	installRegistryPackages,
	LANGUAGE_PACKAGE_MANAGER,
	type PackageManager,
} from "../core/pkg-manager";
import {
	createProjectDirectory,
	getRequiredGithubSecrets,
	installProjectTemplateFromRegistry,
} from "../core/setup";
import { toSlug } from "../../src/core/utils";
import {
	collectInputsForSelection,
	parseCliInputValues,
	resolveInstallContext,
} from "../registry/inputs";
import { assertEmptyTargetDirectory } from "../registry/install";
import { loadRegistry } from "../registry/loader";
import {
	getRegistryItemLanguage,
	type RegistryInstallContext,
} from "../registry/schema";
import {
	promptRegistryInput,
	resolveRegistryTemplateItem,
} from "../registry/select";

export type CreateCommandOptions = {
	template?: string;
	/** Pre-parsed values (tests / advanced). Prefer `cliOptions` from the CLI layer. */
	cliValues?: Partial<RegistryInstallContext>;
	/** Raw CAC options; parsed against the selected template's inputs. */
	cliOptions?: Record<string, unknown>;
};

/**
 * Create a new project from a registry template item.
 * @param options - Optional CLI-style options; prompts when omitted.
 */
export async function createCommand(
	options: CreateCommandOptions = {},
): Promise<void> {
	const registry = await loadRegistry();
	const { itemName, item } = await resolveRegistryTemplateItem(
		options.template,
	);

	const lang = (getRegistryItemLanguage(item) ??
		Language.TYPESCRIPT) as Language;
	const projectSpec = item.projectSpec ?? "package";

	const cliValues =
		options.cliValues ??
		parseCliInputValues(
			options.cliOptions ?? {},
			collectInputsForSelection(
				[itemName],
				registry.items,
				registry.commandInputs?.create,
			),
		);

	const context = await resolveInstallContext({
		rootItemNames: [itemName],
		index: registry.items,
		commandInputs: registry.commandInputs?.create,
		cliValues,
		resolveInput: promptRegistryInput,
		lang,
		command: "create",
	});

	const name = String(context.name);

	let packageManagerVersion = "";
	const packageManager: PackageManager = LANGUAGE_PACKAGE_MANAGER[lang];
	const resolvedTargetDir = path.resolve(process.cwd(), toSlug(name));

	console.log();
	await tasks.runWithTasks("Preflight checks", async () => {
		await assertEmptyTargetDirectory(resolvedTargetDir);
		packageManagerVersion = await ensurePackageManager(packageManager);
	});

	let targetDir = "";
	let installResult: Awaited<
		ReturnType<typeof installProjectTemplateFromRegistry>
	> | null = null;
	await tasks.runWithTasks(`Preparing ${projectSpec}`, undefined, [
		{
			title: `Create ${projectSpec} directory`,
			task: async () => {
				targetDir = await createProjectDirectory(process.cwd(), toSlug(name));
			},
		},
		{
			title: `Install "${itemName}" template`,
			task: async () => {
				installResult = await installProjectTemplateFromRegistry({
					targetDir,
					itemName,
					lang,
					public: Boolean(context.public),
					includeInstructions: Boolean(context.includeInstructions),
					instructionsIdeFormat:
						typeof context.instructionsIdeFormat === "string"
							? context.instructionsIdeFormat
							: undefined,
					authorName:
						typeof context.authorName === "string"
							? context.authorName
							: undefined,
					authorGitUsername:
						typeof context.authorGitUsername === "string"
							? context.authorGitUsername
							: undefined,
					authorGitEmail:
						typeof context.authorGitEmail === "string"
							? context.authorGitEmail
							: undefined,
					name,
					packageManagerVersion,
					writeInstruction: writeInstructionToFile,
					resolveInput: promptRegistryInput,
				});
			},
		},
		{
			title: "Install registry packages",
			task: async () => {
				if (!installResult) return;
				await installRegistryPackages(
					targetDir,
					installResult.dependencies,
					installResult.devDependencies,
				);
			},
		},
	]);

	let githubSecrets: string[] = [];
	await tasks.runWithTasks("Finishing up", undefined, [
		{
			title: "Initialize git",
			task: async () => {
				await initGitRepo(targetDir);
			},
		},
		{
			title: "Make initial commit",
			task: async () => {
				await makeInitialCommit(targetDir);
			},
		},
		{
			title: "Fetch github secrets list",
			task: async () => {
				githubSecrets = await getRequiredGithubSecrets(targetDir);
			},
		},
	]);

	const installCmd = getInstallScript(packageManager);

	let currentStep = 1;
	console.log();
	console.log(
		chalk.bold(
			`${projectSpec.charAt(0).toUpperCase()}${projectSpec.slice(1)} generated successfully! Next steps:`,
		),
	);
	console.log();
	const cdCommand = `cd ${toSlug(name)}`;
	console.log(
		`  ${currentStep}. Enter your ${projectSpec} directory using ${primaryText(cdCommand)},`,
	);
	currentStep += 1;

	console.log(
		`  ${currentStep}. Push your initial commit with ${primaryText("git push -u origin main")}`,
	);
	currentStep += 1;

	if (githubSecrets.length > 0) {
		console.log(
			`  ${currentStep}. Configure the following repository secrets in your GitHub project :`,
		);
		currentStep += 1;
		githubSecrets.forEach((secret) => {
			console.log(`    - ${primaryText(secret)}`);
		});
	}

	console.log(
		`  ${currentStep}. Install dependencies with ${primaryText(installCmd)}`,
	);
	currentStep += 1;

	console.log(`  ${currentStep}. Happy building, fellow wizard!`);

	console.log();
	console.log(
		`Stuck? Open an issue at ${primaryText("https://github.com/agrawal-rohit/tuckshop/issues")}`,
	);
	console.log();
}

export default createCommand;
