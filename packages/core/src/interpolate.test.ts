import { describe, expect, it } from "vitest";
import { buildInterpolationContext, interpolatePayload } from "./interpolate";
import type { RegistryPayload } from "./schema";

describe("core/interpolate", () => {
	describe("buildInterpolationContext", () => {
		it("keeps typed conditions, merges select option bindings, and lets hook bindings win", () => {
			expect(
				buildInterpolationContext(
					{
						defaultBranch: "main",
						enableCi: true,
						tags: ["ios", "web"],
						packageManager: "pnpm",
						skipped: undefined,
					},
					{ sonarProjectKey: "org_app", defaultBranch: "develop" },
					{
						packageManager: [
							{
								value: "pnpm",
								label: "pnpm",
								bindings: {
									pmRun: "pnpm",
									pmExec: "pnpm exec",
									pmPublish: "pnpm publish",
								},
							},
						],
					},
				),
			).toEqual({
				defaultBranch: "develop",
				enableCi: true,
				tags: ["ios", "web"],
				packageManager: "pnpm",
				pmRun: "pnpm",
				pmExec: "pnpm exec",
				pmPublish: "pnpm publish",
				sonarProjectKey: "org_app",
			});
		});

		it("omits skipped optionals from the view", () => {
			expect(buildInterpolationContext({ skipped: undefined }, {})).toEqual({});
		});

		it("does not seed option bindings for an unmatched or unknown captured value", () => {
			expect(
				buildInterpolationContext(
					{ packageManager: "cargo" },
					{},
					{
						packageManager: [
							{
								value: "pnpm",
								label: "pnpm",
								bindings: { pmRun: "pnpm" },
							},
						],
					},
				),
			).toEqual({ packageManager: "cargo" });
		});
	});

	describe("interpolatePayload", () => {
		it("replaces {{key}} in files and commands without touching GitHub Actions expressions", () => {
			const ghaSha = "${{" + " github.sha }}";
			const payload = interpolatePayload(
				{
					files: [
						{
							target: "ci.yml",
							content:
								"branch: {{defaultBranch}}\nsha: " +
								ghaSha +
								"\nrun: {{pmRun}} test\n",
						},
					],
					commands: { npm: { test: "{{pmExec}} vitest run" } },
				},
				{
					defaultBranch: "main",
					pmRun: "pnpm",
					pmExec: "pnpm exec",
				},
			);

			expect(payload.files[0].content).toBe(
				"branch: main\nsha: " + ghaSha + "\nrun: pnpm test\n",
			);
			expect(payload.commands).toEqual({
				npm: { test: "pnpm exec vitest run" },
			});
		});

		it("treats boolean and array conditions as typed Mustache sections", () => {
			expect(
				interpolatePayload(
					{
						files: [
							{
								target: "a.txt",
								content:
									"{{#enableCi}}ci{{/enableCi}}{{^enableCi}}no-ci{{/enableCi}}\n{{#tags}}{{.}} {{/tags}}",
							},
						],
					},
					{ enableCi: false, tags: ["ios", "web"] },
				).files[0].content,
			).toBe("no-ci\nios web ");
		});

		it("substitutes empty strings for missing keys", () => {
			expect(
				interpolatePayload(
					{ files: [{ target: "a.txt", content: "n={{missing}}" }] },
					{},
				).files[0].content,
			).toBe("n=");
			expect(
				interpolatePayload(
					{ files: [{ target: "a.txt", content: "n={{empty}}" }] },
					{ empty: "" },
				).files[0].content,
			).toBe("n=");
		});

		it("does not HTML-escape interpolated values", () => {
			expect(
				interpolatePayload(
					{ files: [{ target: "a.txt", content: "name={{authorName}}" }] },
					{ authorName: "Ada & Bob <dev>" },
				).files[0].content,
			).toBe("name=Ada & Bob <dev>");
		});

		it("skips undefined command sets and still interpolates defined ecosystems", () => {
			expect(
				interpolatePayload(
					{
						files: [],
						commands: {
							npm: { test: "{{pmExec}} vitest" },
							pypi: undefined,
						} as RegistryPayload["commands"],
					},
					{ pmExec: "pnpm exec" },
				).commands,
			).toEqual({ npm: { test: "pnpm exec vitest" } });
		});
	});
});
