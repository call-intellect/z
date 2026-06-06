import {
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';

/**
 * Tracker Phase 3 part C (2026-05-24) — IssueInferFieldsService.
 *
 * AI-suggest при создании задачи. Загружает Issue + project-context (members,
 * активные Goal, последние задачи), формирует промпт и вызывает LlmRouter
 * (taskType `issue-infer-fields`). Возвращает структурированные подсказки.
 *
 * Принципы:
 *   - confidence < 0.7 → caller получит result, но обычно подсказки скрываются
 *     на фронте (порог решается UI).
 *   - timeout 8s — встроен в `inferFields` (если медленнее, бросает таймаут;
 *     IssuesService.create() ловит и возвращает Issue без `aiSuggestions`).
 *   - Метрика `ai_issue_inferred_total{tenant_top, accepted=false}` инкрементируется
 *     при каждом успешном inference. accepted=true инкрементируется отдельно
 *     при фактическом принятии (через PATCH /issues/:id — добавится позже).
 *   - Используется через `@Optional()` в IssuesService.create() — не должна
 *     ломать создание задачи при недоступности LLM/Redis/embeddings.
 */
@Injectable()
export class IssueInferFieldsService {
  private readonly logger = new Logger(IssueInferFieldsService.name);
  private static readonly INFER_TIMEOUT_MS = 8_000;
  private static readonly MIN_CONFIDENCE = 0.7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Возвращает подсказки для задачи. Не бросает наружу — на любую ошибку
   * (timeout / LLM down / JSON parse fail) возвращает null. Caller сам
   * решает, что показать пользователю.
   */
  async inferFields(args: {
    tenantId: string;
    issueId: string;
    contextHints?: string;
  }): Promise<IssueInferFieldsResult | null> {
    try {
      const issue = await this.prisma.issue.findFirst({
        where: { id: args.issueId, tenantId: args.tenantId, deletedAt: null },
        select: {
          id: true,
          projectId: true,
          title: true,
          description: true,
          descriptionStripped: true,
        },
      });
      if (!issue) {
        return null;
      }
      const context = await this.loadProjectContext(
        args.tenantId,
        issue.projectId,
      );

      const systemPrompt = this.buildSystemPrompt();
      const userMessage = this.buildUserMessage({
        title: issue.title,
        description: issue.descriptionStripped ?? issue.description ?? '',
        members: context.members,
        goals: context.goals,
        recentIssues: context.recentIssues,
        labels: context.labels,
        contextHints: args.contextHints,
      });

      const callPromise = this.router.call({
        taskType: 'issue-infer-fields',
        systemPrompt,
        userMessage,
        tenantId: args.tenantId,
        sourceRef: { type: 'issue', id: issue.id },
        maxTokens: 600,
        // JSON-mode — критично для парсинга. LlmRouter передаст responseFormat провайдеру.
        responseFormat: { type: 'json_object' },
      });

      const result = await this.withTimeout(
        callPromise,
        IssueInferFieldsService.INFER_TIMEOUT_MS,
      );
      const parsed = this.parseResponse(result.text);
      if (!parsed) {
        return null;
      }
      // Валидация ссылочной целостности — фильтруем мусор от LLM.
      const validated = this.validateRefs(parsed, context);
      this.metrics?.incAiIssueInferred({
        tenantTop: tenantTopOf(args.tenantId),
        accepted: 'false',
      });
      return validated;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          issueId: args.issueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'IssueInferFieldsService.inferFields упал — caller получит null',
      );
      return null;
    }
  }

  /**
   * Помечает, что фронт принял подсказку — отдельный счётчик для
   * измерения acceptance rate. Контракт: можно вызвать несколько раз
   * (один раз на каждое applied поле).
   */
  recordAccepted(args: { tenantId: string }): void {
    this.metrics?.incAiIssueInferred({
      tenantTop: tenantTopOf(args.tenantId),
      accepted: 'true',
    });
  }

  // ── private ──

  private async loadProjectContext(
    tenantId: string,
    projectId: string,
  ): Promise<ProjectContext> {
    // Members: смотрим IssueAssignee истории + Project.ownerId + defaultAssigneeId.
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, tenantId },
      select: { ownerId: true, defaultAssigneeId: true, name: true },
    });
    if (!project) {
      return { members: [], goals: [], recentIssues: [], labels: [] };
    }
    // Последние 200 assignee-записей проекта → топ-30 уникальных userId'ов.
    // Имена пользователей загружаем отдельным batch-запросом, потому что
    // у `IssueAssignee` нет relation на `User` в текущей схеме.
    const assigneeRows = await this.prisma.issueAssignee.findMany({
      where: { issue: { projectId, tenantId, deletedAt: null } },
      select: { userId: true },
      take: 200,
      orderBy: { assignedAt: 'desc' },
    });
    const memberMap = new Map<string, { id: string; name: string }>();
    if (project.ownerId) {
      memberMap.set(project.ownerId, {
        id: project.ownerId,
        name: project.ownerId,
      });
    }
    for (const row of assigneeRows) {
      if (!memberMap.has(row.userId)) {
        memberMap.set(row.userId, { id: row.userId, name: row.userId });
      }
      if (memberMap.size >= 30) break;
    }
    if (memberMap.size > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: [...memberMap.keys()] } },
        select: { id: true, name: true },
      });
      for (const u of users) {
        const existing = memberMap.get(u.id);
        if (existing) {
          existing.name = u.name ?? u.id;
        }
      }
    }
    const members = [...memberMap.values()];

    const goals = await this.prisma.goal.findMany({
      where: { tenantId, status: 'active' },
      select: { id: true, name: true, description: true },
      take: 25,
      orderBy: { updatedAt: 'desc' },
    });

    const recentIssues = await this.prisma.issue.findMany({
      where: { tenantId, projectId, deletedAt: null },
      select: {
        identifier: true,
        title: true,
        priority: true,
        dueDate: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const labels = await this.prisma.label.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      take: 50,
    });

    return { members, goals, recentIssues, labels };
  }

  private buildSystemPrompt(): string {
    return [
      'Ты — AI-помощник трекера задач Кора.',
      'Тебе дана новая задача в проекте и контекст: участники проекта, активные цели компании, последние задачи и доступные метки.',
      'Твоя работа — предложить структурированные значения полей задачи: исполнитель, приоритет, дедлайн, цель, метки.',
      'Правила:',
      '— Подсказывай ТОЛЬКО когда уверен (confidence ≥ 0.7). При сомнениях — оставляй поле null.',
      '— assigneeId — выбирай только из членов проекта; не выдумывай.',
      '— goalId — только из списка активных целей.',
      '— labels — короткие фразы (если нет в списке известных меток — допустим, но осторожно).',
      '— priority ∈ urgent|high|medium|low|none.',
      '— dueDate — ISO-8601 (YYYY-MM-DD) или null.',
      'Отвечай строго JSON без markdown/комментариев:',
      '{"suggestedAssigneeId":null|"<userId>","suggestedDueDate":null|"YYYY-MM-DD","suggestedPriority":null|"urgent|high|medium|low|none","suggestedGoalId":null|"<goalId>","suggestedLabels":["..."],"confidence":0.0-1.0,"reasoning":"короткое объяснение"}',
    ].join('\n');
  }

  private buildUserMessage(args: {
    title: string;
    description: string;
    members: ReadonlyArray<{ id: string; name: string }>;
    goals: ReadonlyArray<{ id: string; name: string; description: string }>;
    recentIssues: ReadonlyArray<{
      identifier: string;
      title: string;
      priority: string;
      dueDate: Date | null;
    }>;
    labels: ReadonlyArray<{ id: string; name: string }>;
    contextHints?: string;
  }): string {
    const lines: string[] = [];
    lines.push(`# Новая задача`);
    lines.push(`Title: ${args.title}`);
    if (args.description) {
      lines.push(`Description: ${args.description.slice(0, 2000)}`);
    }
    if (args.contextHints) {
      lines.push(`Дополнительный контекст: ${args.contextHints.slice(0, 1000)}`);
    }
    lines.push('');
    lines.push(`# Участники проекта (id → имя)`);
    for (const m of args.members) lines.push(`- ${m.id} → ${m.name}`);
    lines.push('');
    lines.push(`# Активные цели компании`);
    for (const g of args.goals) {
      const desc = (g.description ?? '').slice(0, 200);
      lines.push(`- ${g.id} → ${g.name}${desc ? ` (${desc})` : ''}`);
    }
    lines.push('');
    lines.push(`# Последние задачи в проекте`);
    for (const i of args.recentIssues) {
      const due = i.dueDate ? i.dueDate.toISOString().slice(0, 10) : '—';
      lines.push(`- ${i.identifier}: ${i.title} (prio=${i.priority}, due=${due})`);
    }
    lines.push('');
    lines.push(`# Доступные метки`);
    lines.push(args.labels.map((l) => `${l.id}:${l.name}`).join(', ') || '(нет)');
    lines.push('');
    lines.push(`Верни JSON.`);
    return lines.join('\n');
  }

  private parseResponse(text: string): RawSuggestion | null {
    try {
      const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
      const obj = JSON.parse(cleaned) as Record<string, unknown>;
      const conf = typeof obj.confidence === 'number' ? obj.confidence : 0;
      return {
        suggestedAssigneeId:
          typeof obj.suggestedAssigneeId === 'string'
            ? obj.suggestedAssigneeId
            : null,
        suggestedDueDate:
          typeof obj.suggestedDueDate === 'string'
            ? obj.suggestedDueDate
            : null,
        suggestedPriority:
          typeof obj.suggestedPriority === 'string'
            ? obj.suggestedPriority
            : null,
        suggestedGoalId:
          typeof obj.suggestedGoalId === 'string'
            ? obj.suggestedGoalId
            : null,
        suggestedLabels: Array.isArray(obj.suggestedLabels)
          ? (obj.suggestedLabels as unknown[]).filter(
              (v): v is string => typeof v === 'string',
            )
          : [],
        confidence: Math.max(0, Math.min(1, conf)),
        reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : null,
      };
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'IssueInferFieldsService: не удалось распарсить ответ LLM',
      );
      return null;
    }
  }

  /** Фильтрация мусора: assignee и goal должны быть из контекста. */
  private validateRefs(
    raw: RawSuggestion,
    ctx: ProjectContext,
  ): IssueInferFieldsResult {
    const memberIds = new Set(ctx.members.map((m) => m.id));
    const goalIds = new Set(ctx.goals.map((g) => g.id));
    const validPriorities = new Set([
      'urgent',
      'high',
      'medium',
      'low',
      'none',
    ]);
    const assignee = raw.suggestedAssigneeId && memberIds.has(raw.suggestedAssigneeId)
      ? raw.suggestedAssigneeId
      : null;
    const goal = raw.suggestedGoalId && goalIds.has(raw.suggestedGoalId)
      ? raw.suggestedGoalId
      : null;
    const priority = raw.suggestedPriority && validPriorities.has(raw.suggestedPriority)
      ? raw.suggestedPriority
      : null;
    // dueDate валидируем как ISO-8601 (YYYY-MM-DD).
    let due: string | null = null;
    if (raw.suggestedDueDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.suggestedDueDate)) {
      const d = new Date(raw.suggestedDueDate);
      if (!Number.isNaN(d.getTime())) due = raw.suggestedDueDate;
    }
    return {
      suggestedAssigneeId: assignee,
      suggestedDueDate: due,
      suggestedPriority: priority,
      suggestedGoalId: goal,
      suggestedLabels: raw.suggestedLabels.slice(0, 8),
      confidence: raw.confidence,
      meetsThreshold: raw.confidence >= IssueInferFieldsService.MIN_CONFIDENCE,
      reasoning: raw.reasoning,
    };
  }

  private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`IssueInferFields timeout ${ms}ms`)),
        ms,
      );
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

interface ProjectContext {
  members: Array<{ id: string; name: string }>;
  goals: Array<{ id: string; name: string; description: string }>;
  recentIssues: Array<{
    identifier: string;
    title: string;
    priority: string;
    dueDate: Date | null;
  }>;
  labels: Array<{ id: string; name: string }>;
}

interface RawSuggestion {
  suggestedAssigneeId: string | null;
  suggestedDueDate: string | null;
  suggestedPriority: string | null;
  suggestedGoalId: string | null;
  suggestedLabels: string[];
  confidence: number;
  reasoning: string | null;
}

export interface IssueInferFieldsResult {
  suggestedAssigneeId: string | null;
  suggestedDueDate: string | null;
  suggestedPriority: string | null;
  suggestedGoalId: string | null;
  suggestedLabels: string[];
  confidence: number;
  /** True если confidence ≥ 0.7 — caller рекомендует показать подсказки. */
  meetsThreshold: boolean;
  reasoning: string | null;
}
