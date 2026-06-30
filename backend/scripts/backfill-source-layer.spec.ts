import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import {
  backfillSourceLayer,
  resolveKind,
  resolveMeetingId,
  resolveTitle,
} from './backfill-source-layer';

interface RawEventRow {
  id: string;
  tenantId: string;
  sourceType: string;
  sourceExternalId: string | null;
  sourceTitle: string | null;
  occurredAt: Date;
  payloadStorage: 'inline' | 's3';
  payload: unknown;
}

function buildPrisma(opts: {
  pending: number;
  events?: RawEventRow[];
  participants?: Array<{ personId: string | null; role: 'host' | 'guest' }>;
  evidence?: Array<{ blockId: string }>;
  grouped?: Array<{ entityId: string; _count: { entityId: number } }>;
}) {
  let served = false;
  const count = vi.fn(async () => opts.pending);
  const findMany = vi.fn(async () => {
    if (served) return [];
    served = true;
    return opts.events ?? [];
  });
  const episodeUpsert = vi.fn(async () => ({ id: 'ep' }));
  const participantFindMany = vi.fn(async () => opts.participants ?? []);
  const sourceParticipantUpsert = vi.fn(async () => ({}));
  const evidenceFindMany = vi.fn(async () => opts.evidence ?? []);
  const groupBy = vi.fn(async () => opts.grouped ?? []);
  const sourceEntityUpsert = vi.fn(async () => ({}));

  const prisma = {
    rawEvent: { count, findMany },
    sourceEpisode: { upsert: episodeUpsert },
    participant: { findMany: participantFindMany },
    sourceParticipant: { upsert: sourceParticipantUpsert },
    ideaBlockEvidence: { findMany: evidenceFindMany },
    ideaBlockEntity: { groupBy },
    sourceEntity: { upsert: sourceEntityUpsert },
  };
  return {
    prisma,
    mocks: {
      count,
      findMany,
      episodeUpsert,
      participantFindMany,
      sourceParticipantUpsert,
      evidenceFindMany,
      groupBy,
      sourceEntityUpsert,
    },
  };
}

const meetingEvent: RawEventRow = {
  id: 'raw-1',
  tenantId: 'tenant-1',
  sourceType: 'meeting',
  sourceExternalId: 'meeting-7',
  sourceTitle: 'Планёрка',
  occurredAt: new Date('2026-04-01T10:00:00.000Z'),
  payloadStorage: 'inline',
  payload: {},
};

describe('backfill-source-layer — чистые хелперы', () => {
  it('resolveKind мапит sourceType → kind', () => {
    expect(resolveKind('meeting' as never)).toBe('meeting');
    expect(resolveKind('meeting_report' as never)).toBe('meeting');
    expect(resolveKind('external' as never)).toBe('document');
    expect(resolveKind('chat' as never)).toBe('chat');
    expect(resolveKind('bitrix' as never)).toBe('chat');
    expect(resolveKind('tracker_event' as never)).toBeNull();
  });

  it('resolveMeetingId: meeting → sourceExternalId; meeting_report → payload.meetingId / report_-префикс', () => {
    expect(
      resolveMeetingId({ sourceType: 'meeting', sourceExternalId: 'm-1' } as never, {}),
    ).toBe('m-1');
    expect(
      resolveMeetingId({ sourceType: 'meeting_report', sourceExternalId: 'report_m-2' } as never, {
        meetingId: 'm-2',
      }),
    ).toBe('m-2');
    expect(
      resolveMeetingId({ sourceType: 'meeting_report', sourceExternalId: 'report_m-3' } as never, {}),
    ).toBe('m-3');
  });

  it('resolveTitle: sourceTitle → fallback sourceExternalId → sourceType:id', () => {
    expect(
      resolveTitle({ sourceTitle: 'T', sourceExternalId: 'x', sourceType: 'meeting', id: 'i' } as never),
    ).toBe('T');
    expect(
      resolveTitle({ sourceTitle: null, sourceExternalId: 'ext', sourceType: 'meeting', id: 'i' } as never),
    ).toBe('ext');
    expect(
      resolveTitle({ sourceTitle: null, sourceExternalId: null, sourceType: 'chat', id: 'i' } as never),
    ).toBe('chat:i');
  });
});

describe('backfillSourceLayer', () => {
  it('pending=0 → no-op (already-present): findMany/upsert не вызываются', async () => {
    const { prisma, mocks } = buildPrisma({ pending: 0 });
    const stats = await backfillSourceLayer(prisma as unknown as PrismaClient, { dryRun: false });

    expect(mocks.count).toHaveBeenCalledTimes(1);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.episodeUpsert).not.toHaveBeenCalled();
    expect(stats.episodes).toBe(0);
    expect(stats.scanned).toBe(0);
  });

  it('первый прогон: создаёт эпизод + участников + сущности', async () => {
    const { prisma, mocks } = buildPrisma({
      pending: 1,
      events: [meetingEvent],
      participants: [
        { personId: 'p1', role: 'host' },
        { personId: 'p2', role: 'guest' },
      ],
      evidence: [{ blockId: 'b1' }, { blockId: 'b1' }, { blockId: 'b2' }],
      grouped: [{ entityId: 'e1', _count: { entityId: 2 } }],
    });

    const stats = await backfillSourceLayer(prisma as unknown as PrismaClient, { dryRun: false });

    expect(mocks.episodeUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.participantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { meetingId: 'meeting-7', personId: { not: null } } }),
    );
    expect(mocks.sourceParticipantUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { blockId: { in: ['b1', 'b2'] }, tenantId: 'tenant-1' } }),
    );
    expect(mocks.sourceEntityUpsert).toHaveBeenCalledTimes(1);
    expect(stats.episodes).toBe(1);
    expect(stats.participants).toBe(2);
    expect(stats.entities).toBe(1);
  });

  it('второй прогон (SourceEpisode уже есть → pending=0) = полный no-op (0 создания)', async () => {
    const { prisma, mocks } = buildPrisma({ pending: 0, events: [meetingEvent] });
    const stats = await backfillSourceLayer(prisma as unknown as PrismaClient, { dryRun: false });

    expect(mocks.episodeUpsert).not.toHaveBeenCalled();
    expect(mocks.sourceParticipantUpsert).not.toHaveBeenCalled();
    expect(mocks.sourceEntityUpsert).not.toHaveBeenCalled();
    expect(stats.episodes).toBe(0);
  });

  it('dry-run: считает, но ничего не пишет', async () => {
    const { prisma, mocks } = buildPrisma({
      pending: 1,
      events: [meetingEvent],
      participants: [{ personId: 'p1', role: 'host' }],
      evidence: [{ blockId: 'b1' }],
      grouped: [{ entityId: 'e1', _count: { entityId: 1 } }],
    });

    const stats = await backfillSourceLayer(prisma as unknown as PrismaClient, { dryRun: true });

    expect(mocks.episodeUpsert).not.toHaveBeenCalled();
    expect(mocks.sourceParticipantUpsert).not.toHaveBeenCalled();
    expect(mocks.sourceEntityUpsert).not.toHaveBeenCalled();
    expect(stats.episodes).toBe(1);
    expect(stats.participants).toBe(1);
    expect(stats.entities).toBe(1);
  });
});
