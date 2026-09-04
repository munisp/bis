module.exports = {
  root: true,
  extends: ['@react-native'],
  env: { 'react-native/react-native': true },
  ignorePatterns: ['node_modules/', 'android/', 'ios/', 'coverage/'],
  rules: {
    'no-console': 'error',
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
