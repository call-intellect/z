import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { IssueGoalSuggestService } from './issue-goal-suggest.service';

describe('IssueGoalSuggestService.suggestGoal', () => {
  let prisma: PrismaService;
  let router: LlmRouterService;
  let metrics: BusinessMetricsService;
  let svc: IssueGoalSuggestService;

  let issueFindFirst: ReturnType<typeof vi.fn>;
  let goalFindMany: ReturnType<typeof vi.fn>;
  let queryRaw: ReturnType<typeof vi.fn>;
  let routerCall: ReturnType<typeof vi.fn>;
  let incSuggested: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    issueFindFirst = vi.fn();
    goalFindMany = vi.fn();
    queryRaw = vi.fn();
    routerCall = vi.fn();
    incSuggested = vi.fn();
    prisma = {
      issue: { findFirst: issueFindFirst },
      goal: { findMany: goalFindMany },
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    router = { call: routerCall } as unknown as LlmRouterService;
    metrics = {
      incAiIssueGoalSuggested: incSuggested,
    } as unknown as BusinessMetricsService;
    svc = new IssueGoalSuggestService(prisma, router, metrics);
  });

  function setupIssue(): void {
    issueFindFirst.mockResolvedValue({
      id: 'iss1',
      title: 'Сделать релиз',
      description: 'Релиз v2',
      descriptionStripped: 'Релиз v2',
    });
  }

  it('KNN: ≥60% top-10 → одна Goal с distance ≤ 0.20 → source=knn', async () => {
    setupIssue();
    queryRaw.mockResolvedValue([
      { goalId: 'g1', distance: 0.05 },
      { goalId: 'g1', distance: 0.06 },
      { goalId: 'g1', distance: 0.07 },
      { goalId: 'g1', distance: 0.08 },
      { goalId: 'g1', distance: 0.09 },
      { goalId: 'g1', distance: 0.1 },
      { goalId: 'g1', distance: 0.11 },
      { goalId: 'g2', distance: 0.12 },
      { goalId: 'g2', distance: 0.13 },
      { goalId: 'g3', distance: 0.14 },
    ]);
    const result = await svc.suggestGoal({
      tenantId: 't1',
      issueId: 'iss1',
    });
    expect(result).toEqual({
      goalId: 'g1',
      confidence: 0.7,
      source: 'knn',
    });
    expect(routerCall).not.toHaveBeenCalled();
    expect(incSuggested).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      accepted: 'false',
      source: 'knn',
    });
  });

  it('KNN: top distance > 0.20 → fallback LLM, LLM возвращает valid goalId', async () => {
    setupIssue();
    queryRaw.mockResolvedValue([
      { goalId: 'g1', distance: 0.5 },
      { goalId: 'g1', distance: 0.6 },
    ]);
    goalFindMany.mockResolvedValue([
      { id: 'g1', name: 'Релиз', description: 'CI/CD' },
      { id: 'g2', name: 'Маркетинг', description: 'продвижение' },
    ]);
    routerCall.mockResolvedValue({
      text: JSON.stringify({
        goalId: 'g1',
        confidence: 0.8,
        reasoning: 'релиз',
      }),
      modelUsed: 'deepseek:deepseek-chat',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 100,
    });
    const result = await svc.suggestGoal({
      tenantId: 't1',
      issueId: 'iss1',
    });
    expect(result?.goalId).toBe('g1');
    expect(result?.source).toBe('llm');
    expect(incSuggested).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      accepted: 'false',
      source: 'llm',
    });
  });

  it('KNN: voting share < 60% → fallback LLM', async () => {
    setupIssue();
    queryRaw.mockResolvedValue([
      { goalId: 'g1', distance: 0.05 },
      { goalId: 'g2', distance: 0.06 },
      { goalId: 'g3', distance: 0.07 },
      { goalId: 'g4', distance: 0.08 },
      { goalId: 'g5', distance: 0.09 },
    ]);
    goalFindMany.mockResolvedValue([{ id: 'g1', name: 'Релиз', description: '' }]);
    routerCall.mockResolvedValue({
      text: JSON.stringify({ goalId: 'g1', confidence: 0.9 }),
      modelUsed: 'deepseek:deepseek-chat',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 50,
    });
    const result = await svc.suggestGoal({
      tenantId: 't1',
      issueId: 'iss1',
    });
    expect(result?.source).toBe('llm');
    expect(routerCall).toHaveBeenCalled();
  });

  it('Пустой KNN (нет embedding у источника) → fallback LLM', async () => {
    setupIssue();
    queryRaw.mockResolvedValue([]);
    goalFindMany.mockResolvedValue([{ id: 'g1', name: 'Цель 1', description: '' }]);
    routerCall.mockResolvedValue({
      text: JSON.stringify({ goalId: 'g1', confidence: 0.7 }),
      modelUsed: 'deepseek:deepseek-chat',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 50,
    });
    const result = await svc.suggestGoal({
      tenantId: 't1',
      issueId: 'iss1',
    });
    expect(result?.source).toBe('llm');
  });

  it('LLM вернул goalId не из списка → null + source=none', async () => {
    setupIssue();
    queryRaw.mockResolvedValue([]);
    goalFindMany.mockResolvedValue([{ id: 'g1', name: 'Цель 1', description: '' }]);
    routerCall.mockResolvedValue({
      text: JSON.stringify({ goalId: 'g-phantom', confidence: 0.9 }),
      modelUsed: 'deepseek:deepseek-chat',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 50,
    });
    const result = await svc.suggestGoal({
      tenantId: 't1',
      issueId: 'iss1',
    });
    expect(result).toBeNull();
    expect(incSuggested).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      accepted: 'false',
      source: 'none',
    });
  });

  it('Issue не найдена → null без LLM/KNN', async () => {
    issueFindFirst.mockResolvedValue(null);
    const result = await svc.suggestGoal({
      tenantId: 't1',
      issueId: 'lost',
    });
    expect(result).toBeNull();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(routerCall).not.toHaveBeenCalled();
  });
});
