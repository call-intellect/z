import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  oppositeRelationType,
  type CreateIssueRelationDto,
  type IssueRelationDto,
  type IssueRelationType,
} from '../dto/issues/create-relation.dto';

import { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';

/**
 * RelationsService — CRUD над `IssueRelation` (связи между задачами).
 *
 * Бизнес-инварианты:
 *   1. Self-relation запрещён (`sourceIssueId !== targetIssueId`).
 *   2. Связи симметричные: если создаём `A blocks B`, в той же транзакции
 *      создаём обратную `B blocked_by A`. Для `relates_to` обратная — такая же.
 *   3. Идемпотентность: если уже есть запись с тем же
 *      `(sourceIssueId, targetIssueId, relationType)` — возвращаем существующую,
 *      не валим конфликтом. На обратной стороне делаем upsert (тоже идемпотентно).
 *   4. Каждая мутация записывает `IssueActivity` для обоих issues (related /
 *      unrelated), чтобы во втором мозге было видно «история того, что связывалось».
 *   5. Tenant-ownership: source и target должны принадлежать одному tenant'у.
 */
@Injectable()
export class RelationsService {
  private readonly logger = new Logger(RelationsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
  ) {}

  /**
   * Все связи задачи (как outgoing — source=issueId, так и incoming — target=issueId).
   * Отсортированы по createdAt DESC. Лимит 500 (на UI больше не нужно).
   */
  async getRelations(
    issueId: string,
    tenantId: string,
  ): Promise<IssueRelationDto[]> {
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

  /**
   * Создать связь + парную обратную. Транзакция.
   *
   * Возвращает свежесозданную (или существующую — при идемпотентном повторе)
   * запись в формате `IssueRelationDto` с `direction='out'` (направление —
   * относительно source). Парная обратная запись возвращается через
   * `getRelations()` — отдельный вызов фронта.
   */
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

    // Обе задачи должны существовать и быть в одном tenant'е.
    await this.issues.requireIssue(sourceIssueId, tenantId);
    await this.issues.requireIssue(dto.targetIssueId, tenantId);

    const opposite = oppositeRelationType(dto.relationType);

    const created = await this.prisma.$transaction(async (tx) => {
      // Прямая связь — upsert по unique (source,target,relationType).
      const direct = await tx.issueRelation.upsert({
        where: {
          sourceIssueId_targetIssueId_relationType: {
            sourceIssueId,
            targetIssueId: dto.targetIssueId,
            relationType: dto.relationType,
          },
        },
        update: {}, // Идемпотентно: если уже есть — оставляем как было.
        create: {
          sourceIssueId,
          targetIssueId: dto.targetIssueId,
          relationType: dto.relationType,
          createdById: userId,
        },
      });

      // Обратная связь (если применимо). Тоже upsert.
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

      // IssueActivity на обоих issues.
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

  /**
   * Удалить связь по id. Парная обратная (если есть в БД) тоже удаляется.
   * IssueActivity verb='unrelated' на обоих issues.
   */
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
    // Tenant-check через issue ownership (исходную проверяем — обоих в одном
    // tenant'е инвариант установлен на этапе create).
    await this.issues.requireIssue(relation.sourceIssueId, tenantId);

    const opposite = oppositeRelationType(
      relation.relationType as IssueRelationType,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.issueRelation.delete({ where: { id: relationId } });

      if (opposite) {
        // Удаляем парную (если она ещё существует — могла быть удалена ранее).
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
