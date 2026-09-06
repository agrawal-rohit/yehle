import type { ConditionHandler } from "@tuckshop/core";

/** Marker files used to detect which IDE or coding agent a project is configured for. */
const IDE_MARKERS: ReadonlyArray<{ value: string; paths: string[] }> = [
	{ value: "cursor", paths: [".cursor/rules", ".cursorrules", ".cursor/settings.json"] },
	{ value: "claude-code", paths: [".claude/config.json", ".claude.json", "CLAUDE.md"] },
	{
		value: "copilot",
		paths: [".github/copilot-instructions.md"],
	},
	{ value: "codex", paths: ["AGENTS.md"] },
	{ value: "opencode", paths: ["opencode.json"] },
];

/** Suggest an IDE format from existing project markers. */
const handler: ConditionHandler = {
	async infer(ctx) {
		const allowed = new Set((ctx.values ?? []).map((entry) => entry.value));
		const detected: string[] = [];
		for (const candidate of IDE_MARKERS) {
			if (!allowed.has(candidate.value)) continue;
			const present = await Promise.all(
				candidate.paths.map((path) => ctx.isFile(path)),
			);
			if (present.some(Boolean)) detected.push(candidate.value);
		}
		return detected.length > 0 ? detected[0] : undefined;
	},
};

export default handler;