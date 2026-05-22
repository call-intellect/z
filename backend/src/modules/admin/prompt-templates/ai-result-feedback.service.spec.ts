/**
 * Фаза A.3 — unit-тесты на AiResultFeedbackService.
 *
 * Покрытие (≥3 сценария по DoD):
 *   1) upsert — создаёт реакцию.
 *   2) upsert — обновляет реакцию (повторный POST с другим reaction).
 *   3) upsert — несуществующая встреча → NotFound.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AiResultFeedbackService } from './ai-result-feedback.service';

function build({ aiResult }: { aiResult: { id: string } | null }) {
  const upsertMock = vi.fn(
    async ({
      create,
      update,
    }: {
      create: { aiResultId: string; userId: string; reaction: string };
      update: { reaction: string };
    }) => ({
      id: 'f-1',
      aiResultId: create.aiResultId,
      userId: create.userId,
      reaction: update.reaction,
      comment: null,
      createdAt: new Date(),
    }),
  );
  const prisma = {
    aiResult: {
      findUnique: vi.fn(async () => aiResult),
    },
    aiResultFeedback: {
      upsert: upsertMock,
      findUnique: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
  } as unknown as PrismaService;
  const svc = new AiResultFeedbackService(prisma);
  return { svc, prisma, upsertMock };
}

describe('AiResultFeedbackService.upsert', () => {
  it('создаёт реакцию на существующий AiResult', async () => {
    const { svc, upsertMock } = build({ aiResult: { id: 'ai-1' } });
    const out = await svc.upsert({
      meetingId: 'm-1',
      userId: 'u-1',
      dto: { reaction: 'positive' },
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { aiResultId_userId: { aiResultId: 'ai-1', userId: 'u-1' } },
        create: expect.objectContaining({ reaction: 'positive' }),
        update: expect.objectContaining({ reaction: 'positive' }),
      }),
    );
    expect(out.reaction).toBe('positive');
  });

  it('обновление реакции на ту же запись (positive → negative)', async () => {
    const { svc, upsertMock } = build({ aiResult: { id: 'ai-1' } });
    await svc.upsert({
      meetingId: 'm-1',
      userId: 'u-1',
      dto: { reaction: 'positive' },
    });
    await svc.upsert({
      meetingId: 'm-1',
      userId: 'u-1',
      dto: { reaction: 'negative' },
    });
    // Второй вызов передал update.reaction='negative'.
    const call2 = upsertMock.mock.calls[1]?.[0] as { update: { reaction: string } };
    expect(call2.update.reaction).toBe('negative');
  });

  it('несуществующая встреча → NotFound', async () => {
    const { svc } = build({ aiResult: null });
    await expect(
      svc.upsert({
        meetingId: 'm-none',
        userId: 'u-1',
        dto: { reaction: 'positive' },
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'ai_result_not_found' } },
    });
  });
});
