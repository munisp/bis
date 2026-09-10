module.exports = {
  root: true,
  extends: ["expo"],
  ignorePatterns: ["node_modules/", ".expo/", "android/", "ios/"],
  rules: {
    "no-console": "error",
    "@typescript-eslint/no-explicit-any": "warn",
  },
};
