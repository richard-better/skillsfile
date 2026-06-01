import { cpSync, mkdirSync, copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

export type PatchResult =
  | { ok: true; outputDir: string }
  | { ok: false; reason: string };

/**
 * Stage an upstream skill folder + patch.md into a tmpdir and invoke `claude`
 * in headless mode to apply the patch.
 *
 * Returns the path to the output directory on success.
 */
export async function applyPatch(args: {
  upstreamSkillDir: string;
  patchPath: string;
}): Promise<PatchResult> {
  const work = mkdtempSync(join(tmpdir(), "skills-patch-"));
  const upstream = join(work, "upstream");
  const output = join(work, "output");
  mkdirSync(upstream, { recursive: true });
  mkdirSync(output, { recursive: true });

  cpSync(args.upstreamSkillDir, upstream, { recursive: true });
  copyFileSync(args.patchPath, join(work, "patch.md"));

  const prompt = [
    "Apply the patch in ./patch.md to the file(s) in ./upstream/.",
    "Write the result(s) to ./output/ preserving the same relative layout.",
    "",
    "The patch describes changes in natural language — sections to remove,",
    "lines to rewrite, invariants to preserve. Use Read and Write tools.",
    "",
    "If the patch cannot be applied unambiguously (upstream changed in a way",
    "the patch no longer fits), do NOT write any output file. Print one line:",
    "FAILED: <one-sentence reason>",
    "",
    "Otherwise print one line: OK",
  ].join("\n");

  const result =
    await $`claude -p ${prompt} --allowed-tools Read,Write --model claude-haiku-4-5`
      .cwd(work)
      .text();

  const firstLine = result.trim().split("\n")[0] ?? "";
  if (firstLine.startsWith("FAILED:")) {
    return { ok: false, reason: firstLine.slice("FAILED:".length).trim() };
  }

  const outputSkill = join(output, "SKILL.md");
  if (!existsSync(outputSkill)) {
    return { ok: false, reason: "patch produced no output/SKILL.md" };
  }

  return { ok: true, outputDir: output };
}
