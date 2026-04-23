/**
 * BIS Node.js SDK
 * Official TypeScript/JavaScript client for the Background Intelligence System API.
 *
 * @example
 * ```typescript
 * import { BISClient } from 'bis-sdk';
 * const client = new BISClient({ apiKey: 'bis_live_your_key' });
 * const investigations = await client.investigations.list({ status: 'open' });
 * ```
 */

export * from './client';
export * from './types';
export * from './errors';
