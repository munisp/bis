import { describe, expect, it, vi } from 'vitest';
import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';

vi.mock('./db');
vi.mock('./permify', () => ({
  permifyCheck: vi.fn().mockResolvedValue(true),
  permifyWriteRelationship: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./cache', () => ({
  withCache: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
  invalidateCache: vi.fn(),
  TTL: {},
}));
vi.mock('./dapr', () => ({
  publishInvestigationEvent: vi.fn(),
  publishKycEvent: vi.fn(),
  publishCaseEvent: vi.fn(),
  publishBillingEvent: vi.fn(),
  publishStablecoinEvent: vi.fn(),
  publishCriminalRecordEvent: vi.fn(),
  publishDaprScreeningEvent: vi.fn(),
  publishFieldVisitEvent: vi.fn(),
  publishMojaloopEvent: vi.fn(),
  publishCorporateCheckEvent: vi.fn(),
}));

function anonymousContext(): TrpcContext {
  return {
    user: null,
    tenantId: null,
    isDemo: false,
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

describe('KYC document evidence negative authorization', () => {
  it('rejects anonymous upload initiation before database, encryption, or object-storage allocation', async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.kycDocumentEvidence.initiate({
        kycRecordId: 1,
        documentType: 'nin_slip',
        contentType: 'image/jpeg',
        contentLength: 1024,
        sha256: 'b'.repeat(64),
        description: 'Synthetic authorization test KYC document',
        idempotencyKey: '2a887cc4-21e8-4b42-a5e9-79e684fae3ba',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects anonymous upload completion before object metadata can be read', async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.kycDocumentEvidence.complete({ uploadId: '2a887cc4-21e8-4b42-a5e9-79e684fae3ba' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
