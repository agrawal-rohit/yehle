import type { BeforeInstallHook } from "@tuckshop/core";
import * as spdxLicenseList from "spdx-license-list/full";

/** Popular SPDX ids shown first in the license picker. */
const POPULAR_IDS = [
	"MIT",
	"Apache-2.0",
	"BSD-3-Clause",
	"BSD-2-Clause",
	"ISC",
	"MPL-2.0",
	"GPL-3.0-only",
	"GPL-3.0-or-later",
	"LGPL-3.0-only",
	"AGPL-3.0-only",
	"Unlicense",
	"CC0-1.0",
] as const;

const licenses = spdxLicenseList as unknown as Record<
	string,
	{ name: string; licenseText: string }
>;

/** Placeholders that need year / copyright holder substitution. */
const COPYRIGHT_PLACEHOLDER =
	/<year>|<copyright holders>|<owner>|<name of author>/;

/** Prompt for an SPDX license and return a filled LICENSE file before install writes. */
const beforeInstall: BeforeInstallHook = async (ctx) => {
	const popular = new Set<string>(POPULAR_IDS);
	const options = [
		...POPULAR_IDS.flatMap((id) => {
			const entry = licenses[id];
			return entry ? [{ label: entry.name, value: id, hint: id }] : [];
		}),
		...Object.keys(licenses)
			.filter((id) => !popular.has(id))
			.sort((a, b) => a.localeCompare(b))
			.map((id) => ({
				label: licenses[id].name,
				value: id,
				hint: id,
			})),
	];

	const licenseId = await ctx.prompts.select(
		"Which SPDX license should be added?",
		{ options },
		"MIT",
	);
	const entry = licenses[licenseId];
	if (!entry) throw new Error(`Unknown SPDX license id "${licenseId}".`);

	let licenseText = entry.licenseText;
	if (COPYRIGHT_PLACEHOLDER.test(licenseText)) {
		const authorName = ctx.conditions.authorName;
		const holder =
			typeof authorName === "string" && authorName.length > 0
				? authorName
				: await ctx.prompts.text("Copyright holder", { required: true });
		const year = await ctx.prompts.text(
			"Copyright year",
			{ required: true },
			String(new Date().getFullYear()),
		);
		licenseText = licenseText
			.replaceAll("<year>", year)
			.replaceAll("<copyright holders>", holder)
			.replaceAll("<owner>", holder)
			.replaceAll("<name of author>", holder);
	}

	return {
		// Append so static payload files are kept unless the hook replaces ctx.files entirely.
		files: [...ctx.files, { target: "LICENSE", content: licenseText }],
	};
};

export default beforeInstall;
