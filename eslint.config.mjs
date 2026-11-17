import neostandard, { resolveIgnoresFromGitignore } from "neostandard";

export default [
  ...neostandard({ noStyle: true, ignores: resolveIgnoresFromGitignore() }),
  // neostandard targets an older version, without import attributes.
  { languageOptions: { ecmaVersion: "latest" } },
];
