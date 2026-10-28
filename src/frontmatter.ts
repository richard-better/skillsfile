import { type Document, parseDocument } from "yaml";

const FRONTMATTER = /^---\r?\n([\s\S]*?\r?\n)?---(\r?\n|$)/;

export interface SkillFile {
	frontmatter: Document;
	body: string;
}

export function parseSkillFile(text: string): SkillFile {
	const match = FRONTMATTER.exec(text);
	if (!match) {
		throw new Error("SKILL.md has no YAML frontmatter");
	}
	const frontmatter = parseDocument(match[1] ?? "");
	if (frontmatter.errors.length > 0) {
		throw new Error(
			`SKILL.md frontmatter is invalid YAML: ${frontmatter.errors[0]?.message}`,
		);
	}
	return { frontmatter, body: text.slice(match[0].length) };
}

export function serializeSkillFile({ frontmatter, body }: SkillFile): string {
	return `---\n${frontmatter.toString({ lineWidth: 0 })}---\n${body}`;
}

/** Best-effort frontmatter read for listing; returns undefined when unparseable. */
export function readFrontmatter(text: string): Document | undefined {
	try {
		return parseSkillFile(text).frontmatter;
	} catch {
		return undefined;
	}
}
