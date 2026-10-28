#!/usr/bin/env node
// Stands in for `claude -p` in tests. Applies `replace "A" with "B"` and `link "name" to "path"`
// instructions in the working directory, answers FAILED for an instruction saying `fail`,
// and logs each call to $FAKE_CLAUDE_LOG.
import {
	appendFileSync,
	readdirSync,
	readFileSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") {
	console.log("9.9.9 (Claude Code)");
	process.exit(0);
}
if (args[0] === "--help") {
	console.log("  --restricted   Restricted mode");
	process.exit(0);
}
const prompt = args[args.indexOf("-p") + 1] ?? "";
if (process.env.FAKE_CLAUDE_LOG) {
	appendFileSync(
		process.env.FAKE_CLAUDE_LOG,
		`${JSON.stringify({ cwd: process.cwd(), args })}\n`,
	);
}
const instructions = prompt
	.slice(prompt.indexOf("Instructions:"))
	.split("\n")
	.map((line) => /^\d+\. (.*)$/.exec(line)?.[1])
	.filter(Boolean);

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

for (const instruction of instructions) {
	if (instruction === "fail") {
		console.log("I cannot do that.\nFAILED: asked to fail");
		process.exit(0);
	}
	const link = /^link "(.*)" to "(.*)"$/.exec(instruction);
	if (link) symlinkSync(link[2], join(process.cwd(), link[1]));
	const replace = /^replace "(.*)" with "(.*)"$/.exec(instruction);
	if (!replace) continue;
	for (const file of files(process.cwd())) {
		const text = readFileSync(file, "utf8");
		if (text.includes(replace[1]))
			writeFileSync(file, text.replaceAll(replace[1], replace[2]));
	}
}
console.log("Edited the files.\nDONE");
