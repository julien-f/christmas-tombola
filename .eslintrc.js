module.exports = {
  extends: [
    // standard configuration
    "standard",

    // https://github.com/mysticatea/eslint-plugin-n#-rules
    "plugin:n/recommended",

    // disable rules handled by prettier
    "prettier",
  ],

  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module", // or "script" if not using ES modules
  },

  reportUnusedDisableDirectives: true,

  rules: {
    // uncomment if you are using a builder like Babel
    // "n/no-unsupported-features/es-syntax": "off",
  },
};
