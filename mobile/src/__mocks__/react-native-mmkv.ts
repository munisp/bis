/**
 * Minimal react-native-mmkv stub for Vitest.
 * The real MMKV is a native module that cannot run in Node.js.
 */
export class MMKV {
  private store: Map<string, string> = new Map();

  getString(key: string): string | undefined {
    return this.store.get(key);
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}
