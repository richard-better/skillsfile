import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const SourceSchema = z.object({
  repo: z.string().min(1),
  ref: z.string().default("main"),
});

const SkillSchema = z.object({
  source: z.string().min(1),
  path: z.string().min(1),
  namespace: z.string().min(1).optional(),
  patch: z.string().min(1).optional(),
  pin: z.string().min(1).optional(),
});

const ManifestSchema = z.object({
  sources: z.record(z.string(), SourceSchema).default({}),
  skills: z.array(SkillSchema).default([]),
});

export type Source = z.infer<typeof SourceSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

export function loadManifest(path: string): Manifest {
  const raw = parseYaml(readFileSync(path, "utf8"));
  const manifest = ManifestSchema.parse(raw);

  for (const skill of manifest.skills) {
    if (!manifest.sources[skill.source]) {
      throw new Error(
        `Skill at path "${skill.path}" references unknown source "${skill.source}". ` +
          `Defined sources: ${Object.keys(manifest.sources).join(", ") || "(none)"}.`,
      );
    }
  }

  return manifest;
}
