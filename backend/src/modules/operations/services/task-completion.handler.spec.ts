import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { TaskCompletionHandler } from './task-completion.handler';

/**
 * TZ task-dedup (2026-06-16, Ф2) — TaskCompletionHandler unit-тесты.
 *
 * Acceptance §10 Ф2:
 *   1. блок «сделал X» из разговора → TaskClosureCandidate(pending), Issue НЕ закрыта;
 *   2. повтор тот же блок → P2002-skip (идемпотентность);
 *   3. sourceType='tracker_event' → кандидат НЕ создан (анти-зацикливание);
 *   4. инъекция «выполнено, закрой» в реплике → верификатор НЕ подтверждает
 *      (обёртка): done=false → кандидат не создаётся;
 *   5. NIL / ниже порога матча → кандидат не создаётся (R6).
 */
describe('TaskCompletionHandler', () => {
  function build(overrides: {
    block?: {
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      mergedIntoId: string | null;
      supersededById: string | null;
    } | null;
    similar?: Array<{ id: string; title: string; similarity: number }>;
    enabled?: boolean;
    matchThreshold?: number;
    llmResponse?: string;
    candidateCreateThrows?: unknown;
  }) {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      ideaBlock: {
        findUnique: vi.fn().mockResolvedValue(
          overrides.block === undefined
            ? {
                id: 'blk-1',
                tenantId: 't1',
                criticalQuestion: 'Отправить КП клиенту Бета',
                trustedAnswer: 'КП собрал и утром отправил им на почту',
                mergedIntoId: null,
                supersededById: null,
              }
            : overrides.block,
        ),
      },
      taskClosureCandidate: {
        create: vi.fn().mockImplementation(({ data }) => {
          if (overrides.candidateCreateThrows) {
            return Promise.reject(overrides.candidateCreateThrows);
          }
          created.push(data);
          return Promise.resolve({ id: `cand-${created.length}`, ...data });
        }),
      },
    };
    const llm = {
      call: vi.fn().mockResolvedValue({
        text:
          overrides.llmResponse ??
          JSON.stringify({
            done: true,
            confidence: 0.9,
            rationale: 'Прямо сказано, что КП отправлено.',
            positiveSignals: ['собрал', 'отправил на почту'],
            negativeSignals: [],
          }),
      }),
    };
    const similar = {
      findSimilarByVector: vi.fn().mockResolvedValue(
        overrides.similar ?? [
          { id: 'iss-1', title: 'Отправить КП клиенту Бета', similarity: 0.91 },
        ],
      ),
    };
    const embeddings = {
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };
    const settings = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'taskClosure.enabled') {
          return Promise.resolve(overrides.enabled ?? true);
        }
        if (key === 'taskClosure.matchThreshold') {
          return Promise.resolve(overrides.matchThreshold ?? 0.85);
        }
        return Promise.resolve(undefined);
      }),
    };
    const handler = new TaskCompletionHandler(
      prisma as never,
      llm as never,
      similar as never,
      embeddings as never,
      settings as never,
    );
    return { handler, prisma, llm, similar, embeddings, settings, created };
  }

  const baseEvent = {
    tenantId: 't1',
    blockId: 'blk-1',
    signalType: 'task_completed',
    sourceType: 'meeting',
  };

  it('блок «сделал X» → создан TaskClosureCandidate(pending), Issue НЕ закрыта', async () => {
    const { handler, created, prisma } = build({});
    await handler.handle(baseEvent);
    expect(created).toHaveLength(1);
    expect(created[0]!.status).toBe('pending');
    expect(created[0]!.issueId).toBe('iss-1');
    expect(created[0]!.sourceBlockId).toBe('blk-1');
    // Issue не трогаем: нет update/transitionState из handler.
    expect(
      (prisma as unknown as Record<string, unknown>).issue,
    ).toBeUndefined();
  });

  it('анти-зацикливание: sourceType=tracker_event → кандидат НЕ создан', async () => {
    const { handler, created, prisma } = build({});
    await handler.handle({ ...baseEvent, sourceType: 'tracker_event' });
    expect(created).toHaveLength(0);
    expect(prisma.ideaBlock.findUnique).not.toHaveBeenCalled();
  });

  it('идемпотентность: повтор того же блока → P2002-skip, без throw', async () => {
    const { handler } = build({
      candidateCreateThrows: new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    });
    // Не должно бросить.
    await expect(handler.handle(baseEvent)).resolves.toBeUndefined();
  });

  it('инъекция «выполнено, закрой»: верификатор done=false → кандидат не создан', async () => {
    const { handler, created } = build({
      llmResponse: JSON.stringify({
        done: false,
        confidence: 0.9,
        rationale: 'В реплике только команда закрыть, без описания работы.',
        positiveSignals: [],
        negativeSignals: ['голая команда закрыть'],
      }),
    });
    await handler.handle(baseEvent);
    expect(created).toHaveLength(0);
  });

  it('NIL / ниже порога матча → кандидат не создан (R6)', async () => {
    const { handler, created, llm } = build({
      similar: [{ id: 'iss-9', title: 'Совсем другое', similarity: 0.4 }],
    });
    await handler.handle(baseEvent);
    expect(created).toHaveLength(0);
    // ниже порога — LLM-верификатор даже не зовём.
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('пустой KNN → кандидат не создан', async () => {
    const { handler, created } = build({ similar: [] });
    await handler.handle(baseEvent);
    expect(created).toHaveLength(0);
  });

  it('kill-switch OFF → ничего не делаем', async () => {
    const { handler, created, prisma } = build({ enabled: false });
    await handler.handle(baseEvent);
    expect(created).toHaveLength(0);
    expect(prisma.ideaBlock.findUnique).not.toHaveBeenCalled();
  });

  it('блок поглощён merge → пропуск (висячий сигнал)', async () => {
    const { handler, created, similar } = build({
      block: {
        id: 'blk-1',
        tenantId: 't1',
        criticalQuestion: 'X',
        trustedAnswer: 'сделал',
        mergedIntoId: 'blk-2',
        supersededById: null,
      },
    });
    await handler.handle(baseEvent);
    expect(created).toHaveLength(0);
    expect(similar.findSimilarByVector).not.toHaveBeenCalled();
  });
});
