import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { Installer } from "../src/install.js";
import { FixtureRepo, skillMd, tempDir } from "./helpers.js";

async function project(yaml: (url: string) => string) {
	const repo = await FixtureRepo.create({
		"skills/animate/SKILL.md": skillMd(
			"animate",
			"Animate.",
			"Use review-animations to check — carefully.\n",
		),
		"skills/review-animations/SKILL.md": skillMd(
			"review-animations",
			"Review.",
		),
	});
	const dir = await tempDir();
	const log = join(dir, "claude.log");
	process.env.FAKE_CLAUDE_LOG = log;
	const configFile = join(dir, "skills.yaml");
	const write = (text: string) => writeFile(configFile, text);
	await write(yaml(repo.url));
	const target = join(dir, ".agents/skills");
	const run = async (fn: (installer: Installer) => Promise<unknown>) => {
		const installer = new Installer(
			await loadConfig(configFile, ".agents/skills"),
		);
		try {
			return await fn(installer);
		} finally {
			await installer.dispose();
		}
	};
	return {
		repo,
		dir,
		target,
		write,
		read: (path: string) => readFile(join(target, path), "utf8"),
		install: (options: Parameters<Installer["install"]>[0] = {}) =>
			run((installer) => installer.install(options)) as ReturnType<
				Installer["install"]
			>,
		diff: (name: string) => run((installer) => installer.diff(name)),
		calls: async () =>
			existsSync(log)
				? (await readFile(log, "utf8"))
						.trim()
						.split("\n")
						.map((line) => JSON.parse(line) as { args: string[] })
				: [],
	};
}

const anchored = (url: string) => `x-rules:
  dashes: &dashes 'replace "—" with "-"'
  names: &names 'replace "review-animations" with "emil-review-animations"'

x-emil: &emil
  source: ${url}
  instructions: [*dashes, *names]

skills:
  emil-animate:
    <<: *emil
    path: skills/animate
`;

describe("instructions", () => {
	it("rewrites once, then reuses the saved result until upstream changes", async () => {
		const p = await project(anchored);
		expect((await p.install()).errors).toEqual(new Map());
		expect(await p.read("emil-animate/SKILL.md")).toContain(
			"Use emil-review-animations to check - carefully.",
		);
		expect(await p.calls()).toHaveLength(1);
		const patch = await readFile(
			join(p.dir, "patches/emil-animate.instructions.patch"),
			"utf8",
		);
		expect(patch).toMatch(
			/^skillsfile instructions sha256-\w+\ndiff --git a\/SKILL.md b\/SKILL.md/,
		);

		await p.install();
		await rm(p.target, { recursive: true });
		expect((await p.install()).outcomes.get("emil-animate")).toBe("added");
		expect(await p.read("emil-animate/SKILL.md")).toContain(
			"emil-review-animations",
		);
		expect(await p.calls()).toHaveLength(1);

		await p.repo.commit({
			"skills/animate/SKILL.md": skillMd(
				"animate",
				"Animate.",
				"Ask review-animations — twice.\n",
			),
		});
		await p.install({ update: true });
		expect(await p.read("emil-animate/SKILL.md")).toContain(
			"Ask emil-review-animations - twice.",
		);
		expect(await p.calls()).toHaveLength(2);
	});

	it("reruns when the instructions change and cleans up when they are removed", async () => {
		const p = await project(anchored);
		await p.install();
		await p.write(
			anchored(p.repo.url).replace(
				"instructions: [*dashes, *names]",
				"instructions: [*dashes]",
			),
		);
		await p.install();
		expect(await p.read("emil-animate/SKILL.md")).toContain(
			"Use review-animations to check - carefully.",
		);
		expect(await p.calls()).toHaveLength(2);

		await p.write(
			anchored(p.repo.url).replace("  instructions: [*dashes, *names]\n", ""),
		);
		await p.install();
		expect(await p.read("emil-animate/SKILL.md")).toContain(
			"Use review-animations to check — carefully.",
		);
		expect(
			existsSync(join(p.dir, "patches/emil-animate.instructions.patch")),
		).toBe(false);
	});

	it("tells Claude the installed and upstream names of the skill and its siblings, confined to the skill", async () => {
		const p = await project(
			(url) => `model: haiku
skills:
  emil-animate:
    source: ${url}
    path: skills/animate
    instructions: 'replace "x" with "y"'
  emil-review-animations:
    source: ${url}
    skill: review-animations
`,
		);
		await p.install();
		const [call] = await p.calls();
		const prompt = call?.args[call.args.indexOf("-p") + 1];
		expect(prompt).toContain(
			"installed as `emil-animate` (upstream name: `animate`)",
		);
		expect(prompt).toContain(
			"- emil-review-animations (upstream name: review-animations)",
		);
		expect(call?.args).toEqual(
			expect.arrayContaining([
				"--restricted",
				"--strict-mcp-config",
				"--tools",
				"Read,Edit,Write,Glob,Grep",
			]),
		);
		expect(call?.args.slice(-2)).toEqual(["--model", "haiku"]);
	});

	it("keeps the previous version when Claude cannot apply the instructions", async () => {
		const p = await project(anchored);
		await p.install();
		const before = await p.read("emil-animate/SKILL.md");
		await p.write(
			anchored(p.repo.url).replace(
				"instructions: [*dashes, *names]",
				"instructions: [fail]",
			),
		);
		const result = await p.install();
		expect(result.errors.get("emil-animate")?.message).toBe(
			"instructions could not be applied: asked to fail",
		);
		expect(await p.read("emil-animate/SKILL.md")).toBe(before);
	});

	it("diffs local edits against the rewritten skill without calling Claude again", async () => {
		const p = await project(anchored);
		await p.install();
		const file = join(p.target, "emil-animate/SKILL.md");
		await writeFile(file, `${await readFile(file, "utf8")}My rule.\n`);
		await p.diff("emil-animate");
		const patch = await readFile(
			join(p.dir, "patches/emil-animate.patch"),
			"utf8",
		);
		expect(patch).toContain("+My rule.");
		// Only the local edit; the rewrite is part of the base, so nothing is removed.
		expect(patch).not.toMatch(/^-[^-]/m);
		expect(await p.calls()).toHaveLength(1);
	});

	it("refuses a rewrite that links outside the skill", async () => {
		const p = await project(anchored);
		await p.write(
			anchored(p.repo.url).replace(
				"instructions: [*dashes, *names]",
				'instructions: [link "secrets" to "/etc"]',
			),
		);
		const result = await p.install();
		expect(result.errors.get("emil-animate")?.message).toBe(
			"secrets links outside the skill; refusing to install it",
		);
		expect(existsSync(join(p.target, "emil-animate"))).toBe(false);
	});

	it("explains when the claude binary is too old for --restricted", async () => {
		const p = await project(anchored);
		const fake = process.env.SKILLSFILE_CLAUDE;
		process.env.SKILLSFILE_CLAUDE = join(
			import.meta.dirname,
			"fake-old-claude.mjs",
		);
		try {
			const result = await p.install();
			expect(result.errors.get("emil-animate")?.message).toBe(
				`Claude Code 2.1.15 at ${process.env.SKILLSFILE_CLAUDE} is too old for instructions, which need --restricted. Update it, or set SKILLSFILE_CLAUDE to a newer claude.`,
			);
			expect(await p.calls()).toHaveLength(0);
		} finally {
			process.env.SKILLSFILE_CLAUDE = fake;
		}
	});
});
