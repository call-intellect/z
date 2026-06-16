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

interface FakeWorker {
  processor: (job: Job) => Promise<void>;
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const workerInstances: FakeWorker[] = [];

vi.mock('bullmq', () => {
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

describe('SpecialistRoutingDispatcherWorker', () => {
  function build(opts?: { meetingExternalId?: string | null; hasEvidence?: boolean }) {
    const make = () => ({ handle: vi.fn(async () => undefined) });

    const pipe = {
      run: vi.fn(async (_meta: unknown, fn: () => Promise<unknown>) => fn()),
    };

    const hasEvidence = opts?.hasEvidence ?? true;
    const meetingExternalId =
      opts?.meetingExternalId === undefined ? 'mtg-1' : opts.meetingExternalId;
    const prisma = {
      ideaBlockEvidence: {
        findMany: vi.fn(async () => (hasEvidence ? [{ rawEventId: 're1' }] : [])),
      },
      rawEvent: {
        findFirst: vi.fn(async () =>
          meetingExternalId ? { sourceExternalId: meetingExternalId } : null,
        ),
      },
    };

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
      pipe as never,
      prisma as never,
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
      pipe,
      prisma,
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

    await expect(processor(jobOf('3-999-unknown'))).rejects.toThrow(/неизвестный jobName/);
  });

  it('регистрирует ровно 14 handler-ов (по числу специалистов на очереди)', () => {
    const { dispatcher } = build();
    const map = (dispatcher as unknown as { handlers: Map<string, unknown> }).handlers;
    expect(map.size).toBe(14);
  });

  it('блок из встречи → pipe.run вызван с traceId="mtg_<meetingId>" и оборачивает handler', async () => {
    const { handlers, pipe } = build({ meetingExternalId: 'M-42' });
    const processor = getProcessor();

    await processor(jobOf(Specialist314GoalsWorker.SPECIALIST_NAME));

    expect(pipe.run).toHaveBeenCalledTimes(1);
    expect(pipe.run).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 'mtg_M-42' }),
      expect.any(Function),
    );
    expect(handlers.goals.handle).toHaveBeenCalledTimes(1);
  });

  it('блок не из встречи → pipe.run вызван с fallback-traceId (block_<id>)', async () => {
    const { pipe } = build({ hasEvidence: false });
    const processor = getProcessor();

    await processor(jobOf(Specialist314GoalsWorker.SPECIALIST_NAME));

    expect(pipe.run).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 'block_b1' }),
      expect.any(Function),
    );
  });
});
