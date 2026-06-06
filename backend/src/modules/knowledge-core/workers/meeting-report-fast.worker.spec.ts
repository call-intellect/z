import { describe, expect, it, vi } from 'vitest';

import type { AiParticipantContext } from '../../ai/services/prompts/participant-context';
import type { MeetingReportFastTask } from '../../ai/services/prompts/meeting-report-fast.prompt';
import { TaskAssigneeResolverService } from '../services/task-assignee-resolver.service';

import { MeetingReportFastWorker } from './meeting-report-fast.worker';

/**
 * ТЗ 2026-06-04 meeting-identity-and-clones-attribution, Фаза 4 — mini-e2e:
 * `MeetingReportFastWorker.writeTasks` пост-фактум резолвит `assigneeUserId`
 * из `assigneeRaw` по участникам встречи (БЕЗ правки LLM-промпта).
 *
 * Проверяем:
 *   1. assigneeRaw='Настя' + зарегистрированный участник «Настя» →
 *      Task.assigneeUserId='u-nastya'.
 *   2. Имя не совпало (нет такого участника) → assigneeUserId=null, задача
 *      всё равно создаётся, assigneeRaw сохраняется.
 *   3. Тёзки (два участника с одинаковым именем) → ambiguous → assigneeUserId=null,
 *      задача создаётся.
 *
 * writeTasks — private; дёргаем через any-cast, чтобы не поднимать BullMQ Worker
 * и весь DI-граф. `assigneeResolver` — реальный сервис (resolve чистый, метрики
 * @Optional()), участников передаём аргументом.
 */

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
} {
  const created: CreatedTask[] = [];
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
  };

  const assigneeResolver = new TaskAssigneeResolverService();

  // ТЗ Ф5.2 — gate `meetingTasksToTrackerOnly`. По умолчанию OFF (false):
  // задачи создаются как раньше (тесты Фазы 4). Можно включить через opts.
  const cfg = {
    getDynamic: vi.fn(async () => opts?.trackerOnly ?? false),
  };

  const worker = new MeetingReportFastWorker(
    {} as never, // redis
    prisma as never,
    {} as never, // router
    {} as never, // participantContext (writeTasks получает participants аргументом)
    assigneeResolver,
    cfg as never, // cfg (TypedConfigService) — gate meetingTasksToTrackerOnly
    undefined, // metrics @Optional()
  );

  return { worker, created, upsert: prisma.aiResult.upsert };
}

function task(
  title: string,
  assigneeRaw: string | null,
): MeetingReportFastTask {
  return {
    title,
    assigneeRaw,
    dueDateIso: null,
    sourceQuote: null,
    confidence: 0.9,
  } as unknown as MeetingReportFastTask;
}

function participant(
  overrides: Partial<AiParticipantContext>,
): AiParticipantContext {
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

    // Видимая задача = tracker Issue (создаётся отдельно), Task не пишем.
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
