import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type Document, isMap, parseDocument } from "yaml";
import { z } from "zod";

export const CONFIG_FILE = "skills.yaml";

export const skillName = z
	.string()
	.regex(
		/^[a-z0-9][a-z0-9-]*$/,
		"skill names are lowercase letters, digits and hyphens",
	);

const openaiInterface = z
	.object({
		display_name: z.string(),
		short_description: z.string(),
		default_prompt: z.string(),
		icon_small: z.string(),
		icon_large: z.string(),
		brand_color: z.string(),
	})
	.partial()
	.strict();

const entrySchema = z
	.object({
		/** `owner/repo` on GitHub, a git URL, or a local path (`./`, `../`, `/`, `~/`). */
		source: z.string().min(1),
		/** Branch, tag or commit. Defaults to the remote's default branch. */
		ref: z
			.string()
			.regex(/^[^-\s]\S*$/, "refs cannot start with - or contain whitespace")
			.optional(),
		/** Upstream skill name to look up in the source. Defaults to the entry key. */
		skill: z.string().min(1).optional(),
		/** Exact directory of the skill inside the source. Overrides `skill` lookup. */
		path: z.string().min(1).optional(),
		/** Replaces the `description` frontmatter field. */
		description: z.string().min(1).optional(),
		/**
		 * `auto`: the model may load the skill on its own.
		 * `explicit`: only loaded when invoked by name (/skill in Claude Code, $skill in Codex).
		 * Unset keeps whatever upstream declares.
		 */
		invocation: z.enum(["auto", "explicit"]).optional(),
		/** `false` skips generating agents/openai.yaml; an object overrides its interface fields. */
		openai: z.union([z.literal(false), openaiInterface]).optional(),
		/** Unified diff applied last, relative to skills.yaml. Create one with `skillsfile diff`. */
		patch: z.string().min(1).optional(),
	})
	.strict()
	.refine((entry) => !(entry.skill && entry.path), {
		message: "set either `skill` or `path`, not both",
	});

const configSchema = z
	.object({
		/** Where skills are installed, relative to skills.yaml. */
		target: z.string().min(1).optional(),
		skills: z
			.record(
				skillName,
				z.union([
					z
						.string()
						.min(1)
						.transform((source) => ({ source })),
					entrySchema,
				]),
			)
			.default({}),
	})
	.strict();

export type SkillEntry = z.infer<typeof entrySchema>;
export type OpenaiInterface = z.infer<typeof openaiInterface>;

export interface Config {
	/** Absolute path of skills.yaml. */
	file: string;
	/** Directory containing skills.yaml; relative paths resolve against it. */
	dir: string;
	/** Absolute install directory. */
	target: string;
	skills: Map<string, SkillEntry>;
}

export class ConfigError extends Error {}

export async function loadConfig(
	file: string,
	defaultTarget: string,
): Promise<Config> {
	// Resolve symlinks so relative paths (target, patches, the lock) sit next to the real file.
	const absolute = existsSync(file) ? realpathSync(file) : resolve(file);
	const dir = dirname(absolute);
	const text = existsSync(absolute) ? await readFile(absolute, "utf8") : "";
	const document = parseDocument(text, { merge: true });
	if (document.errors.length > 0) {
		throw new ConfigError(`${absolute}: ${document.errors[0]?.message}`);
	}
	const parsed = configSchema.safeParse(withoutExtensions(document.toJS()));
	if (!parsed.success) {
		const issues = parsed.error.issues.map(
			(issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
		);
		throw new ConfigError(`${absolute} is invalid:\n${issues.join("\n")}`);
	}
	return {
		file: absolute,
		dir,
		target: resolve(dir, parsed.data.target ?? defaultTarget),
		skills: new Map(Object.entries(parsed.data.skills)),
	};
}

/** Top-level `x-` keys hold shared definitions for YAML anchors, like docker-compose. */
function withoutExtensions(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return value ?? {};
	return Object.fromEntries(
		Object.entries(value).filter(([key]) => !key.startsWith("x-")),
	);
}

/** Edits skills.yaml in place while keeping the user's comments and formatting. */
export async function editConfig(
	file: string,
	edit: (document: Document) => void,
): Promise<void> {
	const text = existsSync(file) ? await readFile(file, "utf8") : "";
	const document: Document = parseDocument(text, { merge: true });
	if (!isMap(document.contents)) {
		document.contents = document.createNode({});
	}
	if (!document.has("skills")) {
		document.set("skills", document.createNode({}));
	}
	edit(document);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, document.toString({ lineWidth: 0 }));
}
