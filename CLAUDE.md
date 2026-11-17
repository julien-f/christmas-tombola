# CLAUDE.md

Usage: [README](README.md).

## Development

- `node --run check` (format, lint, tests) passes before committing, and the pre-push hook enforces it; `node --run format` fixes formatting.
- [`scripts/check.sh`](scripts/check.sh) skips a check whose inputs already passed it, in any worktree (stamps in `.git/check-stamps/`); delete them to force a full run.
- Single test: `node --run test -- --test-name-pattern='<name>'`.
- ESLint and Prettier ignores come from `.gitignore` only.

## Pitfalls

- The whole suite runs despite `--test-name-pattern` (`ℹ tests 24` instead of 6): Node ignores options placed after a file (`node --test utils.test.mjs --test-name-pattern=…`). Put the option before the file.
- ESLint and Prettier caches (`node_modules/.cache/`) miss in every new worktree: both key entries on absolute paths, and Prettier also hashes the path into each entry. Don't try to share them; the stamps of `scripts/check.sh` are what is shared across worktrees.
