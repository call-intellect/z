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
    llmResponse?: string;
    candidateCreateThrows?: unknown;
    livingCardEnabled?: boolean;
    existingLivingNote?: { id: string } | null;
  }) {
    const created: Array<Record<string, unknown>> = [];
    const livingNotes: Array<Record<string, unknown>> = [];
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
      issueActivity: {
        findFirst: vi
          .fn()
          .mockResolvedValue(overrides.existingLivingNote ?? null),
        create: vi.fn().mockImplementation(({ data }) => {
          livingNotes.push(data);
          return Promise.resolve({ id: `act-${livingNotes.length}`, ...data });
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
        if (key === 'taskClosure.lexicalFallbackMinOverlap') {
          return Promise.resolve(overrides.lexicalFallbackMinOverlap ?? 0.5);
        }
        if (key === 'taskClosure.candidateTtlDays') {
          return Promise.resolve(overrides.candidateTtlDays ?? 14);
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
      llm as never,
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
      llm,
      similar,
      embeddings,
      settings,
      created,
      livingNotes,
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
      llmResponse: JSON.stringify({
        done: false,
        confidence: 0.5,
        rationale: 'Начато, но не закончено.',
        positiveSignals: [],
        negativeSignals: ['работа не завершена'],
      }),
    });
    await handler.handle(baseEvent);
    expect(created).toHaveLength(0);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.event).toBe('task.progress_signalled');
  });

  it('лексический fallback: KNN ниже порога, но перекрытие токенов ловит задачу', async () => {
    const { handler, created, emitted, llm } = build({
      // similarity 0.7 < порога 0.85, но название почти дословно в тексте блока.
      similar: [
        { id: 'iss-7', title: 'Отправить КП клиенту Бета', similarity: 0.7 },
      ],
    });
    await handler.handle(baseEvent);
    // KNN не дотянул, fallback поймал → verify зван → done=true → кандидат.
    expect(llm.call).toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(created[0]!.issueId).toBe('iss-7');
    expect(emitted).toHaveLength(1);
  });

  it('лексический fallback не срабатывает при низком перекрытии', async () => {
    const { handler, created, emitted, llm } = build({
      similar: [
        { id: 'iss-9', title: 'Подготовить годовой бюджет', similarity: 0.6 },
      ],
    });
    await handler.handle(baseEvent);
    expect(llm.call).not.toHaveBeenCalled();
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
      llmResponse: JSON.stringify({
        done: false,
        confidence: 0.5,
        rationale: 'Не завершено.',
        positiveSignals: [],
        negativeSignals: ['нет завершения'],
      }),
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

  describe('живая карточка (Ф9): прогресс по существующей задаче', () => {
    const notDoneResponse = JSON.stringify({
      done: false,
      confidence: 0.5,
      rationale: 'Работа идёт, но ещё не завершена.',
      positiveSignals: ['начал'],
      negativeSignals: ['не завершено'],
    });

    it('матч + done=false + kill-switch ON → дозапись conversation_note, кандидат НЕ создан', async () => {
      const { handler, prisma, livingNotes, created } = build({
        llmResponse: notDoneResponse,
      });
      await handler.handle(baseEvent);
      expect(prisma.issueActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ verb: 'conversation_note' }),
        }),
      );
      expect(livingNotes).toHaveLength(1);
      expect(livingNotes[0]!.metadata).toMatchObject({ sourceBlockId: 'blk-1' });
      expect(created).toHaveLength(0);
      expect(prisma.taskClosureCandidate.create).not.toHaveBeenCalled();
    });

    it('идемпотентность: заметка по блоку уже есть → create НЕ вызван', async () => {
      const { handler, prisma, livingNotes } = build({
        llmResponse: notDoneResponse,
        existingLivingNote: { id: 'act-existing' },
      });
      await handler.handle(baseEvent);
      expect(prisma.issueActivity.findFirst).toHaveBeenCalled();
      expect(prisma.issueActivity.create).not.toHaveBeenCalled();
      expect(livingNotes).toHaveLength(0);
    });

    it('kill-switch OFF → дозаписи нет', async () => {
      const { handler, prisma, livingNotes } = build({
        llmResponse: notDoneResponse,
        livingCardEnabled: false,
      });
      await handler.handle(baseEvent);
      expect(prisma.issueActivity.create).not.toHaveBeenCalled();
      expect(livingNotes).toHaveLength(0);
    });

    it('done=true → прежний путь (кандидат), заметка НЕ дописывается', async () => {
      const { handler, prisma, created, livingNotes } = build({});
      await handler.handle(baseEvent);
      expect(created).toHaveLength(1);
      expect(prisma.issueActivity.create).not.toHaveBeenCalled();
      expect(livingNotes).toHaveLength(0);
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
