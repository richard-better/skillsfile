#!/usr/bin/env node
// A Claude Code release from before --restricted existed.
const [command] = process.argv.slice(2);
if (command === "--version") console.log("2.1.15 (Claude Code)");
else if (command === "--help")
	console.log("  -p, --print   Print response and exit");
else {
	console.error("error: unknown option '--restricted'");
	process.exit(1);
}
