import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inferConditionValues } from "./infer";
import { type RegistryCondition, RegistryConditionInference } from "./schema";

describe("registry/infer", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "infer-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	const languageCondition: RegistryCondition = {
		label: "Language",
		inference: RegistryConditionInference.FILES,
		values: [
			{
				value: "typescript",
				label: "TypeScript",
				files: ["package.json", "tsconfig.json"],
			},
			{
				value: "python",
				label: "Python",
				files: ["pyproject.toml", "uv.lock", "requirements.txt"],
			},
			{
				value: "rust",
				label: "Rust",
				files: ["Cargo.toml"],
			},
		],
	};

	it("infers a value when exactly one value's files match", async () => {
		fs.writeFileSync(path.join(tempDir, "package.json"), "{}\n");

		const context = await inferConditionValues(
			{ language: languageCondition },
			tempDir,
		);

		expect(context).toEqual({ language: "typescript" });
	});

	it("returns nothing when no values match", async () => {
		const context = await inferConditionValues(
			{ language: languageCondition },
			tempDir,
		);

		expect(context).toEqual({});
	});

	it("returns nothing when multiple values match", async () => {
		fs.writeFileSync(path.join(tempDir, "package.json"), "{}\n");
		fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "");

		const context = await inferConditionValues(
			{ language: languageCondition },
			tempDir,
		);

		expect(context).toEqual({});
	});

	it("skips conditions without an inference declaration", async () => {
		fs.writeFileSync(path.join(tempDir, "package.json"), "{}\n");

		const context = await inferConditionValues(
			{
				language: {
					label: "Language",
					values: [
						{
							value: "typescript",
							label: "TypeScript",
							files: ["package.json"],
						},
					],
				},
			},
			tempDir,
		);

		expect(context).toEqual({});
	});
});
