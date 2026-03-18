import {
	addProjectInstructions,
	applyTemplateModifications as applyCoreTemplateModifications,
	buildTemplateMetadata,
	type WriteInstructionFn,
} from "../../core/setup";
import { writeInstructionToFile } from "../instructions/ide-formats";
import type { GeneratePackageConfiguration } from "./config";
import { templatePublicPaths } from "./config";

export async function applyTemplateModifications(
	targetDir: string,
	generateConfig: GeneratePackageConfiguration,
	packageManagerVersion: string,
): Promise<void> {
	const templatePath = `package/${generateConfig.template}`;
	const metadata = await buildTemplateMetadata(
		generateConfig.lang,
		templatePath,
		packageManagerVersion,
		generateConfig,
	);

	const publicFiles = [
		...templatePublicPaths.shared,
		...(templatePublicPaths[generateConfig.lang] ?? []),
	];

	await applyCoreTemplateModifications({
		targetDir,
		metadata,
		isPublic: generateConfig.public,
		publicOnlyFiles: publicFiles,
		stripJsonKeys: [{ file: "biome.json", key: "root" }],
	});
}

export async function addPackageInstructions(
	targetDir: string,
	generateConfig: GeneratePackageConfiguration,
): Promise<void> {
	await addProjectInstructions(
		targetDir,
		{
			lang: generateConfig.lang,
			projectSpec: "package",
			template: generateConfig.template,
			includeInstructions: generateConfig.includeInstructions,
			instructionsIdeFormat: generateConfig.instructionsIdeFormat,
		},
		writeInstructionToFile as WriteInstructionFn,
	);
}
