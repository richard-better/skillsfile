import { type Document, isMap, isScalar, parseDocument, stringify } from "yaml";

const FRONTMATTER = /^---\r?\n([\s\S]*?\r?\n)?---(\r?\n|$)/;

/** A SKILL.md split into its frontmatter text and body. Edits keep untouched fields byte-identical. */
export class SkillFile {
	private constructor(
		private readonly open: string,
		private yaml: string,
		private readonly close: string,
		readonly body: string,
		private document: Document,
	) {}

	static parse(text: string): SkillFile {
		const match = FRONTMATTER.exec(text);
		if (!match) {
			throw new Error("SKILL.md has no YAML frontmatter");
		}
		const yaml = match[1] ?? "";
		const open = match[0].slice(0, match[0].indexOf("\n") + 1);
		const close = match[0].slice(open.length + yaml.length);
		return new SkillFile(
			open,
			yaml,
			close,
			text.slice(match[0].length),
			parseFrontmatter(yaml),
		);
	}

	get(key: string): unknown {
		return this.document.get(key);
	}

	/** Sets a top-level field, or removes it when `value` is undefined, by splicing only its lines. */
	set(key: string, value: unknown): void {
		const map = this.document.contents;
		const pair = isMap(map)
			? map.items.find((item) => isScalar(item.key) && item.key.value === key)
			: undefined;
		const rendered =
			value === undefined ? "" : stringify({ [key]: value }, { lineWidth: 0 });
		if (!pair) {
			if (value === undefined) return;
			this.yaml += rendered;
		} else {
			const keyRange = isScalar(pair.key) ? pair.key.range : undefined;
			const valueRange = (
				pair.value as { range?: [number, number, number] } | null
			)?.range;
			if (!keyRange) throw new Error(`cannot edit frontmatter field ${key}`);
			const start = this.yaml.lastIndexOf("\n", keyRange[0] - 1) + 1;
			const valueEnd = valueRange?.[1] ?? keyRange[1];
			const newline = this.yaml.indexOf("\n", valueEnd - 1);
			const end = newline === -1 ? this.yaml.length : newline + 1;
			this.yaml = this.yaml.slice(0, start) + rendered + this.yaml.slice(end);
		}
		this.document = parseFrontmatter(this.yaml);
	}

	toString(): string {
		return `${this.open}${this.yaml}${this.close}${this.body}`;
	}
}

function parseFrontmatter(yaml: string): Document {
	const document = parseDocument(yaml);
	if (document.errors.length > 0) {
		throw new Error(
			`SKILL.md frontmatter is invalid YAML: ${document.errors[0]?.message}`,
		);
	}
	return document;
}

/** Best-effort frontmatter field read for listing; returns undefined when unparseable. */
export function readFrontmatterField(text: string, key: string): unknown {
	try {
		return SkillFile.parse(text).get(key);
	} catch {
		return undefined;
	}
}
