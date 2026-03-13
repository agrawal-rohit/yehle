import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import logger, { primaryText } from "../../cli/logger";
import tasks, { conditionalTask } from "../../cli/tasks";
import { initGitRepo, makeInitialCommit } from "../../core/git";
import {
	ensurePackageManager,
	getInstallScript,
	LANGUAGE_PACKAGE_MANAGER,
	type PackageManager,
} from "../../core/pkg-manager";
import { toSlug } from "../../core/utils";
import {
	type GeneratePackageConfiguration,
	getGeneratePackageConfiguration,
} from "./config";
import {
	addPackageInstructions,
	applyTemplateModifications,
	createPackageDirectory,
	getRequiredGithubSecrets,
	writePackageTemplateFiles,
} from "./setup";

export async function generatePackage(
	options: Partial<GeneratePackageConfiguration> = {},
): Promise<void> {
	await logger.intro("generating package...");

	// Gather configuration (skip prompts when options are provided)
	const generateConfig = await getGeneratePackageConfiguration({
		lang: options.lang,
		name: options.name,
		template: options.template,
		public: options.public,
	});

	let packageManagerVersion = "";
	const packageManager: PackageManager =
		LANGUAGE_PACKAGE_MANAGER[generateConfig.lang];
	const resolvedTargetDir = path.resolve(
		process.cwd(),
		toSlug(generateConfig.name),
	);

	// Preflight checks
	console.log();
	await tasks.runWithTasks("Preflight checks", async () => {
		// Check target directory
		let isEmpty = true;
		if (fs.existsSync(resolvedTargetDir)) {
			try {
				const files = fs.readdirSync(resolvedTargetDir);
				isEmpty = files.length === 0;
			} catch {
				isEmpty = true;
			}
		}

		if (!isEmpty)
			throw new Error(`Target directory is not empty: ${resolvedTargetDir}`);

		// Check package manager availability
		packageManagerVersion = await ensurePackageManager(packageManager);
	});

	// Create the package
	let targetDir = "";
	await tasks.runWithTasks("Preparing package", undefined, [
		{
			title: "Create package directory",
			task: async () => {
				targetDir = await createPackageDirectory(
					process.cwd(),
					toSlug(generateConfig.name),
				);
			},
		},
		{
			title: `Add "${generateConfig.template}" template`,
			task: async () => {
				await writePackageTemplateFiles(targetDir, generateConfig);
			},
		},
		{
			title: "Modify template with user preferences",
			task: async () => {
				await applyTemplateModifications(
					targetDir,
					generateConfig,
					packageManagerVersion,
				);
			},
		},
		...conditionalTask(Boolean(generateConfig.includeInstructions), {
			title: "Add agent instructions",
			task: async () => {
				await addPackageInstructions(targetDir, generateConfig);
			},
		}),
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
	console.log(chalk.bold("Package generated successfully! Next steps:"));
	console.log();
	const cdCommand = `cd ${toSlug(generateConfig.name)}`;
	console.log(
		`  ${currentStep}. Enter your package directory using ${primaryText(cdCommand)},`,
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
		`Stuck? Open an issue at ${primaryText("https://github.com/agrawal-rohit/yehle/issues")}`,
	);
	console.log();
}

export default generatePackage;
