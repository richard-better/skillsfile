import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyOverrides,
	displayName,
	shortDescription,
} from "../src/transform.js";
import { skillMd, tempDir, writeFiles } from "./helpers.js";

async function skill(files: Record<string, string>) {
	const dir = await tempDir();
	await writeFiles(dir, files);
	return {
		dir,
		read: (path: string) => readFile(join(dir, path), "utf8"),
	};
}

describe("applyOverrides", () => {
	it("leaves an untouched skill byte-identical apart from a generated openai.yaml", async () => {
		const original = skillMd(
			"grill-me",
			"Interview the user about a plan. Use when asked to grill.",
			"Body.\n",
			"license: MIT\n",
		);
		const s = await skill({ "SKILL.md": original });
		await applyOverrides(s.dir, "grill-me", { source: "x/y" });
		expect(await s.read("SKILL.md")).toBe(original);
		expect(await s.read("agents/openai.yaml")).toBe(
			'interface:\n  display_name: "Grill Me"\n  short_description: "Interview the user about a plan"\n',
		);
	});

	it("renames, redescribes and makes a skill explicit-only for Claude and Codex", async () => {
		const s = await skill({
			"SKILL.md": skillMd("code-review", "Review code.", "Run /code-review.\n"),
		});
		await applyOverrides(s.dir, "aihero-code-review", {
			source: "x/y",
			description: "Two-axis review: standards and spec.",
			invocation: "explicit",
			openai: { display_name: "AI Hero Code Review" },
		});
		expect(await s.read("SKILL.md")).toBe(
			'---\nname: aihero-code-review\ndescription: "Two-axis review: standards and spec."\ndisable-model-invocation: true\n---\n\nRun /code-review.\n',
		);
		expect(await s.read("agents/openai.yaml")).toBe(
			'interface:\n  display_name: "AI Hero Code Review"\n  short_description: "Two-axis review: standards and spec"\npolicy:\n  allow_implicit_invocation: false\n',
		);
	});

	it("merges into an upstream openai.yaml and follows renames in default_prompt", async () => {
		const s = await skill({
			"SKILL.md": skillMd(
				"router",
				"Routing.",
				"Body.\n",
				"disable-model-invocation: true\n",
			),
			"agents/openai.yaml":
				'interface:\n  display_name: "Router"\n  default_prompt: "Use $router to add a route."\npolicy:\n  allow_implicit_invocation: false\ndependencies:\n  tools: []\n',
		});
		await applyOverrides(s.dir, "expo-router", {
			source: "x/y",
			invocation: "auto",
			openai: { short_description: "Expo Router navigation" },
		});
		expect(await s.read("SKILL.md")).not.toContain("disable-model-invocation");
		expect(await s.read("agents/openai.yaml")).toBe(
			'interface:\n  display_name: "Router"\n  default_prompt: "Use $expo-router to add a route."\n  short_description: "Expo Router navigation"\ndependencies:\n  tools: []\n',
		);
	});

	it("does not create openai.yaml when disabled", async () => {
		const s = await skill({ "SKILL.md": skillMd("a", "A skill.") });
		await applyOverrides(s.dir, "a", { source: "x/y", openai: false });
		await expect(s.read("agents/openai.yaml")).rejects.toThrow();
	});
});

describe("displayName", () => {
	it("title-cases words and keeps acronyms", () => {
		expect(displayName("eas-app-stores")).toBe("EAS App Stores");
		expect(displayName("find-skills-for-a-pr")).toBe("Find Skills for a PR");
	});
});

describe("shortDescription", () => {
	it("uses the first sentence", () => {
		expect(shortDescription("Grill the user. Use when asked.")).toBe(
			"Grill the user",
		);
	});

	it("clips long sentences at a word boundary within 64 characters", () => {
		const result = shortDescription(
			"Review the changes since a fixed point along two axes: standards and the originating spec",
		);
		expect(result).toBe(
			"Review the changes since a fixed point along two axes…",
		);
		expect(result.length).toBeLessThanOrEqual(64);
	});
});
