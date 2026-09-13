import { describe, expect, it, vi } from 'vitest';
import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';

vi.mock('./db');
vi.mock('./permify', () => ({ permifyCheck: vi.fn().mockResolvedValue(true), permifyWriteRelationship: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./cache', () => ({ withCache: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()), invalidateCache: vi.fn(), TTL: {} }));
vi.mock('./dapr', () => ({ publishInvestigationEvent: vi.fn(), publishKycEvent: vi.fn(), publishCaseEvent: vi.fn(), publishBillingEvent: vi.fn(), publishStablecoinEvent: vi.fn(), publishCriminalRecordEvent: vi.fn(), publishDaprScreeningEvent: vi.fn(), publishFieldVisitEvent: vi.fn(), publishMojaloopEvent: vi.fn(), publishCorporateCheckEvent: vi.fn() }));

function anonymousContext(): TrpcContext {
  return { user: null, tenantId: null, isDemo: false, req: { protocol: 'https', headers: {} } as TrpcContext['req'], res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'] };
}

describe('field evidence negative authorization', () => {
  it('rejects an anonymous upload-initiation request before it can allocate object storage', async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(caller.fieldEvidence.initiate({ investigationId: 1, contentType: 'image/jpeg', contentLength: 1024, sha256: 'a'.repeat(64), description: 'Synthetic authorization test evidence', idempotencyKey: '2af2ba93-7e4e-47d9-8ab1-8b91b4e891d1' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects an anonymous upload-completion request before it can read object metadata', async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(caller.fieldEvidence.complete({ uploadId: '2af2ba93-7e4e-47d9-8ab1-8b91b4e891d1' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
