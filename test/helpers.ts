import { chmod, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { git } from "../src/process.js";

export async function tempDir(prefix = "skillsfile-test-"): Promise<string> {
	// Real paths, so assertions match paths skillsfile resolves (macOS /var is a symlink).
	return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

export async function writeFiles(
	root: string,
	files: Record<string, string>,
): Promise<void> {
	for (const [path, content] of Object.entries(files)) {
		const file = join(root, path);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, content);
		if (path.endsWith(".sh")) await chmod(file, 0o755);
	}
}

export function skillMd(
	name: string,
	description: string,
	body = "Body.\n",
	extra = "",
): string {
	return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}`;
}

/** A git repository usable as a skill source through a file:// URL. */
export class FixtureRepo {
	private constructor(readonly dir: string) {}

	static async create(files: Record<string, string>): Promise<FixtureRepo> {
		const repo = new FixtureRepo(await tempDir("skillsfile-repo-"));
		await git(["init", "--quiet", "--initial-branch=main"], repo.dir);
		await git(["config", "user.email", "test@example.com"], repo.dir);
		await git(["config", "user.name", "Test"], repo.dir);
		await git(["config", "commit.gpgsign", "false"], repo.dir);
		await repo.commit(files);
		return repo;
	}

	get url(): string {
		return `file://${this.dir}`;
	}

	async commit(files: Record<string, string>): Promise<string> {
		await writeFiles(this.dir, files);
		await git(["add", "-A"], this.dir);
		await git(["commit", "--quiet", "-m", "change"], this.dir);
		return (await git(["rev-parse", "HEAD"], this.dir)).trim();
	}
}
