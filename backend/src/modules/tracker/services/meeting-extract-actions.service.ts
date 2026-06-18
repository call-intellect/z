import { createHash } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tryParseJson } from '../../ai/services/json-extract.util';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { OrgContextService } from '../../ai/services/org-context.service';
import { ParticipantContextService } from '../../ai/services/participant-context.service';
import type {
  DialogTurn,
  RoomChatMessage,
} from '../../ai/services/prompts/common';
import { withAsrNote } from '../../ai/services/prompts/common';
import {
  buildMeetingExtractActionsPrompt,
  TASKS_SCHEMA,
  TASKS_TOOL_NAME,
} from '../../ai/services/prompts/tasks';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { BlockFetchService } from '../../knowledge-core/services/block-fetch.service';
import { TaskAssigneeResolverService } from '../../knowledge-core/services/task-assignee-resolver.service';
import { computeExpiresAt } from '../../pending-actions/expires-at.util';

import { IntakeAutoTriageQueueService } from './intake-auto-triage-queue.service';
import { shouldMaterializeTask } from './task-quality-gate.util';

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
    // ТЗ 2026-06-04 meeting-identity-and-clones-attribution, Фаза 5.1 —
    // резолв исполнителя по IDENTITY УЧАСТНИКОВ встречи (а не substring по
    // Person.name по всему тенанту). Оба сервиса — из @Global модулей
    // (AiModule / KnowledgeCoreModule), паттерн скопирован из
    // `meeting-report-fast.worker.ts`.
    @Inject(ParticipantContextService)
    private readonly participantContext: ParticipantContextService,
    // ТЗ-4 Ф3 — общий загрузчик org-контекста (вынесен из приватного
    // loadOrgContext). Чистый реюз: поведение tasks-пути не меняется.
    @Inject(OrgContextService)
    private readonly orgContext: OrgContextService,
    @Inject(TaskAssigneeResolverService)
    private readonly assigneeResolver: TaskAssigneeResolverService,
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(IntakeAutoTriageQueueService)
    private readonly autoTriageQueue?: IntakeAutoTriageQueueService,
    // A10 (2026-06-14) — провенанс автозадач: canonical-блоки встречи →
    // IntakeIssue.sourceBlockIds → DecisionTaskLink('derived') при авто-приёме.
    // @Optional (как в IntakeService) — best-effort, без него провенанс пуст.
    // Стоит ПОСЛЕДНИМ в списке, чтобы не сдвигать позиционные аргументы в
    // существующих unit-тестах (они конструируют сервис вручную).
    @Optional()
    @Inject(BlockFetchService)
    private readonly blockFetch?: BlockFetchService,
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
    const ctx = await this.orgContext.load(tenantId, meeting.startedAt);

    // 2b. Участники встречи (с identity — после Ф0.2 включает приглашённых
    // сотрудников). Используются для жёсткого резолва исполнителя задачи:
    // матч имени/userId ТОЛЬКО среди тех, кто реально был на встрече.
    const participants = await this.participantContext.loadForMeeting(meetingId);

    // 2c. A10 (2026-06-14) — провенанс автозадач (canonical action-блоки
    // встречи). Резолвим один раз на встречу; пишем в каждый IntakeIssue, чтобы
    // при авто-приёме родился DecisionTaskLink('derived'). Best-effort.
    const meetingSourceBlockIds = await this.resolveMeetingSourceBlockIds(
      meetingId,
      tenantId,
    );

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
        // ТЗ-4 Ф2 — ASR-нота дописывается В КОНЕЦ system (cache-friendly):
        // вход — сырое распознавание речи, просим восстанавливать смысл по
        // контексту и нормализовать числа.
        systemPrompt: withAsrNote(prompt.system),
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
        // #73 — HTTP-200 с телом, которое не парсится/не проходит схему, НЕ
        // считаем успехом: роутер перейдёт к следующему провайдеру в каскаде.
        validate: (text) => TASKS_SCHEMA.safeParse(tryParseJson(text)).success,
        dataClass: 'internal',
        sourceRef: { type: 'meeting', id: meetingId },
      });
      // #73 — tryParseJson снимает ```json-обёртку и достаёт первый {…}, чтобы
      // markdown-обёрнутый ответ не терялся (голый JSON.parse падал на fence).
      const json = tryParseJson(result.text);
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

      // Ф5.1 — резолв исполнителя по identity участников встречи через общий
      // TaskAssigneeResolverService (тот же сервис, что в meeting-report-fast).
      // LLM `assigneeUserId` не отдаёт → стартуем с null; матч только по
      // assigneeRaw среди участников. Тёзка не из встречи / гость → null.
      const suggestedAssigneeId =
        this.assigneeResolver.resolve(
          [
            {
              assigneeRaw: t.suggestedAssigneeHint ?? t.assignee ?? null,
              assigneeUserId: null,
            },
          ],
          participants,
          tenantId,
        )[0]?.assigneeUserId ?? null;
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

      // Ф0 (ТЗ 2026-06-16) — детерминированный гейт качества ПЕРЕД созданием
      // задачи из AI-источника: не материализуем «мусор» (вопрос/намерение без
      // ответственного и срока). Чистые правила, без LLM. При сомнении —
      // пропускаем создание, поток не падает.
      const gate = shouldMaterializeTask({
        title,
        ownerUserId: suggestedAssigneeId,
        ownerHint: t.suggestedAssigneeHint ?? t.assignee ?? null,
        dueDate: suggestedDueDate,
        source: 'meeting',
      });
      if (!gate.ok) {
        skipped++;
        this.logger.log(
          { meetingId, reason: gate.reason, title },
          'meeting-extract-actions: гейт качества не пропустил задачу',
        );
        continue;
      }

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
          // A10 (2026-06-14) — провенанс встречи (для DecisionTaskLink derived).
          sourceBlockIds: meetingSourceBlockIds,
          // Фикс linkedMeetingIds 2026-06-17 — хранить для прокидки в Issue.
          meetingId,
          confidence: confidenceDecimal,
          // Редизайн Ф4 (2026-06-13) — авто-протухание: sweep-крон закроет
          // pending-intake после TTL (cfg.pendingActions.intakeTtlDays).
          // TODO: крутилка позже уедет в AdminSetting UI.
          expiresAt: computeExpiresAt(this.cfg.pendingActions.intakeTtlDays),
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

  private parseIsoDate(s: string | null | undefined): Date | null {
    if (!s) return null;
    // YYYY-MM-DD или полный ISO; разрешаем оба.
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (!m) return null;
    const d = new Date(`${m[1]}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * A10 (2026-06-14) — провенанс автозадач: action-несущие canonical-блоки
   * встречи (commitment / plan_item / task_created / decision), которые и
   * пересекаются с `Decision.sourceBlockIds`. Best-effort: нет BlockFetchService
   * / RawEvent / блоков → пустой массив, не бросает (analyze.worker не падает).
   */
  private async resolveMeetingSourceBlockIds(
    meetingId: string,
    tenantId: string,
  ): Promise<string[]> {
    if (!this.blockFetch) return [];
    try {
      const blocks = await this.blockFetch.getCanonicalBlocksForMeeting(
        meetingId,
        tenantId,
      );
      const ACTION_SIGNALS = new Set([
        'commitment',
        'plan_item',
        'task_created',
        'decision',
      ]);
      return blocks
        .filter((b) => ACTION_SIGNALS.has(b.signalType))
        .map((b) => b.id)
        .slice(0, 64);
    } catch (e) {
      this.logger.warn(
        { meetingId, err: e instanceof Error ? e.message : String(e) },
        'meeting-extract-actions: резолв sourceBlockIds упал — пустой провенанс',
      );
      return [];
    }
  }

}

function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  // 3 знака — соответствует БД Decimal(4,3).
  return Math.round(v * 1000) / 1000;
}
