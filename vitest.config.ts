import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globalSetup: ["test/build.ts"],
		testTimeout: 30_000,
		// Never reach a real model from tests.
		env: {
			SKILLSFILE_CLAUDE: new URL("test/fake-claude.mjs", import.meta.url)
				.pathname,
		},
	},
});
