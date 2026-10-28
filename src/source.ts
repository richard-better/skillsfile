import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { readFrontmatter } from "./frontmatter.js";
import { git } from "./process.js";

export type Source =
	| { kind: "git"; url: string }
	| { kind: "local"; dir: string };

export function parseSource(spec: string, baseDir: string): Source {
	if (/^(\.{1,2}(\/|$)|\/|~(\/|$))/.test(spec)) {
		const expanded = spec.startsWith("~")
			? join(homedir(), spec.slice(1))
			: spec;
		return { kind: "local", dir: resolve(baseDir, expanded) };
	}
	if (/^[\w.-]+\/[\w.-]+$/.test(spec)) {
		return {
			kind: "git",
			url: `https://github.com/${spec.replace(/\.git$/, "")}.git`,
		};
	}
	if (
		/^(https?|ssh|git|file):\/\//.test(spec) ||
		/^[\w.-]+@[\w.-]+:/.test(spec)
	) {
		return { kind: "git", url: spec };
	}
	throw new Error(
		`unrecognized source "${spec}": use owner/repo, a git URL, or a path starting with ./, ../, / or ~/`,
	);
}

export interface Checkout {
	dir: string;
	/** Resolved commit, or undefined for local sources. */
	commit: string | undefined;
}

/** Fetches git sources into a scratch directory, once per (url, ref). */
export class Fetcher {
	private readonly checkouts = new Map<string, Promise<Checkout>>();
	private root: string | undefined;

	fetch(source: Source, ref: string | undefined): Promise<Checkout> {
		if (source.kind === "local") {
			if (!existsSync(source.dir)) {
				return Promise.reject(
					new Error(`local source ${source.dir} does not exist`),
				);
			}
			return Promise.resolve({ dir: source.dir, commit: undefined });
		}
		const key = `${source.url}#${ref ?? "HEAD"}`;
		let checkout = this.checkouts.get(key);
		if (!checkout) {
			checkout = this.clone(source.url, ref ?? "HEAD");
			this.checkouts.set(key, checkout);
		}
		return checkout;
	}

	private async clone(url: string, ref: string): Promise<Checkout> {
		this.root ??= await mkdtemp(join(tmpdir(), "skillsfile-"));
		const dir = join(this.root, String(this.checkouts.size));
		await mkdir(dir);
		await git(["init", "--quiet"], dir);
		// A depth-1 fetch of an exact ref works for branches, tags and full commit SHAs.
		await git(["fetch", "--quiet", "--depth", "1", url, ref], dir);
		await git(
			["-c", "advice.detachedHead=false", "checkout", "--quiet", "FETCH_HEAD"],
			dir,
		);
		const commit = (await git(["rev-parse", "HEAD"], dir)).trim();
		return { dir, commit };
	}

	async dispose(): Promise<void> {
		if (this.root) {
			await rm(this.root, { recursive: true, force: true });
		}
	}
}

export interface FoundSkill {
	/** Frontmatter name, falling back to the directory name. */
	name: string;
	/** Directory relative to the checkout root, using forward slashes. */
	path: string;
	description: string | undefined;
}

const IGNORED_DIRS = new Set([".git", "node_modules"]);

/** Lists every directory containing a SKILL.md. Skill directories are not searched further. */
export async function discoverSkills(root: string): Promise<FoundSkill[]> {
	const found: FoundSkill[] = [];
	async function walk(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true });
		if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
			const frontmatter = readFrontmatter(
				await readFile(join(dir, "SKILL.md"), "utf8"),
			);
			const name = frontmatter?.get("name");
			const description = frontmatter?.get("description");
			found.push({
				name: typeof name === "string" ? name : basename(dir),
				path: relative(root, dir).split(sep).join("/") || ".",
				description: typeof description === "string" ? description : undefined,
			});
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
				await walk(join(dir, entry.name));
			}
		}
	}
	await walk(root);
	return found.sort((a, b) => a.path.localeCompare(b.path));
}

/** Finds the skill directory for an entry, by explicit path or by name. */
export async function locateSkill(
	root: string,
	options: { path?: string; skill: string },
): Promise<string> {
	if (options.path) {
		const dir = resolve(root, options.path);
		if (!existsSync(join(dir, "SKILL.md"))) {
			throw new Error(`no SKILL.md at ${options.path}`);
		}
		return dir;
	}
	const skills = await discoverSkills(root);
	const byName = skills.filter((skill) => skill.name === options.skill);
	const matches =
		byName.length > 0
			? byName
			: skills.filter((skill) => basename(skill.path) === options.skill);
	if (matches.length === 1 && matches[0]) {
		return resolve(root, matches[0].path);
	}
	if (matches.length > 1) {
		const paths = matches.map((skill) => skill.path).join(", ");
		throw new Error(
			`skill "${options.skill}" is ambiguous (${paths}); set \`path\``,
		);
	}
	const available = skills.map((skill) => skill.name).join(", ") || "none";
	throw new Error(
		`skill "${options.skill}" not found; available: ${available}`,
	);
}
