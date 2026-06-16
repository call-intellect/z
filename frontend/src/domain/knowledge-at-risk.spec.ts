/**
 * ТЗ coo-orphan-agents Ф5 — тесты domain «знания под риском».
 */
import { describe, expect, it } from 'vitest';

import type { KnowledgeAtRiskListApi } from '@/api/operations-dashboard.api';

import {
  fromKnowledgeAtRiskApi,
  KNOWLEDGE_RISK_SEVERITY_LABEL,
} from './knowledge-at-risk';

describe('fromKnowledgeAtRiskApi', () => {
  it('пробрасывает soleExpertPersonName (имя и null) и маппит snapshotAt → Date', () => {
    const api: KnowledgeAtRiskListApi = {
      items: [
        {
          categoryName: 'Биллинг',
          soleExpertPersonId: 'cuid-1',
          soleExpertPersonName: 'Иван Петров',
          busFactorLevel: 'critical',
          personRiskLevel: 'high',
          combinedSeverity: 'critical',
          snapshotAt: '2026-06-15T05:00:00.000Z',
        },
        {
          categoryName: 'Интеграции',
          soleExpertPersonId: null,
          soleExpertPersonName: null,
          busFactorLevel: 'critical',
          personRiskLevel: null,
          combinedSeverity: 'warning',
          snapshotAt: '2026-06-15T05:00:00.000Z',
        },
      ],
    };

    const out = fromKnowledgeAtRiskApi(api);

    expect(out).toHaveLength(2);
    expect(out[0].soleExpertPersonName).toBe('Иван Петров');
    expect(out[1].soleExpertPersonName).toBeNull();
    expect(out[0].snapshotAt).toBeInstanceOf(Date);
    expect(out[0].snapshotAt.toISOString()).toBe('2026-06-15T05:00:00.000Z');
    expect(out[0].combinedSeverity).toBe('critical');
  });

  it('пустой items → пустой массив', () => {
    expect(fromKnowledgeAtRiskApi({ items: [] })).toEqual([]);
  });
});

describe('KNOWLEDGE_RISK_SEVERITY_LABEL', () => {
  it('critical → «критично»', () => {
    expect(KNOWLEDGE_RISK_SEVERITY_LABEL.critical).toBe('критично');
  });
});
