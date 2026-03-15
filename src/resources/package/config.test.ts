import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node modules and internal modules
vi.mock("../../cli/prompts", () => ({
	default: {
		selectInput: vi.fn(),
		textInput: vi.fn(),
		confirmInput: vi.fn(() => Promise.resolve(false)),
	},
}));

vi.mock("../../cli/tasks", () => ({
	default: {
		runWithTasks: vi.fn(async (_, task) => {
			if (task) await task();
		}),
	},
}));

(
	globalThis as typeof globalThis & { mockIsLocalMode: boolean }
).mockIsLocalMode = false;

vi.mock("../../core/constants", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../core/constants")>();
	return {
		...actual,
		get IS_LOCAL_MODE() {
			return (globalThis as typeof globalThis & { mockIsLocalMode: boolean })
				.mockIsLocalMode;
		},
	};
});

vi.mock("../../core/git", () => ({
	getGitEmail: vi.fn(),
	getGitUsername: vi.fn(),
}));

vi.mock("../../core/pkg-manager", () => ({
	LANGUAGE_PACKAGE_REGISTRY: {
		typescript: "npm",
	},
	validatePackageName: vi.fn(),
}));

vi.mock("../../core/templates", () => ({
	listAvailableTemplates: vi.fn(),
	listLanguageNames: vi.fn().mockResolvedValue(["typescript"]),
}));

vi.mock("../../core/utils", () => ({
	capitalizeFirstLetter: vi.fn(),
	toSlug: vi.fn(),
}));

vi.mock("../../resources/instructions/config", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../../resources/instructions/config")
		>();
	return {
		...actual,
		getIdeFormatSelection: vi.fn().mockResolvedValue("cursor"),
	};
});

import prompts from "../../cli/prompts";
import tasks from "../../cli/tasks";
import { Language } from "../../core/constants";
import { getGitEmail, getGitUsername } from "../../core/git";
import { validatePackageName } from "../../core/pkg-manager";
import {
	listAvailableTemplates,
	listLanguageNames,
} from "../../core/templates";
import { capitalizeFirstLetter, toSlug } from "../../core/utils";
// Import after mocks
import {
	getGeneratePackageConfiguration,
	getPackageLanguage,
	getPackageName,
	getPackageTemplate,
	getPackageVisibility,
	promptAuthorGitEmail,
	promptAuthorGitUsername,
	promptAuthorName,
} from "./config";

describe("resources/package/config", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset prompt mocks so mockResolvedValueOnce from one test doesn't leak into another.
		vi.mocked(prompts.selectInput).mockReset();
		vi.mocked(prompts.textInput).mockReset();
		vi.mocked(prompts.confirmInput).mockReset();
		vi.mocked(prompts.confirmInput).mockImplementation(() =>
			Promise.resolve(false),
		);
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.clearAllMocks();
		(
			globalThis as typeof globalThis & { mockIsLocalMode: boolean }
		).mockIsLocalMode = false;
	});

	describe("getGeneratePackageConfiguration", () => {
		it("should gather configuration from cliFlags without prompting for author info when not public", async () => {
			vi.mocked(validatePackageName).mockImplementation(() => {});
			vi.mocked(listAvailableTemplates).mockResolvedValue(["basic"]);

			const config = await getGeneratePackageConfiguration({
				lang: Language.TYPESCRIPT,
				name: "my-package",
				template: "basic",
				public: false,
			});

			expect(config).toEqual({
				lang: Language.TYPESCRIPT,
				name: "my-package",
				template: "basic",
				public: false,
				includeInstructions: false,
				instructionsIdeFormat: undefined,
				authorName: undefined,
				authorGitEmail: undefined,
				authorGitUsername: undefined,
			});
		});

		it("should prompt for author info when package is public", async () => {
			vi.mocked(prompts.selectInput).mockResolvedValueOnce(Language.TYPESCRIPT);
			vi.mocked(validatePackageName).mockImplementation(() => {});
			vi.mocked(prompts.textInput).mockResolvedValueOnce("my-package");
			vi.mocked(listAvailableTemplates).mockResolvedValue([
				"basic",
				"advanced",
			]);
			vi.mocked(prompts.selectInput).mockResolvedValueOnce("basic");
			// First confirm: visibility (public). Second: include instructions (false so we don't call getIdeFormatSelection).
			vi.mocked(prompts.confirmInput)
				.mockResolvedValueOnce(true)
				.mockResolvedValueOnce(false);
			vi.mocked(getGitUsername).mockResolvedValue("John");
			vi.mocked(prompts.textInput).mockResolvedValueOnce("John Doe");
			vi.mocked(getGitEmail).mockResolvedValue("john@example.com");
			vi.mocked(prompts.textInput).mockResolvedValueOnce("john@example.com");
			vi.mocked(prompts.textInput).mockResolvedValueOnce("johndoe");
			vi.mocked(toSlug).mockReturnValue("johndoe");

			const config = await getGeneratePackageConfiguration({ public: true });

			expect(config.public).toBe(true);
			expect(config.authorName).toBe("John Doe");
			expect(config.authorGitEmail).toBe("john@example.com");
			expect(config.authorGitUsername).toBe("johndoe");
		});
	});

	describe("getPackageLanguage", () => {
		it("should return language from cliFlags if provided and valid", async () => {
			vi.mocked(listLanguageNames).mockResolvedValue(["typescript"]);

			const result = await getPackageLanguage({ lang: Language.TYPESCRIPT });

			expect(listLanguageNames).toHaveBeenCalled();
			expect(result).toBe(Language.TYPESCRIPT);
		});

		it("should prompt for language if not provided in cliFlags", async () => {
			vi.mocked(listLanguageNames).mockResolvedValue(["typescript"]);
			vi.mocked(capitalizeFirstLetter).mockReturnValue("Typescript");
			vi.mocked(prompts.selectInput).mockResolvedValue(Language.TYPESCRIPT);

			const result = await getPackageLanguage({});

			expect(listLanguageNames).toHaveBeenCalled();
			expect(prompts.selectInput).toHaveBeenCalledWith(
				"Which language would you prefer to use?",
				expect.objectContaining({
					options: [{ label: "Typescript", value: "typescript" }],
				}),
				Language.TYPESCRIPT,
			);
			expect(result).toBe(Language.TYPESCRIPT);
		});

		it("should throw an error for an invalid language", async () => {
			vi.mocked(listLanguageNames).mockResolvedValue(["typescript"]);

			await expect(
				getPackageLanguage({ lang: "invalid" as unknown as Language }),
			).rejects.toThrow("Unsupported language: invalid (valid: typescript)");
		});
	});

	describe("getPackageName", () => {
		it("should return name from cliFlags and validate it", async () => {
			vi.mocked(validatePackageName).mockImplementation(() => {});

			const result = await getPackageName(Language.TYPESCRIPT, {
				name: "my-package",
			});

			expect(result).toBe("my-package");
			expect(validatePackageName).toHaveBeenCalledWith(
				"my-package",
				Language.TYPESCRIPT,
			);
		});

		it("should prompt for name if not provided in cliFlags", async () => {
			vi.mocked(prompts.textInput).mockResolvedValueOnce("prompted-package");
			vi.mocked(validatePackageName).mockImplementation(() => {});

			const result = await getPackageName(Language.TYPESCRIPT, {});

			expect(prompts.textInput).toHaveBeenCalledWith(
				"What should we call your package?",
				{ required: true },
				"my-package",
			);
			expect(result).toBe("prompted-package");
		});

		it("should throw an error if package name validation fails", async () => {
			vi.mocked(validatePackageName).mockImplementation(() => {
				throw new Error("Invalid package name");
			});

			await expect(
				getPackageName(Language.TYPESCRIPT, { name: "invalid name" }),
			).rejects.toThrow("Invalid package name");
		});
	});

	describe("getPackageTemplate", () => {
		it("should return template from cliFlags if valid", async () => {
			vi.mocked(listAvailableTemplates).mockResolvedValue([
				"basic",
				"advanced",
			]);

			const result = await getPackageTemplate(Language.TYPESCRIPT, {
				template: "basic",
			});

			expect(result).toBe("basic");
		});

		it("should use the single available template without prompting", async () => {
			vi.mocked(listAvailableTemplates).mockResolvedValue(["basic"]);

			const result = await getPackageTemplate(Language.TYPESCRIPT, {});

			expect(result).toBe("basic");
		});

		it("should prompt for template if not provided and multiple available", async () => {
			vi.mocked(listAvailableTemplates).mockResolvedValue([
				"basic",
				"advanced",
			]);
			vi.mocked(prompts.selectInput).mockResolvedValue("advanced");

			const result = await getPackageTemplate(Language.TYPESCRIPT, {});

			expect(prompts.selectInput).toHaveBeenCalledWith(
				"Which starter template would you like to use?",
				expect.any(Object),
				"basic",
			);
			expect(result).toBe("advanced");
		});

		it("should run tasks to fetch templates when not in local mode", async () => {
			vi.mocked(listAvailableTemplates).mockResolvedValue(["basic"]);

			await getPackageTemplate(Language.TYPESCRIPT, {});

			expect(tasks.runWithTasks).toHaveBeenCalledWith(
				"Checking available package templates",
				expect.any(Function),
			);
		});

		it("should fetch templates directly when in local mode", async () => {
			(
				globalThis as typeof globalThis & { mockIsLocalMode: boolean }
			).mockIsLocalMode = true;
			vi.mocked(listAvailableTemplates).mockResolvedValue(["basic"]);

			const result = await getPackageTemplate(Language.TYPESCRIPT, {});

			expect(listAvailableTemplates).toHaveBeenCalledWith(
				Language.TYPESCRIPT,
				"package",
			);
			expect(tasks.runWithTasks).not.toHaveBeenCalled();
			expect(result).toBe("basic");
		});

		it("should throw an error if no templates are available", async () => {
			vi.mocked(listAvailableTemplates).mockResolvedValue([]);

			await expect(getPackageTemplate(Language.TYPESCRIPT, {})).rejects.toThrow(
				"No templates found for language: typescript",
			);
		});

		it("should throw an error for an invalid template", async () => {
			vi.mocked(listAvailableTemplates).mockResolvedValue([
				"basic",
				"advanced",
			]);

			await expect(
				getPackageTemplate(Language.TYPESCRIPT, { template: "invalid" }),
			).rejects.toThrow("Unsupported template: invalid");
		});
	});

	describe("getPackageVisibility", () => {
		it("should return public flag from cliFlags", async () => {
			const result = await getPackageVisibility(Language.TYPESCRIPT, {
				public: true,
			});
			expect(result).toBe(true);
		});

		it("should prompt for visibility if not provided in cliFlags", async () => {
			vi.mocked(prompts.confirmInput).mockResolvedValueOnce(true);

			const result = await getPackageVisibility(Language.TYPESCRIPT, {});

			expect(prompts.confirmInput).toHaveBeenCalledWith(
				"Should this package be publicly available? (released to the npm registry)",
				undefined,
				true,
			);
			expect(result).toBe(true);
		});
	});

	describe("promptAuthorName", () => {
		it("should prompt for author's full name with git username as default", async () => {
			vi.mocked(getGitUsername).mockResolvedValue("John");
			vi.mocked(prompts.textInput).mockResolvedValueOnce("John Doe");

			const result = await promptAuthorName();

			expect(getGitUsername).toHaveBeenCalled();
			expect(prompts.textInput).toHaveBeenCalledWith(
				"What is the author's name?",
				undefined,
				"John",
			);
			expect(result).toBe("John Doe");
		});
	});

	describe("promptAuthorGitEmail", () => {
		it("should prompt for author's git email with inferred email as default", async () => {
			vi.mocked(getGitEmail).mockResolvedValue("john@example.com");
			vi.mocked(prompts.textInput).mockResolvedValueOnce("john@example.com");

			const result = await promptAuthorGitEmail();

			expect(getGitEmail).toHaveBeenCalled();
			expect(prompts.textInput).toHaveBeenCalledWith(
				"What is the author's email?",
				undefined,
				"john@example.com",
			);
			expect(result).toBe("john@example.com");
		});
	});

	describe("promptAuthorGitUsername", () => {
		it("should prompt for author's git username and return slugified version", async () => {
			vi.mocked(getGitUsername).mockResolvedValue("John Doe");
			vi.mocked(prompts.textInput).mockResolvedValue("John Doe");
			vi.mocked(toSlug).mockReturnValue("john-doe");

			const result = await promptAuthorGitUsername();

			expect(getGitUsername).toHaveBeenCalled();
			expect(prompts.textInput).toHaveBeenCalledWith(
				"Under which GitHub account would this repository be stored?",
				undefined,
				"johndoe",
			);
			expect(toSlug).toHaveBeenCalledWith("John Doe");
			expect(result).toBe("john-doe");
		});

		it("should prompt for author's git username with undefined default when git name is empty", async () => {
			vi.mocked(getGitUsername).mockResolvedValue("");
			vi.mocked(prompts.textInput).mockResolvedValue("johndoe");
			vi.mocked(toSlug).mockReturnValue("johndoe");

			const result = await promptAuthorGitUsername();

			expect(getGitUsername).toHaveBeenCalled();
			expect(prompts.textInput).toHaveBeenCalledWith(
				"Under which GitHub account would this repository be stored?",
				undefined,
				undefined,
			);
			expect(toSlug).toHaveBeenCalledWith("johndoe");
			expect(result).toBe("johndoe");
		});
	});
});
