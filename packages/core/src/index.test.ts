import { describe, expect, it } from "vitest";
import * as core from "./index";

describe("package entry", () => {
	it("re-exports the public core API", () => {
		expect(typeof core.isFileAsync).toBe("function");
		expect(typeof core.pathKindAsync).toBe("function");
		expect(core.PathKind).toBeDefined();
		expect(typeof core.readDirectoryAsync).toBe("function");
		expect(typeof core.readFileAsync).toBe("function");
		expect(typeof core.readJsonFileAsync).toBe("function");
		expect(core.InvalidJsonError).toBeDefined();
		expect(typeof core.removeAsync).toBe("function");
		expect(typeof core.writeFileAsync).toBe("function");
		expect(typeof core.isAbsoluteHttpUrl).toBe("function");
		expect(typeof core.assertSafeRemoteUrl).toBe("function");
		expect(typeof core.publishedRegistryUrl).toBe("function");
		expect(typeof core.parseRegistryDocument).toBe("function");
		expect(typeof core.parseWithSchema).toBe("function");
		expect(typeof core.buildRegistry).toBe("function");
		expect(typeof core.resolveInstallPlan).toBe("function");
		expect(typeof core.runAsync).toBe("function");
		expect(typeof core.mergeEcosystemDependencies).toBe("function");
		expect(typeof core.buildPackageInstallCommands).toBe("function");
		expect(typeof core.joinRelativePathUnderRoot).toBe("function");
		expect(typeof core.detectPackageManagerFromLockfile).toBe("function");
		expect(typeof core.policyForConditionKind).toBe("function");
		expect(typeof core.runItemHandler).toBe("function");
		expect(typeof core.inferConditionDefault).toBe("function");
		expect(core.registryPayloadSchema).toBeDefined();
		expect(core.RegistryConditionKind).toBeDefined();
		expect(core.RegistryEcosystem).toBeDefined();
	});
});
