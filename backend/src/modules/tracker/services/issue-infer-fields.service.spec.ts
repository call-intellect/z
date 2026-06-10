import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { IssueInferFieldsService } from './issue-infer-fields.service';

/**
 * Tracker Phase 3 part C — юнит-тест IssueInferFieldsService.
 *
 * Цели:
 *   - happy path: успешный LLM-ответ → возвращает structured suggestions
 *     и инкрементирует метрику с accepted='false'.
 *   - Issue не найдена → null (без LLM-вызова).
 *   - LLM вернул мусор / non-JSON → null.
 *   - assigneeId не из списка members → null (фильтр ссылочной целостности).
 *   - LLM timeout → null (best-effort, не бросает наружу).
 */
describe('IssueInferFieldsService.inferFields', () => {
  let prisma: PrismaService;
  let router: LlmRouterService;
  let metrics: BusinessMetricsService;
  let svc: IssueInferFieldsService;

  let issueFindFirst: ReturnType<typeof vi.fn>;
  let projectFindFirst: ReturnType<typeof vi.fn>;
  let issueAssigneeFindMany: ReturnType<typeof vi.fn>;
  let userFindMany: ReturnType<typeof vi.fn>;
  let goalFindMany: ReturnType<typeof vi.fn>;
  let recentIssuesFindMany: ReturnType<typeof vi.fn>;
  let labelFindMany: ReturnType<typeof vi.fn>;
  let routerCall: ReturnType<typeof vi.fn>;
  let incInferred: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    issueFindFirst = vi.fn();
    projectFindFirst = vi.fn();
    issueAssigneeFindMany = vi.fn();
    userFindMany = vi.fn();
    goalFindMany = vi.fn();
    // recentIssues + первоначальный issue.findFirst — оба вызывают issue.findFirst/findMany.
    recentIssuesFindMany = vi.fn();
    labelFindMany = vi.fn();

    prisma = {
      issue: {
        findFirst: issueFindFirst,
        findMany: recentIssuesFindMany,
      },
      project: { findFirst: projectFindFirst },
      issueAssignee: { findMany: issueAssigneeFindMany },
      user: { findMany: userFindMany },
      goal: { findMany: goalFindMany },
      label: { findMany: labelFindMany },
    } as unknown as PrismaService;

    routerCall = vi.fn();
    router = { call: routerCall } as unknown as LlmRouterService;

    incInferred = vi.fn();
    metrics = {
      incAiIssueInferred: incInferred,
    } as unknown as BusinessMetricsService;

    svc = new IssueInferFieldsService(prisma, router, metrics);
  });

  function setupHappyContext(): void {
    issueFindFirst.mockResolvedValue({
      id: 'iss1',
      projectId: 'p1',
      title: 'Опубликовать релиз v2',
      description: 'Сделать сборку и катить в прод',
      descriptionStripped: 'Сделать сборку и катить в прод',
    });
    projectFindFirst.mockResolvedValue({
      ownerId: 'u-owner',
      defaultAssigneeId: null,
      name: 'Релизы',
    });
    issueAssigneeFindMany.mockResolvedValue([
      { userId: 'u1' },
      { userId: 'u2' },
      { userId: 'u-owner' },
    ]);
    userFindMany.mockResolvedValue([
      { id: 'u1', name: 'Иванов' },
      { id: 'u2', name: 'Петров' },
      { id: 'u-owner', name: 'Сидоров' },
    ]);
    goalFindMany.mockResolvedValue([
      { id: 'g1', name: 'Релизный пайплайн', description: 'CI/CD' },
    ]);
    recentIssuesFindMany.mockResolvedValue([]);
    labelFindMany.mockResolvedValue([{ id: 'l1', name: 'release' }]);
  }

  it('happy path — корректный JSON-ответ LLM → структурированный результат + метрика false', async () => {
    setupHappyContext();
    routerCall.mockResolvedValue({
      text: JSON.stringify({
        suggestedAssigneeId: 'u1',
        suggestedDueDate: '2026-06-01',
        suggestedPriority: 'high',
        suggestedGoalId: 'g1',
        suggestedLabels: ['release', 'urgent'],
        confidence: 0.85,
        reasoning: 'релиз — Иванов делает CI',
      }),
      modelUsed: 'deepseek:deepseek-chat',
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      durationMs: 200,
    });
    const result = await svc.inferFields({
      tenantId: 't1',
      issueId: 'iss1',
    });
    expect(result).toMatchObject({
      suggestedAssigneeId: 'u1',
      suggestedDueDate: '2026-06-01',
      suggestedPriority: 'high',
      // Волна 5 / кластер B — goal-привязка убрана из issue-infer (владелец —
      // issue-goal-suggest). Даже если LLM вернул goalId, поле теперь всегда null.
      suggestedGoalId: null,
      confidence: 0.85,
      meetsThreshold: true,
    });
    expect(result?.suggestedLabels).toEqual(['release', 'urgent']);
    expect(incInferred).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      accepted: 'false',
    });
  });

  it('Issue не найдена → null, без LLM-вызова', async () => {
    issueFindFirst.mockResolvedValue(null);
    const result = await svc.inferFields({ tenantId: 't1', issueId: 'lost' });
    expect(result).toBeNull();
    expect(routerCall).not.toHaveBeenCalled();
  });

  it('LLM вернул не-JSON → null (best-effort)', async () => {
    setupHappyContext();
    routerCall.mockResolvedValue({
      text: 'извини, я не уверен',
      modelUsed: 'deepseek:deepseek-chat',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 100,
    });
    const result = await svc.inferFields({
      tenantId: 't1',
      issueId: 'iss1',
    });
    expect(result).toBeNull();
  });

  it('LLM вернул assigneeId не из списка → фильтр обнуляет', async () => {
    setupHappyContext();
    routerCall.mockResolvedValue({
      text: JSON.stringify({
        suggestedAssigneeId: 'u-phantom', // не в members
        suggestedGoalId: 'g1',
        suggestedPriority: 'medium',
        suggestedLabels: [],
        confidence: 0.9,
      }),
      modelUsed: 'deepseek:deepseek-chat',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 100,
    });
    const result = await svc.inferFields({ tenantId: 't1', issueId: 'iss1' });
    expect(result?.suggestedAssigneeId).toBeNull();
    // Волна 5 / кластер B — goalId больше не извлекается этим агентом → null.
    expect(result?.suggestedGoalId).toBeNull();
    expect(result?.suggestedPriority).toBe('medium');
  });

  it('LLM упал → null, метрика inferred НЕ инкрементируется', async () => {
    setupHappyContext();
    routerCall.mockRejectedValue(new Error('LLM down'));
    const result = await svc.inferFields({ tenantId: 't1', issueId: 'iss1' });
    expect(result).toBeNull();
    expect(incInferred).not.toHaveBeenCalled();
  });

  it('recordAccepted инкрементирует метрику с accepted=true', () => {
    svc.recordAccepted({ tenantId: 't1' });
    expect(incInferred).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      accepted: 'true',
    });
  });
});
