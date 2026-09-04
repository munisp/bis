const files = new Map<string, string>();

const RNFS = {
  DocumentDirectoryPath: '/secure-documents',
  CachesDirectoryPath: '/secure-cache',
  exists: async (path: string) => files.has(path),
  mkdir: async (_path: string) => undefined,
  readFile: async (path: string) => {
    const value = files.get(path);
    if (value === undefined) {
      throw new Error(`Mock file not found: ${path}`);
    }
    return value;
  },
  writeFile: async (path: string, value: string) => {
    files.set(path, value);
  },
  unlink: async (path: string) => {
    files.delete(path);
  },
  readDir: async (_path: string) => [],
  stat: async (_path: string) => ({ size: 1024 }),
  uploadFiles: async (_options: unknown) => ({ promise: Promise.resolve({ statusCode: 200 }) }),
};

export function __resetFileSystemMock(): void {
  files.clear();
}

export default RNFS;
