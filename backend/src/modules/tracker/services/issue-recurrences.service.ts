import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type IssueRecurrence } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateIssueRecurrenceDto } from '../dto/recurrences/create-issue-recurrence.dto';
import {
  RecurrenceRuleSchema,
  type IssueTemplateConfig,
  type RecurrenceRule,
} from '../dto/recurrences/issue-template-config.types';
import type { UpdateIssueRecurrenceDto } from '../dto/recurrences/update-issue-recurrence.dto';

import { ProjectsService } from './projects.service';

export interface IssueRecurrenceResponseDto {
  id: string;
  projectId: string;
  templateIssueId: string | null;
  rule: RecurrenceRule;
  config: IssueTemplateConfig;
  nextRunAt: string;
  lastRunAt: string | null;
  enabled: boolean;
  createdById: string;
  createdAt: string;
}

@Injectable()
export class IssueRecurrencesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  static parseRule(serialized: string): RecurrenceRule {
    let raw: unknown;
    try {
      raw = JSON.parse(serialized);
    } catch {
      raw = null;
    }
    const parsed = RecurrenceRuleSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    return { freq: 'weekly', interval: 1 };
  }

  static advance(from: Date, rule: RecurrenceRule): Date {
    const interval = rule.interval >= 1 ? Math.floor(rule.interval) : 1;
    const next = new Date(from.getTime());
    switch (rule.freq) {
      case 'daily':
        next.setUTCDate(next.getUTCDate() + interval);
        return next;
      case 'weekly':
        next.setUTCDate(next.getUTCDate() + 7 * interval);
        return next;
      case 'monthly':
        next.setUTCMonth(next.getUTCMonth() + interval);
        return next;
      default:
        next.setUTCDate(next.getUTCDate() + 7 * interval);
        return next;
    }
  }

  static dayKey(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async list(
    tenantId: string,
    projectId: string,
  ): Promise<IssueRecurrenceResponseDto[]> {
    await this.projects.requireProject(projectId, tenantId);
    const rows = await this.prisma.issueRecurrence.findMany({
      where: { tenantId, projectId },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  async create(
    dto: CreateIssueRecurrenceDto,
    tenantId: string,
    userId: string,
  ): Promise<IssueRecurrenceResponseDto> {
    await this.projects.requireProject(dto.projectId, tenantId);
    const created = await this.prisma.issueRecurrence.create({
      data: {
        tenantId,
        projectId: dto.projectId,
        templateIssueId: dto.templateIssueId ?? null,
        rrule: JSON.stringify(dto.rule),
        config: dto.config as unknown as Prisma.InputJsonValue,
        nextRunAt: dto.nextRunAt,
        enabled: dto.enabled ?? true,
        createdById: userId,
      },
    });
    return this.toResponse(created);
  }

  async update(
    id: string,
    dto: UpdateIssueRecurrenceDto,
    tenantId: string,
  ): Promise<IssueRecurrenceResponseDto> {
    const existing = await this.require(id, tenantId);
    const updated = await this.prisma.issueRecurrence.update({
      where: { id: existing.id },
      data: {
        ...(dto.rule !== undefined ? { rrule: JSON.stringify(dto.rule) } : {}),
        ...(dto.config !== undefined
          ? { config: dto.config as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.nextRunAt !== undefined ? { nextRunAt: dto.nextRunAt } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });
    return this.toResponse(updated);
  }

  async remove(id: string, tenantId: string): Promise<{ ok: true }> {
    const existing = await this.require(id, tenantId);
    await this.prisma.issueRecurrence.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  private async require(id: string, tenantId: string): Promise<IssueRecurrence> {
    const row = await this.prisma.issueRecurrence.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'issue_recurrence_not_found',
          message: 'Повторение задачи не найдено',
        },
      });
    }
    return row;
  }

  private toResponse(r: IssueRecurrence): IssueRecurrenceResponseDto {
    return {
      id: r.id,
      projectId: r.projectId,
      templateIssueId: r.templateIssueId,
      rule: IssueRecurrencesService.parseRule(r.rrule),
      config: (r.config ?? {}) as unknown as IssueTemplateConfig,
      nextRunAt: r.nextRunAt.toISOString(),
      lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
      enabled: r.enabled,
      createdById: r.createdById,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
