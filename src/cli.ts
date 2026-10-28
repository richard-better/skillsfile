#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG_FILE, type Config, editConfig, loadConfig } from "./config.js";
import { Installer, type InstallResult } from "./install.js";
import { lockPathFor, readLock } from "./lock.js";
import { discoverSkills, Fetcher, parseSource } from "./source.js";

const HELP = `skillsfile - declarative agent skills from one skills.yaml

Usage:
  skillsfile [install]              Install skills.yaml at the locked commits
  skillsfile update [name...]       Move skills to the latest upstream commit
  skillsfile add <source>           Add skills from owner/repo, a git URL or a local path
      --skill <name>                  Pick a skill (repeatable); needed when the source has several
      --all                           Add every skill in the source
      --name <name>                   Install under a different name (one skill only)
      --ref <ref>                     Track a branch, tag or commit
  skillsfile remove <name...>       Remove skills from skills.yaml and uninstall them
  skillsfile diff <name>            Save local edits to an installed skill as a patch
  skillsfile list                   Show configured skills and their pinned commits

Options:
  -g, --global                      Use ~/.agents/skills.yaml, installing into ~/.agents/skills
  -c, --config <file>               Use a specific skills.yaml (default: ./skills.yaml)
      --force                       Overwrite locally edited or unmanaged skill directories
  -h, --help                        Show this help
  -v, --version                     Show the version
`;

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			global: { type: "boolean", short: "g" },
			config: { type: "string", short: "c" },
			force: { type: "boolean" },
			skill: { type: "string", multiple: true },
			all: { type: "boolean" },
			name: { type: "string" },
			ref: { type: "string" },
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" },
		},
	});
	if (values.help) {
		process.stdout.write(HELP);
		return 0;
	}
	if (values.version) {
		const pkg = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		);
		process.stdout.write(`${pkg.version}\n`);
		return 0;
	}

	const [command = "install", ...args] = positionals;
	const configFile =
		values.config ??
		(values.global ? join(homedir(), ".agents", CONFIG_FILE) : CONFIG_FILE);
	const defaultTarget = values.global ? "skills" : join(".agents", "skills");
	const load = () => loadConfig(configFile, defaultTarget);
	const force = values.force ?? false;

	switch (command) {
		case "install":
		case "i":
			return withInstaller(await load(), (installer) =>
				installer.install({ force, log }),
			);

		case "update":
		case "up": {
			const config = await load();
			const unknown = args.filter((name) => !config.skills.has(name));
			if (unknown.length > 0)
				return fail(`not in ${config.file}: ${unknown.join(", ")}`);
			const update = args.length > 0 ? new Set(args) : true;
			return withInstaller(config, (installer) =>
				installer.install({ update, force, log }),
			);
		}

		case "add": {
			const [spec] = args;
			if (!spec)
				return fail(
					"add needs a source, e.g. skillsfile add mattpocock/skills --skill grill-me",
				);
			const added = await add(spec, configFile, values);
			if (added === undefined) return 1;
			const config = await load();
			return withInstaller(config, (installer) =>
				installer.install({ update: added, force, log }),
			);
		}

		case "remove":
		case "rm": {
			if (args.length === 0)
				return fail("remove needs at least one skill name");
			const config = await load();
			const unknown = args.filter((name) => !config.skills.has(name));
			if (unknown.length > 0)
				return fail(`not in ${config.file}: ${unknown.join(", ")}`);
			await editConfig(config.file, (document) => {
				for (const name of args) document.deleteIn(["skills", name]);
			});
			return withInstaller(await load(), (installer) =>
				installer.install({ force, log }),
			);
		}

		case "diff": {
			const [name] = args;
			if (!name) return fail("diff needs a skill name");
			const config = await load();
			const installer = new Installer(config);
			try {
				const patch = await installer.diff(name);
				log(
					patch
						? `wrote ${relative(process.cwd(), patch)}`
						: `${name} has no local edits`,
				);
				return 0;
			} finally {
				await installer.dispose();
			}
		}

		case "list":
		case "ls": {
			const config = await load();
			const lock = await readLock(lockPathFor(config.file));
			for (const [name, entry] of config.skills) {
				const locked = lock.get(name);
				const pin =
					locked?.commit?.slice(0, 7) ?? (locked ? "local" : "not installed");
				const installed = existsSync(join(config.target, name))
					? ""
					: " (missing)";
				log(
					`${name}  ${entry.source}${entry.ref ? `#${entry.ref}` : ""}  ${pin}${installed}`,
				);
			}
			return 0;
		}

		default:
			return fail(`unknown command "${command}"\n\n${HELP}`);
	}
}

async function add(
	spec: string,
	configFile: string,
	options: { skill?: string[]; all?: boolean; name?: string; ref?: string },
): Promise<Set<string> | undefined> {
	const fetcher = new Fetcher();
	let available: Awaited<ReturnType<typeof discoverSkills>>;
	try {
		const checkout = await fetcher.fetch(
			parseSource(spec, process.cwd()),
			options.ref,
		);
		available = await discoverSkills(checkout.dir);
	} finally {
		await fetcher.dispose();
	}
	if (available.length === 0) {
		fail(`no SKILL.md found in ${spec}`);
		return undefined;
	}

	let chosen = available;
	if (options.skill) {
		const missing = options.skill.filter(
			(name) => !available.some((skill) => skill.name === name),
		);
		if (missing.length > 0) {
			fail(
				`not found in ${spec}: ${missing.join(", ")}\n\n${describe(available)}`,
			);
			return undefined;
		}
		chosen = available.filter((skill) => options.skill?.includes(skill.name));
	} else if (!options.all && available.length > 1) {
		fail(
			`${spec} has ${available.length} skills; pick with --skill <name> or use --all\n\n${describe(available)}`,
		);
		return undefined;
	}
	if (options.name && chosen.length !== 1) {
		fail("--name only works when adding a single skill");
		return undefined;
	}
	const duplicates = chosen.filter(
		(skill) => chosen.filter((other) => other.name === skill.name).length > 1,
	);
	if (duplicates.length > 0) {
		fail(
			`several skills are named ${duplicates[0]?.name}; add them one at a time with --name and edit \`path\``,
		);
		return undefined;
	}

	const added = new Set<string>();
	await editConfig(configFile, (document) => {
		for (const skill of chosen) {
			const name = options.name ?? skill.name;
			const entry: Record<string, string> = { source: spec };
			if (options.ref) entry.ref = options.ref;
			if (name !== skill.name) entry.skill = skill.name;
			const short = Object.keys(entry).length === 1;
			document.setIn(
				["skills", name],
				short ? spec : document.createNode(entry),
			);
			added.add(name);
		}
	});
	return added;
}

function describe(
	skills: { name: string; description: string | undefined }[],
): string {
	return skills
		.map(
			(skill) =>
				`  ${skill.name}${skill.description ? ` - ${skill.description}` : ""}`,
		)
		.join("\n");
}

async function withInstaller(
	config: Config,
	action: (installer: Installer) => Promise<InstallResult>,
): Promise<number> {
	const installer = new Installer(config);
	try {
		const { outcomes, errors } = await action(installer);
		for (const [name, error] of errors) {
			process.stderr.write(`error ${name}: ${error.message}\n`);
		}
		if (
			errors.size === 0 &&
			[...outcomes.values()].every((outcome) => outcome === "unchanged")
		) {
			log(`${outcomes.size} skills up to date`);
		}
		return errors.size === 0 ? 0 : 1;
	} finally {
		await installer.dispose();
	}
}

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

function fail(message: string): number {
	process.stderr.write(`${message}\n`);
	return 1;
}

main(process.argv.slice(2)).then(
	(code) => {
		process.exitCode = code;
	},
	(error: unknown) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	},
);
