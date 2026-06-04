import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExperimentDetectorWorker } from './experiment-detector.worker';
import { ProcessDetectorWorker } from './process-detector.worker';
import { Specialist31RegulationsWorker } from './specialist-3-1-regulations.worker';
import { Specialist314GoalsWorker } from './specialist-3-14-goals.worker';
import { Specialist32KnowledgeCloneWorker } from './specialist-3-2-knowledge-clone.worker';
import { Specialist33DecisionsWorker } from './specialist-3-3-decisions.worker';
import { Specialist34ProjectCustomerWorker } from './specialist-3-4-project-customer.worker';
import { Specialist35InsightsWorker } from './specialist-3-5-insights.worker';
import { Specialist36IdeasWorker } from './specialist-3-6-ideas.worker';
import { Specialist37SkillWorker } from './specialist-3-7-skill.worker';
import { SpecialistRoutingDispatcherWorker } from './specialist-routing-dispatcher.worker';
import { SprintHelperWorker } from './sprint-helper.worker';

// Не поднимаем реальный BullMQ Worker — мокаем класс, чтобы конструктор
// `new Worker(...)` в onModuleInit не создавал реального соединения с Redis.
interface FakeWorker {
  processor: (job: Job) => Promise<void>;
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const workerInstances: FakeWorker[] = [];

vi.mock('bullmq', () => {
  // Класс (а не arrow) — чтобы вызов через `new Worker(...)` работал.
  class Worker implements FakeWorker {
    processor: (job: Job) => Promise<void>;
    on = vi.fn();
    close = vi.fn(async () => undefined);
    constructor(_queue: string, processor: (job: Job) => Promise<void>) {
      this.processor = processor;
      workerInstances.push(this);
    }
  }
  return { Worker };
});

/**
 * Ф2 МТЗ «разблокировка конвейера» — unit-тесты диспетчера
 * `core.specialist-routing`.
 *
 * Проверяем:
 *   1. известный jobName → вызывается `handle` ровно нужного хендлера один раз,
 *      чужие хендлеры не вызываются;
 *   2. неизвестный jobName → `dispatch` БРОСАЕТ (не resolved молча).
 */
describe('SpecialistRoutingDispatcherWorker', () => {
  /**
   * Собирает по мок-хендлеру на каждый из 14 специалистов. Каждый мок —
   * `{ handle: vi.fn() }`, плюс на класс навешан правильный static-ключ
   * (берём из самого класса, чтобы карта совпадала с продакшеном).
   */
  function build() {
    const make = () => ({ handle: vi.fn(async () => undefined) });

    const regulations = make();
    const knowledgeClone = make();
    const decisions = make();
    const projectCustomer = make();
    const insights = make();
    const ideas = make();
    const skill = make();
    const helpfulness = make();
    const experiments = make();
    const personalRelation = make();
    const processDetector = make();
    const roleMap = make();
    const goals = make();
    const sprintHelper = make();

    const redis = { client: {} };

    const dispatcher = new SpecialistRoutingDispatcherWorker(
      redis as never,
      regulations as never,
      knowledgeClone as never,
      decisions as never,
      projectCustomer as never,
      insights as never,
      ideas as never,
      skill as never,
      helpfulness as never,
      experiments as never,
      personalRelation as never,
      processDetector as never,
      roleMap as never,
      goals as never,
      sprintHelper as never,
    );

    dispatcher.onModuleInit();

    return {
      dispatcher,
      handlers: {
        regulations,
        knowledgeClone,
        decisions,
        projectCustomer,
        insights,
        ideas,
        skill,
        helpfulness,
        experiments,
        personalRelation,
        processDetector,
        roleMap,
        goals,
        sprintHelper,
      },
    };
  }

  /** Достаёт процессор единственного созданного Worker'а. */
  function getProcessor(): (job: Job) => Promise<void> {
    const last = workerInstances[workerInstances.length - 1];
    if (!last) throw new Error('Worker не был создан');
    return last.processor;
  }

  function jobOf(name: string): Job {
    return { name, data: { blockId: 'b1', tenantId: 't1' } } as unknown as Job;
  }

  beforeEach(() => {
    workerInstances.length = 0;
  });

  it('известный jobName → вызывает ровно нужный handler один раз; чужие не вызываются', async () => {
    const { handlers } = build();
    const processor = getProcessor();

    await processor(jobOf(Specialist314GoalsWorker.SPECIALIST_NAME));

    expect(handlers.goals.handle).toHaveBeenCalledTimes(1);
    // Ни один другой хендлер не должен сработать.
    for (const [key, h] of Object.entries(handlers)) {
      if (key === 'goals') continue;
      expect(h.handle, `handler ${key} не должен вызываться`).not.toHaveBeenCalled();
    }
  });

  it('каждый из 14 jobName маршрутизируется в свой handler', async () => {
    const { handlers } = build();
    const processor = getProcessor();

    const cases: Array<[string, { handle: ReturnType<typeof vi.fn> }]> = [
      [Specialist31RegulationsWorker.SPECIALIST_NAME, handlers.regulations],
      [Specialist32KnowledgeCloneWorker.SPECIALIST_NAME, handlers.knowledgeClone],
      [Specialist33DecisionsWorker.SPECIALIST_NAME, handlers.decisions],
      [Specialist34ProjectCustomerWorker.SPECIALIST_NAME, handlers.projectCustomer],
      [Specialist35InsightsWorker.SPECIALIST_NAME, handlers.insights],
      [Specialist36IdeasWorker.SPECIALIST_NAME, handlers.ideas],
      [Specialist37SkillWorker.SPECIALIST_NAME, handlers.skill],
      [ExperimentDetectorWorker.SPECIALIST_NAME, handlers.experiments],
      [ProcessDetectorWorker.SPECIALIST_NAME, handlers.processDetector],
      [Specialist314GoalsWorker.SPECIALIST_NAME, handlers.goals],
      [SprintHelperWorker.JOB_NAME, handlers.sprintHelper],
    ];

    for (const [name, handler] of cases) {
      handler.handle.mockClear();
      await processor(jobOf(name));
      expect(handler.handle, `jobName ${name}`).toHaveBeenCalledTimes(1);
    }
  });

  it('неизвестный jobName → dispatch БРОСАЕТ (не resolved молча)', async () => {
    build();
    const processor = getProcessor();

    await expect(processor(jobOf('3-999-unknown'))).rejects.toThrow(
      /неизвестный jobName/,
    );
  });

  it('регистрирует ровно 14 handler-ов (по числу специалистов на очереди)', () => {
    const { dispatcher } = build();
    const map = (
      dispatcher as unknown as { handlers: Map<string, unknown> }
    ).handlers;
    expect(map.size).toBe(14);
  });
});
