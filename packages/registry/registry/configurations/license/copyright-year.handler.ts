import type { ConditionHandler } from "@tuckshop/core";

/**
 * Suggest the current calendar year as the copyright year default.
 * @returns Four-digit year string.
 */
const handler: ConditionHandler = {
	async infer() {
		return String(new Date().getFullYear());
	},
};

export default handler;
