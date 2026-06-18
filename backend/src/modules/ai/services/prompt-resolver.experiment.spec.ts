import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { PromptExperimentsService } from '../../admin/prompt-templates/prompt-experiments.service';

import { PromptResolverService } from './prompt-resolver.service';

function buildSvc(args: {
  allocation: { experimentId: string; group: 'A' | 'B'; versionId: string } | null;
  versionRow: {
    id: string;
    systemPrompt: string;
    outputSchema: object;
    toolName: string | null;
    sections: Array<{
      id: string;
      versionId: string;
      order: number;
      key: string;
      title: string;
      instruction: string;
      outputType: string;
      required: boolean;
      maxTokens: number | null;
    }>;
    template: {
      id: string;
      scope: string;
      orgId: string | null;
      taskType: string;
      meetingType: string | null;
      deletedAt: Date | null;
    };
  } | null;
}): {
  svc: PromptResolverService;
} {
  const prisma = {
    promptTemplateVersion: {
      findUnique: vi.fn(async () => args.versionRow),
    },
    promptTemplate: { findFirst: vi.fn(async () => null) },
  } as unknown as PrismaService;
  const experiments = {
    resolveAllocation: vi.fn(async () => args.allocation),
  } as unknown as PromptExperimentsService;
  const svc = new PromptResolverService(prisma, undefined, experiments);
  return { svc };
}

const sampleVersion = (versionId: string) => ({
  id: versionId,
  systemPrompt: 'system prompt',
  outputSchema: { type: 'object', properties: {} },
  toolName: null,
  sections: [
    {
      id: `s-${versionId}-1`,
      versionId,
      order: 1,
      key: 'summary',
      title: 'Сводка',
      instruction: 'Напиши сводку',
      outputType: 'text',
      required: true,
      maxTokens: null,
    },
  ],
  template: {
    id: `t-${versionId}`,
    scope: 'system' as const,
    orgId: null,
    taskType: 'summary',
    meetingType: 'sales',
    deletedAt: null,
  },
});

describe('PromptResolverService — A.3 experiment integration', () => {
  it('возвращает группу A когда experiment попал в группу A', async () => {
    const { svc } = buildSvc({
      allocation: { experimentId: 'e-1', group: 'A', versionId: 'v-A' },
      versionRow: sampleVersion('v-A'),
    });
    const result = await svc.resolveForMeeting({
      tenantId: 'org-1',
      meetingId: 'm-100',
      meetingType: 'sales',
      taskType: 'summary',
    });
    expect(result.experimentGroup).toBe('A');
    expect(result.versionId).toBe('v-A');
  });

  it('возвращает группу B когда experiment попал в группу B', async () => {
    const { svc } = buildSvc({
      allocation: { experimentId: 'e-1', group: 'B', versionId: 'v-B' },
      versionRow: sampleVersion('v-B'),
    });
    const result = await svc.resolveForMeeting({
      tenantId: 'org-1',
      meetingId: 'm-200',
      meetingType: 'sales',
      taskType: 'summary',
    });
    expect(result.experimentGroup).toBe('B');
    expect(result.versionId).toBe('v-B');
  });

  it('эксперимента нет — falls back на обычный резолв (code_fallback)', async () => {
    const { svc } = buildSvc({
      allocation: null,
      versionRow: null,
    });
    const result = await svc.resolveForMeeting({
      tenantId: 'org-1',
      meetingId: 'm-300',
      meetingType: 'sales',
      taskType: 'summary',
    });
    expect(result.experimentGroup).toBeUndefined();
    expect(result.source).toBe('code_fallback');
  });
});
