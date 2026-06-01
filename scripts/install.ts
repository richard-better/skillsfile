#!/usr/bin/env bun
/**
 * Symlink dist/* into ~/.claude/ so Claude Code picks the skills up.
 *
 *   dist/<namespace>/        →  ~/.claude/plugins/<namespace>/
 *   dist/_unscoped/<skill>/  →  ~/.claude/skills/<skill>/
 *
 * Ownership tracked in:
 *   ~/.claude/plugins/.skills-collection-managed
 *   ~/.claude/skills/.skills-collection-managed
 *
 * Only symlinks listed in those files get removed when dropped from manifest.
 * Hand-rolled skills/plugins next to them are never touched.
 *
 * TODO: implement.
 */

console.log("[install] not implemented yet — see TODO at top of scripts/install.ts");
