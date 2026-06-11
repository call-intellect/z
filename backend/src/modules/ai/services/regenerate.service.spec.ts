import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';
import type { AiQueueService } from '../ai-queue.service';

import type { LlmRouterService } from './llm-router.service';
import {
  QuotaExceededError,
  RegenerateConflictError,
  RegenerateForbiddenError,
  RegenerateService,
} from './regenerate.service';

interface BuildOpts {
  meeting?: {
    ownerId?: string;
    recapVersion?: number;
    type?: string;
  } | null;
  auditCount?: number;
  /** При этом числе update() бросает P2025 (имитация optimistic-conflict). */
  conflictOnUpdate?: boolean;
  llmRouterText?: string;
}

function build(opts: BuildOpts = {}) {
  const meeting = {
    id: 'm-1',
    ownerId: opts.meeting?.ownerId ?? 'u-1',
    recapVersion: opts.meeting?.recapVersion ?? 1,
    type: opts.meeting?.type ?? 'team',
    title: 'Sample',
    transcript: { turns: [{ speaker: 'A', text: 'hi', startSec: 0, endSec: 1 }] },
    aiResult: { structuredData: { foo: 'old', bar: { x: 1 } } },
  };
  const findUnique = vi.fn(async () => (opts.meeting === null ? null : meeting));
  const update = vi.fn(async () => {
    if (opts.conflictOnUpdate) {
      throw new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2025',
        clientVersion: 'test',
      });
    }
    return { recapVersion: meeting.recapVersion + 1 };
  });
  const aiResultUpdate = vi.fn(async () => undefined);
  const auditCreate = vi.fn(async () => undefined);
  const auditCount = vi.fn(async () => opts.auditCount ?? 0);
  const txn = vi.fn(async (fn: (tx: unknown) => unknown) =>
    fn({
      meeting: { update },
      aiResult: { update: aiResultUpdate },
    }),
  );

  const prisma = {
    meeting: { findUnique, update },
    aiResult: { update: aiResultUpdate },
    auditLog: { create: auditCreate, count: auditCount },
    $transaction: txn,
  } as unknown as PrismaService;

  const queue = {
    enqueueAnalyzeWithTemplate: vi.fn(async () => undefined),
  } as unknown as AiQueueService;

  const coreQueue = {
    enqueueMeetingReportFast: vi.fn(async () => undefined),
  } as unknown as CoreQueueService;

  const router = {
    call: vi.fn(async () => ({
      text: opts.llmRouterText ?? '"new section value"',
      modelUsed: 'anthropic:claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 20,
      durationMs: 1000,
    })),
  } as unknown as LlmRouterService;

  const cfg = {
    workspace: { maxRegeneratePerMeetingPerDay: 5 },
  } as unknown as TypedConfigService;

  const svc = new RegenerateService(prisma, queue, coreQueue, router, cfg);
  return { svc, findUnique, update, aiResultUpdate, auditCreate, auditCount, queue, coreQueue, router, txn };
}

describe('RegenerateService.regenerateMeeting', () => {
  it('happy path: bumps version, ставит analyze + meeting-report-fast', async () => {
    const ctx = build({});
    const out = await ctx.svc.regenerateMeeting({
      meetingId: 'm-1',
      userId: 'u-1',
      expectedRecapVersion: 1,
    });
    expect(out.recapVersion).toBe(2);
    expect(ctx.queue.enqueueAnalyzeWithTemplate).toHaveBeenCalledWith('m-1', 2, undefined);
    expect(ctx.coreQueue.enqueueMeetingReportFast).toHaveBeenCalledWith('m-1', {
      reason: 'v2',
    });
  });

  it('templateId передаётся в analyze', async () => {
    const ctx = build({});
    await ctx.svc.regenerateMeeting({
      meetingId: 'm-1',
      userId: 'u-1',
      expectedRecapVersion: 1,
      templateId: 'tpl-7',
    });
    expect(ctx.queue.enqueueAnalyzeWithTemplate).toHaveBeenCalledWith('m-1', 2, 'tpl-7');
  });

  it('conflict (recapVersion mismatch при чтении) → RegenerateConflictError', async () => {
    const ctx = build({ meeting: { recapVersion: 5 } });
    await expect(
      ctx.svc.regenerateMeeting({
        meetingId: 'm-1',
        userId: 'u-1',
        expectedRecapVersion: 1,
      }),
    ).rejects.toBeInstanceOf(RegenerateConflictError);
  });

  it('conflict (P2025 при update) → RegenerateConflictError', async () => {
    const ctx = build({ conflictOnUpdate: true });
    await expect(
      ctx.svc.regenerateMeeting({
        meetingId: 'm-1',
        userId: 'u-1',
        expectedRecapVersion: 1,
      }),
    ).rejects.toBeInstanceOf(RegenerateConflictError);
  });

  it('forbidden: чужой userId', async () => {
    const ctx = build({});
    await expect(
      ctx.svc.regenerateMeeting({
        meetingId: 'm-1',
        userId: 'someone-else',
        expectedRecapVersion: 1,
      }),
    ).rejects.toBeInstanceOf(RegenerateForbiddenError);
  });

  it('quota exceeded → QuotaExceededError', async () => {
    const ctx = build({ auditCount: 5 });
    await expect(
      ctx.svc.regenerateMeeting({
        meetingId: 'm-1',
        userId: 'u-1',
        expectedRecapVersion: 1,
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(ctx.queue.enqueueAnalyzeWithTemplate).not.toHaveBeenCalled();
  });

  it('успех: пишет audit-лог', async () => {
    const ctx = build({});
    await ctx.svc.regenerateMeeting({
      meetingId: 'm-1',
      userId: 'u-1',
      expectedRecapVersion: 1,
      templateId: 'tpl-1',
    });
    expect(ctx.auditCreate).toHaveBeenCalledOnce();
    const auditCalls = (ctx.auditCreate as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const firstArg = auditCalls[0]?.[0] as { data: { action: string } } | undefined;
    expect(firstArg?.data.action).toBe('meeting.regenerate');
  });
});

describe('RegenerateService.regenerateSection', () => {
  it('happy: парсит JSON и записывает новое значение секции', async () => {
    const ctx = build({ llmRouterText: '"updated value"' });
    const out = await ctx.svc.regenerateSection({
      meetingId: 'm-1',
      userId: 'u-1',
      expectedRecapVersion: 1,
      sectionKey: 'foo',
    });
    expect(out.recapVersion).toBe(2);
    expect(out.newSectionValue).toBe('updated value');
    expect(ctx.txn).toHaveBeenCalled();
  });

  it('LLM вернул не-JSON — сохраняем сырой текст как значение', async () => {
    const ctx = build({ llmRouterText: 'plain text' });
    const out = await ctx.svc.regenerateSection({
      meetingId: 'm-1',
      userId: 'u-1',
      expectedRecapVersion: 1,
      sectionKey: 'foo',
    });
    expect(out.newSectionValue).toBe('plain text');
  });

  it('forbidden: чужой userId', async () => {
    const ctx = build({});
    await expect(
      ctx.svc.regenerateSection({
        meetingId: 'm-1',
        userId: 'other',
        expectedRecapVersion: 1,
        sectionKey: 'foo',
      }),
    ).rejects.toBeInstanceOf(RegenerateForbiddenError);
  });
});
