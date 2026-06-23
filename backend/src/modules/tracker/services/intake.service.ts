import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, type IntakeIssue, type Task } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { BlockFetchService } from '../../knowledge-core/services/block-fetch.service';
import { computeExpiresAt } from '../../pending-actions/expires-at.util';
import type {
  CreateIntakeDto,
  ListIntakeQuery,
} from '../dto/intake/create-intake.dto';
import type {
  TriageIntakeDto,
  UpdateIntakeDto,
} from '../dto/intake/triage-intake.dto';
import type { IssueResponseDto } from '../dto/issues/issue-response.dto';

import { linkDerivedDecisionsForIssue } from './decision-task-link.util';
import { IntakeAutoTriageQueueService } from './intake-auto-triage-queue.service';
import { IssuesService } from './issues.service';
import { ProjectsService } from './projects.service';
import { TaskDedupService } from './task-dedup.service';
import { shouldMaterializeTask } from './task-quality-gate.util';
import { TrackerEventsService } from './tracker-events.service';
import { WebhookDispatcher } from './webhook-dispatcher.service';

export interface IntakeResponseDto {
  id: string;
  tenantId: string;
  projectId: string | null;
  status: string;
  source: string;
  sourceEmail: string | null;
  externalSource: string | null;
  externalId: string | null;
  rawContent: string;
  extractedTitle: string | null;
  extractedDescription: string | null;
  suggestedProjectId: string | null;
  suggestedAssigneeId: string | null;
  suggestedGoalId: string | null;
  /**
   * Человекочитаемые имена для suggested* (резолвятся только в списке `findAll`).
   * В одиночных ответах (create/update/triage) — null, чтобы не плодить запросы.
   * Если запись не найдена/удалена — остаётся null (сырой cuid не протекает в UI).
   */
  suggestedProjectName: string | null;
  suggestedAssigneeName: string | null;
  suggestedGoalTitle: string | null;
  suggestedPriority: string | null;
  suggestedDueDate: string | null;
  suggestedLabels: string[];
  /** A10 (2026-06-14) — IdeaBlock-источники кандидата (провенанс). */
  sourceBlockIds: string[];
  confidence: string | null;
  triagedByUserId: string | null;
  triagedAt: string | null;
  rejectedReason: string | null;
  snoozedUntil: string | null;
  createdIssueId: string | null;
  /** TZ task-dedup (2026-06-16) — открытая Issue-дубль, найденная арбитром (suggest). */
  suggestedDuplicateOfIssueId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListIntakeResponse {
  items: IntakeResponseDto[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Карты id→имя для обогащения suggested*-полей в списке intake.
 * - projectNames: projectId → Project.name
 * - goalTitles: goalId → Goal.name
 * - assigneeNames: userId → Person.name
 */
interface SuggestedNameMaps {
  projectNames: Map<string, string>;
  goalTitles: Map<string, string>;
  assigneeNames: Map<string, string>;
}

export interface TriageIntakeResult {
  intake: IntakeResponseDto;
  /** Создана при decision='accept'. */
  createdIssue: IssueResponseDto | null;
}

const CHATBOX_TASK_ID_PREFIX = 'chatbox-task:';

function normalizeTitleForDedup(title: string): string {
  return title.trim().toLowerCase().replace(/ё/gu, 'е');
}

/**
 * IntakeService — входящие задачи перед триажем (из webhook чек-инов,
 * email-адаптера, Telegram-бота, concierge-AI). Триаж: accept / reject /
 * snooze / duplicate.
 */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(TrackerEventsService)
    private readonly events: TrackerEventsService,
    @Inject(WebhookDispatcher)
    private readonly webhooks: WebhookDispatcher,
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService,
    // Wave 3 / Tracker Phase 3 part B — best-effort enqueue auto-triage.
    // @Optional, чтобы существующие unit-тесты IntakeService не упали
    // (там DI без Redis). В рантайме провайдер инжектится через TrackerModule.
    @Optional()
    @Inject(IntakeAutoTriageQueueService)
    private readonly autoTriageQueue?: IntakeAutoTriageQueueService,
    // A10 (2026-06-14) — резолв провенанса (canonical-блоки встречи) для
    // next-step → intake. @Optional: BlockFetchService — из @Global
    // KnowledgeCoreModule (как TaskAssigneeResolverService в
    // meeting-extract-actions); в unit-тестах IntakeService его не передают —
    // тогда провенанс резолвится в пустой массив (best-effort, не падаем).
    @Optional()
    @Inject(BlockFetchService)
    private readonly blockFetch?: BlockFetchService,
    // QA B1 (2026-06-15) — fallback-проект «Входящие» при accept без проекта
    // (решение владельца: не заставлять выбирать проект, класть в общую папку,
    // а пользователь позже вручную перенесёт задачу в нужный проект).
    // @Optional: в unit-тестах IntakeService строится без ProjectsService —
    // тогда дефолт-проект не создаётся и сохраняется прежняя 400-семантика
    // (тесты accept всегда передают targetProjectId, путь не задевается).
    @Optional()
    @Inject(ProjectsService)
    private readonly projects?: ProjectsService,
    // TZ task-dedup (2026-06-16, Ф1 уровень A) — дедуп-гейт перед записью
    // intake-карточки. @Optional: unit-тесты IntakeService строятся без него →
    // дедуп пропускается (карточка создаётся как есть, suggestedDuplicate=null).
    @Optional()
    @Inject(TaskDedupService)
    private readonly taskDedup?: TaskDedupService,
  ) {}

  /**
   * QA B1 (2026-06-15) — per-tenant дефолт-проект «Входящие» для задач без
   * привязки к конкретному проекту. Решение владельца: accept без проекта не
   * должен выдавать ошибку — задача кладётся в общую папку «Входящие».
   *
   * ВАЖНО — тот же проект, что использует авто-приём входящих
   * (`intake-auto-triage.worker.ts` → resolveInboxProjectId): find-or-create по
   * имени INBOX_PROJECT_NAME, владелец = владелец Org, network=0. Так ручной и
   * авто-триаж сходятся в ОДНУ папку (без дублей дефолт-проектов). Логику стоит
   * вынести в общий ProjectsService.ensureInboxProject при следующем касании
   * воркера (сейчас не трогаем W4-воркер и его тесты).
   *
   * Идемпотентно: findFirst по имени → create → при гонке повторный findFirst.
   * Возвращает null, если ProjectsService недоступен (DI без него — только
   * unit-тесты) или у Org нет владельца; вызывающий код тогда сохраняет прежнее
   * поведение (ошибка target_project_required).
   */
  private static readonly INBOX_PROJECT_NAME = 'Входящие';

  private async ensureInboxProjectId(tenantId: string): Promise<string | null> {
    if (!this.projects) return null;
    const findExisting = (): Promise<{ id: string } | null> =>
      this.prisma.project.findFirst({
        where: {
          tenantId,
          name: IntakeService.INBOX_PROJECT_NAME,
          deletedAt: null,
          archivedAt: null,
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
    const existing = await findExisting();
    if (existing) return existing.id;
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { ownerId: true },
    });
    const ownerId = org?.ownerId ?? null;
    if (!ownerId) return null;
    try {
      const created = await this.projects.create(
        {
          name: IntakeService.INBOX_PROJECT_NAME,
          description:
            'Задачи из внешних каналов без определённого проекта. Создан Корой автоматически (авто-приём входящих).',
          network: 0,
          timezone: 'Europe/Moscow',
          cycleViewEnabled: true,
          intakeViewEnabled: true,
          gantViewEnabled: false,
          timeTrackingEnabled: false,
        },
        tenantId,
        ownerId,
      );
      return created.id;
    } catch {
      // Гонка: параллельный accept/воркер уже создал «Входящие» — переиспользуем.
      const retry = await findExisting();
      return retry?.id ?? null;
    }
  }

  /** Создать intake-карточку. Не требует userId — может вызвать webhook-адаптер. */
  async create(
    dto: CreateIntakeDto,
    tenantId: string,
  ): Promise<IntakeResponseDto> {
    // TZ task-dedup (2026-06-16, Ф1 уровень A) — дедуп-гейт ПЕРЕД записью.
    // Best-effort (R4): любой сбой/таймаут → verdict='nil', карточка создаётся
    // как есть. verdict='same' → пишем suggestedDuplicateOfIssueId, что блокирует
    // авто-accept в auto-triage (route to human). Авто-merge НЕ делаем (R13).
    let suggestedDuplicateOfIssueId: string | null = null;
    if (this.taskDedup) {
      const dedup = await this.taskDedup.evaluate({
        tenantId,
        title: dto.extractedTitle ?? dto.rawContent,
        description: dto.extractedDescription ?? null,
      });
      if (dedup.verdict === 'same') {
        suggestedDuplicateOfIssueId = dedup.matchedIssueId;
        this.logger.log(
          {
            tenantId,
            matchedIssueId: dedup.matchedIssueId,
            similarity: dedup.similarity,
          },
          'intake create: дедуп-арбитр нашёл дубль — помечаем suggestedDuplicateOfIssueId',
        );
      }
    }

    const created = await this.prisma.intakeIssue.create({
      data: {
        tenantId,
        projectId: dto.projectId ?? null,
        suggestedDuplicateOfIssueId,
        source: dto.source,
        sourceEmail: dto.sourceEmail ?? null,
        externalSource: dto.externalSource ?? null,
        externalId: dto.externalId ?? null,
        rawContent: dto.rawContent,
        extractedTitle: dto.extractedTitle ?? null,
        extractedDescription: dto.extractedDescription ?? null,
        suggestedProjectId: dto.suggestedProjectId ?? null,
        suggestedAssigneeId: dto.suggestedAssigneeId ?? null,
        suggestedGoalId: dto.suggestedGoalId ?? null,
        suggestedPriority: dto.suggestedPriority ?? null,
        suggestedDueDate: dto.suggestedDueDate ?? null,
        suggestedLabels: dto.suggestedLabels,
        // A10 (2026-06-14) — провенанс кандидата (IdeaBlock-источники).
        sourceBlockIds: dto.sourceBlockIds,
        meetingId: dto.meetingId ?? null,
        confidence:
          dto.confidence != null
            ? new Prisma.Decimal(dto.confidence)
            : null,
        // Редизайн Ф4 (2026-06-13) — авто-протухание: sweep-крон закроет
        // pending-intake после TTL (cfg.pendingActions.intakeTtlDays). TODO:
        // крутилка позже уедет в AdminSetting UI.
        expiresAt: computeExpiresAt(this.cfg.pendingActions.intakeTtlDays),
      },
    });
    const response = this.toResponse(created);
    this.events.publishIntakeNewItem(created.id, tenantId);
    void this.webhooks
      .dispatch(tenantId, 'intake.created', { intake: response })
      .catch((e) => {
        this.logger.warn(
          { intakeId: created.id, err: e instanceof Error ? e.message : String(e) },
          'intake.created webhook dispatch failed',
        );
      });
    // Wave 3 / Tracker Phase 3 part B — best-effort enqueue auto-triage.
    // Если auto-triage queue не подключена (например, в тестах) — пропускаем.
    if (this.autoTriageQueue) {
      void this.autoTriageQueue
        .enqueue({ tenantId, intakeIssueId: created.id })
        .catch((e) => {
          this.logger.warn(
            {
              intakeId: created.id,
              err: e instanceof Error ? e.message : String(e),
            },
            'intake-auto-triage enqueue failed (best-effort)',
          );
        });
    }
    return response;
  }

  /**
   * Редизайн кабинета Ф5а (2026-06-13) — «следующий шаг отчёта → кандидат в
   * задачу». Создаёт IntakeIssue (source='meeting') из текста next-step отчёта
   * встречи. Сама задача появится только после триажа (accept) — здесь только
   * кандидат.
   *
   * Идемпотентность: externalId детерминирован по (meetingId + sha1(text)),
   * source='meeting'. Повторный вызов с тем же text по той же встрече вернёт
   * уже существующий intake (не плодит дубль).
   *
   * tenant-изоляция: проверяем, что встреча принадлежит tenantId (404 иначе) —
   * без зависимости от MeetingsService (разрыв цикла meetings↔tracker).
   *
   * A10 (2026-06-14) — петля провенанса замкнута. `sourceBlockIds` либо
   * передаёт FE явно (если знает блоки-источники), либо backend резолвит их по
   * canonical-блокам встречи (BlockFetchService) — берём action-несущие сигналы
   * (commitment / plan_item / task_created / decision), которые и порождают
   * next-step в отчёте и пересекаются с `Decision.sourceBlockIds`. Резолв
   * best-effort: при отсутствии BlockFetchService / RawEvent / блоков пишем
   * пустой массив, не падаем. Дальше при промоуте в Issue эти блоки рождают
   * `DecisionTaskLink(linkType='derived')`.
   */
  async createFromMeetingNextStep(args: {
    meetingId: string;
    text: string;
    description?: string | null;
    sourceBlockIds?: string[] | null;
    tenantId: string;
  }): Promise<IntakeResponseDto> {
    const { meetingId, tenantId } = args;
    const text = args.text.trim();
    if (text.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'text_required', message: 'Текст следующего шага пуст' },
      });
    }

    // tenant-изоляция: встреча должна принадлежать организации.
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!meeting) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'meeting_not_found', message: 'Встреча не найдена' },
      });
    }

    // Детерминированный externalId для идемпотентности (max 200 симв в схеме).
    const textHash = createHash('sha1').update(text).digest('hex').slice(0, 16);
    const externalId = `meeting:${meetingId}:${textHash}`.slice(0, 200);

    // Если уже создавали этот же next-step по этой встрече — вернуть его.
    const existing = await this.prisma.intakeIssue.findFirst({
      where: { tenantId, source: 'meeting', externalSource: 'meeting', externalId },
    });
    if (existing) {
      this.logger.debug(
        { meetingId, externalId },
        'intake from next-step: дубль — возвращаем существующий',
      );
      return this.toResponse(existing);
    }

    // Ф0 (ТЗ 2026-06-16) — детерминированный гейт качества ПЕРЕД созданием
    // задачи из AI-источника (следующий шаг отчёта встречи). Не материализуем
    // «мусор» (вопрос/намерение без ответственного и срока). Чистые правила,
    // без LLM. Прямые доверенные пути (email/in_app/self-task) сюда не заходят —
    // они идут через generic `create()` с источником-человеком (§6 boundary).
    // [ASSUMPTION: next-step отчёта — доверенный источник (report-агент уже
    // отфильтровал болтовню), поэтому применяем только форм-гейт (отсеять
    // вопрос/намерение), не требуя owner/срок — потому что эти поля на пути
    // next-step не извлекаются вовсе, а строгое требование зарубило бы всю фичу]
    const gate = shouldMaterializeTask({
      title: text,
      ownerUserId: null,
      ownerHint: null,
      dueDate: null,
      source: 'meeting_next_step',
    });
    if (!gate.ok) {
      this.logger.log(
        { meetingId, reason: gate.reason },
        'intake from next-step: гейт качества не пропустил задачу',
      );
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'task_quality_gate_rejected',
          message:
            'Текст не похож на задачу с ответственным или сроком — не создаём карточку',
        },
      });
    }

    // A10 — провенанс: явный список от FE имеет приоритет, иначе резолвим по
    // canonical-блокам встречи (best-effort, пустой массив при сбое).
    const explicit = (args.sourceBlockIds ?? []).filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    const sourceBlockIds =
      explicit.length > 0
        ? explicit
        : await this.resolveMeetingSourceBlockIds(meetingId, tenantId);

    return this.create(
      {
        source: 'meeting',
        rawContent: text,
        extractedTitle: text.slice(0, 120),
        extractedDescription: args.description?.trim() || null,
        externalSource: 'meeting',
        externalId,
        suggestedLabels: [],
        sourceBlockIds,
        meetingId,
      },
      tenantId,
    );
  }

  /**
   * A10 (2026-06-14) — провенанс next-step → canonical-блоки встречи.
   * Берём action-несущие сигналы (commitment / plan_item / task_created /
   * decision): именно из них формируются «следующие шаги» в отчёте и именно
   * они пересекаются с `Decision.sourceBlockIds` (→ DecisionTaskLink derived).
   * Best-effort: нет BlockFetchService / RawEvent / блоков → пустой массив.
   * Никогда не бросает — провенанс необязателен, intake создаётся в любом случае.
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
      const ids = blocks
        .filter((b) => ACTION_SIGNALS.has(b.signalType))
        .map((b) => b.id);
      return ids.slice(0, 64);
    } catch (e) {
      this.logger.warn(
        {
          meetingId,
          err: e instanceof Error ? e.message : String(e),
        },
        'intake from next-step: резолв sourceBlockIds упал — пустой провенанс',
      );
      return [];
    }
  }

  /**
   * Список intake-карточек. Доступ: admin / project_manager.
   *
   * Зеркало очереди подтверждений (A4, 2026-06-14): экран `/intake` — это
   * детальный триаж-вид той же pending-секции, что агрегирует
   * `IntakePendingProvider` в `/actions`. Чтобы число «требует разбора» на
   * `/intake` совпадало со вкладом intake в счётчик `/actions`, дефолтный вид
   * (status='pending' ИЛИ статус не задан явно) исключает карточки, которые
   * пользователь отложил через единую очередь (`PendingActionSnooze`,
   * source='intake', активный snoozedUntil) — ровно тем же фильтром, что
   * провайдер. Явный `status=accepted|rejected|...` snooze НЕ применяет —
   * история разобранных остаётся полной. snooze привязан к пользователю,
   * поэтому исключение работает только когда передан `userId` (вызов из
   * REST-контроллера); без userId (внутренние вызовы) — поведение прежнее.
   */
  async findAll(
    tenantId: string,
    query: ListIntakeQuery,
    userId?: string,
  ): Promise<ListIntakeResponse> {
    const where: Prisma.IntakeIssueWhereInput = { tenantId };
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.projectId) where.projectId = query.projectId;

    // snooze-aware «требует разбора»: исключаем карточки, отложенные этим
    // пользователем через очередь /actions. Только для pending-вида (явный
    // status='pending' либо статус не задан) — иначе ломали бы историю.
    const pendingDefaultView = query.status === undefined || query.status === 'pending';
    if (pendingDefaultView && userId) {
      const snoozedIds = await this.loadSnoozedIntakeIds(tenantId, userId);
      if (snoozedIds.length > 0) {
        where.id = { notIn: snoozedIds };
      }
    }

    const includeChatbox =
      this.cfg.tracker.chatboxTasksInTriageEnabled &&
      pendingDefaultView &&
      query.source === undefined &&
      query.projectId === undefined;

    if (!includeChatbox) {
      const [items, total] = await Promise.all([
        this.prisma.intakeIssue.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        }),
        this.prisma.intakeIssue.count({ where }),
      ]);
      const names = await this.resolveSuggestedNames(tenantId, items);
      return {
        items: items.map((i) => this.toResponse(i, names)),
        total,
        page: query.page,
        limit: query.limit,
      };
    }

    const intakeRows = await this.prisma.intakeIssue.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
    });
    const chatboxTasks = await this.prisma.task.findMany({
      where: { tenantId, sourceType: 'chatbox', status: 'open' },
      orderBy: [{ createdAt: 'desc' }],
    });

    const dedupTitles = await this.loadOpenTitlesForDedup(tenantId, intakeRows);
    const chatboxKept = chatboxTasks.filter(
      (t) => !dedupTitles.has(normalizeTitleForDedup(t.title)),
    );

    const names = await this.resolveSuggestedNames(
      tenantId,
      intakeRows,
      chatboxKept,
    );
    const merged: Array<{ createdAt: Date; dto: IntakeResponseDto }> = [
      ...intakeRows.map((i) => ({
        createdAt: i.createdAt,
        dto: this.toResponse(i, names),
      })),
      ...chatboxKept.map((t) => ({
        createdAt: t.createdAt,
        dto: this.toResponseFromChatboxTask(t, names),
      })),
    ];
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = merged.length;
    const start = (query.page - 1) * query.limit;
    const items = merged
      .slice(start, start + query.limit)
      .map((m) => m.dto);
    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Кросс-дедуп для read-union триажа (Блок B / F10): нормализованные title
   * открытых IntakeIssue (уже в выборке) + открытых Issue этого tenant. Если
   * нормализованный title chatbox-Task совпадает с любым из них — задачу не
   * показываем (одна задача из встречи и из чата). Best-effort: сбой Issue-выборки
   * не ломает ленту — возвращаем title'ы только из intake-выборки.
   */
  private async loadOpenTitlesForDedup(
    tenantId: string,
    intakeRows: IntakeIssue[],
  ): Promise<Set<string>> {
    const titles = new Set<string>();
    for (const i of intakeRows) {
      const t = i.extractedTitle ?? i.rawContent;
      if (t) titles.add(normalizeTitleForDedup(t));
    }
    try {
      const openIssues = await this.prisma.issue.findMany({
        where: {
          tenantId,
          deletedAt: null,
          archivedAt: null,
          completedAt: null,
        },
        select: { title: true },
      });
      for (const issue of openIssues) {
        titles.add(normalizeTitleForDedup(issue.title));
      }
    } catch (e) {
      this.logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'intake findAll: кросс-дедуп по Issue упал — дедупим только по intake',
      );
    }
    return titles;
  }

  /**
   * Активные snooze пользователя для intake-карточек (PendingActionSnooze,
   * source='intake', snoozedUntil ещё в будущем). Возвращает resourceId'ы —
   * id IntakeIssue, которые надо исключить из pending-вида. Тот же критерий,
   * что `PendingActionsService.loadSnoozedBySource` → `IntakePendingProvider`,
   * чтобы число pending на /intake совпадало с очередью /actions.
   */
  private async loadSnoozedIntakeIds(
    tenantId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.pendingActionSnooze.findMany({
      where: {
        tenantId,
        userId,
        source: 'intake',
        snoozedUntil: { gt: new Date() },
      },
      select: { resourceId: true },
    });
    return rows.map((r) => r.resourceId);
  }

  /**
   * Батч-резолв человекочитаемых имён для suggested*-полей списка intake.
   * Ровно 3 запроса (project / goal / person), все с фильтром по tenantId.
   * - suggestedProjectId → Project.name
   * - suggestedGoalId → Goal.name (в схеме поле названия цели — `name`)
   * - suggestedAssigneeId — это userId → Person.name (по Person.userId)
   * Отсутствующие/удалённые записи в карты не попадают → имя останется null.
   */
  private async resolveSuggestedNames(
    tenantId: string,
    items: IntakeIssue[],
    chatboxTasks: Task[] = [],
  ): Promise<SuggestedNameMaps> {
    const projectIds = new Set<string>();
    const goalIds = new Set<string>();
    const assigneeUserIds = new Set<string>();
    for (const i of items) {
      if (i.suggestedProjectId) projectIds.add(i.suggestedProjectId);
      if (i.suggestedGoalId) goalIds.add(i.suggestedGoalId);
      if (i.suggestedAssigneeId) assigneeUserIds.add(i.suggestedAssigneeId);
    }
    for (const t of chatboxTasks) {
      if (t.assigneeUserId) assigneeUserIds.add(t.assigneeUserId);
    }

    const [projects, goals, persons] = await Promise.all([
      projectIds.size > 0
        ? this.prisma.project.findMany({
            where: { id: { in: [...projectIds] }, tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      goalIds.size > 0
        ? this.prisma.goal.findMany({
            where: { id: { in: [...goalIds] }, tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      assigneeUserIds.size > 0
        ? this.prisma.person.findMany({
            where: { userId: { in: [...assigneeUserIds] }, tenantId },
            select: { userId: true, name: true },
          })
        : Promise.resolve([] as { userId: string | null; name: string }[]),
    ]);

    const projectNames = new Map<string, string>();
    for (const p of projects) projectNames.set(p.id, p.name);
    const goalTitles = new Map<string, string>();
    for (const g of goals) goalTitles.set(g.id, g.name);
    const assigneeNames = new Map<string, string>();
    for (const p of persons) {
      if (p.userId) assigneeNames.set(p.userId, p.name);
    }

    return { projectNames, goalTitles, assigneeNames };
  }

  /** PATCH полей intake (extraction overrides / suggestions). */
  async update(
    id: string,
    dto: UpdateIntakeDto,
    tenantId: string,
    _userId: string,
  ): Promise<IntakeResponseDto> {
    await this.requireIntake(id, tenantId);
    const updated = await this.prisma.intakeIssue.update({
      where: { id },
      data: {
        ...(dto.extractedTitle !== undefined && {
          extractedTitle: dto.extractedTitle,
        }),
        ...(dto.extractedDescription !== undefined && {
          extractedDescription: dto.extractedDescription,
        }),
        ...(dto.projectId !== undefined && { projectId: dto.projectId }),
        ...(dto.suggestedProjectId !== undefined && {
          suggestedProjectId: dto.suggestedProjectId,
        }),
        ...(dto.suggestedAssigneeId !== undefined && {
          suggestedAssigneeId: dto.suggestedAssigneeId,
        }),
        ...(dto.suggestedGoalId !== undefined && {
          suggestedGoalId: dto.suggestedGoalId,
        }),
        ...(dto.suggestedPriority !== undefined && {
          suggestedPriority: dto.suggestedPriority,
        }),
        ...(dto.suggestedDueDate !== undefined && {
          suggestedDueDate: dto.suggestedDueDate,
        }),
        ...(dto.suggestedLabels !== undefined && {
          suggestedLabels: dto.suggestedLabels,
        }),
      },
    });
    return this.toResponse(updated);
  }

  /**
   * Триаж intake. accept → создаёт Issue в targetProjectId; reject → status=
   * 'rejected' + reason; snooze → status='snoozed' + snoozedUntil; duplicate →
   * status='duplicate' + ссылка на createdIssueId=duplicateOfIssueId.
   */
  async triage(
    id: string,
    dto: TriageIntakeDto,
    tenantId: string,
    userId: string,
  ): Promise<TriageIntakeResult> {
    if (id.startsWith(CHATBOX_TASK_ID_PREFIX)) {
      return this.triageChatboxTask(
        id.slice(CHATBOX_TASK_ID_PREFIX.length),
        dto,
        tenantId,
        userId,
      );
    }

    const intake = await this.requireIntake(id, tenantId);
    if (intake.status !== 'pending' && intake.status !== 'snoozed') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'intake_already_triaged',
          message: `Intake уже в статусе '${intake.status}'`,
        },
      });
    }

    let createdIssue: IssueResponseDto | null = null;
    const triagedAt = new Date();

    if (dto.decision === 'accept') {
      // QA B1 (2026-06-15) — порядок выбора проекта: явный выбор → привязка
      // кандидата → AI-предложение → fallback «Входящие». Решение владельца:
      // задача без проекта не должна выдавать ошибку — кладём в общую папку,
      // а пользователь позже вручную перенесёт её в нужный проект.
      const targetProjectId =
        dto.targetProjectId ??
        intake.projectId ??
        intake.suggestedProjectId ??
        (await this.ensureInboxProjectId(tenantId));
      if (!targetProjectId) {
        // Сюда попадаем только если ProjectsService недоступен (unit-тесты DI
        // без него); в проде дефолт-проект гарантирован выше.
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'target_project_required',
            message: 'Не указан проект для создания задачи',
          },
        });
      }
      const title =
        dto.overrideTitle ??
        intake.extractedTitle ??
        intake.rawContent.slice(0, 200);
      const description =
        dto.overrideDescription ??
        intake.extractedDescription ??
        intake.rawContent;
      createdIssue = await this.issues.create(
        targetProjectId,
        {
          title,
          description,
          descriptionHtml: null,
          descriptionStripped: description,
          priority:
            dto.overridePriority ??
            (intake.suggestedPriority as
              | 'urgent'
              | 'high'
              | 'medium'
              | 'low'
              | 'none'
              | null) ??
            'none',
          stateId: null,
          parentId: null,
          estimatePoints: null,
          sortOrder: 0,
          startDate: null,
          dueDate: dto.overrideDueDate ?? intake.suggestedDueDate ?? null,
          cycleId: null,
          goalId: dto.overrideGoalId ?? intake.suggestedGoalId ?? null,
          assigneeUserIds:
            dto.overrideAssigneeUserIds ??
            (intake.suggestedAssigneeId ? [intake.suggestedAssigneeId] : []),
          labelIds: [], // matching label ids — Sprint 2 (resolve по suggestedLabels)
          externalSource: intake.externalSource ?? intake.source,
          externalId: intake.externalId,
          // A10 (2026-06-14) — провенанс intake → Issue.
          sourceBlockIds: intake.sourceBlockIds,
          linkedMeetingIds: intake.meetingId ? [intake.meetingId] : [],
          // TZ task-dedup (2026-06-16) — дедуп уже отработал на уровне A
          // (intake create); двойной suggest не нужен.
          skipDedup: true,
        },
        tenantId,
        userId,
      );
      // A10 — замыкание петли: пересечение sourceBlockIds задачи с
      // Decision.sourceBlockIds той же Org → DecisionTaskLink('derived').
      // Best-effort: ошибка не должна откатывать уже созданную задачу.
      await this.linkDerivedDecisions(
        tenantId,
        createdIssue.id,
        intake.sourceBlockIds,
      );
    } else if (dto.decision === 'snooze' && !dto.snoozedUntil) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'snoozed_until_required',
          message: 'Для snooze требуется snoozedUntil',
        },
      });
    } else if (dto.decision === 'duplicate' && !dto.duplicateOfIssueId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'duplicate_of_issue_required',
          message: 'Для duplicate требуется duplicateOfIssueId',
        },
      });
    }

    const updated = await this.prisma.intakeIssue.update({
      where: { id },
      data: {
        status:
          dto.decision === 'accept'
            ? 'accepted'
            : dto.decision === 'reject'
              ? 'rejected'
              : dto.decision === 'snooze'
                ? 'snoozed'
                : 'duplicate',
        triagedByUserId: userId,
        triagedAt,
        rejectedReason:
          dto.decision === 'reject' ? (dto.reason ?? null) : null,
        snoozedUntil:
          dto.decision === 'snooze' ? (dto.snoozedUntil ?? null) : null,
        createdIssueId:
          dto.decision === 'accept'
            ? (createdIssue?.id ?? null)
            : dto.decision === 'duplicate'
              ? (dto.duplicateOfIssueId ?? null)
              : null,
      },
    });

    const result: TriageIntakeResult = {
      intake: this.toResponse(updated),
      createdIssue,
    };
    this.events.publishIntakeTriaged({
      intakeId: id,
      tenantId,
      decision: dto.decision,
      createdIssueId: createdIssue?.id ?? null,
    });
    void this.webhooks
      .dispatch(tenantId, 'intake.triaged', {
        intake: result.intake,
        decision: dto.decision,
        createdIssueId: createdIssue?.id ?? null,
      })
      .catch((e) => {
        this.logger.warn(
          { intakeId: id, err: e instanceof Error ? e.message : String(e) },
          'intake.triaged webhook dispatch failed',
        );
      });
    return result;
  }

  /**
   * Блок B / F10 — промоут chatbox-Task на триаже. accept → создаёт Issue из
   * Task (тот же путь выбора проекта, что у IntakeIssue: явный → Inbox-fallback)
   * и помечает Task `done` (идемпотентно: уже done → no-op). reject → помечает
   * Task `done` без создания Issue. snooze/duplicate для chatbox-Task не
   * поддержаны (нет состояния «отложено» у Task) — best-effort no-op c пометкой.
   * Ответ — той же формы (`TriageIntakeResult`), что обычный триаж.
   */
  private async triageChatboxTask(
    taskId: string,
    dto: TriageIntakeDto,
    tenantId: string,
    userId: string,
  ): Promise<TriageIntakeResult> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, tenantId, sourceType: 'chatbox' },
    });
    if (!task) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'intake_not_found', message: 'Intake-карточка не найдена' },
      });
    }
    if (task.status !== 'open') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'intake_already_triaged',
          message: `Задача уже в статусе '${task.status}'`,
        },
      });
    }

    let createdIssue: IssueResponseDto | null = null;

    if (dto.decision === 'accept') {
      const targetProjectId =
        dto.targetProjectId ?? (await this.ensureInboxProjectId(tenantId));
      if (!targetProjectId) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'target_project_required',
            message: 'Не указан проект для создания задачи',
          },
        });
      }
      const title = dto.overrideTitle ?? task.title;
      const description =
        dto.overrideDescription ?? task.description ?? task.title;
      createdIssue = await this.issues.create(
        targetProjectId,
        {
          title,
          description,
          descriptionHtml: null,
          descriptionStripped: description,
          priority: dto.overridePriority ?? 'none',
          stateId: null,
          parentId: null,
          estimatePoints: null,
          sortOrder: 0,
          startDate: null,
          dueDate: dto.overrideDueDate ?? task.dueDate ?? null,
          cycleId: null,
          goalId: dto.overrideGoalId ?? null,
          assigneeUserIds:
            dto.overrideAssigneeUserIds ??
            (task.assigneeUserId ? [task.assigneeUserId] : []),
          labelIds: [],
          externalSource: 'chatbox',
          externalId: null,
          sourceBlockIds: [],
          linkedMeetingIds: [],
          skipDedup: true,
        },
        tenantId,
        userId,
      );
      try {
        await this.prisma.taskSource.create({
          data: {
            tenantId,
            issueId: createdIssue.id,
            sourceType: 'chatbox',
            sourceRefId: task.sourceChatSessionId ?? task.id,
            quote: task.sourceQuote ?? null,
          },
        });
      } catch (e) {
        if ((e as { code?: string })?.code !== 'P2002') {
          this.logger.warn(
            {
              taskId,
              issueId: createdIssue.id,
              err: e instanceof Error ? e.message : String(e),
            },
            'triageChatboxTask: TaskSource provenance link failed (best-effort)',
          );
        }
      }
    } else if (dto.decision === 'snooze' && !dto.snoozedUntil) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'snoozed_until_required',
          message: 'Для snooze требуется snoozedUntil',
        },
      });
    } else if (dto.decision === 'duplicate' && !dto.duplicateOfIssueId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'duplicate_of_issue_required',
          message: 'Для duplicate требуется duplicateOfIssueId',
        },
      });
    }

    const closesTask =
      dto.decision === 'accept' ||
      dto.decision === 'reject' ||
      dto.decision === 'duplicate';
    if (closesTask) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'done' },
      });
    }

    const intakeView: IntakeResponseDto = {
      ...this.toResponseFromChatboxTask({
        ...task,
        status: closesTask ? 'done' : task.status,
      }),
      status:
        dto.decision === 'accept'
          ? 'accepted'
          : dto.decision === 'reject'
            ? 'rejected'
            : dto.decision === 'snooze'
              ? 'snoozed'
              : 'duplicate',
      triagedByUserId: userId,
      triagedAt: new Date().toISOString(),
      createdIssueId:
        dto.decision === 'accept'
          ? (createdIssue?.id ?? null)
          : dto.decision === 'duplicate'
            ? (dto.duplicateOfIssueId ?? null)
            : null,
    };

    this.events.publishIntakeTriaged({
      intakeId: `${CHATBOX_TASK_ID_PREFIX}${taskId}`,
      tenantId,
      decision: dto.decision,
      createdIssueId: createdIssue?.id ?? null,
    });

    return { intake: intakeView, createdIssue };
  }

  /**
   * A10 (2026-06-14) — связывает созданную из intake задачу с пересекающимися
   * по `sourceBlockIds` Decision'ами (linkType='derived'). Тонкая обёртка над
   * общим хелпером `linkDerivedDecisionsForIssue` (тот же код, что в
   * IntakeAutoTriageWorker). Best-effort: лог + продолжаем, чтобы сбой линковки
   * не откатывал уже принятый intake / созданную задачу.
   */
  private async linkDerivedDecisions(
    tenantId: string,
    issueId: string,
    sourceBlockIds: string[],
  ): Promise<void> {
    try {
      const created = await linkDerivedDecisionsForIssue(this.prisma, {
        tenantId,
        issueId,
        sourceBlockIds,
      });
      if (created > 0) {
        this.logger.debug(
          { issueId, created },
          'intake triage: создано DecisionTaskLink(derived)',
        );
      }
    } catch (e) {
      this.logger.warn(
        { issueId, err: e instanceof Error ? e.message : String(e) },
        'intake triage: линковка derived-решений упала (best-effort)',
      );
    }
  }

  private async requireIntake(
    id: string,
    tenantId: string,
  ): Promise<IntakeIssue> {
    const i = await this.prisma.intakeIssue.findFirst({
      where: { id, tenantId },
    });
    if (!i) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'intake_not_found', message: 'Intake-карточка не найдена' },
      });
    }
    return i;
  }

  private toResponse(
    i: IntakeIssue,
    names?: SuggestedNameMaps,
  ): IntakeResponseDto {
    return {
      id: i.id,
      tenantId: i.tenantId,
      projectId: i.projectId,
      status: i.status,
      source: i.source,
      sourceEmail: i.sourceEmail,
      externalSource: i.externalSource,
      externalId: i.externalId,
      rawContent: i.rawContent,
      extractedTitle: i.extractedTitle,
      extractedDescription: i.extractedDescription,
      suggestedProjectId: i.suggestedProjectId,
      suggestedAssigneeId: i.suggestedAssigneeId,
      suggestedGoalId: i.suggestedGoalId,
      suggestedProjectName:
        (i.suggestedProjectId &&
          names?.projectNames.get(i.suggestedProjectId)) ||
        null,
      suggestedAssigneeName:
        (i.suggestedAssigneeId &&
          names?.assigneeNames.get(i.suggestedAssigneeId)) ||
        null,
      suggestedGoalTitle:
        (i.suggestedGoalId && names?.goalTitles.get(i.suggestedGoalId)) ||
        null,
      suggestedPriority: i.suggestedPriority,
      suggestedDueDate: i.suggestedDueDate?.toISOString() ?? null,
      suggestedLabels: i.suggestedLabels,
      sourceBlockIds: i.sourceBlockIds,
      confidence: i.confidence?.toString() ?? null,
      triagedByUserId: i.triagedByUserId,
      triagedAt: i.triagedAt?.toISOString() ?? null,
      rejectedReason: i.rejectedReason,
      snoozedUntil: i.snoozedUntil?.toISOString() ?? null,
      createdIssueId: i.createdIssueId,
      suggestedDuplicateOfIssueId: i.suggestedDuplicateOfIssueId,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    };
  }

  /**
   * Блок B / F10 (read-union) — адаптер chatbox-Task в элемент той же формы,
   * что отдаёт `toResponse` для IntakeIssue. Синтетический id с префиксом
   * `chatbox-task:`<Task.id> — по нему `triage` различает источник и промоутит
   * Task→Issue. Поля, которых у Task нет, отдаём как null/пустые — форма
   * совпадает 1-в-1 с IntakeResponseDto.
   */
  private toResponseFromChatboxTask(
    t: Task,
    names?: SuggestedNameMaps,
  ): IntakeResponseDto {
    return {
      id: `${CHATBOX_TASK_ID_PREFIX}${t.id}`,
      tenantId: t.tenantId ?? '',
      projectId: null,
      status: 'pending',
      source: 'chatbox',
      sourceEmail: null,
      externalSource: null,
      externalId: null,
      rawContent: t.title,
      extractedTitle: t.title,
      extractedDescription: t.description,
      suggestedProjectId: null,
      suggestedAssigneeId: t.assigneeUserId,
      suggestedGoalId: null,
      suggestedProjectName: null,
      suggestedAssigneeName:
        (t.assigneeUserId && names?.assigneeNames.get(t.assigneeUserId)) ||
        null,
      suggestedGoalTitle: null,
      suggestedPriority: null,
      suggestedDueDate: t.dueDate?.toISOString() ?? null,
      suggestedLabels: [],
      sourceBlockIds: [],
      confidence: null,
      triagedByUserId: null,
      triagedAt: null,
      rejectedReason: null,
      snoozedUntil: null,
      createdIssueId: null,
      suggestedDuplicateOfIssueId: null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
}
