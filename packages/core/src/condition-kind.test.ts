import { describe, expect, it } from "vitest";
import {
	conditionKindPolicy,
	policyForConditionKind,
	RegistryConditionKind,
	type RegistryContext,
} from "./condition-kind";

const selectValues = [
	{ value: "typescript", label: "TypeScript" },
	{ value: "python", label: "Python" },
];

describe("core/condition-kind", () => {
	describe("policyForConditionKind", () => {
		it("defaults to select when kind is omitted", () => {
			expect(policyForConditionKind(undefined).kind).toBe(
				RegistryConditionKind.SELECT,
			);
		});
	});

	describe("select policy", () => {
		const policy = conditionKindPolicy[RegistryConditionKind.SELECT];

		it("requires values and allows when clauses", () => {
			expect(policy.requiresValues).toBe(true);
			expect(policy.allowsInWhen).toBe(true);
		});

		it("seeds context with the when string", () => {
			const context: RegistryContext = {};
			policy.seedContext(context, "language", "typescript");
			expect(context.language).toBe("typescript");
		});

		it("normalizes a declared inferred string", () => {
			expect(policy.normalizeInferred("typescript", selectValues)).toBe(
				"typescript",
			);
		});

		it("rejects non-string or undeclared inferred values", () => {
			expect(policy.normalizeInferred(true, selectValues)).toBeUndefined();
			expect(
				policy.normalizeInferred(["typescript"], selectValues),
			).toBeUndefined();
			expect(policy.normalizeInferred("ruby", selectValues)).toBeUndefined();
		});
	});

	describe("multiselect policy", () => {
		const policy = conditionKindPolicy[RegistryConditionKind.MULTISELECT];
		const values = [
			{ value: "ios", label: "iOS" },
			{ value: "web", label: "Web" },
		];

		it("requires values and allows when clauses", () => {
			expect(policy.requiresValues).toBe(true);
			expect(policy.allowsInWhen).toBe(true);
		});

		it("seeds a new array and appends unique values", () => {
			const context: RegistryContext = {};
			policy.seedContext(context, "platforms", "ios");
			expect(context.platforms).toEqual(["ios"]);
			policy.seedContext(context, "platforms", "web");
			expect(context.platforms).toEqual(["ios", "web"]);
			policy.seedContext(context, "platforms", "ios");
			expect(context.platforms).toEqual(["ios", "web"]);
		});

		it("replaces a non-array context entry when seeding", () => {
			const context: RegistryContext = { platforms: "ios" };
			policy.seedContext(context, "platforms", "web");
			expect(context.platforms).toEqual(["web"]);
		});

		it("normalizes string and string[] inferences", () => {
			expect(policy.normalizeInferred("ios", values)).toEqual(["ios"]);
			expect(policy.normalizeInferred(["ios", "web"], values)).toEqual([
				"ios",
				"web",
			]);
		});

		it("rejects invalid inferred multiselect values", () => {
			expect(policy.normalizeInferred(true, values)).toBeUndefined();
			expect(
				policy.normalizeInferred(["ios", "android"], values),
			).toBeUndefined();
			expect(policy.normalizeInferred([], values)).toEqual([]);
		});
	});

	describe("boolean policy", () => {
		const policy = conditionKindPolicy[RegistryConditionKind.BOOLEAN];

		it("does not require values and allows when clauses", () => {
			expect(policy.requiresValues).toBe(false);
			expect(policy.allowsInWhen).toBe(true);
		});

		it("seeds boolean context from when strings", () => {
			const context: RegistryContext = {};
			policy.seedContext(context, "enableCi", "true");
			expect(context.enableCi).toBe(true);
			policy.seedContext(context, "enableCi", "false");
			expect(context.enableCi).toBe(false);
		});

		it("accepts true and false when values", () => {
			expect(() => policy.assertWhenValue("true", undefined)).not.toThrow();
			expect(() => policy.assertWhenValue("false", undefined)).not.toThrow();
		});

		it("normalizes boolean and string inferences", () => {
			expect(policy.normalizeInferred(true, [])).toBe(true);
			expect(policy.normalizeInferred(false, [])).toBe(false);
			expect(policy.normalizeInferred("true", [])).toBe(true);
			expect(policy.normalizeInferred("false", [])).toBe(false);
			expect(policy.normalizeInferred("yes", [])).toBeUndefined();
			expect(policy.normalizeInferred(["true"], [])).toBeUndefined();
		});

		it("rejects non-boolean when values", () => {
			expect(() => policy.assertWhenValue("yes", undefined)).toThrow(
				"boolean:yes",
			);
		});
	});

	describe("text policy", () => {
		const policy = conditionKindPolicy[RegistryConditionKind.TEXT];

		it("does not require values and disallows when clauses", () => {
			expect(policy.requiresValues).toBe(false);
			expect(policy.allowsInWhen).toBe(false);
		});

		it("seeds context with the when string", () => {
			const context: RegistryContext = {};
			policy.seedContext(context, "author", "Ada");
			expect(context.author).toBe("Ada");
		});

		it("normalizes non-empty string inferences only", () => {
			expect(policy.normalizeInferred("Ada", [])).toBe("Ada");
			expect(policy.normalizeInferred("", [])).toBeUndefined();
			expect(policy.normalizeInferred(true, [])).toBeUndefined();
			expect(policy.normalizeInferred(["Ada"], [])).toBeUndefined();
		});

		it("rejects use in when", () => {
			expect(() => policy.assertWhenValue("Ada", undefined)).toThrow(
				"text_in_when",
			);
		});
	});
});
