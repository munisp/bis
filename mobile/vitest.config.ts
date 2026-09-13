import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  define: {
    // React Native global — not defined in Node/jsdom test environment
    __DEV__: JSON.stringify(true),
  },
  resolve: {
    alias: {
      // Replace react-native (Flow-annotated) with a minimal stub so Vitest
      // can parse tests that import from RN-dependent modules.
      'react-native': path.resolve(__dirname, 'src/__mocks__/react-native.ts'),
      '@react-navigation/native': path.resolve(__dirname, 'src/__mocks__/@react-navigation/native.ts'),
      '@react-navigation/native-stack': path.resolve(__dirname, 'src/__mocks__/@react-navigation/native-stack.ts'),
      // Native modules are replaced by audited deterministic test doubles.
      'react-native-mmkv': path.resolve(__dirname, 'src/__mocks__/react-native-mmkv.ts'),
      'react-native-quick-crypto': path.resolve(__dirname, 'src/__mocks__/react-native-quick-crypto.ts'),
      'react-native-keychain': path.resolve(__dirname, 'src/__mocks__/react-native-keychain.ts'),
      '@react-native-community/netinfo': path.resolve(__dirname, 'src/__mocks__/react-native-netinfo.ts'),
      'react-native-fs': path.resolve(__dirname, 'src/__mocks__/react-native-fs.ts'),
      'react-native-document-picker': path.resolve(__dirname, 'src/__mocks__/react-native-document-picker.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'android', 'ios'],
  },
});
