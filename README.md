# skills-collection

Personal Claude Code skill collection. Pulls skills from multiple upstream repos
(gstack, Matt Pocock, Jeff Allan, etc.), applies optional natural-language
`patch.md` files via Claude Code itself, and materializes the result as
per-source mini-plugins under `dist/`.

A daily GitHub Action keeps everything fresh.

Design doc: `docs/plans/2026-05-29-skill-marketplace-design.md` in the `ass`
repo.

## Layout

```
manifest.yaml        # sources + skills to include
patches/             # natural-language patch.md files
dist/                # generated, committed
  <namespace>/       # one folder per `namespace:` value → installed as plugin
    .claude-plugin/plugin.json
    skills/<skill>/SKILL.md
  _unscoped/         # entries without a namespace → installed as bare skills
    <skill>/SKILL.md
scripts/             # bun scripts: sync, install, libs
.github/workflows/   # daily sync workflow
```

## Local use

```bash
bun install
bun run sync           # fetch + patch + materialize into dist/
bun run install:skills # symlink dist/* into ~/.claude/
```

Day-to-day:

```bash
git pull               # picks up overnight CI sync
bun run install:skills # only needed when entries are added/removed
```

## Adding a skill

1. Add a `sources:` entry (if the upstream repo is new).
2. Add a `skills:` entry referencing that source by key, with a `path:` inside
   the upstream repo. Optionally set `namespace:` and `patch:`.
3. `bun run sync` to materialize. Commit, push.

## Status

Scaffolded. `sync.ts` and `install.ts` are stubs. See TODOs in each.
