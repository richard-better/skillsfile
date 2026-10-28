import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./process.js";

/** Applies a unified diff (paths prefixed a/ and b/) to a skill directory. */
export async function applyPatch(
	dir: string,
	patchFile: string,
): Promise<void> {
	const result = await run("git", ["apply", "--whitespace=nowarn", patchFile], {
		cwd: dir,
	});
	if (result.code !== 0) {
		throw new Error(
			`patch ${patchFile} no longer applies:\n${result.stderr.trim()}\n` +
				"Remove `patch` from the entry, install, redo your edits, then run `skillsfile diff`.",
		);
	}
}

/** Returns the unified diff turning `base` into `edited`, or an empty string when identical. */
export async function createPatch(
	base: string,
	edited: string,
): Promise<string> {
	const scratch = await mkdtemp(join(tmpdir(), "skillsfile-diff-"));
	try {
		// Copy both trees to sibling `a` and `b` so the diff header paths are exactly a/<file> and b/<file>.
		await cp(base, join(scratch, "a"), {
			recursive: true,
			verbatimSymlinks: true,
		});
		await cp(edited, join(scratch, "b"), {
			recursive: true,
			verbatimSymlinks: true,
		});
		const result = await run(
			"git",
			[
				"diff",
				"--no-index",
				"--no-prefix",
				"--no-color",
				"--no-ext-diff",
				"--binary",
				"a",
				"b",
			],
			{ cwd: scratch },
		);
		if (result.code > 1) {
			throw new Error(`git diff failed:\n${result.stderr.trim()}`);
		}
		return result.stdout;
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
