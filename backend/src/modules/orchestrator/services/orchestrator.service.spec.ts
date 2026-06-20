import { describe, expect, it, beforeEach, vi } from 'vitest';

import type { OrchestratorStreamEvent } from '../orchestrator.types';

import { OrchestratorService } from './orchestrator.service';

const mkCfgStub = () => ({
  resolveSync<T>(_adminKey: string, envKey: string, def: T): T {
    const raw = process.env[envKey];
    if (raw === undefined || raw === '') return def;
    if (typeof def === 'boolean') {
      return (['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase()) as unknown) as T;
    }
    if (typeof def === 'number') {
      const n = Number(raw);
      return ((Number.isFinite(n) ? n : def) as unknown) as T;
    }
    return (raw as unknown) as T;
  },
});

const mkPrismaMock = () => {
  const run = {
    id: 'run_1',
    tenantId: 'org_1',
    userId: 'user_1',
    task: 'test',
    status: 'planning',
    planJson: null,
    synthesisJson: null,
    verificationJson: null,
    errorMessage: null,
    startedAt: new Date(),
    completedAt: null,
  };
  const jobs = [
    {
      id: 'job_1',
      runId: 'run_1',
      stepIndex: 0,
      agentType: 'topic_summary',
      contextJson: {},
      resultJson: { text: 'ok', citations: [], confidence: 0.8 },
      status: 'done',
      errorMessage: null,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  ];
  return {
    orchestratorRun: {
      create: vi.fn().mockResolvedValue({ id: 'run_1' }),
      update: vi.fn().mockResolvedValue(run),
    },
    orchestratorSubagentJob: {
      findMany: vi.fn().mockResolvedValue(jobs),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
};

describe('OrchestratorService (δ-1)', () => {
  beforeEach(() => {
    process.env['ORCHESTRATOR_ENABLED'] = 'true';
    process.env['ORCHESTRATOR_MAX_SUBAGENTS_PER_RUN'] = '5';
    process.env['ORCHESTRATOR_RUN_TIMEOUT_MINUTES'] = '15';
  });

  it('feature-flag off → возвращает error event и не создаёт run', async () => {
    process.env['ORCHESTRATOR_ENABLED'] = 'false';
    const prisma = mkPrismaMock();
    const svc = new OrchestratorService(
      prisma as any,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { incOrchestratorRun: vi.fn(), observeOrchestratorRunDurationSeconds: vi.fn() } as any,
      mkCfgStub() as any,
    );
    const events: OrchestratorStreamEvent[] = [];
    for await (const ev of svc.run({
      task: 'test',
      tenantId: 'org_1',
      userId: 'user_1',
    })) {
      events.push(ev);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'error',
      code: 'orchestrator_disabled',
      message: expect.stringContaining('ORCHESTRATOR_ENABLED=false'),
    });
    expect(prisma.orchestratorRun.create).not.toHaveBeenCalled();
  });

  it('happy-path: started → plan → subagent_started → subagent_completed → synthesis → verification → done', async () => {
    const prisma = mkPrismaMock();
    const planning = {
      plan: vi.fn().mockResolvedValue({
        steps: [
          {
            stepIndex: 0,
            agentType: 'topic_summary',
            description: 'тест',
            contextSlice: { focus: 'test', seedHints: [], params: {} },
          },
        ],
        rationale: 'mock plan',
      }),
    };
    const spawner = {
      spawn: vi.fn().mockResolvedValue([
        {
          stepIndex: 0,
          agentType: 'topic_summary',
          jobId: 'job_1',
          description: 'тест',
        },
      ]),
    };
    const synthesis = {
      synthesize: vi.fn().mockResolvedValue({
        text: 'final synth',
        citations: [],
        usedSteps: [0],
      }),
    };
    const verification = {
      verify: vi.fn().mockResolvedValue({
        confidence: 0.8,
        reasoning: 'ok',
        retried: false,
      }),
    };
    const metrics = {
      incOrchestratorRun: vi.fn(),
      observeOrchestratorRunDurationSeconds: vi.fn(),
    };

    const svc = new OrchestratorService(
      prisma as any,
      planning as any,
      spawner as any,
      synthesis as any,
      verification as any,
      metrics as any,
      mkCfgStub() as any,
    );

    const events: OrchestratorStreamEvent[] = [];
    for await (const ev of svc.run({
      task: 'test',
      tenantId: 'org_1',
      userId: 'user_1',
    })) {
      events.push(ev);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('started');
    expect(types).toContain('plan');
    expect(types).toContain('subagent_started');
    expect(types).toContain('subagent_completed');
    expect(types).toContain('synthesis');
    expect(types).toContain('verification');
    expect(types).toContain('done');
    expect(metrics.incOrchestratorRun).toHaveBeenCalledWith({
      status: 'done',
    });
  });
});
