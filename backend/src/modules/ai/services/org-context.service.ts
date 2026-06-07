import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

import type { MeetingExtractActionsContext } from './prompts/tasks';

/**
 * Компактный org-контекст компании (проекты / активные цели / сотрудники)
 * для инъекции в SYSTEM AI-промптов встречи.
 *
 * Реюз единого загрузчика: до ТЗ-4 Ф3 эта логика жила приватным методом
 * `loadOrgContext` в `MeetingExtractActionsService`. Вынесена в отдельный
 * `@Injectable`-сервис (зеркало `ParticipantContextService`), чтобы её мог
 * инжектить и `analyze.worker` (summary + report-by-type), и
 * `MeetingExtractActionsService` (tasks-путь) — без дублирования запросов.
 *
 * Не пишет в БД, не зависит от LLM-провайдеров. Результат стабильно
 * per-tenant (меняется редко), поэтому подходит как cache-friendly суффикс
 * SYSTEM (кэш живёт между встречами одной org).
 */
export type OrgContext = MeetingExtractActionsContext &
  Required<Pick<MeetingExtractActionsContext, 'meetingDateIso'>>;

@Injectable()
export class OrgContextService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Загружает компактный org-контекст: до 40 проектов, до 30 активных целей,
   * до 60 сотрудников-employee. Take-лимиты и фильтры идентичны историческому
   * `MeetingExtractActionsService.loadOrgContext` (поведение не меняется).
   */
  async load(
    tenantId: string,
    meetingStartedAt: Date | null,
  ): Promise<OrgContext> {
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
}
