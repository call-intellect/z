import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  oppositeRelationType,
  type CreateIssueRelationDto,
  type IssueRelationDto,
  type IssueRelationType,
} from '../dto/issues/create-relation.dto';

import { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';

@Injectable()
export class RelationsService {
  private readonly logger = new Logger(RelationsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
  ) {}

  async getRelations(issueId: string, tenantId: string): Promise<IssueRelationDto[]> {
    await this.issues.requireIssue(issueId, tenantId);
    const rows = await this.prisma.issueRelation.findMany({
      where: {
        OR: [{ sourceIssueId: issueId }, { targetIssueId: issueId }],
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      sourceIssueId: r.sourceIssueId,
      targetIssueId: r.targetIssueId,
      relationType: r.relationType,
      createdById: r.createdById,
      createdAt: r.createdAt.toISOString(),
      direction: r.sourceIssueId === issueId ? 'out' : 'in',
    }));
  }

  async createRelation(
    sourceIssueId: string,
    dto: CreateIssueRelationDto,
    tenantId: string,
    userId: string,
  ): Promise<IssueRelationDto> {
    if (sourceIssueId === dto.targetIssueId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'self_relation_forbidden',
          message: 'Нельзя связать задачу саму с собой',
        },
      });
    }

    await this.issues.requireIssue(sourceIssueId, tenantId);
    await this.issues.requireIssue(dto.targetIssueId, tenantId);

    const opposite = oppositeRelationType(dto.relationType);

    const created = await this.prisma.$transaction(async (tx) => {
      const direct = await tx.issueRelation.upsert({
        where: {
          sourceIssueId_targetIssueId_relationType: {
            sourceIssueId,
            targetIssueId: dto.targetIssueId,
            relationType: dto.relationType,
          },
        },
        update: {},
        create: {
          sourceIssueId,
          targetIssueId: dto.targetIssueId,
          relationType: dto.relationType,
          createdById: userId,
        },
      });

      if (opposite) {
        await tx.issueRelation.upsert({
          where: {
            sourceIssueId_targetIssueId_relationType: {
              sourceIssueId: dto.targetIssueId,
              targetIssueId: sourceIssueId,
              relationType: opposite,
            },
          },
          update: {},
          create: {
            sourceIssueId: dto.targetIssueId,
            targetIssueId: sourceIssueId,
            relationType: opposite,
            createdById: userId,
          },
        });
      }

      await this.activity.record({
        tenantId,
        issueId: sourceIssueId,
        actorUserId: userId,
        actorType: 'user',
        verb: 'related',
        newValue: {
          targetIssueId: dto.targetIssueId,
          relationType: dto.relationType,
        },
        tx,
      });
      if (opposite) {
        await this.activity.record({
          tenantId,
          issueId: dto.targetIssueId,
          actorUserId: userId,
          actorType: 'user',
          verb: 'related',
          newValue: {
            targetIssueId: sourceIssueId,
            relationType: opposite,
          },
          tx,
        });
      }

      return direct;
    });

    return {
      id: created.id,
      sourceIssueId: created.sourceIssueId,
      targetIssueId: created.targetIssueId,
      relationType: created.relationType,
      createdById: created.createdById,
      createdAt: created.createdAt.toISOString(),
      direction: 'out',
    };
  }

  async deleteRelation(
    relationId: string,
    tenantId: string,
    userId: string,
  ): Promise<{ ok: true }> {
    const relation = await this.prisma.issueRelation.findUnique({
      where: { id: relationId },
    });
    if (!relation) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'relation_not_found', message: 'Связь не найдена' },
      });
    }
    await this.issues.requireIssue(relation.sourceIssueId, tenantId);

    const opposite = oppositeRelationType(relation.relationType as IssueRelationType);

    await this.prisma.$transaction(async (tx) => {
      await tx.issueRelation.delete({ where: { id: relationId } });

      if (opposite) {
        await tx.issueRelation.deleteMany({
          where: {
            sourceIssueId: relation.targetIssueId,
            targetIssueId: relation.sourceIssueId,
            relationType: opposite,
          },
        });
      }

      await this.activity.record({
        tenantId,
        issueId: relation.sourceIssueId,
        actorUserId: userId,
        actorType: 'user',
        verb: 'unrelated',
        oldValue: {
          targetIssueId: relation.targetIssueId,
          relationType: relation.relationType,
        },
        tx,
      });
      if (opposite) {
        await this.activity.record({
          tenantId,
          issueId: relation.targetIssueId,
          actorUserId: userId,
          actorType: 'user',
          verb: 'unrelated',
          oldValue: {
            targetIssueId: relation.sourceIssueId,
            relationType: opposite,
          },
          tx,
        });
      }
    });

    return { ok: true };
  }
}
