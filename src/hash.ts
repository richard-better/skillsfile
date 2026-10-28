import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

/** Content hash of a directory tree: paths, file contents, executable bits and symlink targets. */
export async function hashDir(root: string): Promise<string> {
	const hash = createHash("sha256");
	async function walk(dir: string, prefix: string): Promise<void> {
		const entries = (await readdir(dir)).sort();
		for (const name of entries) {
			const path = join(dir, name);
			const relative = prefix ? `${prefix}/${name}` : name;
			const stat = await lstat(path);
			if (stat.isDirectory()) {
				await walk(path, relative);
			} else if (stat.isSymbolicLink()) {
				hash.update(`link\0${relative}\0${await readlink(path)}\0`);
			} else {
				const executable = (stat.mode & 0o111) !== 0;
				hash.update(`file\0${relative}\0${executable ? "x" : "-"}\0`);
				hash.update(await readFile(path));
				hash.update("\0");
			}
		}
	}
	await walk(root, "");
	return `sha256-${hash.digest("hex")}`;
}

export function hashText(...parts: string[]): string {
	const hash = createHash("sha256");
	for (const part of parts) hash.update(`${part}\0`);
	return `sha256-${hash.digest("hex")}`;
}
