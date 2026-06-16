import { describe, expect, it } from 'vitest';

import type {
  CustomerRiskListApi,
  CustomerRiskSnapshotApi,
} from '@/api/operations-dashboard.api';
import {
  CUSTOMER_RISK_LEVEL_LABEL,
  fromCustomerRiskListApi,
} from './customer-risk';

function snapshot(
  overrides: Partial<CustomerRiskSnapshotApi> = {},
): CustomerRiskSnapshotApi {
  return {
    id: 'snap-1',
    customerEntityId: 'ent-1',
    customerName: 'ООО Ромашка',
    dateLocal: '2026-06-15',
    signalCounts: {
      churn_risk: 0,
      objection: 0,
      pain: 0,
      feature_request: 0,
    },
    windowDays: 14,
    riskScore: 42,
    riskLevel: 'warning',
    scoreDelta: 3,
    signalDelta: 1,
    responsiblePersonId: 'p-1',
    responsiblePersonName: 'Иван Петров',
    topBlocks: [],
    hint: 'Поговорите с клиентом',
    snapshotAt: '2026-06-15T10:00:00.000Z',
    ...overrides,
  };
}

function list(items: CustomerRiskSnapshotApi[]): CustomerRiskListApi {
  return { items, criticalCount: 0, warningCount: items.length };
}

describe('fromCustomerRiskListApi', () => {
  it('badge выбирает преобладающий сигнал', () => {
    const d = fromCustomerRiskListApi(
      list([
        snapshot({
          signalCounts: {
            churn_risk: 3,
            objection: 0,
            pain: 1,
            feature_request: 0,
          },
        }),
      ]),
    );
    expect(d[0].topSignalBadge).toBe('риск ухода: 3');
  });

  it('все нули → topSignalBadge=null', () => {
    const d = fromCustomerRiskListApi(list([snapshot()]));
    expect(d[0].topSignalBadge).toBeNull();
  });

  it('пробрасывает level/score/responsible', () => {
    const d = fromCustomerRiskListApi(
      list([
        snapshot({
          riskLevel: 'critical',
          riskScore: 91,
          scoreDelta: -5,
          responsiblePersonName: 'Анна Сидорова',
        }),
      ]),
    );
    expect(d[0].riskLevel).toBe('critical');
    expect(d[0].riskScore).toBe(91);
    expect(d[0].scoreDelta).toBe(-5);
    expect(d[0].responsiblePersonName).toBe('Анна Сидорова');
  });

  it('пустой items → []', () => {
    expect(fromCustomerRiskListApi(list([]))).toEqual([]);
  });
});

describe('CUSTOMER_RISK_LEVEL_LABEL', () => {
  it('critical === "критично"', () => {
    expect(CUSTOMER_RISK_LEVEL_LABEL.critical).toBe('критично');
  });
});
