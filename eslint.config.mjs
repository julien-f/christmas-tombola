import neostandard from "neostandard";

export default [
  { ignores: [".claude/"] },
  ...neostandard({ noStyle: true }),
  // neostandard targets an older version, without import attributes.
  { languageOptions: { ecmaVersion: "latest" } },
];
