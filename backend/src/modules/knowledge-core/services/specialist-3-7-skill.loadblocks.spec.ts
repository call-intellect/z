import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Specialist37Service } from './specialist-3-7-skill.service';

describe('Specialist37Service.loadSubjectReasoningBlocks — фильтр signalType', () => {
  let prismaMock: {
    ideaBlockEntity: { findMany: ReturnType<typeof vi.fn> };
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
  };
  let svc: Specialist37Service;

  beforeEach(() => {
    prismaMock = {
      ideaBlockEntity: { findMany: vi.fn().mockResolvedValue([]) },
      ideaBlock: { findMany: vi.fn() },
    };
    svc = new Specialist37Service(
      prismaMock as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('выборка subject-блоков фильтрует по расширенному набору (incl. methodology_step)', async () => {
    await (
      svc as unknown as {
        loadSubjectReasoningBlocks(a: {
          tenantId: string;
          entityId: string | null;
          lookbackMonths: number;
        }): Promise<unknown[]>;
      }
    ).loadSubjectReasoningBlocks({ tenantId: 'org-1', entityId: 'e1', lookbackMonths: 12 });

    expect(prismaMock.ideaBlockEntity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: 'subject',
          block: expect.objectContaining({
            signalType: {
              in: expect.arrayContaining([
                'methodology_step',
                'reasoning',
                'rationale',
                'decision_basis',
              ]),
            },
          }),
        }),
      }),
    );
  });
});
