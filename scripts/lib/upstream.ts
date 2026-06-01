import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import type { Source } from "./manifest.ts";

const cache = new Map<string, string>();

function cacheKey(source: Source, pinOverride?: string): string {
  return `${source.repo}@${pinOverride ?? source.ref}`;
}

/**
 * Shallow-clone an upstream repo into a tmpdir; returns the local path.
 * Cached per (repo, ref) for the lifetime of the process.
 */
export async function fetchUpstream(
  source: Source,
  pinOverride?: string,
): Promise<string> {
  const key = cacheKey(source, pinOverride);
  const cached = cache.get(key);
  if (cached && existsSync(cached)) return cached;

  const dir = mkdtempSync(join(tmpdir(), "skills-upstream-"));
  const url = source.repo.startsWith("http")
    ? source.repo
    : `https://${source.repo}.git`;

  if (pinOverride) {
    await $`git clone --depth 1 ${url} ${dir}`.quiet();
    await $`git -C ${dir} fetch --depth 1 origin ${pinOverride}`.quiet();
    await $`git -C ${dir} checkout ${pinOverride}`.quiet();
  } else {
    await $`git clone --depth 1 --branch ${source.ref} ${url} ${dir}`.quiet();
  }

  cache.set(key, dir);
  return dir;
}
