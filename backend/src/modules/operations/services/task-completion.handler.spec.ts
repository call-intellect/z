import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { TaskCompletionHandler, lexicalOverlap } from './task-completion.handler';

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
    lexicalFallbackMinOverlap?: number;
    candidateTtlDays?: number;
    verdict?: {
      done: boolean;
      confidence: number;
      rationale: string;
      positiveSignals: string[];
      negativeSignals: string[];
    } | null;
    candidateCreateThrows?: unknown;
    livingCardEnabled?: boolean;
    progressFromConversationMinConfidence?: number;
    embedMaxAttempts?: number;
    existingProgressUpdate?: { id: string } | null;
    embedImpl?: () => Promise<number[][]>;
  }) {
    const created: Array<Record<string, unknown>> = [];
    const progressUpdates: Array<Record<string, unknown>> = [];
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
      issueProgressUpdate: {
        findFirst: vi
          .fn()
          .mockResolvedValue(overrides.existingProgressUpdate ?? null),
        create: vi.fn().mockImplementation(({ data }) => {
          progressUpdates.push(data);
          return Promise.resolve({ id: `upd-${progressUpdates.length}`, ...data });
        }),
      },
    };
    const closureVerifier = {
      verify: vi
        .fn()
        .mockResolvedValue(
          overrides.verdict ?? {
            done: true,
            confidence: 0.9,
            rationale: 'Прямо сказано, что КП отправлено.',
            positiveSignals: ['собрал', 'отправил на почту'],
            negativeSignals: [],
          },
        ),
    };
    const similar = {
      findSimilarByVector: vi.fn().mockResolvedValue(
        overrides.similar ?? [
          { id: 'iss-1', title: 'Отправить КП клиенту Бета', similarity: 0.91 },
        ],
      ),
    };
    const embeddings = {
      embed: overrides.embedImpl
        ? vi.fn().mockImplementation(overrides.embedImpl)
        : vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };
    const settings = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'taskClosure.enabled') {
          return Promise.resolve(overrides.enabled ?? true);
        }
        if (key === 'taskClosure.matchThreshold') {
          return Promise.resolve(overrides.matchThreshold ?? 0.85);
        }
        if (key === 'taskClosure.lexicalFallbackMinOverlap') {
          return Promise.resolve(overrides.lexicalFallbackMinOverlap ?? 0.5);
        }
        if (key === 'taskClosure.candidateTtlDays') {
          return Promise.resolve(overrides.candidateTtlDays ?? 14);
        }
        if (key === 'taskClosure.embedMaxAttempts') {
          return Promise.resolve(overrides.embedMaxAttempts ?? 3);
        }
        if (key === 'tracker.progressFromConversationMinConfidence') {
          return Promise.resolve(
            overrides.progressFromConversationMinConfidence ?? 0.6,
          );
        }
        return Promise.resolve(undefined);
      }),
    };
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const eventEmitter = {
      emit: vi.fn().mockImplementation((event: string, payload: unknown) => {
        emitted.push({ event, payload });
        return true;
      }),
    };
    const outcomes: string[] = [];
    const metrics = {
      incTaskClosureOutcome: vi
        .fn()
        .mockImplementation((args: { outcome: string }) => {
          outcomes.push(args.outcome);
        }),
    };
    const config = {
      tracker: { livingCardEnabled: overrides.livingCardEnabled ?? true },
    };
    const handler = new TaskCompletionHandler(
      prisma as never,
      closureVerifier as never,
      similar as never,
      embeddings as never,
      settings as never,
      null,
      config as never,
      eventEmitter as never,
      metrics as never,
    );
    return {
      handler,
      prisma,
      closureVerifier,
      similar,
      embeddings,
      settings,
      created,
      progressUpdates,
      eventEmitter,
      emitted,
      metrics,
      outcomes,
    };
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
      verdict: {
        done: false,
        confidence: 0.9,
        rationale: 'В реплике только команда закрыть, без описания работы.',
        positiveSignals: [],
        negativeSignals: ['голая команда закрыть'],
      },
    });
    await handler.handle(baseEvent);
    expect(created).toHaveLength(0);
  });

  it('NIL / ниже порога матча → кандидат не создан (R6)', async () => {
    const { handler, created, closureVerifier } = build({
      similar: [{ id: 'iss-9', title: 'Совсем другое', similarity: 0.4 }],
    });
    await handler.handle(baseEvent);
    expect(created).toHaveLength(0);
    // ниже порога — LLM-верификатор даже не зовём.
    expect(closureVerifier.verify).not.toHaveBeenCalled();
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

  it('эмит task.progress_signalled при KNN-матче (до verify)', async () => {
    const { handler, emitted } = build({});
    await handler.handle(baseEvent);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.event).toBe('task.progress_signalled');
    expect(emitted[0]!.payload).toEqual({
      tenantId: 't1',
      issueId: 'iss-1',
      sourceBlockId: 'blk-1',
    });
  });

  it('прогресс эмитится даже когда verify done=false (частичный сдвиг)', async () => {
    const { handler, emitted, created } = build({
      verdict: {
        done: false,
        confidence: 0.5,
        rationale: 'Начато, но не закончено.',
        positiveSignals: [],
        negativeSignals: ['работа не завершена'],
      },
    });
    await handler.handle(baseEvent);
    expect(created).toHaveLength(0);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.event).toBe('task.progress_signalled');
  });

  it('лексический fallback: KNN ниже порога, но перекрытие токенов ловит задачу', async () => {
    const { handler, created, emitted, closureVerifier } = build({
      // similarity 0.7 < порога 0.85, но название почти дословно в тексте блока.
      similar: [
        { id: 'iss-7', title: 'Отправить КП клиенту Бета', similarity: 0.7 },
      ],
    });
    await handler.handle(baseEvent);
    // KNN не дотянул, fallback поймал → verify зван → done=true → кандидат.
    expect(closureVerifier.verify).toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(created[0]!.issueId).toBe('iss-7');
    expect(emitted).toHaveLength(1);
  });

  it('лексический fallback не срабатывает при низком перекрытии', async () => {
    const { handler, created, emitted, closureVerifier } = build({
      similar: [
        { id: 'iss-9', title: 'Подготовить годовой бюджет', similarity: 0.6 },
      ],
    });
    await handler.handle(baseEvent);
    expect(closureVerifier.verify).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it('метрика исхода created при успешном кандидате', async () => {
    const { handler, outcomes } = build({});
    await handler.handle(baseEvent);
    expect(outcomes).toContain('created');
  });

  it('метрика исхода skipped_tracker для tracker_event', async () => {
    const { handler, outcomes } = build({});
    await handler.handle({ ...baseEvent, sourceType: 'tracker_event' });
    expect(outcomes).toEqual(['skipped_tracker']);
  });

  it('метрика исхода disabled при kill-switch OFF', async () => {
    const { handler, outcomes } = build({ enabled: false });
    await handler.handle(baseEvent);
    expect(outcomes).toEqual(['disabled']);
  });

  it('метрика исхода no_match при пустом KNN', async () => {
    const { handler, outcomes } = build({ similar: [] });
    await handler.handle(baseEvent);
    expect(outcomes).toEqual(['no_match']);
  });

  it('метрика исхода not_done при verify done=false', async () => {
    const { handler, outcomes } = build({
      verdict: {
        done: false,
        confidence: 0.5,
        rationale: 'Не завершено.',
        positiveSignals: [],
        negativeSignals: ['нет завершения'],
      },
    });
    await handler.handle(baseEvent);
    expect(outcomes).toEqual(['not_done']);
  });

  it('метрика исхода dropped_merged при поглощённом блоке', async () => {
    const { handler, outcomes } = build({
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
    expect(outcomes).toEqual(['dropped_merged']);
  });

  it('идемпотентность: P2002 не порождает второй created-инкремент', async () => {
    const { handler, outcomes } = build({
      candidateCreateThrows: new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    });
    await handler.handle(baseEvent);
    // create поймал P2002 (молча) → createCandidate вернулся → created всё равно
    // инкрементится (кандидат уже существует, петля идемпотентна).
    expect(outcomes).toEqual(['created']);
  });

  describe('живая карточка (Ф3): ход выполнения из разговорного блока', () => {
    const notDoneVerdict = {
      done: false,
      confidence: 0.8,
      rationale: 'Работа идёт, но ещё не завершена.',
      positiveSignals: ['начал'],
      negativeSignals: ['не завершено'],
    };

    it('матч + done=false + conf≥порога → создан IssueProgressUpdate, кандидат НЕ создан', async () => {
      const { handler, prisma, progressUpdates, created } = build({
        verdict: notDoneVerdict,
      });
      await handler.handle(baseEvent);
      expect(prisma.issueProgressUpdate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorType: 'ai_agent',
            draftState: 'pending',
            sourceBlockIds: ['blk-1'],
          }),
        }),
      );
      expect(progressUpdates).toHaveLength(1);
      expect(progressUpdates[0]!.sourceBlockIds).toEqual(['blk-1']);
      expect(progressUpdates[0]!.evidenceQuote).toContain('КП');
      expect(created).toHaveLength(0);
      expect(prisma.taskClosureCandidate.create).not.toHaveBeenCalled();
    });

    it('done=false + conf<порога → IssueProgressUpdate НЕ создан (R18 анти-fatigue)', async () => {
      const { handler, prisma, progressUpdates } = build({
        verdict: {
          done: false,
          confidence: 0.4,
          rationale: 'Неуверенно.',
          positiveSignals: [],
          negativeSignals: ['не завершено'],
        },
      });
      await handler.handle(baseEvent);
      expect(prisma.issueProgressUpdate.findFirst).toHaveBeenCalled();
      expect(prisma.issueProgressUpdate.create).not.toHaveBeenCalled();
      expect(progressUpdates).toHaveLength(0);
    });

    it('идемпотентность: IssueProgressUpdate по блоку уже есть → create НЕ вызван', async () => {
      const { handler, prisma, progressUpdates } = build({
        verdict: notDoneVerdict,
        existingProgressUpdate: { id: 'upd-existing' },
      });
      await handler.handle(baseEvent);
      expect(prisma.issueProgressUpdate.findFirst).toHaveBeenCalled();
      expect(prisma.issueProgressUpdate.create).not.toHaveBeenCalled();
      expect(progressUpdates).toHaveLength(0);
    });

    it('kill-switch OFF (livingCardEnabled) → записи нет', async () => {
      const { handler, prisma, progressUpdates } = build({
        verdict: notDoneVerdict,
        livingCardEnabled: false,
      });
      await handler.handle(baseEvent);
      expect(prisma.issueProgressUpdate.create).not.toHaveBeenCalled();
      expect(progressUpdates).toHaveLength(0);
    });

    it('блокер в negativeSignals → health at_risk', async () => {
      const { handler, progressUpdates } = build({
        verdict: {
          done: false,
          confidence: 0.9,
          rationale: 'Застрял на согласовании.',
          positiveSignals: [],
          negativeSignals: ['ждём ответа от юристов, заблокированы'],
        },
      });
      await handler.handle(baseEvent);
      expect(progressUpdates).toHaveLength(1);
      expect(progressUpdates[0]!.health).toBe('at_risk');
    });

    it('done=true → прежний путь (кандидат), запись прогресса НЕ создаётся', async () => {
      const { handler, prisma, created, progressUpdates } = build({});
      await handler.handle(baseEvent);
      expect(created).toHaveLength(1);
      expect(prisma.issueProgressUpdate.create).not.toHaveBeenCalled();
      expect(progressUpdates).toHaveLength(0);
    });
  });

  describe('R14b: embed-resilience (ретрай эмбеддера)', () => {
    it('единичный сбой эмбеддера → ретрай → матч найден, путь продолжается', async () => {
      let calls = 0;
      const { handler, created, embeddings } = build({
        embedImpl: () => {
          calls += 1;
          if (calls === 1) return Promise.reject(new Error('эмбеддер флапнул'));
          return Promise.resolve([[0.1, 0.2, 0.3]]);
        },
      });
      await handler.handle(baseEvent);
      expect(embeddings.embed).toHaveBeenCalledTimes(2);
      expect(created).toHaveLength(1);
    });

    it('эмбеддер падает на всех попытках → embed_fail, кандидат не создан', async () => {
      const { handler, created, embeddings, similar, outcomes } = build({
        embedMaxAttempts: 2,
        embedImpl: () => Promise.reject(new Error('эмбеддер мёртв')),
      });
      await handler.handle(baseEvent);
      expect(embeddings.embed).toHaveBeenCalledTimes(2);
      expect(similar.findSimilarByVector).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
      expect(outcomes).toEqual(['embed_fail']);
    });
  });

  describe('lexicalOverlap (чистая функция)', () => {
    it('полное перекрытие токенов названия → 1', () => {
      expect(
        lexicalOverlap(
          'отправить кп клиенту бета сегодня утром',
          'Отправить клиенту',
        ),
      ).toBe(1);
    });

    it('нормализация ё→е и регистр', () => {
      expect(lexicalOverlap('подобрал ключ', 'Ключ')).toBe(1);
      expect(lexicalOverlap('всё готово', 'Все')).toBe(1);
    });

    it('короткие токены (<3 симв) отбрасываются', () => {
      expect(lexicalOverlap('я он мы', 'Я Он')).toBe(0);
    });

    it('пустое название → 0', () => {
      expect(lexicalOverlap('любой текст', '')).toBe(0);
    });

    it('частичное перекрытие → доля токенов названия', () => {
      // название {отправить, отчёт}; в тексте только 'отправить' → 0.5
      expect(lexicalOverlap('я отправить документ', 'отправить отчет')).toBe(
        0.5,
      );
    });
  });
});
