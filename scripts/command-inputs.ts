import {
	type RegistryCommandInputs,
	RegistryInputOptionsFrom,
	RegistryInputType,
} from "../src_old/registry/schema";

/** Shared `tuckshop add` command inputs merged into registry.json at build time. */
export const REGISTRY_COMMAND_INPUTS: RegistryCommandInputs = {
	add: [
		{
			name: "public",
			type: RegistryInputType.BOOLEAN,
			prompt:
				"Is the target project public? (controls license, community files, and public-only content)",
			default: false,
		},
		{
			name: "includeInstructions",
			type: RegistryInputType.BOOLEAN,
			prompt: "Include agent instructions?",
			default: false,
		},
		{
			name: "instructionsIdeFormat",
			type: RegistryInputType.SELECT,
			prompt: "Which IDE should the instructions be written for?",
			when: "includeInstructions",
			optionsFrom: RegistryInputOptionsFrom.IDE_FORMATS,
		},
		{
			name: "framework",
			type: RegistryInputType.STRING,
			prompt: "Target framework for cross-framework items (e.g., react, vue)",
		},
	],
};
