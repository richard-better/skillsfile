import { existsSync } from "node:fs";
import {
	mkdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { Installer } from "../src/install.js";
import { readLock } from "../src/lock.js";
import { FixtureRepo, skillMd, tempDir, writeFiles } from "./helpers.js";

async function project(
	yaml: (repo: FixtureRepo) => string,
	files?: Record<string, string>,
) {
	const repo = await FixtureRepo.create(
		files ?? {
			"skills/grill-me/SKILL.md": skillMd("grill-me", "Grill the user."),
			"skills/grill-me/run.sh": "#!/bin/sh\necho hi\n",
			"skills/code-review/SKILL.md": skillMd("code-review", "Review code."),
		},
	);
	const dir = await tempDir();
	const configFile = join(dir, "skills.yaml");
	await writeFile(configFile, yaml(repo));
	const target = join(dir, ".agents", "skills");
	return {
		repo,
		dir,
		configFile,
		target,
		read: (path: string) => readFile(join(target, path), "utf8"),
		async install(options: Parameters<Installer["install"]>[0] = {}) {
			const installer = new Installer(
				await loadConfig(configFile, ".agents/skills"),
			);
			try {
				return await installer.install(options);
			} finally {
				await installer.dispose();
			}
		},
		async diff(name: string) {
			const installer = new Installer(
				await loadConfig(configFile, ".agents/skills"),
			);
			try {
				return await installer.diff(name);
			} finally {
				await installer.dispose();
			}
		},
		lock: () => readLock(join(dir, "skills.lock")),
	};
}

describe("Installer", () => {
	it("installs, pins commits, and stays pinned until update", async () => {
		const p = await project((repo) => `skills:\n  grill-me: ${repo.url}\n`);
		const first = await p.install();
		expect(first.errors).toEqual(new Map());
		expect(first.outcomes.get("grill-me")).toBe("added");
		expect(await p.read("grill-me/SKILL.md")).toContain("Grill the user.");
		expect(
			(await stat(join(p.target, "grill-me/run.sh"))).mode & 0o111,
		).not.toBe(0);
		const pinned = (await p.lock()).get("grill-me")?.commit;
		expect(pinned).toMatch(/^[0-9a-f]{40}$/);

		await p.repo.commit({
			"skills/grill-me/SKILL.md": skillMd("grill-me", "Grill harder."),
		});
		expect((await p.install()).outcomes.get("grill-me")).toBe("unchanged");
		expect(await p.read("grill-me/SKILL.md")).toContain("Grill the user.");

		// A fresh machine with only skills.yaml and skills.lock gets the pinned commit back.
		await rm(p.target, { recursive: true });
		expect((await p.install()).outcomes.get("grill-me")).toBe("added");
		expect(await p.read("grill-me/SKILL.md")).toContain("Grill the user.");

		expect((await p.install({ update: true })).outcomes.get("grill-me")).toBe(
			"updated",
		);
		expect(await p.read("grill-me/SKILL.md")).toContain("Grill harder.");
		expect((await p.lock()).get("grill-me")?.commit).not.toBe(pinned);
	});

	it("rebuilds when the entry changes", async () => {
		const p = await project((repo) => `skills:\n  grill-me: ${repo.url}\n`);
		await p.install();
		await writeFile(
			p.configFile,
			`skills:\n  grill-me:\n    source: ${p.repo.url}\n    description: Sharpen a plan.\n`,
		);
		expect((await p.install()).outcomes.get("grill-me")).toBe("updated");
		expect(await p.read("grill-me/SKILL.md")).toContain(
			"description: Sharpen a plan.",
		);
	});

	it("installs a renamed skill under its new name", async () => {
		const p = await project(
			(repo) =>
				`skills:\n  aihero-code-review:\n    source: ${repo.url}\n    skill: code-review\n`,
		);
		await p.install();
		expect(await p.read("aihero-code-review/SKILL.md")).toContain(
			"name: aihero-code-review",
		);
		expect((await p.lock()).get("aihero-code-review")?.path).toBe(
			"skills/code-review",
		);
	});

	it("refuses to overwrite local edits, then keeps them as a patch", async () => {
		const p = await project((repo) => `skills:\n  grill-me: ${repo.url}\n`);
		await p.install();
		const edited = `${await p.read("grill-me/SKILL.md")}\nAlways ask one question at a time.\n`;
		await writeFile(join(p.target, "grill-me/SKILL.md"), edited);

		await writeFile(
			p.configFile,
			`skills:\n  grill-me:\n    source: ${p.repo.url}\n    invocation: explicit\n`,
		);
		const blocked = await p.install();
		expect(blocked.errors.get("grill-me")?.message).toContain(
			"skillsfile diff grill-me",
		);
		await writeFile(p.configFile, `skills:\n  grill-me: ${p.repo.url}\n`);

		const patch = await p.diff("grill-me");
		expect(patch).toBe(join(p.dir, "patches/grill-me.patch"));
		expect(await readFile(p.configFile, "utf8")).toBe(
			`skills:\n  grill-me:\n    source: ${p.repo.url}\n    patch: patches/grill-me.patch\n`,
		);
		expect((await p.install()).outcomes.get("grill-me")).toBe("unchanged");

		// The patch survives upstream changes and is applied on top of overrides.
		await p.repo.commit({ "skills/grill-me/extra.md": "More.\n" });
		await p.install({ update: true });
		expect(await p.read("grill-me/SKILL.md")).toBe(edited);
		expect(await p.read("grill-me/extra.md")).toBe("More.\n");
	});

	it("removes skills dropped from skills.yaml but never unmanaged directories", async () => {
		const p = await project(
			(repo) =>
				`skills:\n  grill-me: ${repo.url}\n  code-review: ${repo.url}\n`,
		);
		await p.install();
		await writeFile(p.configFile, `skills:\n  grill-me: ${p.repo.url}\n`);
		expect((await p.install()).outcomes.get("code-review")).toBe("removed");
		expect(existsSync(join(p.target, "code-review"))).toBe(false);
		expect((await p.lock()).has("code-review")).toBe(false);

		await writeFile(join(p.target, "mine.md"), "hand-made");
		await writeFile(
			p.configFile,
			`skills:\n  grill-me: ${p.repo.url}\n  code-review: ${p.repo.url}\n`,
		);
		await mkdir(join(p.target, "code-review"));
		const result = await p.install();
		expect(result.errors.get("code-review")?.message).toContain(
			"not managed by skillsfile",
		);
		expect((await p.install({ force: true })).outcomes.get("code-review")).toBe(
			"added",
		);
		expect(existsSync(join(p.target, "mine.md"))).toBe(true);
	});

	it("reports a failing skill without blocking the others", async () => {
		const p = await project(
			(repo) => `skills:\n  grill-me: ${repo.url}\n  missing: ${repo.url}\n`,
		);
		const result = await p.install();
		expect(result.outcomes.get("grill-me")).toBe("added");
		expect(result.errors.get("missing")?.message).toContain(
			'skill "missing" not found',
		);
	});

	it("refuses skills with symlinks that point outside the skill", async () => {
		const p = await project(() => "skills:\n  evil: ./local\n");
		const outside = await tempDir();
		await writeFiles(p.dir, { "local/SKILL.md": skillMd("evil", "Evil.") });
		await symlink(outside, join(p.dir, "local/agents"));
		const result = await p.install();
		expect(result.errors.get("evil")?.message).toContain(
			"agents links outside the skill",
		);
		expect(existsSync(join(outside, "openai.yaml"))).toBe(false);
	});

	it("refuses patches that add symlinks pointing outside the skill", async () => {
		const p = await project(
			(repo) =>
				`skills:\n  grill-me:\n    source: ${repo.url}\n    patch: evil.patch\n`,
		);
		await writeFile(
			join(p.dir, "evil.patch"),
			"diff --git a/secrets b/secrets\nnew file mode 120000\nindex 0000000..1111111\n--- /dev/null\n+++ b/secrets\n@@ -0,0 +1 @@\n+/etc\n\\ No newline at end of file\n",
		);
		const result = await p.install();
		expect(result.errors.get("grill-me")?.message).toBe(
			"secrets links outside the skill; refusing to install it",
		);
		expect(existsSync(join(p.target, "grill-me"))).toBe(false);
	});

	it("rejects lock entries whose names could escape the target", async () => {
		const p = await project((repo) => `skills:\n  grill-me: ${repo.url}\n`);
		await writeFile(
			join(p.dir, "skills.lock"),
			JSON.stringify({
				version: 1,
				skills: {
					"../escape": { source: "x/y", path: ".", entry: "e", hash: "h" },
				},
			}),
		);
		await expect(p.install()).rejects.toThrow("not a valid lock file");
	});

	it("reads YAML anchors, merge keys and top-level x- definitions", async () => {
		const p = await project(
			(repo) => `x-shared: &shared
  source: ${repo.url}
  invocation: explicit

skills:
  grill-me:
    <<: *shared
  aihero-code-review:
    <<: *shared
    skill: code-review
`,
		);
		expect((await p.install()).errors).toEqual(new Map());
		expect(await p.read("grill-me/SKILL.md")).toContain(
			"disable-model-invocation: true",
		);
		expect(await p.read("aihero-code-review/SKILL.md")).toContain(
			"disable-model-invocation: true",
		);
	});

	it("installs from a local directory", async () => {
		const p = await project(() => "skills:\n  mine: ./local\n");
		await writeFiles(p.dir, {
			"local/SKILL.md": skillMd("mine", "My own skill."),
		});
		expect((await p.install()).outcomes.get("mine")).toBe("added");
		expect((await p.lock()).get("mine")?.commit).toBeUndefined();
	});
});
