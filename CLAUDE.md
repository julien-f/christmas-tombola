# CLAUDE.md

Usage: [README](README.md).

## Development

- `npm run check` (format, lint, tests) passes before committing; `npm run format` fixes formatting.
- Single test: `npm test -- --test-name-pattern='<name>'`.
- `_sendSms.test.mjs` needs `openssl` on the PATH.
- ESLint and Prettier ignores come from `.gitignore` only.

## Pitfalls

- The whole suite runs despite `--test-name-pattern` (`ℹ tests 24` instead of 6): Node ignores options placed after a file (`node --test utils.test.mjs --test-name-pattern=…`). Put the option before the file.
