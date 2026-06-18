import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, type Issue } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import type { CreateIssueDto } from '../dto/issues/create-issue.dto';
import type {
  IssueActivityDto,
  IssueAiSuggestionsDto,
  IssueChildResponseDto,
  IssueChildrenResponseDto,
  IssueResponseDto,
  IssueVersionDto,
  ListIssuesResponse,
  MyInboxCountDto,
  MyInboxResponseDto,
} from '../dto/issues/issue-response.dto';
import type { ListIssuesQuery } from '../dto/issues/list-issues-query.dto';
import type { ListOrgIssuesQuery } from '../dto/issues/list-org-issues-query.dto';
import type { MyInboxQuery } from '../dto/issues/my-inbox-query.dto';
import type { TransitionIssueStateDto } from '../dto/issues/transition-state.dto';
import type { UpdateIssueDto } from '../dto/issues/update-issue.dto';

import { ActivityRecorderService } from './activity-recorder.service';
import { BoardsService } from './boards.service';
import { HolidayService } from './holiday.service';
import { IssueEmbedQueueService } from './issue-embed-queue.service';
import { IssueGoalSuggestService } from './issue-goal-suggest.service';
import { IssueInferFieldsService } from './issue-infer-fields.service';
import { ProjectsService } from './projects.service';
import { TaskDedupService } from './task-dedup.service';
import { TrackerEmitterService } from './tracker-emitter.service';
import { TrackerEventsService } from './tracker-events.service';
import { WebhookDispatcher } from './webhook-dispatcher.service';

/**
 * IssuesService — ядро трекера. Создание / обновление / переходы статусов /
 * комментарии-связи / лента активности. Все мутации пишутся в IssueActivity
 * через ActivityRecorderService (видимое аудиторное наследие = вход для второго мозга).
 *
 * Доступ: проверяется в контроллере через RbacService.canRead/canWrite('issue').
 * Tenant-scope обязателен на всех методах.
 */
@Injectable()
export class IssuesService {
  private readonly logger = new Logger(IssuesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(TrackerEventsService)
    private readonly events: TrackerEventsService,
    @Inject(WebhookDispatcher)
    private readonly webhooks: WebhookDispatcher,
    @Inject(TrackerEmitterService)
    private readonly emitter: TrackerEmitterService,
    // Tracker Phase 3 (Sprint 6, 2026-05-24) — best-effort enqueue в
    // `core.issue-embed`. Optional: позволяет unit-тестам сервиса работать
    // без Redis/BullMQ и не падать, если очередь временно не инжектится.
    @Optional()
    @Inject(IssueEmbedQueueService)
    private readonly embedQueue?: IssueEmbedQueueService,
    // Tracker Phase 3 part C (2026-05-24) — AI-suggest. Optional: модуль может
    // быть инициализирован без LLM-зависимостей (unit-тесты, dev-окружение
    // без LlmRouter). Если сервисы не инжектятся — `inferSuggestions=true`
    // просто не вернёт `aiSuggestions`, основной flow продолжает работать.
    @Optional()
    @Inject(IssueInferFieldsService)
    private readonly inferFieldsSvc?: IssueInferFieldsService,
    @Optional()
    @Inject(IssueGoalSuggestService)
    private readonly goalSuggestSvc?: IssueGoalSuggestService,
    // Wave 3 finishing (Sprint 10, 2026-05-24) — учёт производственного
    // календаря РФ при создании/обновлении задачи. Optional: модуль может
    // быть собран без HolidayService (unit-тесты, dev-окружение без БД-сидов).
    // Если сервис недоступен — `dueDate` сохраняется ровно как передал клиент
    // (никаких сдвигов). Флаг `dto.respectHolidays !== false` — default-on.
    @Optional()
    @Inject(HolidayService)
    private readonly holidayService?: HolidayService,
    // Tracker Boards (2026-05-27) — резолв default-доски проекта на create
    // (если фронт не передал `boardId`) и валидация целевой доски на PATCH.
    // Optional: unit-тесты `IssuesService` без BoardsService → `boardId`
    // сохраняется как есть (если передан) или null (если нет).
    @Optional()
    @Inject(BoardsService)
    private readonly boards?: BoardsService,
    // Tracker (2026-05-27) — Prometheus-метрики: subtasks_created_total,
    // board_issues_moved_total. Optional: unit-тесты без MetricsModule.
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    // TZ task-dedup (2026-06-16, Ф1 уровень B) — дедуп-гейт прямого create
    // (email-inbox / self-task в обход intake). @Optional: unit-тесты
    // IssuesService строятся без него → дедуп пропускается, задача создаётся
    // как есть. Только suggest (IssueRelation('duplicates')), не блокирует.
    @Optional()
    @Inject(TaskDedupService)
    private readonly taskDedup?: TaskDedupService,
  ) {}

  /**
   * Создать задачу. Атомарно: генерирует sequenceId (max+1 в проекте),
   * identifier=`{project.identifier}-{sequenceId}`, проставляет defaultStateId,
   * создаёт IssueAssignee/IssueLabel, пишет IssueActivity verb='created'.
   */
  async create(
    projectId: string,
    dto: CreateIssueDto,
    tenantId: string,
    userId: string,
  ): Promise<IssueResponseDto> {
    const project = await this.projects.requireProject(projectId, tenantId);
    // Если stateId не передан — используем defaultStateId проекта.
    const stateId = dto.stateId ?? project.defaultStateId ?? null;
    if (dto.stateId) await this.requireStateInProject(dto.stateId, projectId);

    // Tracker subtasks UI (2026-05-27) — валидация parentId при создании
    // перенесена ВНУТРЬ $transaction (audit-fixes Б9): TOCTOU race
    // между check parentId и create issue. См. блок ниже в $transaction.

    // Tracker Boards (2026-05-27) — резолвим boardId:
    //   1. Если фронт явно передал boardId — валидируем, что доска в этом проекте.
    //   2. Иначе — берём default-доску проекта (ленивая инициализация).
    //   3. Если BoardsService не инжектился (unit-тест без Boards) — boardId=null.
    const boardId = await this.resolveBoardIdForCreate({
      tenantId,
      projectId,
      explicitBoardId: dto.boardId ?? null,
    });

    // Wave 3 finishing (Sprint 10) — сдвигаем dueDate на ближайший рабочий
    // день, если попал на праздник/выходной. По умолчанию ВКЛ (default-on);
    // выключается явным `respectHolidays=false` в DTO. Если HolidayService
    // не инжектился (Optional) — оставляем `dueDate` как есть.
    const adjustedDueDate = await this.maybeAdjustDueDate({
      tenantId,
      dueDate: dto.dueDate ?? null,
      respectHolidays: dto.respectHolidays,
    });

    // TZ task-dedup (2026-06-16, Ф1 уровень B) — дедуп-гейт ПЕРЕД транзакцией
    // для прямого create (email/self-task). Best-effort (R4): сбой → 'nil'.
    // verdict='same' → создаём задачу как обычно, затем заводим
    // IssueRelation('duplicates') как ПОДСКАЗКУ (не блокируем создание, R2/R13).
    // skipDedup ставят внутренние caller'ы intake (уже прошли дедуп уровня A).
    let dedupMatchedIssueId: string | null = null;
    if (this.taskDedup && !dto.skipDedup) {
      const dedup = await this.taskDedup.evaluate({
        tenantId,
        title: dto.title,
        description: dto.descriptionStripped ?? dto.description ?? null,
      });
      if (dedup.verdict === 'same') {
        dedupMatchedIssueId = dedup.matchedIssueId;
      }
    }

    const issue = await this.prisma.$transaction(async (tx) => {
      // audit-fixes Б9: валидация родителя ВНУТРИ tx с advisory_xact_lock.
      // Защищает от TOCTOU race (parent удалён/перевешен между check и create).
      if (dto.parentId) {
        await this.validateParentForIssue({
          candidateParentId: dto.parentId,
          projectId,
          tenantId,
          currentIssueId: null,
          tx,
        });
      }

      // Атомарный sequenceId: max+1 per project (узкая зона гонок снимется
      // unique-constraint'ом @@unique([projectId, sequenceId]) — при retry-ит
      // upstream через идемпотентность Sprint 2).
      const maxRow = await tx.issue.aggregate({
        where: { projectId },
        _max: { sequenceId: true },
      });
      const sequenceId = (maxRow._max.sequenceId ?? 0) + 1;
      const identifier = `${project.identifier}-${sequenceId}`;

      const created = await tx.issue.create({
        data: {
          tenantId,
          projectId,
          identifier,
          sequenceId,
          title: dto.title,
          description: dto.description ?? null,
          descriptionHtml: dto.descriptionHtml ?? null,
          descriptionStripped: dto.descriptionStripped ?? null,
          priority: dto.priority,
          stateId,
          parentId: dto.parentId ?? null,
          estimatePoints: dto.estimatePoints ?? null,
          sortOrder: dto.sortOrder,
          startDate: dto.startDate ?? null,
          dueDate: adjustedDueDate,
          cycleId: dto.cycleId ?? null,
          goalId: dto.goalId ?? null,
          // Tracker Boards (2026-05-27) — boardId резолвится выше.
          boardId,
          // A10 (2026-06-14) — провенанс из intake (см. промоут intake→Issue):
          // прокидывается для последующего DecisionTaskLink('derived').
          ...(dto.sourceBlockIds && dto.sourceBlockIds.length > 0
            ? { sourceBlockIds: dto.sourceBlockIds }
            : {}),
          ...(dto.linkedMeetingIds && dto.linkedMeetingIds.length > 0
            ? { linkedMeetingIds: dto.linkedMeetingIds }
            : {}),
          externalSource: dto.externalSource ?? null,
          externalId: dto.externalId ?? null,
          createdById: userId,
          createdManually: true,
        },
      });

      // Assignees.
      if (dto.assigneeUserIds.length > 0) {
        await tx.issueAssignee.createMany({
          data: dto.assigneeUserIds.map((uid) => ({
            issueId: created.id,
            userId: uid,
            assignedById: userId,
          })),
          skipDuplicates: true,
        });
      }
      // Labels — проверим, что они принадлежат tenant'у (защита от cross-tenant).
      if (dto.labelIds.length > 0) {
        const valid = await tx.label.findMany({
          where: { id: { in: dto.labelIds }, tenantId },
          select: { id: true },
        });
        if (valid.length !== dto.labelIds.length) {
          throw new BadRequestException({
            ok: false,
            error: {
              code: 'invalid_label_ids',
              message: 'Часть меток не принадлежит организации или не найдена',
            },
          });
        }
        await tx.issueLabel.createMany({
          data: dto.labelIds.map((labelId) => ({ issueId: created.id, labelId })),
          skipDuplicates: true,
        });
      }

      // IssueActivity verb='created'.
      await this.activity.record({
        tenantId,
        issueId: created.id,
        actorUserId: userId,
        actorType: 'user',
        verb: 'created',
        newValue: { title: created.title, identifier: created.identifier },
        tx,
      });
      return created;
    });

    const response = await this.assemble(issue.id, tenantId);

    // TZ task-dedup (2026-06-16, Ф1 уровень B) — кандидат-подсказка дубля:
    // связь IssueRelation('duplicates') от новой задачи к найденной открытой.
    // Подтверждает существование, НЕ блокирует и НЕ сливает (R2/R13). Best-effort:
    // ошибка/гонка @@unique не валит создание. Self-ссылку не заводим.
    if (dedupMatchedIssueId && dedupMatchedIssueId !== issue.id) {
      try {
        await this.prisma.issueRelation.create({
          data: {
            sourceIssueId: issue.id,
            targetIssueId: dedupMatchedIssueId,
            relationType: 'duplicates',
            createdById: userId,
          },
        });
        this.logger.log(
          { issueId: issue.id, duplicateOfIssueId: dedupMatchedIssueId },
          'issues.create: дедуп-арбитр нашёл дубль — заведена связь duplicates (suggest)',
        );
      } catch (e) {
        this.logger.warn(
          {
            issueId: issue.id,
            err: e instanceof Error ? e.message : String(e),
          },
          'issues.create: не удалось завести связь duplicates (best-effort)',
        );
      }
    }
    // Tracker subtasks UI (2026-05-27) — отдельный счётчик подзадач, чтобы
    // в Grafana отделить «корневые» задачи от подзадач. Метрика
    // `subtasks_created_total{tenant, project}`.
    if (issue.parentId) {
      try {
        this.metrics?.incSubtaskCreated({
          tenant: tenantId,
          project: projectId,
        });
      } catch (e) {
        this.logger.warn(
          {
            issueId: issue.id,
            err: e instanceof Error ? e.message : String(e),
          },
          'subtasks_created_total inc failed (best-effort)',
        );
      }
    }
    // WS + outgoing webhooks (fire-and-forget; ошибки доставки логируются
    // самим dispatcher/events service'ом, не пропагируются).
    this.events.publishIssueCreated(response, tenantId);
    // Sprint 3 B1-3.1 — ingest в knowledge-core через event-emitter.
    // ПОСЛЕ транзакции (issue уже в БД, безопасно эмитить).
    this.emitter.emitIssueCreated(issue, userId);
    // Phase 3 (2026-05-24) — best-effort enqueue embedding pipeline.
    // Не блокирует основной flow; ошибка enqueue → warn, embedding
    // появится при следующем update текста.
    void this.enqueueEmbed(tenantId, issue.id, null);
    void this.webhooks
      .dispatch(tenantId, 'issue.created', { issue: response })
      .catch((e) => {
        this.logger.warn(
          { issueId: response.id, err: e instanceof Error ? e.message : String(e) },
          'issue.created webhook dispatch failed',
        );
      });

    // Tracker Phase 3 part C — AI-suggest по флагу `inferSuggestions`.
    // Best-effort: ошибки/таймаут не блокируют создание задачи; в этом случае
    // `aiSuggestions` остаётся `null`/отсутствует. Goal-suggest требует
    // embedding'а для KNN — он генерируется асинхронно, поэтому первый
    // вызов goalSuggest вернёт результат только если embedding уже успел
    // посчитаться (или сработает LLM-fallback).
    if (dto.inferSuggestions) {
      const aiSuggestions = await this.collectAiSuggestions(
        issue.id,
        tenantId,
      );
      if (aiSuggestions) {
        return { ...response, aiSuggestions };
      }
    }
    return response;
  }

  /**
   * Tracker Phase 3 part C — параллельный сбор AI-подсказок: поля задачи
   * (IssueInferFieldsService) и связь с целью (IssueGoalSuggestService).
   * Сервисы Optional — если хотя бы один доступен, возвращаем структуру
   * с null для недоступного; если оба недоступны — null (caller отдаст
   * IssueResponseDto без aiSuggestions).
   */
  private async collectAiSuggestions(
    issueId: string,
    tenantId: string,
  ): Promise<IssueAiSuggestionsDto | null> {
    if (!this.inferFieldsSvc && !this.goalSuggestSvc) {
      return null;
    }
    const [fieldsResult, goalResult] = await Promise.all([
      this.inferFieldsSvc
        ? this.inferFieldsSvc.inferFields({ tenantId, issueId })
        : Promise.resolve(null),
      this.goalSuggestSvc
        ? this.goalSuggestSvc.suggestGoal({ tenantId, issueId })
        : Promise.resolve(null),
    ]);
    if (!fieldsResult && !goalResult) {
      return null;
    }
    return {
      fields: fieldsResult
        ? {
            suggestedAssigneeId: fieldsResult.suggestedAssigneeId,
            suggestedDueDate: fieldsResult.suggestedDueDate,
            suggestedPriority: fieldsResult.suggestedPriority,
            suggestedGoalId: fieldsResult.suggestedGoalId,
            suggestedLabels: fieldsResult.suggestedLabels,
            confidence: fieldsResult.confidence,
            meetsThreshold: fieldsResult.meetsThreshold,
            reasoning: fieldsResult.reasoning,
          }
        : null,
      goal: goalResult
        ? {
            goalId: goalResult.goalId,
            confidence: goalResult.confidence,
            source: goalResult.source,
          }
        : null,
    };
  }

  /** Список задач проекта с фильтрами. */
  async findAll(
    projectId: string,
    tenantId: string,
    query: ListIssuesQuery,
  ): Promise<ListIssuesResponse> {
    await this.projects.requireProject(projectId, tenantId);
    const where: Prisma.IssueWhereInput = { tenantId, projectId };
    if (!query.includeDeleted) where.deletedAt = null;
    if (!query.includeArchived) where.archivedAt = null;
    if (query.stateId) where.stateId = query.stateId;
    if (query.stateCategory) {
      where.state = { category: query.stateCategory };
    }
    if (query.priority) where.priority = query.priority;
    if (query.parentId) where.parentId = query.parentId;
    if (query.cycleId) where.cycleId = query.cycleId;
    if (query.goalId) where.goalId = query.goalId;
    // Tracker Boards (2026-05-27) — фильтр задач по выбранной доске.
    if (query.boardId) where.boardId = query.boardId;
    if (query.assigneeUserId) {
      where.assignees = { some: { userId: query.assigneeUserId } };
    }
    if (query.labelId) {
      where.labels = { some: { labelId: query.labelId } };
    }
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { descriptionStripped: { contains: query.q, mode: 'insensitive' } },
        { identifier: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.issue.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        take: query.limit,
        skip: (query.page - 1) * query.limit,
        include: {
          assignees: { select: { userId: true } },
          labels: { select: { labelId: true } },
        },
      }),
      this.prisma.issue.count({ where }),
    ]);
    // Tracker subtasks UI (2026-05-27) — массовый подсчёт детей через
    // groupBy, чтобы канбан-карточки могли отрисовать badge `N/M`.
    // Один JOIN-эквивалент на весь список — стоимость минимальная.
    let childrenCountByParent: Map<string, number> | null = null;
    if (query.includeChildrenCount && items.length > 0) {
      const parentIds = items.map((i) => i.id);
      const grouped = await this.prisma.issue.groupBy({
        by: ['parentId'],
        where: {
          tenantId,
          parentId: { in: parentIds },
          deletedAt: null,
        },
        _count: { _all: true },
      });
      childrenCountByParent = new Map();
      for (const row of grouped) {
        if (row.parentId) {
          childrenCountByParent.set(row.parentId, row._count._all);
        }
      }
    }
    return {
      items: items.map((i) => {
        const base = this.toResponseFromInclude(i);
        if (childrenCountByParent) {
          return { ...base, childrenCount: childrenCountByParent.get(i.id) ?? 0 };
        }
        return base;
      }),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Сквозной список задач всей организации (`GET /api/v1/issues`). В отличие
   * от `findAll` (per-project) и `findMyInbox` (только assignee=self) — отдаёт
   * задачи ВСЕХ проектов tenant'а с видимостью по роли/visibilityMode (Р3/Р4):
   *   - руководитель (isLeadership) ИЛИ visibilityMode=open → видит все (read);
   *     учитывается фильтр `assigneeUserId`.
   *   - manager + strict → форсится self-scope (assignee=self ИЛИ создатель),
   *     `assigneeUserId` игнорируется (нельзя подсмотреть чужое).
   * Каждый item несёт `stateCategory` (для группировки по 5 колонкам на фронте).
   */
  async findAllAcrossProjects(
    tenantId: string,
    userId: string,
    query: ListOrgIssuesQuery,
    ctx: { isLeadership: boolean; visibility: 'open' | 'strict' },
  ): Promise<ListIssuesResponse> {
    const where: Prisma.IssueWhereInput = { tenantId };
    if (!query.includeDeleted) where.deletedAt = null;
    if (!query.includeArchived) where.archivedAt = null;
    if (query.projectId) where.projectId = query.projectId;
    if (query.stateCategory) where.state = { category: query.stateCategory };
    if (query.priority) where.priority = query.priority;
    if (query.cycleId) where.cycleId = query.cycleId;
    if (query.labelId) where.labels = { some: { labelId: query.labelId } };
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { descriptionStripped: { contains: query.q, mode: 'insensitive' } },
        { identifier: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    // Р3/Р4 видимость:
    const seesAll = ctx.isLeadership || ctx.visibility === 'open';
    if (seesAll) {
      if (query.assigneeUserId) {
        where.assignees = { some: { userId: query.assigneeUserId } };
      }
    } else {
      // manager + strict → только свои (assignee=self ИЛИ создатель).
      // Отдельный where.AND, чтобы НЕ затереть where.OR от поиска `q`.
      where.AND = [
        {
          OR: [
            { assignees: { some: { userId } } },
            { createdById: userId },
          ],
        },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.issue.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        take: query.limit,
        skip: (query.page - 1) * query.limit,
        include: {
          assignees: { select: { userId: true } },
          labels: { select: { labelId: true } },
          state: { select: { category: true } },
        },
      }),
      this.prisma.issue.count({ where }),
    ]);
    // childrenCount — копия блока из findAll (по запросу includeChildrenCount).
    let childrenCountByParent: Map<string, number> | null = null;
    if (query.includeChildrenCount && items.length > 0) {
      const parentIds = items.map((i) => i.id);
      const grouped = await this.prisma.issue.groupBy({
        by: ['parentId'],
        where: { tenantId, parentId: { in: parentIds }, deletedAt: null },
        _count: { _all: true },
      });
      childrenCountByParent = new Map();
      for (const row of grouped) {
        if (row.parentId) {
          childrenCountByParent.set(row.parentId, row._count._all);
        }
      }
    }
    return {
      items: items.map((i) => {
        const base = this.toResponseFromInclude(i);
        const stateCategory =
          ((i as { state?: { category: string } | null }).state
            ?.category as IssueResponseDto['stateCategory']) ?? null;
        const withCat = { ...base, stateCategory };
        if (childrenCountByParent) {
          return { ...withCat, childrenCount: childrenCountByParent.get(i.id) ?? 0 };
        }
        return withCat;
      }),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Tracker subtasks UI (2026-05-27) — список прямых детей задачи.
   *
   * Возвращает упрощённый DTO без description/labelIds (фронт получает
   * только то, что нужно блоку «Подзадачи» в карточке родителя).
   *
   * Сортировка: `sortOrder ASC, createdAt ASC` — стабильно и совпадает
   * с порядком на канбан-доске родителя.
   *
   * Контракт: `plans/tz/2026-05-27-tracker-subtasks-ui.md` §"REST API".
   */
  async findChildren(
    issueId: string,
    tenantId: string,
  ): Promise<IssueChildrenResponseDto> {
    await this.requireIssue(issueId, tenantId);
    const rows = await this.prisma.issue.findMany({
      where: { tenantId, parentId: issueId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        assignees: { select: { userId: true } },
        state: { select: { category: true } },
      },
    });
    // Подсчёт «внуков»: один groupBy(parentId) на весь список детей.
    // На канбан-доске родителя такие случаи показаны на 2-м уровне, новые
    // подзадачи на 3-м уровне запрещены validateParentForIssue.
    let grandchildrenByParent: Map<string, number> | null = null;
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const grouped = await this.prisma.issue.groupBy({
        by: ['parentId'],
        where: { tenantId, parentId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      });
      grandchildrenByParent = new Map();
      for (const row of grouped) {
        if (row.parentId) {
          grandchildrenByParent.set(row.parentId, row._count._all);
        }
      }
    }
    const items: IssueChildResponseDto[] = rows.map((r) => ({
      id: r.id,
      identifier: r.identifier,
      title: r.title,
      stateId: r.stateId,
      stateCategory:
        (r.state?.category as IssueChildResponseDto['stateCategory']) ?? null,
      priority: r.priority,
      assigneeUserIds: r.assignees.map((a) => a.userId),
      dueDate: r.dueDate?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      childrenCount: grandchildrenByParent?.get(r.id) ?? 0,
      sortOrder: r.sortOrder,
    }));
    return { items, total: items.length };
  }

  /**
   * Мой inbox — задачи, в которых currentUser является assignee
   * (через `IssueAssignee.userId`). Сквозной список по ВСЕМ проектам
   * текущего tenant'а; tenant-scope гарантирует Issue.tenantId.
   *
   * Пагинация: cursor-based. `cursor` — id последней задачи предыдущей
   * страницы. Сортировка — стабильная по `id desc` (без коллизий с
   * createdAt/sortOrder, которые могут совпадать у нескольких задач).
   *
   * Если задач больше чем `limit` — возвращаем ровно `limit` элементов
   * и `nextCursor = items[last].id`. Иначе `nextCursor = null`.
   *
   * Frontend Wave 2: `useMyInbox`.
   */
  async findMyInbox(
    tenantId: string,
    userId: string,
    query: MyInboxQuery,
  ): Promise<MyInboxResponseDto> {
    const where: Prisma.IssueWhereInput = {
      tenantId,
      assignees: { some: { userId } },
    };
    if (!query.includeDeleted) where.deletedAt = null;
    if (!query.includeArchived) where.archivedAt = null;
    if (query.stateId) where.stateId = query.stateId;
    if (query.stateCategory) where.state = { category: query.stateCategory };
    if (query.priority) where.priority = query.priority;
    if (query.projectId) where.projectId = query.projectId;
    if (query.cycleId) where.cycleId = query.cycleId;
    if (query.labelId) where.labels = { some: { labelId: query.labelId } };
    if (query.dueBefore || query.dueAfter) {
      where.dueDate = {
        ...(query.dueBefore && { lte: query.dueBefore }),
        ...(query.dueAfter && { gte: query.dueAfter }),
      };
    }
    // Cursor: берём id < cursor (если задан) — пагинация по убыванию id.
    if (query.cursor) {
      where.id = { lt: query.cursor };
    }
    const rows = await this.prisma.issue.findMany({
      where,
      orderBy: [{ id: 'desc' }],
      take: query.limit + 1, // +1 чтобы определить, есть ли следующая страница
      include: {
        assignees: { select: { userId: true } },
        labels: { select: { labelId: true } },
      },
    });
    const hasMore = rows.length > query.limit;
    const pageItems = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore
      ? (pageItems[pageItems.length - 1]?.id ?? null)
      : null;
    return {
      items: pageItems.map((i) => this.toResponseFromInclude(i)),
      nextCursor,
      limit: query.limit,
    };
  }

  /**
   * Wave 2 polish T6-6a — счётчик задач в моём инбоксе (без пагинации/выборки).
   *
   * Используется фронтом для бейджа на иконке «Инбокс» в `TrackerBottomNav`,
   * чтобы не дёргать тяжёлый `findMyInbox` ради одного числа.
   *
   * Контракт фильтрации эквивалентен `findMyInbox` БЕЗ опциональных query-
   * фильтров: считаем все задачи tenant'а, где user — assignee, исключая
   * deletedAt и archivedAt. На текущей модели данных «непрочитанные»
   * совпадают с «всеми» (модели IssueRead нет), поэтому `unread = total`.
   */
  async countMyInbox(
    tenantId: string,
    userId: string,
  ): Promise<MyInboxCountDto> {
    const where: Prisma.IssueWhereInput = {
      tenantId,
      assignees: { some: { userId } },
      deletedAt: null,
      archivedAt: null,
    };
    const total = await this.prisma.issue.count({ where });
    // Модели IssueRead на сейчас нет — unread временно совпадает с total.
    // Когда появится IssueRead с `readAt` — заменим на отдельный count
    // с фильтром `reads: { none: { userId } }`.
    return { total, unread: total };
  }

  /**
   * ТЗ 2026-06-10 §2 Ф5 — лёгкий листинг ОТКРЫТЫХ задач исполнителя для
   * Telegram-читалки «мои задачи». Открытые = `IssueState.category` НЕ
   * `completed`/`cancelled` (либо задача без статуса). Фильтр по
   * `tenantId` + `assignees.userId` (есть `@@index([userId])` на
   * IssueAssignee). Сортировка: с дедлайном раньше (NULLS LAST по умолчанию
   * Postgres для ASC), затем новые. Возвращает только поля для рендера.
   */
  async listOpenForAssignee(args: {
    tenantId: string;
    userId: string;
    limit: number;
  }): Promise<{
    items: Array<{
      identifier: string;
      title: string;
      stateName: string | null;
      dueDate: Date | null;
    }>;
    total: number;
  }> {
    const where: Prisma.IssueWhereInput = {
      tenantId: args.tenantId,
      deletedAt: null,
      archivedAt: null,
      assignees: { some: { userId: args.userId } },
      OR: [
        { state: { category: { notIn: ['completed', 'cancelled'] } } },
        { stateId: null },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.issue.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: args.limit,
        select: {
          identifier: true,
          title: true,
          dueDate: true,
          state: { select: { name: true } },
        },
      }),
      this.prisma.issue.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        identifier: r.identifier,
        title: r.title,
        stateName: r.state?.name ?? null,
        dueDate: r.dueDate,
      })),
      total,
    };
  }

  /** Найти задачу по id (глобальный id) + проверка tenant. */
  async findById(id: string, tenantId: string): Promise<IssueResponseDto> {
    return this.assemble(id, tenantId);
  }

  /** Найти задачу по identifier (`KORA-123`) + tenant. */
  async findByIdentifier(
    identifier: string,
    tenantId: string,
  ): Promise<IssueResponseDto> {
    const issue = await this.prisma.issue.findFirst({
      where: { tenantId, identifier, deletedAt: null },
      select: { id: true },
    });
    if (!issue) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'issue_not_found', message: 'Задача не найдена' },
      });
    }
    return this.assemble(issue.id, tenantId);
  }

  /**
   * PATCH задачи. Для каждого изменённого поля пишет отдельную строку
   * IssueActivity verb='updated' (field/oldValue/newValue). state-смена через
   * PATCH тоже фиксируется отдельной записью verb='status_changed'.
   */
  async update(
    id: string,
    dto: UpdateIssueDto,
    tenantId: string,
    userId: string,
  ): Promise<IssueResponseDto> {
    const existing = await this.requireIssue(id, tenantId);
    if (dto.stateId && dto.stateId !== existing.stateId) {
      await this.requireStateInProject(dto.stateId, existing.projectId);
    }
    // Tracker subtasks UI (2026-05-27) — валидация смены `parentId`
    // перенесена ВНУТРЬ $transaction (audit-fixes Б9), см. блок ниже.

    // Tracker Boards (2026-05-27) — если фронт меняет boardId на не-null,
    // валидируем что доска принадлежит тому же проекту и tenant'у.
    if (
      dto.boardId &&
      dto.boardId !== existing.boardId &&
      this.boards
    ) {
      await this.boards.assertBoardInProject({
        boardId: dto.boardId,
        projectId: existing.projectId,
        tenantId,
      });
    }
    // Wave 3 finishing (Sprint 10) — корректируем `dueDate` ДО формирования
    // diff'а activity. Если dueDate в dto не передан — не трогаем (undefined
    // означает «оставить как есть»). Если передан null — это явное снятие,
    // adjust пропускаем (нечего сдвигать).
    const adjustedDueDate =
      dto.dueDate === undefined || dto.dueDate === null
        ? dto.dueDate
        : await this.maybeAdjustDueDate({
            tenantId,
            dueDate: dto.dueDate,
            respectHolidays: dto.respectHolidays,
          });
    const changedFields: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      // audit-fixes Б9: валидация parentId ВНУТРИ tx с advisory_xact_lock.
      // Лочит parentId + currentIssueId — две параллельные операции с
      // пересекающимися родителями сериализуются, не дают создать цикл.
      if (dto.parentId !== undefined && dto.parentId !== null) {
        await this.validateParentForIssue({
          candidateParentId: dto.parentId,
          projectId: existing.projectId,
          tenantId,
          currentIssueId: existing.id,
          tx,
        });
      }

      const data: Prisma.IssueUpdateInput = {};
      const activities: Array<{
        verb: string;
        field?: string;
        oldValue: unknown;
        newValue: unknown;
      }> = [];
      const trackField = <K extends keyof Issue>(
        field: K,
        nextValue: Issue[K] | undefined,
      ): void => {
        if (nextValue === undefined) return;
        const prev = existing[field];
        if (this.equalsLoose(prev, nextValue)) return;
        (data as Record<string, unknown>)[field as string] = nextValue;
        // Tracker subtasks UI (2026-05-27) — отдельный verb 'parent_changed'
        // для смены parentId (наряду с 'status_changed' для stateId).
        // Это нужно для активити-фида: «перенесли подзадачу в KORA-200».
        let verb: string;
        if (field === 'stateId') verb = 'status_changed';
        else if (field === 'parentId') verb = 'parent_changed';
        else verb = 'updated';
        activities.push({
          verb,
          field: String(field),
          oldValue: prev,
          newValue: nextValue,
        });
      };

      trackField('title', dto.title);
      trackField('description', dto.description ?? undefined);
      trackField('descriptionHtml', dto.descriptionHtml ?? undefined);
      trackField('descriptionStripped', dto.descriptionStripped ?? undefined);
      trackField('priority', dto.priority);
      trackField('stateId', dto.stateId ?? undefined);
      trackField('parentId', dto.parentId ?? undefined);
      trackField('estimatePoints', dto.estimatePoints ?? undefined);
      trackField('sortOrder', dto.sortOrder);
      trackField('startDate', dto.startDate ?? undefined);
      trackField('dueDate', adjustedDueDate ?? undefined);
      trackField('cycleId', dto.cycleId ?? undefined);
      trackField('goalId', dto.goalId ?? undefined);
      // Tracker Boards (2026-05-27) — фиксируем перенос между досками.
      // verb остаётся 'updated', но IssueActivity.field='boardId' даёт
      // ленте конкретную метку «перенос». В knowledge-core это событие
      // не идёт (не семантика, организационное перекладывание).
      trackField('boardId', dto.boardId ?? undefined);

      if (Object.keys(data).length === 0) {
        return;
      }
      // Если state поменялся и новая категория = completed — проставим completedAt.
      if (dto.stateId !== undefined && dto.stateId !== existing.stateId) {
        const newState = dto.stateId
          ? await tx.issueState.findUnique({ where: { id: dto.stateId } })
          : null;
        if (newState?.category === 'completed' && !existing.completedAt) {
          (data as Record<string, unknown>).completedAt = new Date();
        }
        if (newState?.category !== 'completed' && existing.completedAt) {
          (data as Record<string, unknown>).completedAt = null;
        }
      }
      await tx.issue.update({ where: { id }, data });
      for (const a of activities) {
        if (a.field) changedFields.push(a.field);
        const activityId = await this.activity.record({
          tenantId,
          issueId: id,
          actorUserId: userId,
          actorType: 'user',
          verb: a.verb,
          field: a.field ?? null,
          oldValue: a.oldValue,
          newValue: a.newValue,
          tx,
        });
        // WS активити-фид (emit fire-and-forget — даже до commit'а БД безопасно,
        // т.к. клиент всё равно дойдёт до этой записи через REST при reload).
        this.events.publishActivity({
          tenantId,
          activityId,
          issueId: id,
          verb: a.verb,
        });
      }
    });
    const response = await this.assemble(id, tenantId);
    if (changedFields.length > 0) {
      this.events.publishIssueUpdated(response, tenantId, changedFields);
      // Tracker Boards (2026-05-27) — если изменился boardId, эмитим узкое
      // событие `issue.moved_to_board` (фронт может удалить карточку из
      // старой доски и добавить в новую без перезагрузки + метрика).
      if (changedFields.includes('boardId') && dto.boardId) {
        this.events.publishIssueMovedToBoard({
          tenantId,
          projectId: existing.projectId,
          issueId: id,
          fromBoardId: existing.boardId,
          toBoardId: dto.boardId,
        });
        this.metrics?.incBoardIssueMoved({
          tenantTop: tenantTopOf(tenantId),
          fromBoard: existing.boardId ?? '',
          toBoard: dto.boardId,
        });
      }
      // Phase 3 (2026-05-24) — пересчёт embedding'а, если изменились
      // текстовые поля (title / description / descriptionStripped). Hash
      // защитит от лишних пересчётов, если описание тривиально перетёрли
      // тем же значением через ?? — но дешевле скипать по hash в воркере,
      // чем дублировать проверку здесь.
      const textChanged =
        changedFields.includes('title') ||
        changedFields.includes('description') ||
        changedFields.includes('descriptionStripped');
      if (textChanged) {
        void this.enqueueEmbed(tenantId, id, null);
      }
      // Sprint 3 B1-3.1 — ingest в knowledge-core. Если изменился stateId —
      // эмитим status_changed (+ специфичные blocked/completed).
      if (changedFields.includes('stateId') && dto.stateId !== undefined) {
        void this.emitStateChangeIfNeeded({
          issueId: id,
          tenantId,
          userId,
          oldStateId: existing.stateId,
          newStateId: dto.stateId,
        }).catch((e) => {
          this.logger.warn(
            { issueId: id, err: e instanceof Error ? e.message : String(e) },
            'tracker-emitter: emitStateChangeIfNeeded (update) упал — событие в knowledge-core пропущено',
          );
        });
      }
      void this.webhooks
        .dispatch(tenantId, 'issue.updated', {
          issue: response,
          changedFields,
        })
        .catch((e) => {
          this.logger.warn(
            { issueId: id, err: e instanceof Error ? e.message : String(e) },
            'issue.updated webhook dispatch failed',
          );
        });
    }
    return response;
  }

  /** Soft-delete через deletedAt. Пишет IssueActivity verb='deleted'. */
  async softDelete(id: string, tenantId: string, userId: string): Promise<{ ok: true }> {
    const existing = await this.requireIssue(id, tenantId);
    await this.prisma.$transaction(async (tx) => {
      await tx.issue.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });
      await this.activity.record({
        tenantId,
        issueId: existing.id,
        actorUserId: userId,
        actorType: 'user',
        verb: 'deleted',
        tx,
      });
    });
    this.events.publishIssueDeleted(existing.id, tenantId, existing.projectId);
    void this.webhooks
      .dispatch(tenantId, 'issue.deleted', {
        issueId: existing.id,
        projectId: existing.projectId,
      })
      .catch((e) => {
        this.logger.warn(
          { issueId: existing.id, err: e instanceof Error ? e.message : String(e) },
          'issue.deleted webhook dispatch failed',
        );
      });
    return { ok: true };
  }

  /**
   * Сменить статус задачи отдельным action'ом (predпочтительнее PATCH stateId).
   * Доступ: assignee / project_manager / admin (контроллер проверяет RBAC).
   */
  async transitionState(
    id: string,
    dto: TransitionIssueStateDto,
    tenantId: string,
    userId: string,
  ): Promise<IssueResponseDto> {
    const existing = await this.requireIssue(id, tenantId);
    if (existing.stateId === dto.stateId) {
      // Идемпотентно: уже в нужном состоянии.
      return this.assemble(id, tenantId);
    }
    const newState = await this.prisma.issueState.findFirst({
      where: { id: dto.stateId, projectId: existing.projectId },
    });
    if (!newState) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_state_id',
          message: 'Статус не найден или принадлежит другому проекту',
        },
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.IssueUpdateInput = {
        state: { connect: { id: dto.stateId } },
      };
      if (newState.category === 'completed' && !existing.completedAt) {
        data.completedAt = new Date();
      } else if (newState.category !== 'completed' && existing.completedAt) {
        data.completedAt = null;
      }
      await tx.issue.update({ where: { id }, data });
      const activityId = await this.activity.record({
        tenantId,
        issueId: id,
        actorUserId: userId,
        actorType: 'user',
        verb: 'status_changed',
        field: 'stateId',
        oldValue: existing.stateId,
        newValue: dto.stateId,
        metadata: dto.reason ? { reason: dto.reason } : null,
        tx,
      });
      this.events.publishActivity({
        tenantId,
        activityId,
        issueId: id,
        verb: 'status_changed',
      });
    });
    const response = await this.assemble(id, tenantId);
    this.events.publishIssueUpdated(response, tenantId, ['stateId']);
    // Sprint 3 B1-3.1 — ingest в knowledge-core (status_changed + спец. blocked/completed).
    void this.emitStateChangeIfNeeded({
      issueId: id,
      tenantId,
      userId,
      oldStateId: existing.stateId,
      newStateId: dto.stateId,
      reason: dto.reason ?? null,
    }).catch((e) => {
      this.logger.warn(
        { issueId: id, err: e instanceof Error ? e.message : String(e) },
        'tracker-emitter: emitStateChangeIfNeeded (transition) упал — событие в knowledge-core пропущено',
      );
    });
    void this.webhooks
      .dispatch(tenantId, 'issue.updated', {
        issue: response,
        changedFields: ['stateId'],
      })
      .catch((e) => {
        this.logger.warn(
          { issueId: id, err: e instanceof Error ? e.message : String(e) },
          'issue.updated (transition) webhook dispatch failed',
        );
      });
    return response;
  }

  /**
   * Перенос задачи в другой проект (POST /issues/:id/move). ТЗ
   * `plans/tz/2026-06-15-issue-move-to-project.md`.
   *
   * Простая смена projectId сломала бы инварианты: identifier уникален
   * per-tenant, sequenceId уникален per-project, stateId/boardId/cycleId
   * принадлежат исходному проекту. Поэтому перенос = атомарная ре-аллокация
   * в `$transaction`:
   *   1. новый sequenceId = max(в целевом проекте)+1;
   *   2. новый identifier = `${target.identifier}-${seq}`;
   *   3. stateId → статус целевого проекта той же category (иначе
   *      defaultStateId целевого, иначе null);
   *   4. boardId → default-доска целевого проекта (иначе null);
   *   5. cycleId → null (цикл исходного проекта неприменим);
   *   6. IssueActivity verb='moved_to_project' + WS + метрика.
   *
   * Подзадачи: v1 запрещает перенос задачи, у которой есть parentId или
   * дети (понятная 400) — деревья переносить нельзя, потому что родитель
   * обязан быть в том же проекте (validateParentForIssue). Relations /
   * labels / assignees / goal — tenant-scoped и переживают перенос.
   */
  async moveToProject(
    issueId: string,
    targetProjectId: string,
    tenantId: string,
    userId: string,
  ): Promise<IssueResponseDto> {
    const existing = await this.requireIssue(issueId, tenantId);

    if (existing.projectId === targetProjectId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'same_project',
          message: 'Задача уже находится в этом проекте',
        },
      });
    }

    // Целевой проект того же tenant'а (404 если чужой/удалён) и не архивный.
    const target = await this.projects.requireProject(targetProjectId, tenantId);
    if (target.archivedAt !== null) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'target_project_archived',
          message: 'Целевой проект архивирован — перенос невозможен',
        },
      });
    }

    // Подзадачи: запрещаем перенос задачи с родителем или с детьми.
    if (existing.parentId !== null) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'cannot_move_issue_with_subtasks',
          message:
            'Нельзя перенести подзадачу — сначала сделайте её самостоятельной',
        },
      });
    }
    const childrenCount = await this.prisma.issue.count({
      where: { parentId: issueId, deletedAt: null },
    });
    if (childrenCount > 0) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'cannot_move_issue_with_subtasks',
          message:
            'Нельзя перенести задачу с подзадачами — перенесите или отвяжите подзадачи',
        },
      });
    }

    // Ремап state по category: ищем в целевом проекте статус той же
    // категории, что у текущего state. Если у задачи нет state или совпадения
    // нет — берём defaultStateId целевого проекта (может быть null).
    const currentCategory = existing.stateId
      ? (
          await this.prisma.issueState.findUnique({
            where: { id: existing.stateId },
            select: { category: true },
          })
        )?.category ?? null
      : null;
    let targetStateId: string | null = target.defaultStateId ?? null;
    if (currentCategory) {
      const matched = await this.prisma.issueState.findFirst({
        where: { projectId: targetProjectId, category: currentCategory },
        orderBy: { sequence: 'asc' },
        select: { id: true },
      });
      if (matched) targetStateId = matched.id;
    }

    // Ремап board: default-доска целевого проекта (лениво создаётся).
    let targetBoardId: string | null = null;
    if (this.boards) {
      try {
        targetBoardId = await this.boards.resolveDefaultBoardId({
          tenantId,
          projectId: targetProjectId,
        });
      } catch (err) {
        this.logger.warn(
          {
            issueId,
            targetProjectId,
            err: err instanceof Error ? err.message : String(err),
          },
          'IssuesService.moveToProject: default-доска целевого проекта не разрешилась — переносим без boardId',
        );
        targetBoardId = null;
      }
    }

    const oldIdentifier = existing.identifier;
    let newIdentifier = oldIdentifier;
    await this.prisma.$transaction(async (tx) => {
      // Новый sequenceId = max(в целевом проекте)+1 — защита
      // @@unique([projectId, sequenceId]). Копия логики из create().
      const maxRow = await tx.issue.aggregate({
        where: { projectId: targetProjectId },
        _max: { sequenceId: true },
      });
      const sequenceId = (maxRow._max.sequenceId ?? 0) + 1;
      newIdentifier = `${target.identifier}-${sequenceId}`;

      await tx.issue.update({
        where: { id: issueId },
        data: {
          projectId: targetProjectId,
          sequenceId,
          identifier: newIdentifier,
          stateId: targetStateId,
          boardId: targetBoardId,
          cycleId: null,
        },
      });

      await this.activity.record({
        tenantId,
        issueId,
        actorUserId: userId,
        actorType: 'user',
        verb: 'moved_to_project',
        field: 'projectId',
        oldValue: existing.projectId,
        newValue: targetProjectId,
        metadata: { oldIdentifier, newIdentifier },
        tx,
      });
    });

    const response = await this.assemble(issueId, tenantId);
    // WS: общий issue.updated (projectId/identifier поменялись) + узкое
    // issue.moved_to_project. Fire-and-forget — ошибки доставки логируются
    // самим events-service'ом, не пропагируются.
    this.events.publishIssueUpdated(response, tenantId, [
      'projectId',
      'identifier',
    ]);
    this.events.publishIssueMovedToProject({
      tenantId,
      issueId,
      fromProjectId: existing.projectId,
      toProjectId: targetProjectId,
      oldIdentifier,
      newIdentifier,
    });
    try {
      this.metrics?.incIssueMovedToProject({ tenantTop: tenantTopOf(tenantId) });
    } catch (e) {
      this.logger.warn(
        { issueId, err: e instanceof Error ? e.message : String(e) },
        'issue_moved_to_project_total inc failed (best-effort)',
      );
    }
    void this.webhooks
      .dispatch(tenantId, 'issue.updated', {
        issue: response,
        changedFields: ['projectId', 'identifier'],
      })
      .catch((e) => {
        this.logger.warn(
          { issueId, err: e instanceof Error ? e.message : String(e) },
          'issue.updated (move) webhook dispatch failed',
        );
      });
    return response;
  }

  /** Добавить исполнителя. IssueActivity verb='assigned'. */
  async addAssignee(
    issueId: string,
    assigneeUserId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<{ ok: true }> {
    const issue = await this.requireIssue(issueId, tenantId);
    const existing = await this.prisma.issueAssignee.findUnique({
      where: { issueId_userId: { issueId, userId: assigneeUserId } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'assignee_already_added',
          message: 'Пользователь уже назначен исполнителем',
        },
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.issueAssignee.create({
        data: { issueId, userId: assigneeUserId, assignedById: actorUserId },
      });
      await this.activity.record({
        tenantId,
        issueId,
        actorUserId,
        actorType: 'user',
        verb: 'assigned',
        newValue: { userId: assigneeUserId },
        tx,
      });
    });
    // Sprint 3 B1-3.1 — ingest в knowledge-core (task_reassigned).
    this.emitter.emitIssueAssigneeChanged({
      issue,
      actorUserId,
      action: 'added',
      assigneeUserId,
    });
    return { ok: true };
  }

  /** Удалить исполнителя. */
  async removeAssignee(
    issueId: string,
    assigneeUserId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<{ ok: true }> {
    const issue = await this.requireIssue(issueId, tenantId);
    const deleted = await this.prisma.issueAssignee.deleteMany({
      where: { issueId, userId: assigneeUserId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'assignee_not_found',
          message: 'Исполнитель не найден на задаче',
        },
      });
    }
    await this.activity.record({
      tenantId,
      issueId,
      actorUserId,
      actorType: 'user',
      verb: 'unassigned',
      oldValue: { userId: assigneeUserId },
    });
    // Sprint 3 B1-3.1 — ingest в knowledge-core (task_reassigned).
    this.emitter.emitIssueAssigneeChanged({
      issue,
      actorUserId,
      action: 'removed',
      assigneeUserId,
    });
    return { ok: true };
  }

  /** Добавить метку. */
  async addLabel(
    issueId: string,
    labelId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<{ ok: true }> {
    await this.requireIssue(issueId, tenantId);
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, tenantId },
      select: { id: true },
    });
    if (!label) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_label_id', message: 'Метка не найдена в организации' },
      });
    }
    try {
      await this.prisma.issueLabel.create({ data: { issueId, labelId } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException({
          ok: false,
          error: { code: 'label_already_added', message: 'Метка уже добавлена' },
        });
      }
      throw e;
    }
    await this.activity.record({
      tenantId,
      issueId,
      actorUserId,
      actorType: 'user',
      verb: 'label_added',
      newValue: { labelId },
    });
    return { ok: true };
  }

  /** Удалить метку. */
  async removeLabel(
    issueId: string,
    labelId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<{ ok: true }> {
    await this.requireIssue(issueId, tenantId);
    const deleted = await this.prisma.issueLabel.deleteMany({
      where: { issueId, labelId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'label_not_on_issue', message: 'Метка не найдена на задаче' },
      });
    }
    await this.activity.record({
      tenantId,
      issueId,
      actorUserId,
      actorType: 'user',
      verb: 'label_removed',
      oldValue: { labelId },
    });
    return { ok: true };
  }

  /** Подписаться на задачу (получать уведомления). */
  async subscribe(
    issueId: string,
    userId: string,
    tenantId: string,
  ): Promise<{ ok: true }> {
    await this.requireIssue(issueId, tenantId);
    try {
      await this.prisma.issueSubscriber.create({ data: { issueId, userId } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Уже подписан — идемпотентно ok.
        return { ok: true };
      }
      throw e;
    }
    return { ok: true };
  }

  /** Отписаться. Идемпотентно. */
  async unsubscribe(
    issueId: string,
    userId: string,
    tenantId: string,
  ): Promise<{ ok: true }> {
    await this.requireIssue(issueId, tenantId);
    await this.prisma.issueSubscriber.deleteMany({ where: { issueId, userId } });
    return { ok: true };
  }

  /**
   * Связать задачу с целью (Goal).
   *
   * - $transaction: Issue.update + IssueActivity verb='goal_linked' с
   *   metadata={goalId}.
   * - WS-событие через `TrackerEventsService.publishIssueUpdated` (паттерн
   *   как у других мутаций) + `publishActivity` для feed'а.
   *
   * Sprint 3 B1-3.2 — после линковки strategic-alignment.cron (см.
   * goals/cron/strategic-alignment-issues.cron.ts) подхватит задачу в
   * следующем проходе. Эмитить сюда специальное knowledge-core событие
   * пока не нужно — связь читается напрямую через Issue.goalId.
   */
  async linkGoal(
    issueId: string,
    goalId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<IssueResponseDto> {
    const existing = await this.requireIssue(issueId, tenantId);
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, tenantId },
      select: { id: true },
    });
    if (!goal) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }
    let activityId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.issue.update({ where: { id: issueId }, data: { goalId } });
      activityId = await this.activity.record({
        tenantId,
        issueId,
        actorUserId,
        actorType: 'user',
        verb: 'goal_linked',
        field: 'goalId',
        oldValue: existing.goalId,
        newValue: goalId,
        metadata: { goalId },
        tx,
      });
    });
    const response = await this.assemble(issueId, tenantId);
    // WS — задача обновилась + новая запись в activity-feed.
    this.events.publishIssueUpdated(response, tenantId, ['goalId']);
    if (activityId) {
      this.events.publishActivity({
        tenantId,
        activityId,
        issueId,
        verb: 'goal_linked',
      });
    }
    return response;
  }

  /** Отвязать задачу от цели. См. linkGoal — симметричная семантика. */
  async unlinkGoal(
    issueId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<IssueResponseDto> {
    const existing = await this.requireIssue(issueId, tenantId);
    if (!existing.goalId) return this.assemble(issueId, tenantId);
    const oldGoalId = existing.goalId;
    let activityId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.issue.update({ where: { id: issueId }, data: { goalId: null } });
      activityId = await this.activity.record({
        tenantId,
        issueId,
        actorUserId,
        actorType: 'user',
        verb: 'goal_unlinked',
        field: 'goalId',
        oldValue: oldGoalId,
        newValue: null,
        metadata: { goalId: oldGoalId },
        tx,
      });
    });
    const response = await this.assemble(issueId, tenantId);
    this.events.publishIssueUpdated(response, tenantId, ['goalId']);
    if (activityId) {
      this.events.publishActivity({
        tenantId,
        activityId,
        issueId,
        verb: 'goal_unlinked',
      });
    }
    return response;
  }

  /** Список IssueActivity для задачи (DESC по epoch). */
  async getActivity(
    issueId: string,
    tenantId: string,
  ): Promise<IssueActivityDto[]> {
    await this.requireIssue(issueId, tenantId);
    const rows = await this.prisma.issueActivity.findMany({
      where: { issueId, tenantId },
      orderBy: [{ epoch: 'desc' }],
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      issueId: r.issueId,
      actorUserId: r.actorUserId,
      actorType: r.actorType,
      agentName: r.agentName,
      verb: r.verb,
      field: r.field,
      oldValue: r.oldValue,
      newValue: r.newValue,
      metadata: r.metadata,
      epoch: r.epoch.toString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Список IssueVersion (исторические снимки) для задачи. */
  async getVersions(
    issueId: string,
    tenantId: string,
  ): Promise<IssueVersionDto[]> {
    await this.requireIssue(issueId, tenantId);
    const rows = await this.prisma.issueVersion.findMany({
      where: { issueId },
      orderBy: [{ versionNumber: 'desc' }],
    });
    return rows.map((v) => ({
      id: v.id,
      issueId: v.issueId,
      versionNumber: v.versionNumber,
      snapshot: v.snapshot,
      createdByUserId: v.createdByUserId,
      createdAt: v.createdAt.toISOString(),
    }));
  }

  // ── internal ──

  /**
   * Sprint 3 B1-3.1 — общая логика emit'ов смены статуса в knowledge-core.
   * Вызывается из `update()` и `transitionState()` ПОСЛЕ транзакции.
   *
   * Логика:
   *   1. Загружаем новое и старое состояние (для определения category).
   *   2. Всегда эмитим `issue.status_changed` (signalType=task_status_changed).
   *   3. Дополнительно, если newState.category='blocked' — эмитим
   *      `issue.status_changed_to_blocked` (signalType=task_blocked).
   *      Если 'completed' — `issue.status_changed_to_done` (task_completed).
   *   4. Если новый stateId = null — эмитим только общий status_changed,
   *      без специфичных (нечего проверять).
   */
  private async emitStateChangeIfNeeded(args: {
    issueId: string;
    tenantId: string;
    userId: string;
    oldStateId: string | null;
    newStateId: string | null;
    reason?: string | null;
  }): Promise<void> {
    const fresh = await this.prisma.issue.findFirst({
      where: { id: args.issueId, tenantId: args.tenantId },
    });
    if (!fresh) return;
    const [oldState, newState] = await Promise.all([
      args.oldStateId
        ? this.prisma.issueState.findUnique({ where: { id: args.oldStateId } })
        : Promise.resolve(null),
      args.newStateId
        ? this.prisma.issueState.findUnique({ where: { id: args.newStateId } })
        : Promise.resolve(null),
    ]);
    this.emitter.emitIssueStatusChanged({
      issue: fresh,
      actorUserId: args.userId,
      oldStateId: args.oldStateId,
      newStateId: args.newStateId,
      oldStateCategory: oldState?.category ?? null,
      newStateCategory: newState?.category ?? null,
      reason: args.reason ?? null,
    });
    if (newState?.category === 'blocked') {
      this.emitter.emitIssueBlocked({
        issue: fresh,
        actorUserId: args.userId,
        newState,
        reason: args.reason ?? null,
      });
    }
    if (newState?.category === 'completed') {
      this.emitter.emitIssueCompleted({
        issue: fresh,
        actorUserId: args.userId,
        newState,
      });
    }
  }

  /** Проверка существования + tenant ownership. */
  async requireIssue(id: string, tenantId: string): Promise<Issue> {
    const issue = await this.prisma.issue.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!issue) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'issue_not_found', message: 'Задача не найдена' },
      });
    }
    return issue;
  }

  /**
   * Tracker subtasks UI (2026-05-27) — валидация родителя при create/update.
   *
   * Падает 400 в следующих случаях:
   *   - `candidateParentId` совпадает с самой задачей (`currentIssueId`)
   *     — `cyclic_parent_not_allowed`.
   *   - кандидат-родитель не существует / в другом tenant'е — `parent_not_found`.
   *   - кандидат в другом проекте — `parent_in_different_project`.
   *   - кандидат сам является подзадачей (parentId !== null) — глубина >2
   *     запрещена — `max_subtask_depth_exceeded`.
   *   - кандидат — один из потомков текущей задачи (только при update,
   *     когда `currentIssueId !== null`) — `cyclic_parent_not_allowed`.
   *     На текущей модели подзадачи 3-го уровня запрещены, поэтому глубина
   *     ≤2, и обход вниз — это ровно один уровень детей. Для устойчивости
   *     к будущему расширению (если depth-limit поднимут) делаем BFS по
   *     всему поддереву с защитой от циклов через `visited`.
   *
   * audit-fixes Б9 (2026-05-29):
   *   - Метод теперь обязателен в транзакционном контексте (параметр `tx`).
   *     Раньше валидация шла на основном prisma-клиенте ПЕРЕД $transaction
   *     с записью, что давало TOCTOU race: кандидат-родитель мог быть
   *     удалён/перевешен между check и write.
   *   - Перед запросами берётся `pg_advisory_xact_lock(hashtext(parentId))` —
   *     сериализует параллельные операции с одним и тем же родителем.
   *     Lock освобождается при коммите/откате транзакции автоматически.
   *
   * TODO (после tracker-boards): проверять boardId родителя.
   */
  private async validateParentForIssue(args: {
    candidateParentId: string;
    projectId: string;
    tenantId: string;
    /** id текущей задачи (null при create). */
    currentIssueId: string | null;
    /** Обязательный транзакционный клиент (audit-fixes Б9). */
    tx: Prisma.TransactionClient;
  }): Promise<void> {
    if (
      args.currentIssueId !== null &&
      args.candidateParentId === args.currentIssueId
    ) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'cyclic_parent_not_allowed',
          message: 'Задача не может быть родителем самой себя',
        },
      });
    }
    // audit-fixes Б9: advisory_xact_lock на parentId. Если currentIssueId
    // задан и отличается от parentId — лочим оба в детерминированном порядке
    // (по убыванию hashtext) чтобы избежать deadlock при двух параллельных
    // update'ах с пересекающимися parent'ами.
    const lockKeys = [args.candidateParentId];
    if (args.currentIssueId && args.currentIssueId !== args.candidateParentId) {
      lockKeys.push(args.currentIssueId);
    }
    // Сортируем строки → стабильный порядок lock'ов.
    lockKeys.sort();
    for (const key of lockKeys) {
      await args.tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }

    const parent = await args.tx.issue.findFirst({
      where: {
        id: args.candidateParentId,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: { id: true, projectId: true, parentId: true },
    });
    if (!parent) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'parent_not_found',
          message: 'Родительская задача не найдена',
        },
      });
    }
    if (parent.projectId !== args.projectId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'parent_in_different_project',
          message: 'Родительская задача в другом проекте',
        },
      });
    }
    if (parent.parentId !== null) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'max_subtask_depth_exceeded',
          message:
            'Подзадача не может быть подзадачей: глубина больше 2 запрещена',
        },
      });
    }
    // Защита от цикла: при update убедимся, что кандидат не лежит в
    // поддереве текущей задачи. BFS вниз, threshold 256 узлов
    // (защита от случайно широких деревьев — на MVP всё равно глубина ≤2).
    if (args.currentIssueId !== null) {
      const visited = new Set<string>([args.currentIssueId]);
      let frontier: string[] = [args.currentIssueId];
      let guard = 0;
      while (frontier.length > 0 && guard < 256) {
        guard++;
        const children = await args.tx.issue.findMany({
          where: {
            tenantId: args.tenantId,
            parentId: { in: frontier },
            deletedAt: null,
          },
          select: { id: true },
        });
        if (children.length === 0) break;
        const next: string[] = [];
        for (const c of children) {
          if (c.id === args.candidateParentId) {
            throw new BadRequestException({
              ok: false,
              error: {
                code: 'cyclic_parent_not_allowed',
                message:
                  'Нельзя назначить родителем потомка текущей задачи',
              },
            });
          }
          if (!visited.has(c.id)) {
            visited.add(c.id);
            next.push(c.id);
          }
        }
        frontier = next;
      }
    }
  }

  private async requireStateInProject(
    stateId: string,
    projectId: string,
  ): Promise<void> {
    const s = await this.prisma.issueState.findFirst({
      where: { id: stateId, projectId },
      select: { id: true },
    });
    if (!s) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_state_id',
          message: 'Статус не принадлежит проекту',
        },
      });
    }
  }

  /** Собрать ResponseDto по id (включая assignees + labels). */
  private async assemble(id: string, tenantId: string): Promise<IssueResponseDto> {
    const issue = await this.prisma.issue.findFirst({
      where: { id, tenantId },
      include: {
        assignees: { select: { userId: true } },
        labels: { select: { labelId: true } },
      },
    });
    if (!issue) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'issue_not_found', message: 'Задача не найдена' },
      });
    }
    return this.toResponseFromInclude(issue);
  }

  private toResponseFromInclude(
    issue: Issue & {
      assignees: Array<{ userId: string }>;
      labels: Array<{ labelId: string }>;
    },
  ): IssueResponseDto {
    return {
      id: issue.id,
      tenantId: issue.tenantId,
      projectId: issue.projectId,
      identifier: issue.identifier,
      sequenceId: issue.sequenceId,
      title: issue.title,
      description: issue.description,
      descriptionHtml: issue.descriptionHtml,
      descriptionStripped: issue.descriptionStripped,
      priority: issue.priority,
      stateId: issue.stateId,
      parentId: issue.parentId,
      estimatePoints: issue.estimatePoints,
      sortOrder: issue.sortOrder,
      startDate: issue.startDate?.toISOString() ?? null,
      dueDate: issue.dueDate?.toISOString() ?? null,
      completedAt: issue.completedAt?.toISOString() ?? null,
      cycleId: issue.cycleId,
      goalId: issue.goalId,
      // Tracker Boards (2026-05-27).
      boardId: issue.boardId,
      meetingId: issue.meetingId,
      linkedMeetingIds: issue.linkedMeetingIds,
      sourceBlockIds: issue.sourceBlockIds,
      confidence: issue.confidence?.toString() ?? null,
      createdManually: issue.createdManually,
      externalSource: issue.externalSource,
      externalId: issue.externalId,
      entityId: issue.entityId,
      createdById: issue.createdById,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
      archivedAt: issue.archivedAt?.toISOString() ?? null,
      deletedAt: issue.deletedAt?.toISOString() ?? null,
      assigneeUserIds: issue.assignees.map((a) => a.userId),
      labelIds: issue.labels.map((l) => l.labelId),
      checklistTotalCount: issue.checklistTotalCount,
      checklistDoneCount: issue.checklistDoneCount,
    };
  }

  /**
   * Tracker Boards (2026-05-27) — резолв `boardId` при создании задачи.
   *
   *   1. Если фронт явно передал boardId — проверяем что доска в этом
   *      проекте + tenant'е через BoardsService.assertBoardInProject.
   *   2. Иначе — резолвим default-доску проекта
   *      (`BoardsService.resolveDefaultBoardId` — лениво создаёт если нет).
   *   3. Если BoardsService недоступен (unit-тесты без модуля) — возвращаем
   *      то, что передал клиент (или null). Schema допускает null.
   */
  private async resolveBoardIdForCreate(args: {
    tenantId: string;
    projectId: string;
    explicitBoardId: string | null;
  }): Promise<string | null> {
    if (!this.boards) {
      return args.explicitBoardId;
    }
    if (args.explicitBoardId) {
      await this.boards.assertBoardInProject({
        boardId: args.explicitBoardId,
        projectId: args.projectId,
        tenantId: args.tenantId,
      });
      return args.explicitBoardId;
    }
    try {
      return await this.boards.resolveDefaultBoardId({
        tenantId: args.tenantId,
        projectId: args.projectId,
      });
    } catch (err) {
      this.logger.warn(
        {
          projectId: args.projectId,
          err: err instanceof Error ? err.message : String(err),
        },
        'IssuesService.resolveBoardIdForCreate: default-доска не разрешилась — создаём задачу без boardId',
      );
      return null;
    }
  }

  /**
   * Phase 3 (2026-05-24) — best-effort enqueue в `core.issue-embed`.
   *
   * Не блокирует caller'а: всегда ловит exception (warn-log), потому что
   * embedding — вспомогательная фича (similar-issues / issue-goal-suggest),
   * и Redis-проблемы не должны валить основной create/update.
   */
  private async enqueueEmbed(
    tenantId: string,
    issueId: string,
    embeddingHash: string | null,
  ): Promise<void> {
    if (!this.embedQueue) return;
    try {
      await this.embedQueue.enqueue({ tenantId, issueId, embeddingHash });
    } catch (err) {
      this.logger.warn(
        { issueId, err: err instanceof Error ? err.message : String(err) },
        'issue-embed: enqueue упал — embedding будет пропущен до следующего апдейта',
      );
    }
  }

  /**
   * Wave 3 finishing (Sprint 10) — корректировка `dueDate` через
   * `HolidayService.adjustDueDate`. Возвращает:
   *   - null — если входной `dueDate=null` (нечего сдвигать).
   *   - исходный Date — если `respectHolidays=false` ИЛИ HolidayService
   *     недоступен (Optional inject не сработал).
   *   - скорректированный Date — иначе (если попал на праздник/выходной,
   *     сдвинется на ближайший рабочий день; если уже рабочий — вернётся
   *     нормализованным к UTC-midnight).
   *
   * Опционально: при ошибке внутри HolidayService — warn-лог + возврат
   * исходного значения. Не валим create/update из-за календарного сбоя.
   */
  private async maybeAdjustDueDate(args: {
    tenantId: string;
    dueDate: Date | null;
    respectHolidays: boolean | undefined;
  }): Promise<Date | null> {
    if (args.dueDate === null) return null;
    if (args.respectHolidays === false) return args.dueDate;
    if (!this.holidayService) return args.dueDate;
    try {
      return await this.holidayService.adjustDueDate({
        tenantId: args.tenantId,
        dueDate: args.dueDate,
      });
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          dueDate: args.dueDate.toISOString(),
          err: err instanceof Error ? err.message : String(err),
        },
        'IssuesService.maybeAdjustDueDate: HolidayService упал — оставляю dueDate как есть',
      );
      return args.dueDate;
    }
  }

  /** Сравнение значений «как в Prisma» — Date через timestamp, остальное ===. */
  private equalsLoose(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (a instanceof Date && typeof b === 'string') {
      return a.getTime() === new Date(b).getTime();
    }
    return a === b;
  }
}
