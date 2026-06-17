import { describe, expect, it, vi } from 'vitest';

import type { MeetingReportFastTask } from '../../ai/services/prompts/meeting-report-fast.prompt';
import type { AiParticipantContext } from '../../ai/services/prompts/participant-context';
import { TaskAssigneeResolverService } from '../services/task-assignee-resolver.service';

import { MeetingReportFastWorker } from './meeting-report-fast.worker';

interface CreatedTask {
  title: string;
  assigneeRaw: string | null;
  assigneeUserId: string | null;
  extractorVersion: string;
}

function buildWorker(opts?: { trackerOnly?: boolean }): {
  worker: MeetingReportFastWorker;
  created: CreatedTask[];
  upsert: ReturnType<typeof vi.fn>;
  qualityUpsert: ReturnType<typeof vi.fn>;
  meetingUpdate: ReturnType<typeof vi.fn>;
} {
  const created: CreatedTask[] = [];
  const qualityUpsert = vi.fn(async () => ({}));
  const meetingUpdate = vi.fn(async () => ({}));
  const prisma = {
    task: {
      findMany: vi.fn(async () => [] as Array<{ title: string }>),
      create: vi.fn(async ({ data }: { data: CreatedTask }) => {
        created.push({
          title: data.title,
          assigneeRaw: data.assigneeRaw ?? null,
          assigneeUserId: data.assigneeUserId ?? null,
          extractorVersion: data.extractorVersion,
        });
        return data;
      }),
    },
    aiResult: {
      upsert: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        meeting: { update: meetingUpdate },
        meetingQualityScore: { upsert: qualityUpsert },
      }),
    ),
  };

  const assigneeResolver = new TaskAssigneeResolverService();

  const cfg = {
    getDynamic: vi.fn(async () => opts?.trackerOnly ?? false),
  };

  const taskDedupe = {
    dedupeForMeeting: vi.fn(async () => ({ merged: 0 })),
  };

  const worker = new MeetingReportFastWorker(
    {} as never,
    prisma as never,
    {} as never,
    {} as never,
    assigneeResolver,
    taskDedupe as never,
    cfg as never,
    undefined,
  );

  return {
    worker,
    created,
    upsert: prisma.aiResult.upsert,
    qualityUpsert,
    meetingUpdate,
  };
}

function qualityScore(): Record<string, unknown> {
  return {
    overallScore: 72,
    categories: {
      preparation: 70,
      structure: 75,
      clarity: 70,
      outcomes: 80,
      engagement: 65,
    },
    recommendations: [
      { text: 'Озвучить повестку в первые 5 минут.', severity: 'info', category: 'preparation' },
    ],
    strengths: ['Конкретные итоги.'],
  };
}

function task(title: string, assigneeRaw: string | null): MeetingReportFastTask {
  return {
    title,
    assigneeRaw,
    dueDateIso: null,
    sourceQuote: null,
    confidence: 0.9,
  } as unknown as MeetingReportFastTask;
}

function participant(overrides: Partial<AiParticipantContext>): AiParticipantContext {
  return {
    livekitIdentity: 'host:u-x',
    displayName: 'X',
    userId: 'u-x',
    fullName: null,
    role: 'host',
    ...overrides,
  };
}

describe('MeetingReportFastWorker.writeTasks — Фаза 4 assignee resolve', () => {
  it('ставит assigneeUserId, когда assigneeRaw совпадает с зарегистрированным участником', async () => {
    const { worker, created } = buildWorker();
    const participants: AiParticipantContext[] = [
      participant({
        livekitIdentity: 'host:u-nastya',
        displayName: 'Настя',
        userId: 'u-nastya',
        role: 'host',
      }),
    ];

    await (worker as any).writeTasks({
      meetingId: 'm-1',
      tenantId: 't-1',
      ownerId: 'owner-1',
      tasks: [task('Подготовить отчёт', 'Настя')],
      participants,
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.assigneeUserId).toBe('u-nastya');
    expect(created[0]?.assigneeRaw).toBe('Настя');
    expect(created[0]?.extractorVersion).toBe('fast');
  });

  it('оставляет assigneeUserId=null, когда имя не совпало (задача всё равно создаётся)', async () => {
    const { worker, created } = buildWorker();
    const participants: AiParticipantContext[] = [
      participant({
        livekitIdentity: 'host:u-nastya',
        displayName: 'Настя',
        userId: 'u-nastya',
        role: 'host',
      }),
    ];

    await (worker as any).writeTasks({
      meetingId: 'm-1',
      tenantId: 't-1',
      ownerId: 'owner-1',
      tasks: [task('Согласовать бюджет', 'Пётр')],
      participants,
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.assigneeUserId).toBeNull();
    expect(created[0]?.assigneeRaw).toBe('Пётр');
  });

  it('тёзки (два участника с одним именем) → ambiguous → assigneeUserId=null, задача создаётся', async () => {
    const { worker, created } = buildWorker();
    const participants: AiParticipantContext[] = [
      participant({
        livekitIdentity: 'host:u-s1',
        displayName: 'Сергей',
        userId: 'u-s1',
        role: 'host',
      }),
      participant({
        livekitIdentity: 'host:u-s2',
        displayName: 'Сергей',
        userId: 'u-s2',
        role: 'guest',
      }),
    ];

    await (worker as any).writeTasks({
      meetingId: 'm-1',
      tenantId: 't-1',
      ownerId: 'owner-1',
      tasks: [task('Проверить макет', 'Сергей')],
      participants,
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.assigneeUserId).toBeNull();
    expect(created[0]?.assigneeRaw).toBe('Сергей');
  });
});

describe('MeetingReportFastWorker.writeTasks — Ф5.2 gate meetingTasksToTrackerOnly', () => {
  it('флаг ON → пользовательский Task для action-items НЕ создаётся', async () => {
    const { worker, created } = buildWorker({ trackerOnly: true });
    const participants: AiParticipantContext[] = [
      participant({
        livekitIdentity: 'host:u-nastya',
        displayName: 'Настя',
        userId: 'u-nastya',
        role: 'host',
      }),
    ];

    await (worker as any).writeTasks({
      meetingId: 'm-1',
      tenantId: 't-1',
      ownerId: 'owner-1',
      tasks: [task('Подготовить отчёт', 'Настя')],
      participants,
    });

    expect(created).toHaveLength(0);
  });

  it('флаг OFF (дефолт) → Task создаётся как раньше', async () => {
    const { worker, created } = buildWorker({ trackerOnly: false });
    const participants: AiParticipantContext[] = [
      participant({
        livekitIdentity: 'host:u-nastya',
        displayName: 'Настя',
        userId: 'u-nastya',
        role: 'host',
      }),
    ];

    await (worker as any).writeTasks({
      meetingId: 'm-1',
      tenantId: 't-1',
      ownerId: 'owner-1',
      tasks: [task('Подготовить отчёт', 'Настя')],
      participants,
    });

    expect(created).toHaveLength(1);
  });
});

/**
 * Б32 [K6] — при деградации провайдера внутренний цикл (MAX_LLM_RETRIES+1 = 3
 * дорогих LLM-вызова) исчерпывается без валидного вывода. РАНЬШЕ воркер бросал
 * исключение «чтобы BullMQ зачёл attempt» → attempts=5 на очереди давали ×3
 * вызова на КАЖДУЮ попытку = до 15 дорогих вызовов на одну встречу. Теперь
 * статус 'failed' записан, job ЗАВЕРШАЕТСЯ без throw → ровно ≤3 LLM-вызова.
 */
describe('MeetingReportFastWorker.process — Б32 ограничение дорогих LLM-вызовов', () => {
  function buildProcessWorker(routerCall: ReturnType<typeof vi.fn>): {
    worker: MeetingReportFastWorker;
    meetingUpdate: ReturnType<typeof vi.fn>;
    routerCall: ReturnType<typeof vi.fn>;
  } {
    const meetingUpdate = vi.fn(async () => ({}));
    const prisma = {
      meeting: {
        findUnique: vi.fn(async () => ({
          id: 'm-1',
          tenantId: 't-1',
          deletedAt: null,
          ownerId: 'owner-1',
          type: 'team',
          title: null,
          startedAt: new Date('2026-06-16T10:00:00.000Z'),
          transcript: {
            turns: [
              { speaker: 'Алиса', text: 'Привет, начнём', startSec: 0, endSec: 2 },
            ],
          },
          aiResult: null,
        })),
        update: meetingUpdate,
      },
    };
    const router = { call: routerCall };
    const participantContext = { loadForMeeting: vi.fn(async () => []) };
    const cfg = { getDynamic: vi.fn(async () => false) };
    const worker = new MeetingReportFastWorker(
      {} as never, // redis
      prisma as never,
      router as never,
      participantContext as never,
      new TaskAssigneeResolverService(),
      { dedupeForMeeting: vi.fn(async () => ({ merged: 0 })) } as never,
      cfg as never,
      undefined, // events @Optional
      undefined, // metrics @Optional
      undefined, // meetingTitle @Optional
    );
    return { worker, meetingUpdate, routerCall };
  }

  it('провайдер всегда отдаёт мусор → ровно 3 LLM-вызова, process НЕ бросает, статус failed', async () => {
    // Router всегда возвращает невалидный ответ (ни tool_calls, ни JSON).
    const routerCall = vi.fn(async () => ({
      text: 'это не JSON',
      toolCalls: undefined,
      modelUsed: 'deepseek:v4',
      providerUsed: 'deepseek',
      tier: 'fast',
    }));
    const { worker, meetingUpdate } = buildProcessWorker(routerCall);

    // НЕ должно бросить (раньше бросало).
    await expect(
      (worker as any).process({ id: 'job-1', data: { meetingId: 'm-1' } }),
    ).resolves.toBeUndefined();

    // Ровно MAX_LLM_RETRIES+1 = 3 дорогих вызова, не больше.
    expect(routerCall).toHaveBeenCalledTimes(3);

    // Финальный статус failed записан в БД.
    const failedCall = meetingUpdate.mock.calls.find(
      (c) =>
        (c[0] as { data?: { reportFastStatus?: string } })?.data
          ?.reportFastStatus === 'failed',
    );
    expect(failedCall).toBeDefined();
  });
});

describe('MeetingReportFastWorker.writeSummary — S6-01 upsert', () => {
  it('пишет через upsert по meetingId', async () => {
    const { worker, upsert } = buildWorker();
    await (worker as any).writeSummary({
      meetingId: 'm-1',
      meetingType: 'sales',
      markdown: 'Привет мир',
      modelUsed: 'deepseek:v4',
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { meetingId: 'm-1' },
        update: expect.objectContaining({ summaryFast: 'Привет мир' }),
      }),
    );
  });

  it('идемпотентность: два вызова → upsert вызван дважды, без create-пути (нет гонки)', async () => {
    const { worker, upsert } = buildWorker();
    const args = {
      meetingId: 'm-1',
      meetingType: 'sales',
      markdown: 'Привет мир',
      modelUsed: 'deepseek:v4',
    };
    await (worker as any).writeSummary(args);
    await (worker as any).writeSummary(args);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('пустой markdown → early return, upsert НЕ вызван', async () => {
    const { worker, upsert } = buildWorker();
    await (worker as any).writeSummary({
      meetingId: 'm-1',
      meetingType: 'sales',
      markdown: '   ',
      modelUsed: 'deepseek:v4',
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('MeetingReportFastWorker.writeQualityScore — Доводка 2 (каноничная таблица)', () => {
  it('валидный quality_score → upsert MeetingQualityScore (маппинг 5 категорий) + qualityScoreStatus=ready', async () => {
    const { worker, qualityUpsert, meetingUpdate } = buildWorker();
    await (worker as any).writeQualityScore({
      meetingId: 'm-1',
      tenantId: 't-1',
      qualityScore: qualityScore(),
    });
    expect(meetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm-1' },
        data: expect.objectContaining({ qualityScoreStatus: 'ready' }),
      }),
    );
    expect(qualityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { meetingId: 'm-1' },
        create: expect.objectContaining({
          meetingId: 'm-1',
          tenantId: 't-1',
          overallScore: 72,
          preparationScore: 70,
          structureScore: 75,
          clarityScore: 70,
          outcomesScore: 80,
          engagementScore: 65,
        }),
      }),
    );
  });

  it('quality_score без overallScore → skip (ни upsert, ни meeting.update)', async () => {
    const { worker, qualityUpsert, meetingUpdate } = buildWorker();
    const bad = qualityScore();
    delete (bad as Record<string, unknown>).overallScore;
    await (worker as any).writeQualityScore({
      meetingId: 'm-1',
      tenantId: 't-1',
      qualityScore: bad,
    });
    expect(qualityUpsert).not.toHaveBeenCalled();
    expect(meetingUpdate).not.toHaveBeenCalled();
  });

  it('quality_score null → skip', async () => {
    const { worker, qualityUpsert, meetingUpdate } = buildWorker();
    await (worker as any).writeQualityScore({
      meetingId: 'm-1',
      tenantId: 't-1',
      qualityScore: null,
    });
    expect(qualityUpsert).not.toHaveBeenCalled();
    expect(meetingUpdate).not.toHaveBeenCalled();
  });
});
