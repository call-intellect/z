import type { RawEvent, Source } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { IngestService } from '../../ingest.service';

import { TrackerAdapter } from './tracker.adapter';

describe('TrackerAdapter', () => {
  let prisma: PrismaService;
  let ingest: IngestService;
  let metrics: BusinessMetricsService;
  let adapter: TrackerAdapter;

  let sourceFindUnique: ReturnType<typeof vi.fn>;
  let sourceCreate: ReturnType<typeof vi.fn>;
  let ingestFn: ReturnType<typeof vi.fn>;
  let incMetric: ReturnType<typeof vi.fn>;

  const fakeSource: Source = {
    id: 'src_tracker_1',
    tenantId: 'org_1',
    type: 'tracker_event',
    name: 'Трекер',
    dataClass: 'internal',
    isActive: true,
    description: null,
    config: null,
    createdAt: new Date('2026-05-24T10:00:00Z'),
    updatedAt: new Date('2026-05-24T10:00:00Z'),
  } as unknown as Source;

  const fakeRawEvent: RawEvent = {
    id: 're_1',
    tenantId: 'org_1',
    sourceId: 'src_tracker_1',
    sourceType: 'tracker_event',
    sourceExternalId: 'tracker:issue:i1:issue.created:2026-05-24T10:00:00.000Z:abc',
    idempotencyKey: 'idem_1',
    occurredAt: new Date('2026-05-24T10:00:00Z'),
    payloadStorage: 'inline',
    payload: {},
    payloadS3Key: null,
    payloadChecksum: 'chk',
    payloadSizeBytes: 100,
    dataClass: 'internal',
    processingStatus: 'received',
    processingError: null,
    processedAt: null,
    ingestedAt: new Date(),
  } as unknown as RawEvent;

  beforeEach(() => {
    sourceFindUnique = vi.fn().mockResolvedValue(fakeSource);
    sourceCreate = vi.fn().mockResolvedValue(fakeSource);
    ingestFn = vi.fn().mockResolvedValue({ rawEvent: fakeRawEvent, idempotent: false });
    incMetric = vi.fn();
    prisma = {
      source: {
        findUnique: sourceFindUnique,
        create: sourceCreate,
      },
    } as unknown as PrismaService;
    ingest = { ingest: ingestFn } as unknown as IngestService;
    metrics = {
      incTrackerEventToKnowledgeCore: incMetric,
    } as unknown as BusinessMetricsService;
    adapter = new TrackerAdapter(prisma, ingest, metrics);
  });

  function basePayload(
    type: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type,
      tenantId: 'org_1',
      occurredAt: '2026-05-24T10:00:00Z',
      issue: {
        id: 'i1',
        identifier: 'KORA-1',
        title: 'Test issue',
        projectId: 'p1',
        stateId: 's1',
        dueDate: null,
      },
      actor: { userId: 'u1', actorType: 'user' },
      meta: {},
      ...overrides,
    };
  }

  const SIGNAL_MAP: Array<[string, string]> = [
    ['issue.created', 'task_created'],
    ['issue.status_changed', 'task_status_changed'],
    ['issue.status_changed_to_blocked', 'task_blocked'],
    ['issue.status_changed_to_done', 'task_completed'],
    ['issue.overdue_detected', 'task_overdue'],
    ['issue.assignee_changed', 'task_reassigned'],
    ['comment.created', 'task_comment'],
    ['mention.created', 'task_mention'],
  ];

  for (const [eventType, expectedSignal] of SIGNAL_MAP) {
    it(`мапит ${eventType} → signalType=${expectedSignal}`, async () => {
      await adapter.handleTrackerEvent(basePayload(eventType) as never);
      expect(ingestFn).toHaveBeenCalledTimes(1);
      const call = ingestFn.mock.calls[0]![0];
      expect((call.payload as { signalTypeHint: string }).signalTypeHint).toBe(expectedSignal);
    });
  }

  it('sourceExternalId одинаков при одинаковых payload', async () => {
    const payload = basePayload('issue.created');
    await adapter.handleTrackerEvent(payload as never);
    await adapter.handleTrackerEvent(payload as never);
    expect(ingestFn).toHaveBeenCalledTimes(2);
    const k1 = ingestFn.mock.calls[0]![0].sourceExternalId;
    const k2 = ingestFn.mock.calls[1]![0].sourceExternalId;
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^tracker:issue:i1:issue\.created:/);
  });

  it('sourceExternalId различается для разных type на одной задаче', async () => {
    await adapter.handleTrackerEvent(basePayload('issue.created') as never);
    await adapter.handleTrackerEvent(basePayload('issue.status_changed') as never);
    const k1 = ingestFn.mock.calls[0]![0].sourceExternalId;
    const k2 = ingestFn.mock.calls[1]![0].sourceExternalId;
    expect(k1).not.toBe(k2);
  });

  it('payload.fullText заполнен для issue.created (title + description)', async () => {
    await adapter.handleTrackerEvent(
      basePayload('issue.created', {
        issue: {
          id: 'i1',
          identifier: 'KORA-1',
          title: 'Заголовок',
          description: 'Подробное описание',
          projectId: 'p1',
          stateId: 's1',
          dueDate: null,
        },
      }) as never,
    );
    const p = ingestFn.mock.calls[0]![0].payload as { fullText?: string };
    expect(p.fullText).toContain('Заголовок');
    expect(p.fullText).toContain('Подробное описание');
  });

  it('payload.fullText заполнен для comment.created (title + comment text)', async () => {
    await adapter.handleTrackerEvent(
      basePayload('comment.created', {
        meta: {
          commentId: 'c1',
          commentContent: 'Полный rich-text',
          commentStripped: 'Полный stripped',
        },
      }) as never,
    );
    const p = ingestFn.mock.calls[0]![0].payload as { fullText?: string };
    expect(p.fullText).toContain('Test issue');
    expect(p.fullText).toContain('Полный stripped');
  });

  it('payload.fullText ОТСУТСТВУЕТ для issue.status_changed без текста', async () => {
    await adapter.handleTrackerEvent(
      basePayload('issue.status_changed', {
        meta: { oldStateId: 's1', newStateId: 's2' },
      }) as never,
    );
    const p = ingestFn.mock.calls[0]![0].payload as { fullText?: string };
    expect(p.fullText).toBeUndefined();
  });

  it('метрика incTrackerEventToKnowledgeCore вызывается с tenant + type', async () => {
    await adapter.handleTrackerEvent(basePayload('issue.created') as never);
    expect(incMetric).toHaveBeenCalledWith({
      tenant: 'org_1',
      type: 'issue.created',
    });
  });

  it('lazy-создаёт Source(type=tracker_event), если его нет', async () => {
    sourceFindUnique.mockResolvedValueOnce(null);
    await adapter.handleTrackerEvent(basePayload('issue.created') as never);
    expect(sourceCreate).toHaveBeenCalledTimes(1);
    expect(sourceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'org_1',
        type: 'tracker_event',
        name: 'Трекер',
        dataClass: 'internal',
        isActive: true,
      }),
    });
  });

  it('переиспользует существующий Source без вызова create', async () => {
    sourceFindUnique.mockResolvedValue(fakeSource);
    await adapter.handleTrackerEvent(basePayload('issue.created') as never);
    expect(sourceCreate).not.toHaveBeenCalled();
  });

  it('ошибка ingest НЕ пробрасывается наружу (best-effort)', async () => {
    ingestFn.mockRejectedValueOnce(new Error('ingest down'));
    await expect(
      adapter.handleTrackerEvent(basePayload('issue.created') as never),
    ).resolves.not.toThrow();
  });

  it('payload без tenantId — skip (warn), нет вызова ingest', async () => {
    await adapter.handleTrackerEvent({
      type: 'issue.created',
      issue: { id: 'i1', identifier: 'KORA-1', title: 't', projectId: 'p1' },
      actor: { userId: 'u1', actorType: 'user' },
      occurredAt: '2026-05-24T10:00:00Z',
    } as never);
    expect(ingestFn).not.toHaveBeenCalled();
  });

  it('payload с неизвестным type — skip, нет вызова ingest', async () => {
    await adapter.handleTrackerEvent(basePayload('unknown.event') as never);
    expect(ingestFn).not.toHaveBeenCalled();
  });
});
