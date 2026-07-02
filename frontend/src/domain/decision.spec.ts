import { describe, expect, it } from 'vitest';

import type {
  DecisionDetailApi,
  DecisionListItemApi,
} from '@/api/decisions.api';
import { mapDecisionDetail, mapDecisionListItem } from './decision';

function listItem(
  overrides: Partial<DecisionListItemApi> = {},
): DecisionListItemApi {
  return {
    id: 'd-1',
    statement: 'Утвердили план',
    status: 'approved',
    decidedByPersonIds: [],
    decidedAt: null,
    deadline: null,
    supersedesId: null,
    affectsEntityIds: [],
    confidence: null,
    trustTier: 'human',
    reversibility: null,
    previewQuote: null,
    previewSourceRef: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function detail(
  overrides: Partial<DecisionDetailApi> = {},
): DecisionDetailApi {
  return {
    ...listItem(),
    rationale: null,
    alternatives: [],
    sourceBlockIds: [],
    personSubjectIds: [],
    currentVersionId: null,
    validFrom: null,
    validUntil: null,
    actualOutcomes: null,
    dataClass: 'sensitive',
    ...overrides,
  };
}

describe('mapDecisionListItem — reversibility', () => {
  it("reversibility='type-1' → 'type-1'", () => {
    expect(mapDecisionListItem(listItem({ reversibility: 'type-1' })).reversibility).toBe(
      'type-1',
    );
  });

  it("reversibility='type-2' → 'type-2'", () => {
    expect(mapDecisionListItem(listItem({ reversibility: 'type-2' })).reversibility).toBe(
      'type-2',
    );
  });

  it('reversibility=null → null', () => {
    expect(mapDecisionListItem(listItem({ reversibility: null })).reversibility).toBeNull();
  });

  it('неизвестное значение → null', () => {
    expect(mapDecisionListItem(listItem({ reversibility: 'type-9' })).reversibility).toBeNull();
  });
});

describe('mapDecisionDetail — reversibility', () => {
  it("reversibility='type-1' пробрасывается в detail", () => {
    expect(mapDecisionDetail(detail({ reversibility: 'type-1' })).reversibility).toBe('type-1');
  });

  it('reversibility=null → null', () => {
    expect(mapDecisionDetail(detail({ reversibility: null })).reversibility).toBeNull();
  });
});
