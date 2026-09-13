type WebCryptoSource = {
  getRandomValues<T extends Uint8Array>(values: T): T;
};

function webCrypto(): WebCryptoSource {
  const source = (globalThis as unknown as { crypto?: WebCryptoSource }).crypto;
  if (!source?.getRandomValues) {
    throw new Error('Vitest requires a Web Crypto random source for secure queue tests');
  }
  return source;
}

export function randomBytes(length: number): Uint8Array {
  return webCrypto().getRandomValues(new Uint8Array(length));
}

export function createCipheriv(): never {
  throw new Error('Cipher tests must use the native runtime; this Vitest mock only supports queue identifier generation');
}

export function createDecipheriv(): never {
  throw new Error('Cipher tests must use the native runtime; this Vitest mock only supports queue identifier generation');
}

export function createHash(): never {
  throw new Error('Hash tests must use the native runtime; this Vitest mock only supports queue identifier generation');
}
