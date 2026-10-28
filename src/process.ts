import { execFile } from "node:child_process";

export interface RunResult {
	stdout: string;
	stderr: string;
	code: number;
}

/** Runs a command without a shell. Resolves with the exit code instead of throwing. */
export function run(
	command: string,
	args: string[],
	options: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
	return new Promise((resolvePromise, reject) => {
		const child = execFile(
			command,
			args,
			{
				cwd: options.cwd,
				maxBuffer: 64 * 1024 * 1024,
				env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: "0" },
			},
			(error, stdout, stderr) => {
				if (error && typeof error.code !== "number") {
					reject(error);
					return;
				}
				resolvePromise({
					stdout,
					stderr,
					code: typeof error?.code === "number" ? error.code : 0,
				});
			},
		);
		if (options.input !== undefined) {
			child.stdin?.end(options.input);
		}
	});
}

export async function git(args: string[], cwd?: string): Promise<string> {
	const result = await run("git", args, { cwd });
	if (result.code !== 0) {
		throw new Error(`git ${args.join(" ")} failed:\n${result.stderr.trim()}`);
	}
	return result.stdout;
}
