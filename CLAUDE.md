# CLAUDE.md

Usage: [README](README.md).

## Development

- `node --run check` (format, lint, tests) passes before committing, and the pre-push hook enforces it; `node --run format` fixes formatting.
- [`scripts/check.sh`](scripts/check.sh) skips a check whose inputs already passed it, in any worktree (stamps in `.git/check-stamps/`); delete them to force a full run.
- Single test: `node --run test -- --test-name-pattern='<name>'`.
- `_sendSms.test.mjs` needs `openssl` on the PATH.
- ESLint and Prettier ignores come from `.gitignore` only.

## Pitfalls

- The whole suite runs despite `--test-name-pattern` (`ℹ tests 24` instead of 6): Node ignores options placed after a file (`node --test utils.test.mjs --test-name-pattern=…`). Put the option before the file.
