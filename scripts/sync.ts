#!/usr/bin/env bun
/**
 * Daily sync: fetch upstream skills, apply patches, materialize into dist/.
 *
 * Run via `bun run sync` locally or by .github/workflows/sync.yml in CI.
 *
 * Steps per skill:
 *   1. Resolve upstream (cached per repo+ref).
 *   2. Hash the upstream skill folder; compare with stored .upstream.sha.
 *      Skip the LLM call if unchanged AND patch is unchanged.
 *   3. If `patch:` is set, run patch.applyPatch().
 *   4. Materialize into dist/<namespace>/skills/<skill>/ (or dist/_unscoped/).
 *   5. Write .upstream.sha sidecar.
 *
 * After all entries:
 *   - Regenerate plugin.json for every namespace in use.
 *   - Remove any dist/* entries no longer in the manifest.
 *   - Upsert a "Sync failures — YYYY-MM" issue if anything failed.
 *
 * TODO: implement. This is a scaffold so `bun install && bun run sync` exits
 * cleanly and signals "not yet wired up".
 */

import { loadManifest } from "./lib/manifest.ts";

const manifest = loadManifest("manifest.yaml");

console.log(
  `[sync] manifest OK — ${Object.keys(manifest.sources).length} sources, ${manifest.skills.length} skills.`,
);
console.log("[sync] not implemented yet — see TODO at top of scripts/sync.ts");
