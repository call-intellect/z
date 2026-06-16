import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { MeetingReingestCron } from './meeting-reingest.cron';

interface Candidate {
  id: string;
  tenantId: string;
}

function makeCron(args: {
  candidates: Candidate[];
  withRawEvent: Set<string>;
  ingestThrowsFor?: Set<string>;
}) {
  const findMany = vi.fn(async () => args.candidates);
  const findFirst = vi.fn(async (q: { where: { sourceExternalId: string } }) =>
    args.withRawEvent.has(q.where.sourceExternalId)
      ? { id: `re-${q.where.sourceExternalId}` }
      : null,
  );
  const prisma = {
    meeting: { findMany },
    rawEvent: { findFirst },
  } as unknown as ConstructorParameters<typeof MeetingReingestCron>[0];

  const ingestMeeting = vi.fn(async (meetingId: string) => {
    if (args.ingestThrowsFor?.has(meetingId)) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'source_inactive', message: 'Source отключён' },
      });
    }
    return { rawEvent: { id: `re-${meetingId}` }, idempotent: false };
  });
  const meetingIngest = {
    ingestMeeting,
  } as unknown as ConstructorParameters<typeof MeetingReingestCron>[1];

  const incIngestFailed = vi.fn();
  const metrics = {
    incIngestFailed,
  } as unknown as ConstructorParameters<typeof MeetingReingestCron>[2];

  return {
    cron: new MeetingReingestCron(prisma, meetingIngest, metrics),
    findMany,
    findFirst,
    ingestMeeting,
    incIngestFailed,
  };
}

describe('MeetingReingestCron.sweep', () => {
  it('встреча с transcript и без RawEvent → ingestMeeting вызван', async () => {
    const { cron, ingestMeeting } = makeCron({
      candidates: [{ id: 'm-1', tenantId: 'org-1' }],
      withRawEvent: new Set(),
    });

    await cron.sweep();

    expect(ingestMeeting).toHaveBeenCalledTimes(1);
    expect(ingestMeeting).toHaveBeenCalledWith('m-1');
  });

  it('встреча с уже существующим RawEvent → ingestMeeting НЕ вызван (без дублей)', async () => {
    const { cron, ingestMeeting, findFirst } = makeCron({
      candidates: [{ id: 'm-1', tenantId: 'org-1' }],
      withRawEvent: new Set(['m-1']),
    });

    await cron.sweep();

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceExternalId: 'm-1', sourceType: 'meeting' }),
      }),
    );
    expect(ingestMeeting).not.toHaveBeenCalled();
  });

  it('упавший ingestMeeting одной встречи не прерывает обработку остальных + incIngestFailed', async () => {
    const { cron, ingestMeeting, incIngestFailed } = makeCron({
      candidates: [
        { id: 'm-1', tenantId: 'org-1' },
        { id: 'm-2', tenantId: 'org-1' },
        { id: 'm-3', tenantId: 'org-2' },
      ],
      withRawEvent: new Set(),
      ingestThrowsFor: new Set(['m-2']),
    });

    await cron.sweep();

    expect(ingestMeeting).toHaveBeenCalledTimes(3);
    expect(ingestMeeting).toHaveBeenCalledWith('m-1');
    expect(ingestMeeting).toHaveBeenCalledWith('m-2');
    expect(ingestMeeting).toHaveBeenCalledWith('m-3');

    expect(incIngestFailed).toHaveBeenCalledTimes(1);
    expect(incIngestFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'source_inactive' }),
    );
  });

  it('смешанный batch: часть с RawEvent (skip), часть без (reingest)', async () => {
    const { cron, ingestMeeting } = makeCron({
      candidates: [
        { id: 'm-1', tenantId: 'org-1' },
        { id: 'm-2', tenantId: 'org-1' },
      ],
      withRawEvent: new Set(['m-1']),
    });

    await cron.sweep();

    expect(ingestMeeting).toHaveBeenCalledTimes(1);
    expect(ingestMeeting).toHaveBeenCalledWith('m-2');
    expect(ingestMeeting).not.toHaveBeenCalledWith('m-1');
  });
});
