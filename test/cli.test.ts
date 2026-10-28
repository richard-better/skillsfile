import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/process.js";
import { FixtureRepo, skillMd, tempDir } from "./helpers.js";

const CLI = resolve("dist/cli.js");

async function setup() {
	const repo = await FixtureRepo.create({
		"skills/grill-me/SKILL.md": skillMd("grill-me", "Grill the user."),
		"skills/code-review/SKILL.md": skillMd("code-review", "Review code."),
	});
	const cwd = await tempDir();
	const home = await tempDir();
	const cli = async (...args: string[]) => {
		const result = await run("node", [CLI, ...args], {
			cwd,
			env: { HOME: home },
		});
		return { ...result, out: result.stdout + result.stderr };
	};
	return { repo, cwd, home, cli };
}

describe("cli", () => {
	it("adds, lists, edits, diffs and removes skills", async () => {
		const { repo, cwd, cli } = await setup();

		const ambiguous = await cli("add", repo.url);
		expect(ambiguous.code).toBe(1);
		expect(ambiguous.out).toContain("has 2 skills; pick with --skill");
		expect(ambiguous.out).toContain("grill-me - Grill the user.");

		const added = await cli(
			"add",
			repo.url,
			"--skill",
			"code-review",
			"--name",
			"aihero-code-review",
		);
		expect(added.out).toBe("added aihero-code-review\n");
		expect(await cli("add", repo.url, "--skill", "grill-me")).toMatchObject({
			code: 0,
		});
		expect(await readFile(join(cwd, "skills.yaml"), "utf8")).toBe(
			`skills:\n  aihero-code-review:\n    source: ${repo.url}\n    skill: code-review\n  grill-me: ${repo.url}\n`,
		);
		expect(
			existsSync(join(cwd, ".agents/skills/aihero-code-review/SKILL.md")),
		).toBe(true);

		expect((await cli("install")).out).toBe("2 skills up to date\n");
		expect((await cli("list")).out).toMatch(
			/^aihero-code-review {2}file:\S+ {2}[0-9a-f]{7}\ngrill-me /,
		);

		const skillFile = join(cwd, ".agents/skills/grill-me/SKILL.md");
		await writeFile(
			skillFile,
			`${await readFile(skillFile, "utf8")}Extra rule.\n`,
		);
		expect((await cli("diff", "grill-me")).out).toBe(
			"wrote patches/grill-me.patch\n",
		);

		const removed = await cli("remove", "aihero-code-review");
		expect(removed.out).toBe("removed aihero-code-review\n");
		expect(existsSync(join(cwd, ".agents/skills/aihero-code-review"))).toBe(
			false,
		);
		expect(await readFile(join(cwd, "skills.yaml"), "utf8")).toBe(
			`skills:\n  grill-me:\n    source: ${repo.url}\n    patch: patches/grill-me.patch\n`,
		);
	});

	it("uses ~/.agents for --global", async () => {
		const { repo, home, cli } = await setup();
		expect((await cli("add", "-g", repo.url, "--skill", "grill-me")).code).toBe(
			0,
		);
		expect(existsSync(join(home, ".agents/skills.yaml"))).toBe(true);
		expect(existsSync(join(home, ".agents/skills.lock"))).toBe(true);
		expect(existsSync(join(home, ".agents/skills/grill-me/SKILL.md"))).toBe(
			true,
		);
	});

	it("rejects refs that git would read as options", async () => {
		const { repo, cwd, cli } = await setup();
		const marker = join(cwd, "pwned");
		const flag = await cli(
			"add",
			repo.url,
			"--skill",
			"grill-me",
			`--ref=--upload-pack=touch ${marker}`,
		);
		expect(flag.code).toBe(1);
		await writeFile(
			join(cwd, "skills.yaml"),
			`skills:\n  grill-me:\n    source: ${repo.url}\n    ref: "--upload-pack=touch ${marker}"\n`,
		);
		const config = await cli("install");
		expect(config.code).toBe(1);
		expect(config.out).toContain("refs cannot start with -");
		expect(existsSync(marker)).toBe(false);
	});

	it("explains invalid config", async () => {
		const { cwd, cli } = await setup();
		await writeFile(join(cwd, "skills.yaml"), "skills:\n  Bad_Name: x/y\n");
		const result = await cli("install");
		expect(result.code).toBe(1);
		expect(result.out).toContain("skills.Bad_Name");
	});
});
