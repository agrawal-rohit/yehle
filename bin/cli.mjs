#!/usr/bin/env node
import loggerModule from "../dist/cli/logger.js";
import indexModule from "../dist/index.js";

// Maintain compatibility with both CommonJS and ESM outputs
const logger = loggerModule?.default ?? loggerModule;
const run = indexModule?.default ?? indexModule;

try {
	run();
} catch (err) {
	logger.error(err instanceof Error ? err.message : String(err));
}
