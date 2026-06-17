import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

const insightCreate: Prisma.InsightCreateInput = {
  kind: 'problem',
  statement: 'type-guard',
  dataClassAudit: { policyVersion: 'type_v1' } as Prisma.InputJsonValue,
  org: { connect: { id: 'org-x' } },
};

const decisionCreate: Prisma.DecisionCreateInput = {
  statement: 'type-guard',
  dataClassAudit: { policyVersion: 'type_v1' } as Prisma.InputJsonValue,
  org: { connect: { id: 'org-x' } },
};

type AssertHasDataClassAudit<T extends { dataClassAudit?: unknown }> = T;
type _InsightHasAudit = AssertHasDataClassAudit<Prisma.InsightCreateInput>;
type _DecisionHasAudit = AssertHasDataClassAudit<Prisma.DecisionCreateInput>;

describe('Ф8 — тип-гард: dataClassAudit в Insight/DecisionCreateInput', () => {
  it('CreateInput-литералы с dataClassAudit компилируются и строятся', () => {
    expect(insightCreate.dataClassAudit).toBeDefined();
    expect(decisionCreate.dataClassAudit).toBeDefined();
    const _checks: [_InsightHasAudit?, _DecisionHasAudit?] = [];
    expect(_checks).toHaveLength(0);
  });
});
