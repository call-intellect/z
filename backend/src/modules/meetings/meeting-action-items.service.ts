import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * MeetingActionItemsService — единая точка чтения «задач встречи» (action items).
 *
 * ТЗ 2026-06-04 meeting-identity-and-clones-attribution, Фаза 5.2
 * («Единая видимая задача»).
 *
 * Источник правды для action-items встречи переключается AdminSetting-флагом
 * `knowledge.meetingTasksToTrackerOnly` (code-fallback FALSE — поэтапная
 * раскатка, текущее поведение):
 *   - FALSE (дефолт): читаем внутренний `Task` (где `meetingId` = встреча) —
 *     ровно как все потребители делали до этой фазы. Ноль изменений в проде до
 *     включения флага владельцем.
 *   - TRUE: видимая задача = tracker `Issue`, связанный со встречей через
 *     `linkedMeetingIds` (`externalSource='meeting'`). Внутренний `Task` для
 *     action-items в этом режиме не создаётся (gate в meeting-report-fast.worker).
 *
 * Все запросы tenant- / owner-scoped (как у каждого потребителя по отдельности).
 * Нормализованная форма `MeetingActionItem` — суперсет полей, нужных всем шести
 * потребителям; каждый маппит её обратно в свой выходной контракт.
 *
 * Сервис объявлен и экспортирован из `@Global() MeetingsModule`, поэтому
 * инжектируется в любой модуль без дополнительных imports (минимум cross-module DI).
 */

/** Флаг — читаем через `getDynamic` (AdminSetting), code-fallback FALSE. */
const FLAG_KEY = 'knowledge.meetingTasksToTrackerOnly';

/**
 * Нормализованная задача встречи. Даты — `Date | null` (потребители сами
 * сериализуют в ISO там, где нужно). Поля подобраны как суперсет того, что
 * читают все потребители: admin (description/assigneeRaw/extractorVersion),
 * exports/chat (title/assigneeRaw/dueDate), search (id/title/status/meetingId).
 */
export interface MeetingActionItem {
  id: string;
  meetingId: string;
  title: string;
  description: string | null;
  status: string;
  assigneeRaw: string | null;
  assigneeUserId: string | null;
  dueDate: Date | null;
  sourceQuote: string | null;
  confidence: number | null;
  extractorVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Облегчённая форма для глобального поиска (⌘K) — поиск по заголовку. */
export interface MeetingActionItemSearchRow {
  id: string;
  title: string;
  status: string;
  meetingId: string;
}

/**
 * Маппинг `IssueState.category` → строковый статус в стиле `TaskStatus`.
 * Зеркало `TASK_STATUS_TO_CATEGORY` из `scripts/migrate-task-to-issue.ts`.
 */
function issueCategoryToStatus(category: string | null | undefined): string {
  switch (category) {
    case 'started':
      return 'in_progress';
    case 'completed':
      return 'done';
    case 'cancelled':
      return 'cancelled';
    case 'backlog':
    case 'unstarted':
    default:
      return 'open';
  }
}

@Injectable()
export class MeetingActionItemsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /** true → читаем Issue; false (дефолт) → читаем Task. */
  private async trackerOnly(): Promise<boolean> {
    return this.cfg.getDynamic<boolean>(FLAG_KEY, undefined, false);
  }

  /**
   * Публичное чтение флага. Нужно потребителям, которым важно знать режим
   * до маппинга (например public API сохраняет байт-в-байт форму Task при OFF).
   */
  async isTrackerOnly(): Promise<boolean> {
    return this.trackerOnly();
  }

  /**
   * Задачи одной встречи в нормализованной форме.
   *
   * @param args.userId — если задан, при FLAG=OFF дополнительно фильтрует Task
   *   по `userId` (как делают owner-scoped потребители: public-api, internal
   *   tasks). При FLAG=ON используется как owner-фильтр Issue (createdById или
   *   назначенный исполнитель). Пропусти его для tenant-широких потребителей
   *   (admin / exports / chat / bulk-zip).
   */
  async listForMeeting(args: {
    meetingId: string;
    tenantId: string;
    userId?: string;
  }): Promise<MeetingActionItem[]> {
    if (await this.trackerOnly()) {
      return this.listIssuesForMeeting(args);
    }
    return this.listTasksForMeeting(args);
  }

  /**
   * Поиск action-items по заголовку для глобального поиска (⌘K).
   * Гейт-парный с `listForMeeting`: OFF → Task пользователя, ON → Issue,
   * связанные со встречами (externalSource='meeting'), доступные пользователю.
   */
  async searchTitlesForUser(args: {
    tenantId: string;
    userId: string;
    query: string;
    limit: number;
  }): Promise<MeetingActionItemSearchRow[]> {
    if (await this.trackerOnly()) {
      return this.searchMeetingIssues(args);
    }
    return this.searchTasks(args);
  }

  // ───────────────────────────── Task-ветка (OFF, дефолт) ──────────────────

  private async listTasksForMeeting(args: {
    meetingId: string;
    tenantId: string;
    userId?: string;
  }): Promise<MeetingActionItem[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        meetingId: args.meetingId,
        // Пустой tenantId трактуем как «без tenant-фильтра» — так legacy-встречи
        // с tenantId=null не теряют свои Task (сохраняем прежнее поведение
        // потребителей, которые читали Task только по meetingId).
        ...(args.tenantId ? { tenantId: args.tenantId } : {}),
        ...(args.userId ? { userId: args.userId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((t) => ({
      id: t.id,
      meetingId: t.meetingId,
      title: t.title,
      description: t.description ?? null,
      status: t.status,
      assigneeRaw: t.assigneeRaw ?? null,
      assigneeUserId: t.assigneeUserId ?? null,
      dueDate: t.dueDate ?? null,
      sourceQuote: t.sourceQuote ?? null,
      confidence: t.confidence ?? null,
      extractorVersion: t.extractorVersion ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  private async searchTasks(args: {
    userId: string;
    query: string;
    limit: number;
  }): Promise<MeetingActionItemSearchRow[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        userId: args.userId,
        title: { contains: args.query, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
      select: { id: true, title: true, status: true, meetingId: true },
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      meetingId: t.meetingId,
    }));
  }

  // ───────────────────────────── Issue-ветка (ON, дормант) ─────────────────

  private async listIssuesForMeeting(args: {
    meetingId: string;
    tenantId: string;
    userId?: string;
  }): Promise<MeetingActionItem[]> {
    const where: Prisma.IssueWhereInput = {
      tenantId: args.tenantId,
      deletedAt: null,
      linkedMeetingIds: { has: args.meetingId },
      ...(args.userId
        ? {
            OR: [
              { createdById: args.userId },
              { assignees: { some: { userId: args.userId } } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.issue.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        state: { select: { category: true } },
        assignees: {
          select: { userId: true },
          orderBy: { assignedAt: 'asc' },
          take: 1,
        },
      },
    });
    return rows.map((issue) => ({
      id: issue.id,
      meetingId: args.meetingId,
      title: issue.title,
      description: issue.descriptionStripped ?? null,
      status: issueCategoryToStatus(issue.state?.category),
      // Issue не хранит сырую строку-имя — assigneeRaw недоступен.
      assigneeRaw: null,
      assigneeUserId: issue.assignees[0]?.userId ?? null,
      dueDate: issue.dueDate ?? null,
      sourceQuote: null,
      confidence: issue.confidence !== null ? Number(issue.confidence) : null,
      extractorVersion: issue.externalSource,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    }));
  }

  private async searchMeetingIssues(args: {
    tenantId: string;
    userId: string;
    query: string;
    limit: number;
  }): Promise<MeetingActionItemSearchRow[]> {
    const rows = await this.prisma.issue.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        externalSource: 'meeting',
        title: { contains: args.query, mode: 'insensitive' },
        OR: [
          { createdById: args.userId },
          { assignees: { some: { userId: args.userId } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
      select: {
        id: true,
        title: true,
        linkedMeetingIds: true,
        state: { select: { category: true } },
      },
    });
    return rows.map((issue) => ({
      id: issue.id,
      title: issue.title,
      status: issueCategoryToStatus(issue.state?.category),
      // ⌘K-ссылка ведёт на первую связанную встречу (как было для Task.meetingId).
      meetingId: issue.linkedMeetingIds[0] ?? '',
    }));
  }
}
