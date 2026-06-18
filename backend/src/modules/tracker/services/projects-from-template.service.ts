import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import type { CreateFromTemplateDto } from '../dto/projects/create-from-template.dto';
import {
  type TeamTemplateDefinition,
  type TeamTemplateState,
  type TeamTemplateTypicalTask,
} from '../seed/team-templates-data';

export interface CreateFromTemplateResult {
  projectId: string;
  identifier: string;
  slug: string;
  templateSlug: string;
  statesCount: number;
  exampleTasksCount: number;
  regulationStubsCount: number;
}

@Injectable()
export class ProjectsFromTemplateService {
  private readonly logger = new Logger(ProjectsFromTemplateService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async createFromTemplate(args: {
    tenantId: string;
    userId: string;
    dto: CreateFromTemplateDto;
  }): Promise<CreateFromTemplateResult> {
    const { tenantId, userId, dto } = args;

    const template = await this.findTemplate({
      tenantId,
      slug: dto.templateSlug,
    });
    if (!template) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'team_template_not_found',
          message: 'Шаблон команды не найден',
        },
      });
    }

    const definition = this.parseDefinition(template.definition);
    const slug = dto.slug ?? dto.identifier.toLowerCase();

    const [slugTaken, identifierTaken] = await Promise.all([
      this.prisma.project.findUnique({
        where: { tenantId_slug: { tenantId, slug } },
        select: { id: true },
      }),
      this.prisma.project.findFirst({
        where: { tenantId, identifier: dto.identifier },
        select: { id: true },
      }),
    ]);
    if (slugTaken) {
      throw new ConflictException({
        ok: false,
        error: { code: 'project_slug_taken', message: 'Slug проекта уже занят' },
      });
    }
    if (identifierTaken) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'project_identifier_taken',
          message: 'Префикс задач уже занят в организации',
        },
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          tenantId,
          slug,
          identifier: dto.identifier,
          name: dto.projectName,
          description: template.description,
          ownerId: userId,
          teamTemplateId: template.id,
          ...(dto.timezone ? { timezone: dto.timezone } : {}),
        },
      });

      const sortedStates = [...definition.states].sort((a, b) => a.sequence - b.sequence);
      const firstStateKey = sortedStates[0]?.key ?? null;
      const stateIdByKey = new Map<string, string>();
      for (const state of sortedStates) {
        const created = await tx.issueState.create({
          data: {
            tenantId,
            projectId: project.id,
            name: state.name,
            color: state.color,
            category: state.category,
            sequence: state.sequence,
            isDefault: state.key === firstStateKey,
          },
        });
        stateIdByKey.set(state.key, created.id);
      }
      const defaultStateId = firstStateKey ? (stateIdByKey.get(firstStateKey) ?? null) : null;
      if (defaultStateId) {
        await tx.project.update({
          where: { id: project.id },
          data: { defaultStateId },
        });
      }

      await tx.projectMember.create({
        data: { projectId: project.id, userId, role: 20 },
      });

      await tx.board.create({
        data: {
          tenantId,
          projectId: project.id,
          name: 'Доска',
          color: '#5EEAD4',
          sequence: 0,
          isDefault: true,
        },
      });

      let regulationStubsCount = 0;
      for (const stub of definition.regulationStubs) {
        const name = `${stub} — ${project.identifier}`;
        const existing = await tx.regulation.findUnique({
          where: { tenantId_name: { tenantId, name } },
          select: { id: true },
        });
        if (existing) continue;
        await tx.regulation.create({
          data: {
            tenantId,
            name,
            contentMd: '_заглушка регламента, заполните позже_',
          },
        });
        regulationStubsCount += 1;
      }

      let exampleTasksCount = 0;
      if (dto.withExampleTasks && definition.typicalTasks.length > 0) {
        const examples = definition.typicalTasks.slice(0, 3);
        for (const [idx, task] of examples.entries()) {
          const sequenceId = idx + 1;
          const stateId = stateIdByKey.get(task.stateKey) ?? defaultStateId;
          await tx.issue.create({
            data: {
              tenantId,
              projectId: project.id,
              identifier: `${project.identifier}-${sequenceId}`,
              sequenceId,
              title: task.title,
              priority: task.priority ?? 'none',
              stateId,
              estimatePoints: task.estimatePoints ?? null,
              createdById: userId,
              createdManually: false,
              externalSource: 'team_template',
              externalId: `${template.slug}#${idx}`,
            },
          });
          exampleTasksCount += 1;
        }
      }

      await tx.teamTemplate.update({
        where: { id: template.id },
        data: { usageCount: { increment: 1 } },
      });

      return {
        projectId: project.id,
        identifier: project.identifier,
        slug: project.slug,
        statesCount: sortedStates.length,
        exampleTasksCount,
        regulationStubsCount,
      };
    });

    this.metrics?.incTeamTemplateUsed({
      tenantTop: tenantTopOf(tenantId),
      slug: template.slug,
    });
    this.logger.log(
      {
        tenantId,
        userId,
        templateSlug: template.slug,
        projectId: result.projectId,
        statesCount: result.statesCount,
        exampleTasksCount: result.exampleTasksCount,
        regulationStubsCount: result.regulationStubsCount,
      },
      'project created from team-template',
    );

    return {
      ...result,
      templateSlug: template.slug,
    };
  }

  private async findTemplate(args: { tenantId: string; slug: string }): Promise<{
    id: string;
    slug: string;
    description: string;
    definition: Prisma.JsonValue;
  } | null> {
    const perTenant = await this.prisma.teamTemplate.findFirst({
      where: { tenantId: args.tenantId, slug: args.slug },
      select: { id: true, slug: true, description: true, definition: true },
    });
    if (perTenant) return perTenant;
    return this.prisma.teamTemplate.findFirst({
      where: { tenantId: null, slug: args.slug, isPublic: true },
      select: { id: true, slug: true, description: true, definition: true },
    });
  }

  private parseDefinition(value: Prisma.JsonValue): TeamTemplateDefinition {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'team_template_invalid_definition',
          message: 'Шаблон команды содержит некорректное определение',
        },
      });
    }
    const obj = value as Record<string, unknown>;
    const states = Array.isArray(obj.states) ? (obj.states as TeamTemplateState[]) : [];
    if (states.length === 0) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'team_template_no_states',
          message: 'У шаблона команды не задано ни одного статуса',
        },
      });
    }
    return {
      roles: Array.isArray(obj.roles) ? (obj.roles as TeamTemplateDefinition['roles']) : [],
      states,
      typicalTasks: Array.isArray(obj.typicalTasks)
        ? (obj.typicalTasks as TeamTemplateTypicalTask[])
        : [],
      regulationStubs: Array.isArray(obj.regulationStubs)
        ? (obj.regulationStubs as string[]).filter((s): s is string => typeof s === 'string')
        : [],
      kpiTemplates: Array.isArray(obj.kpiTemplates)
        ? (obj.kpiTemplates as TeamTemplateDefinition['kpiTemplates'])
        : [],
    };
  }
}
