import { existsSync } from "node:fs";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { type Config, editConfig, type SkillEntry } from "./config.js";
import { hashDir, hashText } from "./hash.js";
import {
	type Lock,
	type LockEntry,
	lockPathFor,
	readLock,
	writeLock,
} from "./lock.js";
import { applyPatch, createPatch } from "./patch.js";
import { Fetcher, locateSkill, parseSource } from "./source.js";
import { applyOverrides } from "./transform.js";

export interface InstallOptions {
	/** Re-resolve refs instead of using locked commits. `true` for all skills, or a set of names. */
	update?: boolean | ReadonlySet<string>;
	/** Overwrite or delete installed skills even when they were edited locally. */
	force?: boolean;
	log?: (line: string) => void;
}

export type Outcome = "added" | "updated" | "unchanged" | "removed";

export interface InstallResult {
	outcomes: Map<string, Outcome>;
	errors: Map<string, Error>;
}

interface Built {
	dir: string;
	path: string;
	commit: string | undefined;
}

export class Installer {
	private readonly fetcher = new Fetcher();
	private readonly scratch: Promise<string> = mkdtemp(
		join(tmpdir(), "skillsfile-build-"),
	);

	constructor(private readonly config: Config) {}

	get lockFile(): string {
		return lockPathFor(this.config.file);
	}

	async install(options: InstallOptions = {}): Promise<InstallResult> {
		const { config } = this;
		const log = options.log ?? (() => {});
		const lock = await readLock(this.lockFile);
		const nextLock: Lock = new Map();
		const outcomes = new Map<string, Outcome>();
		const errors = new Map<string, Error>();
		await mkdir(config.target, { recursive: true });

		const results = await Promise.allSettled(
			[...config.skills].map(async ([name, entry]) => {
				const update =
					options.update === true ||
					(options.update instanceof Set && options.update.has(name));
				return [
					name,
					await this.installOne(
						name,
						entry,
						lock.get(name),
						update,
						options.force ?? false,
					),
				] as const;
			}),
		);
		for (const [index, result] of results.entries()) {
			const name = [...config.skills.keys()][index] as string;
			if (result.status === "fulfilled") {
				const [, { outcome, lockEntry }] = result.value;
				outcomes.set(name, outcome);
				nextLock.set(name, lockEntry);
			} else {
				errors.set(name, toError(result.reason));
				const previous = lock.get(name);
				if (previous) nextLock.set(name, previous);
			}
		}

		for (const [name, locked] of lock) {
			if (config.skills.has(name)) continue;
			try {
				const dir = join(config.target, name);
				if (existsSync(dir)) {
					await assertUnmodified(
						dir,
						name,
						locked.hash,
						options.force ?? false,
					);
					await rm(dir, { recursive: true, force: true });
				}
				outcomes.set(name, "removed");
			} catch (error) {
				errors.set(name, toError(error));
				nextLock.set(name, locked);
			}
		}

		await writeLock(this.lockFile, nextLock);
		for (const [name, outcome] of outcomes) {
			if (outcome !== "unchanged") log(`${outcome} ${name}`);
		}
		return { outcomes, errors };
	}

	private async installOne(
		name: string,
		entry: SkillEntry,
		locked: LockEntry | undefined,
		update: boolean,
		force: boolean,
	): Promise<{ outcome: Outcome; lockEntry: LockEntry }> {
		const targetDir = join(this.config.target, name);
		const fingerprint = await this.fingerprint(entry);
		const installed = existsSync(targetDir)
			? await hashDir(targetDir)
			: undefined;
		const sameEntry =
			locked?.source === entry.source && locked.ref === entry.ref;

		// Nothing to do when the entry and its patch are unchanged and the pinned output is in place.
		if (
			!update &&
			locked?.commit &&
			locked.entry === fingerprint &&
			installed === locked.hash
		) {
			return { outcome: "unchanged", lockEntry: locked };
		}

		const commit = !update && sameEntry ? locked?.commit : undefined;
		const built = await this.build(name, entry, commit, { patch: true });
		const hash = await hashDir(built.dir);
		const lockEntry: LockEntry = {
			source: entry.source,
			...(entry.ref ? { ref: entry.ref } : {}),
			path: built.path,
			...(built.commit ? { commit: built.commit } : {}),
			entry: fingerprint,
			hash,
		};
		if (installed === hash) {
			return { outcome: "unchanged", lockEntry };
		}
		if (installed !== undefined) {
			if (!locked) {
				if (!force) {
					throw new Error(
						`${targetDir} exists and is not managed by skillsfile; use --force to replace it`,
					);
				}
			} else {
				await assertUnmodified(targetDir, name, locked.hash, force);
			}
		}
		await replaceDir(built.dir, targetDir);
		return {
			outcome: installed === undefined || !locked ? "added" : "updated",
			lockEntry,
		};
	}

	/**
	 * Builds a skill into a scratch directory: upstream files, then overrides, then the patch.
	 * `commit` pins git sources; otherwise the entry's ref (or the default branch) is fetched.
	 */
	async build(
		name: string,
		entry: SkillEntry,
		commit: string | undefined,
		options: { patch: boolean },
	): Promise<Built> {
		const source = parseSource(entry.source, this.config.dir);
		const checkout = await this.fetcher.fetch(source, commit ?? entry.ref);
		const skillDir = await locateSkill(checkout.dir, {
			...(entry.path ? { path: entry.path } : {}),
			skill: entry.skill ?? name,
		});
		const dir = await mkdtemp(join(await this.scratch, `${name}-`));
		await cp(skillDir, dir, { recursive: true, verbatimSymlinks: true });
		await applyOverrides(dir, name, entry);
		if (options.patch && entry.patch) {
			await applyPatch(dir, resolve(this.config.dir, entry.patch));
		}
		return {
			dir,
			path: relative(checkout.dir, skillDir).split("\\").join("/") || ".",
			commit: checkout.commit,
		};
	}

	/**
	 * Captures local edits to an installed skill as a patch file and records it in skills.yaml.
	 * Returns the patch path, or undefined when the skill matches its unpatched build.
	 */
	async diff(name: string): Promise<string | undefined> {
		const entry = this.config.skills.get(name);
		if (!entry) throw new Error(`${name} is not in ${this.config.file}`);
		const lock = await readLock(this.lockFile);
		const locked = lock.get(name);
		const targetDir = join(this.config.target, name);
		if (!locked || !existsSync(targetDir)) {
			throw new Error(`${name} is not installed; run install first`);
		}

		const base = await this.build(name, entry, locked.commit, { patch: false });
		const patch = await createPatch(base.dir, targetDir);
		const patchPath = entry.patch ?? `patches/${name}.patch`;
		const patchFile = resolve(this.config.dir, patchPath);

		if (patch === "") {
			if (entry.patch) await rm(patchFile, { force: true });
		} else {
			await mkdir(dirname(patchFile), { recursive: true });
			await writeFile(patchFile, patch);
		}
		const nextEntry = { ...entry, patch: patch === "" ? undefined : patchPath };
		await editConfig(this.config.file, (document) => {
			const node = document.getIn(["skills", name]);
			if (patch === "") {
				if (entry.patch) document.deleteIn(["skills", name, "patch"]);
			} else if (typeof node === "string") {
				document.setIn(
					["skills", name],
					document.createNode({ source: node, patch: patchPath }),
				);
			} else {
				document.setIn(["skills", name, "patch"], patchPath);
			}
		});
		lock.set(name, {
			...locked,
			entry: await this.fingerprint(nextEntry),
			hash: await hashDir(targetDir),
		});
		await writeLock(this.lockFile, lock);
		return patch === "" ? undefined : patchFile;
	}

	private async fingerprint(entry: SkillEntry): Promise<string> {
		const patchFile = entry.patch
			? resolve(this.config.dir, entry.patch)
			: undefined;
		const patch =
			patchFile && existsSync(patchFile)
				? await readFile(patchFile, "utf8")
				: "";
		return hashText(stableStringify(entry), patch);
	}

	async dispose(): Promise<void> {
		await this.fetcher.dispose();
		await rm(await this.scratch, { recursive: true, force: true });
	}
}

async function assertUnmodified(
	dir: string,
	name: string,
	expected: string,
	force: boolean,
): Promise<void> {
	if (force) return;
	if ((await hashDir(dir)) !== expected) {
		throw new Error(
			`${dir} has local edits; run \`skillsfile diff ${name}\` to keep them as a patch, or --force to discard them`,
		);
	}
}

/** Swaps a built skill into place, staging next to the target so the final rename is atomic. */
async function replaceDir(from: string, to: string): Promise<void> {
	const staging = `${dirname(to)}/.skillsfile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	await cp(from, staging, { recursive: true, verbatimSymlinks: true });
	await rm(to, { recursive: true, force: true });
	await rename(staging, to);
}

function stableStringify(value: unknown): string {
	return JSON.stringify(value, (_key, inner: unknown) =>
		inner && typeof inner === "object" && !Array.isArray(inner)
			? Object.fromEntries(
					Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)),
				)
			: inner,
	);
}

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}
