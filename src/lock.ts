import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { skillName } from "./config.js";

const lockEntrySchema = z.object({
	source: z.string(),
	ref: z.string().optional(),
	/** Skill directory inside the source. */
	path: z.string(),
	/** Commit the skill was built from; absent for local sources. */
	commit: z.string().optional(),
	/** Fingerprint of the skills.yaml entry and its patch file. */
	entry: z.string(),
	/** Hash of the installed directory, used to detect local edits. */
	hash: z.string(),
});

const lockSchema = z.object({
	version: z.literal(1),
	skills: z.record(skillName, lockEntrySchema),
});

export type LockEntry = z.infer<typeof lockEntrySchema>;
export type Lock = Map<string, LockEntry>;

export function lockPathFor(configFile: string): string {
	return `${configFile.replace(/\.ya?ml$/, "")}.lock`;
}

export async function readLock(file: string): Promise<Lock> {
	if (!existsSync(file)) return new Map();
	const parsed = lockSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
	if (!parsed.success) {
		throw new Error(
			`${file} is not a valid lock file; delete it and run install again`,
		);
	}
	return new Map(Object.entries(parsed.data.skills));
}

export async function writeLock(file: string, lock: Lock): Promise<void> {
	const skills = Object.fromEntries(
		[...lock.entries()].sort(([a], [b]) => a.localeCompare(b)),
	);
	await writeFile(file, `${JSON.stringify({ version: 1, skills }, null, 2)}\n`);
}
