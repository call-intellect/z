import { createHash } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import type {
  DialogTurn,
  RoomChatMessage,
} from '../../ai/services/prompts/common';
import {
  buildMeetingExtractActionsPrompt,
  type MeetingExtractActionsContext,
  TASKS_SCHEMA,
  TASKS_TOOL_NAME,
} from '../../ai/services/prompts/tasks';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';

import { IntakeAutoTriageQueueService } from './intake-auto-triage-queue.service';

/**
 * Wave 3 / Tracker Phase 3 part B (2026-05-24) — MeetingExtractActionsService.
 *
 * Извлекает структурированные «автозадачи» из встречи. Цель — превратить
 * упоминания поручений в транскрипте в `IntakeIssue` (со статусом
 * 'pending') с предзаполненными `suggested*` полями. Дальше двумя путями:
 *   - `IntakeAutoTriageWorker` (отдельный воркер) при высокой confidence
 *     автоматически примет такой intake и создаст Issue;
 *   - либо человек подтвердит вручную в `/intake`.
 *
 * Сервис вызывается:
 *   - из `analyze.worker` после ai_ready (auto, best-effort);
 *   - вручную (например, из admin UI) через тот же метод `extract`.
 *
 * Идемпотентность: для каждой выделенной задачи считается хэш
 * `sha1(meetingId + sourceQuote)` → используется как `externalId` IntakeIssue.
 * Повторный вызов сервиса для той же встречи не создаст дублей. Если LLM
 * вернул чуть другую цитату (типовая беда non-deterministic LLM) — будет
 * другой externalId, поэтому повторные runs могут давать новые intake'ы.
 * Это лечится скриптами очистки, либо человек закроет дубль вручную.
 */
@Injectable()
export class MeetingExtractActionsService implements OnModuleInit {
  private readonly logger = new Logger(MeetingExtractActionsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(IntakeAutoTriageQueueService)
    private readonly autoTriageQueue?: IntakeAutoTriageQueueService,
  ) {}

  onModuleInit(): void {
    this.logger.log('MeetingExtractActionsService готов');
  }

  /**
   * Главный метод. Идемпотентный. Best-effort: на любую ошибку LLM
   * возвращает пустой массив, инкрементирует метрику 'llm_error' и не
   * бросает (analyze.worker не должен падать из-за нашего шага).
   */
  async extract(args: {
    tenantId: string;
    meetingId: string;
  }): Promise<Array<{ id: string; title: string; confidence: number | null }>> {
    const { tenantId, meetingId } = args;
    const tenantTop = tenantTopOf(tenantId);

    // 1. Подтягиваем встречу + транскрипт + AiResult.
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, tenantId },
      include: { transcript: true, aiResult: true },
    });
    if (!meeting) {
      this.logger.debug(
        { meetingId, tenantId },
        'meeting-extract-actions: встреча не найдена в текущем tenant',
      );
      return [];
    }
    const turns =
      (meeting.transcript?.turns as unknown as DialogTurn[] | null) ?? [];
    const roomChat =
      (meeting.transcript?.roomChat as unknown as RoomChatMessage[] | null) ??
      undefined;
    if (turns.length === 0) {
      this.logger.debug(
        { meetingId },
        'meeting-extract-actions: нет turns в транскрипте — пропуск',
      );
      this.metrics?.incAiMeetingActionsExtracted({
        tenantTop,
        status: 'llm_empty',
        by: 1,
      });
      return [];
    }

    // 2. Контекст организации (проекты, цели, известные сотрудники).
    const ctx = await this.loadOrgContext(tenantId, meeting.startedAt);

    // 3. Промпт + LLM.
    const prompt = buildMeetingExtractActionsPrompt(
      {
        meeting: {
          id: meeting.id,
          title: meeting.title,
          type: meeting.type,
          startedAt: meeting.startedAt,
          endedAt: meeting.endedAt,
        },
        dialog: turns,
        ...(roomChat ? { roomChat } : {}),
      },
      ctx,
    );

    let parsedTasks:
      | Array<{
          title: string;
          assignee: string | null;
          dueDate: string | null;
          suggestedAssigneeHint?: string | null;
          suggestedDueDate?: string | null;
          suggestedPriority?:
            | 'urgent'
            | 'high'
            | 'medium'
            | 'low'
            | null;
          confidence?: number;
          sourceQuote?: string;
        }>
      | null = null;
    try {
      const result = await this.llm.call({
        taskType: 'meeting-extract-actions',
        tenantId,
        meetingId,
        systemPrompt: prompt.system,
        userMessage: prompt.user,
        responseFormat: {
          type: 'json_schema',
          name: TASKS_TOOL_NAME,
          schema: {
            type: 'object',
            properties: {
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    assignee: { type: ['string', 'null'] },
                    dueDate: { type: ['string', 'null'] },
                    suggestedAssigneeHint: { type: ['string', 'null'] },
                    suggestedDueDate: { type: ['string', 'null'] },
                    suggestedPriority: {
                      type: ['string', 'null'],
                      enum: ['urgent', 'high', 'medium', 'low', null],
                    },
                    confidence: {
                      type: 'number',
                      minimum: 0,
                      maximum: 1,
                    },
                    sourceQuote: { type: 'string' },
                  },
                  required: ['title', 'assignee', 'dueDate'],
                },
              },
            },
            required: ['tasks'],
          },
          strict: true,
        },
        dataClass: 'internal',
        sourceRef: { type: 'meeting', id: meetingId },
      });
      const json = JSON.parse(result.text) as unknown;
      const validated = TASKS_SCHEMA.safeParse(json);
      if (validated.success) {
        parsedTasks = validated.data.tasks;
      } else {
        this.logger.warn(
          { meetingId, err: validated.error?.message },
          'meeting-extract-actions: LLM JSON не прошёл zod schema',
        );
      }
    } catch (err) {
      this.logger.warn(
        {
          meetingId,
          err: err instanceof Error ? err.message : String(err),
        },
        'meeting-extract-actions: LLM упал — пропуск',
      );
      this.metrics?.incAiMeetingActionsExtracted({
        tenantTop,
        status: 'llm_error',
      });
      return [];
    }

    if (!parsedTasks || parsedTasks.length === 0) {
      this.metrics?.incAiMeetingActionsExtracted({
        tenantTop,
        status: 'llm_empty',
      });
      return [];
    }

    // 4. Маппинг hint'ов → suggestedAssigneeId / suggestedProjectId /
    //    suggestedGoalId. Resolver — встроенный, без отдельного сервиса
    //    (см. resolveAssigneeId / resolveProjectId / resolveGoalId).
    const created: Array<{
      id: string;
      title: string;
      confidence: number | null;
    }> = [];
    let skipped = 0;
    for (const t of parsedTasks) {
      const sourceQuote = (t.sourceQuote ?? '').trim();
      const title = t.title.trim();
      if (!title) continue;
      // Идемпотентный externalId = sha1(meetingId + sourceQuote || title).
      const externalId = this.makeExternalId(meetingId, sourceQuote || title);
      const existing = await this.prisma.intakeIssue.findFirst({
        where: {
          tenantId,
          source: 'meeting',
          externalSource: 'meeting',
          externalId,
        },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const suggestedAssigneeId = await this.resolveAssigneeId(
        tenantId,
        t.suggestedAssigneeHint ?? t.assignee,
      );
      const suggestedProjectId = await this.resolveProjectIdByMeeting(
        tenantId,
        meeting.title,
        meeting.cardId,
      );
      const suggestedGoalId: string | null = null; // GoalHint в нашем prompt'е
      // не реализован — vNext (добавим goalHint field). На текущем этапе —
      // оставляем null; IntakeAutoTriageWorker может попробовать дозаполнить.
      const suggestedPriority = t.suggestedPriority ?? null;
      const suggestedDueDate = this.parseIsoDate(t.suggestedDueDate ?? null);
      const confidenceDecimal: Prisma.Decimal | null =
        typeof t.confidence === 'number'
          ? new Prisma.Decimal(clampConfidence(t.confidence))
          : null;

      const rawContent =
        sourceQuote.length > 0
          ? `${title}\n\nЦитата: ${sourceQuote}`
          : title;
      const issue = await this.prisma.intakeIssue.create({
        data: {
          tenantId,
          projectId: suggestedProjectId,
          status: 'pending',
          source: 'meeting',
          externalSource: 'meeting',
          externalId,
          rawContent,
          extractedTitle: title,
          extractedDescription: sourceQuote || null,
          suggestedProjectId,
          suggestedAssigneeId,
          suggestedGoalId,
          suggestedPriority,
          suggestedDueDate,
          suggestedLabels: [],
          confidence: confidenceDecimal,
        },
        select: { id: true },
      });
      created.push({
        id: issue.id,
        title,
        confidence:
          typeof t.confidence === 'number'
            ? clampConfidence(t.confidence)
            : null,
      });

      // Enqueue auto-triage (best-effort). Worker ещё раз перепроверит
      // suggested* и при высокой confidence создаст Issue автоматически.
      if (this.autoTriageQueue) {
        try {
          await this.autoTriageQueue.enqueue({
            tenantId,
            intakeIssueId: issue.id,
          });
        } catch (e) {
          this.logger.warn(
            {
              intakeIssueId: issue.id,
              err: e instanceof Error ? e.message : String(e),
            },
            'meeting-extract-actions: enqueue auto-triage упал — продолжаем',
          );
        }
      }
    }

    this.metrics?.incAiMeetingActionsExtracted({
      tenantTop,
      status: 'created',
      by: created.length,
    });
    if (skipped > 0) {
      this.metrics?.incAiMeetingActionsExtracted({
        tenantTop,
        status: 'skipped_idempotent',
        by: skipped,
      });
    }
    this.logger.log(
      { meetingId, created: created.length, skipped },
      'meeting-extract-actions: готово',
    );
    return created;
  }

  // ─────────────────────────── helpers ───────────────────────────────

  private makeExternalId(meetingId: string, key: string): string {
    const h = createHash('sha1');
    h.update(meetingId);
    h.update(' ');
    h.update(key);
    return `mea_${h.digest('hex').slice(0, 24)}`;
  }

  /**
   * Маппинг assigneeHint → User.id через Person.
   *
   * Текущая логика: ищем Person в org по case-insensitive substring (часть
   * ФИО, например "Иванов" совпадёт с "Иванов Сергей"). На multiple match
   * — null (нужен человеческий триаж). На no match — null.
   *
   * vNext: подключить полноценный AssigneeResolverService (когда появится).
   */
  private async resolveAssigneeId(
    tenantId: string,
    hint: string | null | undefined,
  ): Promise<string | null> {
    const trimmed = (hint ?? '').trim();
    if (trimmed.length < 2) return null;
    // Лёгкий поиск — берём первое слово (фамилию или имя) и ищем по name LIKE.
    const firstToken = trimmed.split(/\s+/)[0] ?? '';
    if (firstToken.length < 2) return null;
    const candidates = await this.prisma.person.findMany({
      where: {
        tenantId,
        deletedAt: null,
        name: { contains: firstToken, mode: 'insensitive' },
      },
      take: 5,
      select: { id: true, userId: true, name: true },
    });
    if (candidates.length === 0) return null;
    // Если ровно один match — возвращаем userId (suggestedAssigneeId — это
    // User.id, потому что Issue.assigneeUserIds[] = User.id).
    const single =
      candidates.length === 1
        ? candidates[0]
        : candidates.find(
            (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
          ) ?? null;
    return single?.userId ?? null;
  }

  /**
   * Маппинг проекта по теме встречи + cardId.
   *
   * Текущая логика: если meeting.cardId есть — смотрим, привязана ли карточка
   * к какому-то projectId через cardSummaryCache (поле не существует в
   * простом виде — vNext). На MVP: ищем по identifier'у проекта в
   * meeting.title (например "DEV — Спринт 21" → DEV).
   */
  private async resolveProjectIdByMeeting(
    tenantId: string,
    title: string,
    _cardId: string | null,
  ): Promise<string | null> {
    if (!title) return null;
    const tokens = title.match(/[A-ZА-Я][A-ZА-Я0-9-]{1,5}/gu) ?? [];
    for (const tok of tokens) {
      const p = await this.prisma.project.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          archivedAt: null,
          identifier: { equals: tok, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (p) return p.id;
    }
    return null;
  }

  private async loadOrgContext(
    tenantId: string,
    meetingStartedAt: Date | null,
  ): Promise<MeetingExtractActionsContext> {
    const [projects, goals, people] = await Promise.all([
      this.prisma.project.findMany({
        where: { tenantId, deletedAt: null, archivedAt: null },
        select: { identifier: true, name: true },
        take: 40,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.goal.findMany({
        where: {
          tenantId,
          archivedAt: null,
          status: 'active',
        },
        select: { name: true },
        take: 30,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.person.findMany({
        where: { tenantId, deletedAt: null, relationship: 'employee' },
        select: { name: true },
        take: 60,
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      projects,
      goals,
      people: people.map((p) => ({ name: p.name, role: null })),
      meetingDateIso: meetingStartedAt
        ? meetingStartedAt.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
    };
  }

  private parseIsoDate(s: string | null | undefined): Date | null {
    if (!s) return null;
    // YYYY-MM-DD или полный ISO; разрешаем оба.
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (!m) return null;
    const d = new Date(`${m[1]}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

}

function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  // 3 знака — соответствует БД Decimal(4,3).
  return Math.round(v * 1000) / 1000;
}
