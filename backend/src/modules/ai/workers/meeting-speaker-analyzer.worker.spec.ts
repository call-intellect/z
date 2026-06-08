import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../services/llm-router.service';

import { MeetingSpeakerAnalyzerWorker } from './meeting-speaker-analyzer.worker';

/**
 * ТЗ B Фаза 4 — JSON-резилиенс speaker-analyzer.
 * Проверяем, что ```json-обёртка LLM-ответа теперь парсится (раньше
 * одиночный JSON.parse падал → MPB оставался без анализа), и что вызов
 * проходит ровно один раз при валидном ответе с первой попытки.
 */
function mkWorker(llmText: string): {
  worker: MeetingSpeakerAnalyzerWorker;
  prisma: {
    meetingParticipantBehavior: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    transcript: { findUnique: ReturnType<typeof vi.fn> };
    participant: { findMany: ReturnType<typeof vi.fn> };
  };
  llm: { call: ReturnType<typeof vi.fn> };
} {
  const speakerLine =
    'Сегодня мы обсудили план релиза и распределили задачи по команде на ближайшую неделю.';

  const prisma = {
    meetingParticipantBehavior: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'mpb-1',
          tenantId: 'org-1',
          participantId: 'part-1',
          displayName: 'Иванов',
          metrics: { meetingId: 'meet-1' },
        },
      ]),
      update: vi.fn().mockResolvedValue({}),
    },
    transcript: {
      findUnique: vi.fn().mockResolvedValue({
        turns: [
          { speaker: 'иванов', text: speakerLine, startSec: 0, endSec: 5 },
        ],
      }),
    },
    participant: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'part-1', livekitIdentity: 'lk-ivanov', name: 'Иванов' },
      ]),
    },
  };

  const llm = {
    call: vi.fn().mockResolvedValue({
      text: llmText,
      modelUsed: 'deepseek:deepseek-chat',
      inputTokens: 50,
      outputTokens: 20,
      cachedTokens: 0,
      durationMs: 100,
    }),
  };

  const worker = new MeetingSpeakerAnalyzerWorker(
    prisma as unknown as PrismaService,
    llm as unknown as LlmRouterService,
  );
  return { worker, prisma, llm };
}

describe('MeetingSpeakerAnalyzerWorker — JSON-резилиенс', () => {
  it('LLM вернул ```json-обёртку → анализ парсится и записывается, один вызов', async () => {
    const wrapped =
      '```json\n' +
      JSON.stringify({
        topics: ['релиз', 'распределение задач'],
        textSentiment: 'positive',
        confidence: 0.8,
      }) +
      '\n```';
    const { worker, prisma, llm } = mkWorker(wrapped);

    const stats = await worker.runOnce();

    expect(llm.call).toHaveBeenCalledTimes(1);
    expect(stats.processed).toBe(1);
    expect(stats.errors).toBe(0);
    const updateArg = prisma.meetingParticipantBehavior.update.mock.calls[0]?.[0] as {
      data: { sentimentTextPerSpeakerJson: { textSentiment: string; confidence: number } };
    };
    expect(updateArg.data.sentimentTextPerSpeakerJson.textSentiment).toBe('positive');
    expect(updateArg.data.sentimentTextPerSpeakerJson.confidence).toBe(0.8);
  });

  it('LLM дважды вернул мусор → errors++, не падает, ретрай×2', async () => {
    const { worker, prisma, llm } = mkWorker('это не json вовсе');

    const stats = await worker.runOnce();

    expect(llm.call).toHaveBeenCalledTimes(2);
    expect(stats.processed).toBe(0);
    expect(stats.errors).toBe(1);
    expect(prisma.meetingParticipantBehavior.update).not.toHaveBeenCalled();
  });
});
