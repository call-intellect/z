import type { PromptFeedback } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import {
  type AiInvocationCompletedEvent,
  type AiInvocationEditedEvent,
  PromptFeedbackCollectorService,
} from './prompt-feedback-collector.service';

interface PartialPrisma {
  promptFeedback: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $executeRawUnsafe: ReturnType<typeof vi.fn>;
}

function makePrisma(args?: { existing?: PromptFeedback | null }): PartialPrisma {
  return {
    promptFeedback: {
      findUnique: vi.fn().mockResolvedValue(args?.existing ?? null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  };
}

function makeMetrics(): {
  metrics: BusinessMetricsService;
  inc: ReturnType<typeof vi.fn>;
} {
  const inc = vi.fn();
  const metrics = { incPromptFeedback: inc } as unknown as BusinessMetricsService;
  return { metrics, inc };
}

function buildSvc(args: {
  prisma: PartialPrisma;
  metrics: BusinessMetricsService;
}): PromptFeedbackCollectorService {
  return new PromptFeedbackCollectorService(
    args.prisma as unknown as PrismaService,
    args.metrics,
    undefined,
  );
}

const completed: AiInvocationCompletedEvent = {
  invocationId: 'inv-1',
  tenantId: 'org-1',
  promptKey: 'meeting-report-fast',
  promptVersion: 'deepseek:deepseek-v4-pro',
  input: {
    systemPrompt: 'system text',
    userMessage: 'user text',
  },
  output: 'AI output text',
};

describe('PromptFeedbackCollectorService.handleInvocationCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('создаёт PromptFeedback и инкрементирует метрику has_edit=false', async () => {
    const prisma = makePrisma();
    const { metrics, inc } = makeMetrics();
    const svc = buildSvc({ prisma, metrics });

    await svc.handleInvocationCompleted(completed);

    expect(prisma.promptFeedback.findUnique).toHaveBeenCalledWith({
      where: { invocationId: 'inv-1' },
    });
    expect(prisma.promptFeedback.create).toHaveBeenCalledTimes(1);
    const createArg = prisma.promptFeedback.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    expect(createArg?.data.tenantId).toBe('org-1');
    expect(createArg?.data.promptKey).toBe('meeting-report-fast');
    expect(createArg?.data.invocationId).toBe('inv-1');
    expect(createArg?.data.originalOutput).toBe('AI output text');
    expect(createArg?.data.editedOutput).toBeUndefined();
    expect(typeof createArg?.data.inputDigest).toBe('string');
    expect((createArg?.data.inputDigest as string).length).toBe(16);
    expect(inc).toHaveBeenCalledWith({
      promptKey: 'meeting-report-fast',
      hasEdit: 'false',
    });
  });

  it('второй completed с тем же invocationId → no-op', async () => {
    const existing = {
      id: 'fb-1',
      invocationId: 'inv-1',
    } as PromptFeedback;
    const prisma = makePrisma({ existing });
    const { metrics } = makeMetrics();
    const svc = buildSvc({ prisma, metrics });

    await svc.handleInvocationCompleted(completed);

    expect(prisma.promptFeedback.create).not.toHaveBeenCalled();
  });
});

describe('PromptFeedbackCollectorService.handleInvocationEdited', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('update editedOutput + editDistance, метрика has_edit=true', async () => {
    const existing = {
      id: 'fb-1',
      invocationId: 'inv-1',
      promptKey: 'meeting-report-fast',
      originalOutput: 'original output text',
    } as PromptFeedback;
    const prisma = makePrisma({ existing });
    const { metrics, inc } = makeMetrics();
    const svc = buildSvc({ prisma, metrics });

    const event: AiInvocationEditedEvent = {
      invocationId: 'inv-1',
      editedOutput: 'edited output much different',
      editedByUserId: 'user-1',
    };
    await svc.handleInvocationEdited(event);

    expect(prisma.promptFeedback.update).toHaveBeenCalledTimes(1);
    const updateArg = prisma.promptFeedback.update.mock.calls[0]?.[0] as
      | { where: { id: string }; data: Record<string, unknown> }
      | undefined;
    expect(updateArg?.where.id).toBe('fb-1');
    expect(updateArg?.data.editedOutput).toBe('edited output much different');
    expect(typeof updateArg?.data.editDistance).toBe('number');
    expect(updateArg?.data.editedAt).toBeInstanceOf(Date);
    expect(updateArg?.data.editedByUserId).toBe('user-1');
    expect(inc).toHaveBeenCalledWith({
      promptKey: 'meeting-report-fast',
      hasEdit: 'true',
    });
  });

  it('edited без существующего feedback → silent skip', async () => {
    const prisma = makePrisma({ existing: null });
    const { metrics, inc } = makeMetrics();
    const svc = buildSvc({ prisma, metrics });

    await svc.handleInvocationEdited({
      invocationId: 'missing-inv',
      editedOutput: 'whatever',
      editedByUserId: null,
    });

    expect(prisma.promptFeedback.update).not.toHaveBeenCalled();
    expect(inc).not.toHaveBeenCalled();
  });
});
