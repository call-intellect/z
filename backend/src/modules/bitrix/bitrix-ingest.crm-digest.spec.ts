import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';
import type { IngestService } from '../ingest/ingest.service';

import { BitrixIngestService } from './bitrix-ingest.service';
import { CRM_BACKFILL_DAYS } from './bitrix-sync.service';

function makeService(opts: { lastCrmDigestAt: Date | null; hasContactChanges?: boolean }): {
  service: BitrixIngestService;
  ingest: { ingest: ReturnType<typeof vi.fn> };
  updateMany: ReturnType<typeof vi.fn>;
} {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const emptyList = vi.fn().mockResolvedValue([]);
  const contactList = vi
    .fn()
    .mockResolvedValue(opts.hasContactChanges ? [{ name: 'Иван', email: 'i@x.ru' }] : []);
  const prisma = {
    bitrixIntegration: {
      findFirst: vi.fn().mockResolvedValue({ lastCrmDigestAt: opts.lastCrmDigestAt }),
      updateMany,
    },
    bitrixContact: { findMany: contactList },
    bitrixCompany: { findMany: emptyList },
    bitrixDeal: { findMany: emptyList },
    bitrixLead: { findMany: emptyList },
    source: {
      findUnique: vi.fn().mockResolvedValue({ id: 'src-bitrix' }),
      create: vi.fn(),
    },
  };
  const ingest = {
    ingest: vi.fn().mockResolvedValue({ rawEvent: { id: 're1' } }),
  };
  const service = new BitrixIngestService(
    prisma as unknown as PrismaService,
    ingest as unknown as IngestService,
    {} as unknown as LlmRouterService,
  );
  return { service, ingest, updateMany };
}

const farPast = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

describe('BitrixIngestService.ingestCrmDigests', () => {
  it('нет изменений → RawEvent не создаётся, курсор всё равно двигается на кап дней', async () => {
    const { service, ingest, updateMany } = makeService({
      lastCrmDigestAt: farPast,
      hasContactChanges: false,
    });
    const res = await service.ingestCrmDigests('t1');
    expect(res.daysDigested).toBe(CRM_BACKFILL_DAYS);
    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('есть изменения → RawEvent на каждый закрытый день (crm-digest-<день>)', async () => {
    const { service, ingest } = makeService({
      lastCrmDigestAt: farPast,
      hasContactChanges: true,
    });
    const res = await service.ingestCrmDigests('t1');
    expect(res.daysDigested).toBe(CRM_BACKFILL_DAYS);
    expect(ingest.ingest).toHaveBeenCalledTimes(CRM_BACKFILL_DAYS);
    const firstArg = ingest.ingest.mock.calls[0]![0] as {
      sourceExternalId: string;
      dataClass: string;
      payload: { kind: string };
    };
    expect(firstArg.sourceExternalId).toMatch(/^crm-digest-\d{4}-\d{2}-\d{2}$/);
    expect(firstArg.dataClass).toBe('sensitive');
    expect(firstArg.payload.kind).toBe('bitrix_crm_digest');
  });

  it('курсор уже сегодня → no-op (нет закрытых дней)', async () => {
    const { service, ingest, updateMany } = makeService({
      lastCrmDigestAt: new Date(),
    });
    const res = await service.ingestCrmDigests('t1');
    expect(res.daysDigested).toBe(0);
    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('интеграции нет → no-op', async () => {
    const { service } = makeService({ lastCrmDigestAt: null });
    (
      service as unknown as {
        prisma: { bitrixIntegration: { findFirst: ReturnType<typeof vi.fn> } };
      }
    ).prisma.bitrixIntegration.findFirst.mockResolvedValueOnce(null);
    const res = await service.ingestCrmDigests('t1');
    expect(res.daysDigested).toBe(0);
  });
});
