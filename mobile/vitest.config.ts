import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Replace react-native (Flow-annotated) with a minimal stub so Vitest
      // can parse tests that import from RN-dependent modules.
      'react-native': path.resolve(__dirname, 'src/__mocks__/react-native.ts'),
      '@react-navigation/native': path.resolve(__dirname, 'src/__mocks__/@react-navigation/native.ts'),
      '@react-navigation/native-stack': path.resolve(__dirname, 'src/__mocks__/@react-navigation/native-stack.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'android', 'ios'],
  },
});
