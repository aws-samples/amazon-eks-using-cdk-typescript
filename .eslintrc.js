module.exports = {
  env: {
    browser: true,
  },
  extends: ["standard", "plugin:import/typescript", "prettier"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "2018",
    sourceType: "module",
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint", "import", "prettier"],
  settings: {
    "import/parsers": {
      "@typescript-eslint/parser": [".ts", ".tsx"],
    },
    "import/resolver": {
      node: {},
      typescript: {
        directory: "./tsconfig.json",
      },
    },
  },
  ignorePatterns: ["*cdk.out/*", "node_modules/", "*.js"],
  rules: {
    "@typescript-eslint/no-require-imports": ["error"],
    "@typescript-eslint/indent": ["error", 2],
    "comma-dangle": ["error", "always-multiline"],
    "comma-spacing": ["error", { before: false, after: true }],
    "array-bracket-newline": ["error", "consistent"],
    curly: ["error", "multi-line", "consistent"],
    "import/no-extraneous-dependencies": ["error"],
    "import/no-unresolved": ["error"],
    "import/order": [
      "error",
      {
        groups: ["builtin", "external"],
        alphabetize: { order: "asc", caseInsensitive: true },
      },
    ],
    "no-duplicate-imports": ["error"],
    "@typescript-eslint/no-shadow": ["error"],
    semi: ["error", "always"],
    "quote-props": ["error", "consistent-as-needed"],
    "max-len": [
      "error",
      {
        code: 150,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreComments: true,
        ignoreRegExpLiterals: true,
      },
    ],
    "@typescript-eslint/no-floating-promises": ["error"],
    "no-return-await": "off",
    "@typescript-eslint/return-await": "error",
    "no-console": ["error"],
    "no-bitwise": ["error"],
  },
};
