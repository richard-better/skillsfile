# skillsfile

Declarative agent skills. List the skills you want in one `skills.yaml`, from any GitHub
repo, git URL or local folder, and `skillsfile` installs them, pinned to exact commits.
Every skill can be renamed, re-described, switched between automatic and explicit-only
invocation, given a Codex `agents/openai.yaml`, and patched with your own edits that
survive upstream updates.

```sh
npx skillsfile add mattpocock/skills --skill grill-me
```

Skills land in `.agents/skills/` (or `~/.agents/skills/` with `-g`). That folder works with Codex,
the `skills` CLI ecosystem and any agent that reads the
[Agent Skills](https://agentskills.io) layout. For Claude Code, point `target` at
`.claude/skills` or symlink it.

## skills.yaml

The file is meant to be edited by hand or by an agent. `add`, `remove` and `diff` keep
your comments and formatting intact.

```yaml
# target: .agents/skills   # default; relative to this file

skills:
  # Shorthand: install the skill with this name from a source.
  grill-me: mattpocock/skills

  # Every option:
  aihero-code-review:            # installed name; becomes the frontmatter `name`
    source: mattpocock/skills    # owner/repo, git URL, or ./local/path
    ref: main                    # branch, tag or commit (default: the default branch)
    skill: code-review           # upstream skill name, when it differs from the key
    # path: skills/engineering/code-review   # or the exact folder instead of `skill`
    description: Two-axis review of a diff against repo standards and the originating spec.
    invocation: explicit         # explicit | auto (unset keeps upstream)
    openai:                      # agents/openai.yaml interface overrides, or `false`
      display_name: AI Hero Code Review
    patch: patches/aihero-code-review.patch
```

| Field | Effect |
| --- | --- |
| key | Install name. Renames the folder and the frontmatter `name`, and rewrites `$old-name` in `openai.yaml`'s `default_prompt`. |
| `source` | `owner/repo` (GitHub), any git URL, or a local path starting with `./`, `../`, `/` or `~/`. |
| `ref` | Branch, tag or commit to track. |
| `skill` / `path` | Which skill in the source. Defaults to the skill whose name matches the key. |
| `description` | Replaces the frontmatter `description`. |
| `invocation` | `explicit` sets `disable-model-invocation: true` for Claude Code and `policy.allow_implicit_invocation: false` for Codex, so the skill only runs when invoked by name. `auto` clears both. |
| `openai` | A missing `agents/openai.yaml` is generated from the name and description. Fields here override it. `false` skips generation. |
| `patch` | A unified diff applied last. Create it with `skillsfile diff`. |

### Sharing settings

Standard YAML anchors and `<<:` merge keys work. Top-level keys starting with `x-` are ignored,
so they can hold shared definitions:

```yaml
x-emil: &emil
  source: emilkowalski/skills
  invocation: explicit

skills:
  emil-animate:
    <<: *emil
    path: skills/animate
  emil-prototype:
    <<: *emil
    path: skills/prototype
```

## Commands

```sh
skillsfile                     # install everything at the locked commits
skillsfile update [name...]    # move to the latest upstream commits
skillsfile add <source> [--skill <name>...] [--all] [--name <name>] [--ref <ref>]
skillsfile remove <name...>
skillsfile diff <name>         # save your edits to an installed skill as a patch
skillsfile list
```

`-g` uses `~/.agents/skills.yaml` and installs into `~/.agents/skills`. `-c <file>` points at
any other `skills.yaml`.

## How it works

Each skill is built in a scratch folder: upstream files, then the overrides from
`skills.yaml`, then the patch. The result replaces the installed folder.

`skills.lock` sits next to `skills.yaml` and records each skill's commit and a hash of
what was installed. Commit it. `install` reproduces the same files anywhere, and
skips skills whose entry, patch and installed files have not changed.

Folders in the target that `skillsfile` did not create are never touched. Skills you
edited after installing are never overwritten or deleted: install stops and asks you to
run `skillsfile diff <name>`, which turns the edits into a patch, or to pass `--force`.

### Patches

Edit the installed skill directly, then run `skillsfile diff <name>`. It writes
`patches/<name>.patch` and adds `patch:` to the entry. On `update`, the patch is applied
to the new upstream version. If upstream changed the same lines, the update for that
skill fails with a message and every other skill still updates.

## Development

```sh
pnpm install
pnpm test        # builds, then runs unit and end-to-end tests against local git repos
pnpm typecheck
pnpm lint
```
