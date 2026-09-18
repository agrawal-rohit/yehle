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

		it("ignores non-string seed values", () => {
			const context: RegistryContext = {};
			policy.seedContext(context, "language", true);
			policy.seedContext(context, "language", ["typescript"]);
			expect(context.language).toBeUndefined();
		});

		it("accepts declared when values and rejects others", () => {
			expect(() =>
				policy.assertWhenValue("typescript", selectValues),
			).not.toThrow();
			expect(() => policy.assertWhenValue("ruby", selectValues)).toThrow(
				"undeclared:ruby",
			);
			expect(() => policy.assertWhenValue(true, selectValues)).toThrow(
				"unexpected:true",
			);
			expect(() =>
				policy.assertWhenValue(["typescript"], selectValues),
			).not.toThrow();
		});

		it("accepts a declared inferred string", () => {
			expect(policy.inferredContextValue("typescript", selectValues)).toBe(
				"typescript",
			);
		});

		it("rejects non-string or undeclared inferred values", () => {
			expect(policy.inferredContextValue(true, selectValues)).toBeUndefined();
			expect(
				policy.inferredContextValue(["typescript"], selectValues),
			).toBeUndefined();
			expect(policy.inferredContextValue("ruby", selectValues)).toBeUndefined();
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

		it("seeds from an array when value and ignores empty or non-string seeds", () => {
			const context: RegistryContext = {};
			policy.seedContext(context, "platforms", ["ios", "web"]);
			expect(context.platforms).toEqual(["ios", "web"]);
			policy.seedContext(context, "platforms", true);
			policy.seedContext(context, "platforms", []);
			expect(context.platforms).toEqual(["ios", "web"]);
		});

		it("converts string inferences to arrays", () => {
			expect(policy.inferredContextValue("ios", values)).toEqual(["ios"]);
			expect(policy.inferredContextValue(["ios", "web"], values)).toEqual([
				"ios",
				"web",
			]);
		});

		it("rejects invalid inferred multiselect values", () => {
			expect(policy.inferredContextValue(true, values)).toBeUndefined();
			expect(
				policy.inferredContextValue(["ios", "android"], values),
			).toBeUndefined();
			expect(policy.inferredContextValue([], values)).toEqual([]);
		});
	});

	describe("boolean policy", () => {
		const policy = conditionKindPolicy[RegistryConditionKind.BOOLEAN];

		it("does not require values and allows when clauses", () => {
			expect(policy.requiresValues).toBe(false);
			expect(policy.allowsInWhen).toBe(true);
		});

		it("seeds boolean context from when booleans", () => {
			const context: RegistryContext = {};
			policy.seedContext(context, "enableCi", true);
			expect(context.enableCi).toBe(true);
			policy.seedContext(context, "enableCi", false);
			expect(context.enableCi).toBe(false);
		});

		it("accepts true and false when values", () => {
			expect(() => policy.assertWhenValue(true, undefined)).not.toThrow();
			expect(() => policy.assertWhenValue(false, undefined)).not.toThrow();
		});

		it("ignores non-boolean seed values", () => {
			const context: RegistryContext = {};
			policy.seedContext(context, "enableCi", "true");
			expect(context.enableCi).toBeUndefined();
		});

		it("converts boolean strings to booleans", () => {
			expect(policy.inferredContextValue(true, [])).toBe(true);
			expect(policy.inferredContextValue(false, [])).toBe(false);
			expect(policy.inferredContextValue("true", [])).toBe(true);
			expect(policy.inferredContextValue("false", [])).toBe(false);
			expect(policy.inferredContextValue("yes", [])).toBeUndefined();
			expect(policy.inferredContextValue(["true"], [])).toBeUndefined();
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

		it("ignores non-string seed values", () => {
			const context: RegistryContext = {};
			policy.seedContext(context, "author", true);
			expect(context.author).toBeUndefined();
		});

		it("accepts only non-empty string inferences", () => {
			expect(policy.inferredContextValue("Ada", [])).toBe("Ada");
			expect(policy.inferredContextValue("", [])).toBeUndefined();
			expect(policy.inferredContextValue(true, [])).toBeUndefined();
			expect(policy.inferredContextValue(["Ada"], [])).toBeUndefined();
		});

		it("rejects use in when", () => {
			expect(() => policy.assertWhenValue("Ada", undefined)).toThrow(
				"text_in_when",
			);
		});
	});
});
