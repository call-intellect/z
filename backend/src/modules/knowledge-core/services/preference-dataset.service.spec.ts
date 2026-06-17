import { describe, expect, it, vi } from 'vitest';

import { PreferenceDatasetService } from './preference-dataset.service';

function makeService(prismaCreate: ReturnType<typeof vi.fn>) {
  const fakePrisma = {
    llmPreferenceSample: {
      create: prismaCreate,
    },
  } as unknown as ConstructorParameters<typeof PreferenceDatasetService>[0];
  return new PreferenceDatasetService(fakePrisma);
}

describe('PreferenceDatasetService.onDecisionRecorded', () => {
  it('approve → создаёт sample с label=correct, taskType маппится из resourceType', async () => {
    const createMock = vi.fn().mockResolvedValue({ id: 's1' });
    const svc = makeService(createMock);
    await svc.onDecisionRecorded({
      tenantId: 'org_1',
      curationItemId: 'ci_1',
      curationDecisionId: 'cd_1',
      resourceType: 'decision',
      resourceId: 'd_1',
      decisionType: 'approve',
      reviewerUserId: 'u_1',
      reasoning: null,
      proposedPayload: { statement: 'X' },
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    const args = createMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data.label).toBe('correct');
    expect(args.data.taskType).toBe('decision-extract');
    expect(args.data.tenantId).toBe('org_1');
    expect(args.data.recordedBy).toBe('u_1');
    expect(args.data.decisionId).toBe('cd_1');
  });

  it('mark_as_misleading → label=misleading', async () => {
    const createMock = vi.fn().mockResolvedValue({ id: 's2' });
    const svc = makeService(createMock);
    await svc.onDecisionRecorded({
      tenantId: 'org_1',
      curationItemId: 'ci_1',
      curationDecisionId: 'cd_2',
      resourceType: 'skill_trait',
      resourceId: 'st_1',
      decisionType: 'mark_as_misleading',
      reviewerUserId: 'u_2',
      reasoning: 'неверно',
      proposedPayload: {},
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    const args2 = createMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args2.data.label).toBe('misleading');
    expect(args2.data.taskType).toBe('skill-trait-detect');
  });

  it('reject → label=wrong', async () => {
    const createMock = vi.fn().mockResolvedValue({ id: 's3' });
    const svc = makeService(createMock);
    await svc.onDecisionRecorded({
      tenantId: 'org_1',
      curationItemId: 'ci_2',
      curationDecisionId: 'cd_3',
      resourceType: 'insight',
      resourceId: 'i_1',
      decisionType: 'reject',
      reviewerUserId: 'u_3',
      reasoning: null,
      proposedPayload: {},
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    const args3 = createMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args3.data.label).toBe('wrong');
  });

  it('escalate → sample НЕ создаётся (не релевантный decisionType)', async () => {
    const createMock = vi.fn();
    const svc = makeService(createMock);
    await svc.onDecisionRecorded({
      tenantId: 'org_1',
      curationItemId: 'ci_3',
      curationDecisionId: 'cd_4',
      resourceType: 'decision',
      resourceId: 'd_2',
      decisionType: 'escalate',
      reviewerUserId: 'u_4',
      proposedPayload: {},
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('best-effort: сбой prisma.create не пробрасывает наружу', async () => {
    const createMock = vi.fn().mockRejectedValue(new Error('db down'));
    const svc = makeService(createMock);
    await expect(
      svc.onDecisionRecorded({
        tenantId: 'org_1',
        curationItemId: 'ci_4',
        curationDecisionId: 'cd_5',
        resourceType: 'decision',
        resourceId: 'd_3',
        decisionType: 'approve',
        reviewerUserId: 'u_5',
        proposedPayload: {},
      }),
    ).resolves.toBeUndefined();
  });
});
