# Dev setup simplification

Branch `dev-setup`, from `v3`, closed with `git merge --no-ff`. This file is deleted before the merge.

## Commits

1. `chore(lint): take ignores from .gitignore`
   - `eslint.config.mjs`: `neostandard({ noStyle: true, ignores: resolveIgnoresFromGitignore() })`, drop `{ ignores: [".claude/"] }`; keep the `ecmaVersion: "latest"` override (still needed for import attributes).
   - Delete `.prettierignore`: Prettier 3 already reads `.gitignore`.
   - Intended side effect: only `/.claude/worktrees/` stays ignored, so tracked `.claude/` files (e.g. `settings.json`) get formatted and linted.
2. `chore(hooks): format every staged file, call lint-staged directly`
   - lint-staged, disjoint globs (tasks of different globs run concurrently):
     `"!(*.js|*.cjs|*.mjs)": "prettier --write --ignore-unknown"`, `"*.{,c,m}js": ["prettier --write", "eslint --no-warn-ignored"]`.
   - `.husky/pre-commit`: `lint-staged` (husky 9 puts `node_modules/.bin` on the PATH; ~0.3 s → ~0.05 s).
3. `chore: add format and check scripts`
   - `"format": "prettier --write ."`, `"check": "prettier --check . && npm run lint && npm test"`.
4. `chore(package): drop empty fields, fill repository`
   - Remove `description`, `keywords`, `homepage`, `bugs`, `preferGlobal`; `"repository": "github:julien-f/christmas-tombola"`.
5. `docs: add CLAUDE.md`
   - `npm run check` before committing; single test command; `openssl` needed by `_sendSms.test.mjs`; ignores come from `.gitignore` only.
   - Pitfalls: `--test-name-pattern` after the file is silently ignored (whole suite runs); bare `node --test` also runs tests under `.claude/worktrees/`.
   - README unchanged.

## Verification

- `npm run check` passes; a bad file under `.claude/worktrees/` is ignored by ESLint and Prettier.
- Committing a badly formatted `.md` reformats it; a badly formatted `.mjs` with a lint error is reformatted then blocked.
