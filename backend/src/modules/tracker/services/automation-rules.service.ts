import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type IssueAutomationRule } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
} from '../dto/automation-rules/automation-rule.types';
import type { CreateAutomationRuleDto } from '../dto/automation-rules/create-automation-rule.dto';
import type { UpdateAutomationRuleDto } from '../dto/automation-rules/update-automation-rule.dto';

import { ProjectsService } from './projects.service';

export interface AutomationRuleResponseDto {
  id: string;
  projectId: string | null;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class AutomationRulesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  async list(
    tenantId: string,
    projectId: string | null,
  ): Promise<AutomationRuleResponseDto[]> {
    if (projectId) {
      await this.projects.requireProject(projectId, tenantId);
    }
    const rows = await this.prisma.issueAutomationRule.findMany({
      where: {
        tenantId,
        ...(projectId === null
          ? {}
          : { OR: [{ projectId }, { projectId: null }] }),
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  async create(
    dto: CreateAutomationRuleDto,
    tenantId: string,
    userId: string,
  ): Promise<AutomationRuleResponseDto> {
    const projectId = dto.projectId ?? null;
    if (projectId) {
      await this.projects.requireProject(projectId, tenantId);
    }
    const created = await this.prisma.issueAutomationRule.create({
      data: {
        tenantId,
        projectId,
        name: dto.name,
        enabled: dto.enabled ?? true,
        trigger: dto.trigger as Prisma.InputJsonValue,
        conditions: (dto.conditions ?? []) as Prisma.InputJsonValue,
        actions: dto.actions as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    return this.toResponse(created);
  }

  async update(
    id: string,
    dto: UpdateAutomationRuleDto,
    tenantId: string,
  ): Promise<AutomationRuleResponseDto> {
    const rule = await this.require(id, tenantId);
    const updated = await this.prisma.issueAutomationRule.update({
      where: { id: rule.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.trigger !== undefined
          ? { trigger: dto.trigger as Prisma.InputJsonValue }
          : {}),
        ...(dto.conditions !== undefined
          ? { conditions: dto.conditions as Prisma.InputJsonValue }
          : {}),
        ...(dto.actions !== undefined
          ? { actions: dto.actions as Prisma.InputJsonValue }
          : {}),
      },
    });
    return this.toResponse(updated);
  }

  async remove(id: string, tenantId: string): Promise<{ ok: true }> {
    const rule = await this.require(id, tenantId);
    await this.prisma.issueAutomationRule.delete({ where: { id: rule.id } });
    return { ok: true };
  }

  private async require(
    id: string,
    tenantId: string,
  ): Promise<IssueAutomationRule> {
    const rule = await this.prisma.issueAutomationRule.findUnique({
      where: { id },
    });
    if (!rule || rule.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'automation_rule_not_found',
          message: 'Правило автоматизации не найдено',
        },
      });
    }
    return rule;
  }

  private toResponse(r: IssueAutomationRule): AutomationRuleResponseDto {
    return {
      id: r.id,
      projectId: r.projectId,
      name: r.name,
      enabled: r.enabled,
      trigger: (r.trigger ?? {}) as AutomationTrigger,
      conditions: (r.conditions ?? []) as AutomationCondition[],
      actions: (r.actions ?? []) as AutomationAction[],
      createdById: r.createdById,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
