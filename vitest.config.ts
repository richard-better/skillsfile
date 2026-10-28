import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globalSetup: ["test/build.ts"],
		testTimeout: 30_000,
	},
});
