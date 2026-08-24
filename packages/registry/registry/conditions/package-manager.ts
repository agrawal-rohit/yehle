import type { ConditionHandler } from "@tuckshop/core";

/** Lockfile markers that imply a package manager when present under the project root. */
const PACKAGE_MANAGER_MARKERS = [
	{ value: "pnpm", files: ["pnpm-lock.yaml"] },
	{ value: "yarn", files: ["yarn.lock"] },
	{ value: "bun", files: ["bun.lock", "bun.lockb"] },
	{ value: "npm", files: ["package-lock.json"] },
] as const;

/** Suggest a package manager default from lockfiles in the project root. */
const handler: ConditionHandler = {
	async infer(ctx) {
		const allowed = new Set((ctx.values ?? []).map((entry) => entry.value));
		let match: string | undefined;

		for (const { value, files } of PACKAGE_MANAGER_MARKERS) {
			if (!allowed.has(value)) continue;

			const present = await Promise.all(files.map((file) => ctx.isFile(file)));
			if (!present.some(Boolean)) continue;
			if (match !== undefined) return undefined;
			match = value;
		}

		return match;
	},
};

export default handler;
