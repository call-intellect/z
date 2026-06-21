import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type IssueTemplate } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateIssueTemplateDto } from '../dto/recurrences/create-issue-template.dto';
import type { IssueTemplateConfig } from '../dto/recurrences/issue-template-config.types';
import type { UpdateIssueTemplateDto } from '../dto/recurrences/update-issue-template.dto';

import { IssueMaterializeService } from './issue-materialize.service';
import { ProjectsService } from './projects.service';

export interface IssueTemplateResponseDto {
  id: string;
  projectId: string | null;
  name: string;
  config: IssueTemplateConfig;
  createdById: string;
  createdAt: string;
}

@Injectable()
export class IssueTemplatesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(IssueMaterializeService)
    private readonly materializer: IssueMaterializeService,
  ) {}

  async list(
    tenantId: string,
    projectId: string | null,
  ): Promise<IssueTemplateResponseDto[]> {
    if (projectId) await this.projects.requireProject(projectId, tenantId);
    const rows = await this.prisma.issueTemplate.findMany({
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
    dto: CreateIssueTemplateDto,
    tenantId: string,
    userId: string,
  ): Promise<IssueTemplateResponseDto> {
    const projectId = dto.projectId ?? null;
    if (projectId) await this.projects.requireProject(projectId, tenantId);
    const created = await this.prisma.issueTemplate.create({
      data: {
        tenantId,
        projectId,
        name: dto.name,
        config: dto.config as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    return this.toResponse(created);
  }

  async update(
    id: string,
    dto: UpdateIssueTemplateDto,
    tenantId: string,
  ): Promise<IssueTemplateResponseDto> {
    const existing = await this.require(id, tenantId);
    const updated = await this.prisma.issueTemplate.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.config !== undefined
          ? { config: dto.config as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    return this.toResponse(updated);
  }

  async remove(id: string, tenantId: string): Promise<{ ok: true }> {
    const existing = await this.require(id, tenantId);
    await this.prisma.issueTemplate.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  async instantiate(
    id: string,
    tenantId: string,
    userId: string,
    projectId?: string | null,
  ): Promise<{ issueId: string }> {
    const template = await this.require(id, tenantId);
    const config = template.config as unknown as IssueTemplateConfig;
    const targetProjectId = projectId ?? template.projectId;
    if (!targetProjectId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'project_required',
          message: 'Для глобального шаблона укажите проект',
        },
      });
    }
    await this.projects.requireProject(targetProjectId, tenantId);
    return this.materializer.materialize({
      tenantId,
      projectId: targetProjectId,
      config,
      createdById: userId,
    });
  }

  private async require(id: string, tenantId: string): Promise<IssueTemplate> {
    const row = await this.prisma.issueTemplate.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'issue_template_not_found',
          message: 'Шаблон задачи не найден',
        },
      });
    }
    return row;
  }

  private toResponse(r: IssueTemplate): IssueTemplateResponseDto {
    return {
      id: r.id,
      projectId: r.projectId,
      name: r.name,
      config: (r.config ?? {}) as unknown as IssueTemplateConfig,
      createdById: r.createdById,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
