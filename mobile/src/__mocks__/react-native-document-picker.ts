export const types = {
  images: 'images',
  pdf: 'application/pdf',
};

export async function pick(): Promise<never> {
  throw new Error('Document selection is not available in unit tests');
}

export function isCancel(_error: unknown): boolean {
  return false;
}
