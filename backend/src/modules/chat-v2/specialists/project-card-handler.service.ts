import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type CardSpecialistHandler,
  type CardSpecialistResult,
  CardSpecialistRegistry,
} from '../services/card-specialist-registry.service';

@Injectable()
export class ProjectCardHandler implements OnModuleInit, CardSpecialistHandler {
  private readonly logger = new Logger(ProjectCardHandler.name);
  static readonly SPECIALIST_NAME = 'project';
  private static readonly DEFAULT_CONFIDENCE = 0.6;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CardSpecialistRegistry)
    private readonly registry: CardSpecialistRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(ProjectCardHandler.SPECIALIST_NAME, this);
    this.logger.log(
      `ProjectCardHandler зарегистрирован как '${ProjectCardHandler.SPECIALIST_NAME}' в CardSpecialistRegistry`,
    );
  }

  async getCardsForQuery(args: {
    tenantId: string;
    query: string;
    candidateBlockIds: readonly string[];
    limit: number;
  }): Promise<readonly CardSpecialistResult[]> {
    try {
      if (args.limit <= 0) return [];
      const tenantId = args.tenantId;
      const blockIds = args.candidateBlockIds.slice(0, 200);

      let projectIds: string[] = [];
      if (blockIds.length > 0) {
        const linked = await this.prisma.issue.findMany({
          where: {
            tenantId,
            deletedAt: null,
            sourceBlockIds: { hasSome: [...blockIds] },
          },
          select: { projectId: true },
          take: 100,
        });
        projectIds = [...new Set(linked.map((l) => l.projectId))];
      }

      const trimmedQuery = (args.query ?? '').trim();
      const nameMatches =
        trimmedQuery.length >= 3
          ? await this.prisma.project.findMany({
              where: {
                tenantId,
                archivedAt: null,
                deletedAt: null,
                OR: [
                  { name: { contains: trimmedQuery, mode: 'insensitive' } },
                  { identifier: { contains: trimmedQuery, mode: 'insensitive' } },
                ],
              },
              select: { id: true },
              take: 5,
            })
          : [];
      for (const nm of nameMatches) {
        if (!projectIds.includes(nm.id)) projectIds.push(nm.id);
      }
      if (projectIds.length === 0) return [];

      const projects = await this.prisma.project.findMany({
        where: { id: { in: projectIds }, tenantId, deletedAt: null },
        select: {
          id: true,
          name: true,
          identifier: true,
          description: true,
        },
        take: Math.max(args.limit, 1),
      });

      return projects.map((p) => ({
        id: p.id,
        type: 'project',
        title: `${p.identifier} · ${p.name}`,
        text: (p.description ?? '').slice(0, 600),
        sourceBlockIds: [],
        confidence: ProjectCardHandler.DEFAULT_CONFIDENCE,
      }));
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProjectCardHandler.getCardsForQuery упал — возвращаю []',
      );
      return [];
    }
  }

  async getCitations(args: {
    tenantId: string;
    projectIds: readonly string[];
    limit?: number;
  }): Promise<ProjectCitation[]> {
    if (args.projectIds.length === 0) return [];
    try {
      const rows = await this.prisma.project.findMany({
        where: {
          id: { in: [...args.projectIds] },
          tenantId: args.tenantId,
          deletedAt: null,
        },
        select: {
          id: true,
          identifier: true,
          name: true,
          description: true,
          ownerId: true,
        },
        take: Math.max(args.limit ?? 10, 1),
      });
      return rows.map((r) => ({
        id: r.id,
        identifier: r.identifier,
        name: r.name,
        description: r.description,
        ownerId: r.ownerId,
      }));
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProjectCardHandler.getCitations упал — возвращаю []',
      );
      return [];
    }
  }

  formatForChat(args: { identifier: string; name: string; ownerName?: string | null }): string {
    const meta = args.ownerName ? ` (владелец: ${args.ownerName})` : '';
    return `📁 ${args.identifier} · ${args.name}${meta}`;
  }
}

export interface ProjectCitation {
  id: string;
  identifier: string;
  name: string;
  description: string | null;
  ownerId: string;
}
