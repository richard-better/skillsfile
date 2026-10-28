import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Document, isMap, parseDocument, Scalar } from "yaml";
import type { OpenaiInterface, SkillEntry } from "./config.js";
import { parseSkillFile, serializeSkillFile } from "./frontmatter.js";

/**
 * Applies an entry's overrides to a staged copy of the skill: rename, description,
 * invocation policy, and Codex's agents/openai.yaml.
 */
export async function applyOverrides(
	dir: string,
	name: string,
	entry: SkillEntry,
): Promise<void> {
	const skillPath = join(dir, "SKILL.md");
	const original = await readFile(skillPath, "utf8");
	const skill = parseSkillFile(original);
	const { frontmatter } = skill;

	const upstreamName = frontmatter.get("name");
	if (upstreamName !== name) {
		frontmatter.set("name", name);
	}
	if (entry.description !== undefined) {
		frontmatter.set("description", entry.description);
	}
	if (entry.invocation === "explicit") {
		frontmatter.set("disable-model-invocation", true);
	} else if (entry.invocation === "auto") {
		frontmatter.delete("disable-model-invocation");
	}
	const updated = serializeSkillFile(skill);
	if (updated !== original) {
		await writeFile(skillPath, updated);
	}

	const description = frontmatter.get("description");
	await writeOpenaiYaml(dir, {
		name,
		upstreamName: typeof upstreamName === "string" ? upstreamName : undefined,
		description: typeof description === "string" ? description : "",
		explicitOnly: frontmatter.get("disable-model-invocation") === true,
		entry,
	});
}

async function writeOpenaiYaml(
	dir: string,
	options: {
		name: string;
		upstreamName: string | undefined;
		description: string;
		explicitOnly: boolean;
		entry: SkillEntry;
	},
): Promise<void> {
	const { name, upstreamName, description, explicitOnly, entry } = options;
	const path = join(dir, "agents", "openai.yaml");
	const exists = existsSync(path);
	if (entry.openai === false && !exists) {
		return;
	}
	const original = exists ? await readFile(path, "utf8") : undefined;
	const document: Document = parseDocument(original ?? "");
	if (!isMap(document.contents)) {
		document.contents = document.createNode({});
	}

	const overrides: OpenaiInterface =
		entry.openai === false ? {} : (entry.openai ?? {});
	const generated: OpenaiInterface = {
		display_name: displayName(name),
		short_description: shortDescription(description),
	};
	const iface = { ...(exists ? {} : generated), ...overrides };
	for (const [key, value] of Object.entries(iface)) {
		document.setIn(["interface", key], quoted(value));
	}
	if (exists && upstreamName && upstreamName !== name) {
		const prompt = document.getIn(["interface", "default_prompt"]);
		if (typeof prompt === "string") {
			const renamed = prompt.replaceAll(`$${upstreamName}`, `$${name}`);
			document.setIn(["interface", "default_prompt"], quoted(renamed));
		}
	}
	// Codex's equivalent of Claude Code's disable-model-invocation. Mirror it so both agents agree.
	if (explicitOnly) {
		document.setIn(["policy", "allow_implicit_invocation"], false);
	} else if (document.hasIn(["policy", "allow_implicit_invocation"])) {
		document.deleteIn(["policy", "allow_implicit_invocation"]);
		const policy = document.get("policy");
		if (isMap(policy) && policy.items.length === 0) {
			document.delete("policy");
		}
	}

	const updated = document.toString({ lineWidth: 0 });
	if (updated !== original) {
		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(path, updated);
	}
}

function quoted(value: string): Scalar {
	const scalar = new Scalar(value);
	scalar.type = Scalar.QUOTE_DOUBLE;
	return scalar;
}

const ACRONYMS = new Set([
	"AI",
	"API",
	"CI",
	"CLI",
	"EAS",
	"GH",
	"LLM",
	"MCP",
	"PDF",
	"PR",
	"SQL",
	"UI",
	"URL",
	"UX",
]);
const SMALL_WORDS = new Set([
	"a",
	"and",
	"for",
	"of",
	"or",
	"the",
	"to",
	"with",
]);

export function displayName(name: string): string {
	return name
		.split("-")
		.filter(Boolean)
		.map((word, index) => {
			if (ACRONYMS.has(word.toUpperCase())) return word.toUpperCase();
			if (index > 0 && SMALL_WORDS.has(word)) return word;
			return word.charAt(0).toUpperCase() + word.slice(1);
		})
		.join(" ");
}

const SHORT_DESCRIPTION_MAX = 64;

/** Codex wants a 25-64 character UI blurb; take the description's first sentence and trim it. */
export function shortDescription(description: string): string {
	const firstSentence = description
		.replace(/\s+/g, " ")
		.trim()
		.split(/(?<=[.!?])\s/)[0]
		?.replace(/[.!?]$/, "");
	if (!firstSentence) return "";
	if (firstSentence.length <= SHORT_DESCRIPTION_MAX) return firstSentence;
	const clipped = firstSentence.slice(0, SHORT_DESCRIPTION_MAX - 1);
	const atWord = clipped
		.slice(0, clipped.lastIndexOf(" "))
		.replace(/[\s,;:-]+$/, "");
	return `${atWord || clipped}…`;
}
