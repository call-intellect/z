import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { KnowledgeEmbeddingService } from '../../knowledge-core/services/embedding.service';
import { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import { SupportAccessService } from './support-access.service';

/**
 * SupportContourService — управление закрытым контуром памяти поддержки
 * (ТЗ 2026-06-09 support-desk Ф2).
 *
 * Отвечает за:
 *   - галочку «сотрудник поддержки» = членство `KnowledgeGroupMember(support,
 *     source='manual')` (Р-7); add/remove реплицирует логику
 *     `KnowledgeAccessAdminService` (его модуль НЕ экспортирует сервис) +
 *     `KnowledgeAccessResolver.invalidateAll()` после каждой мутации;
 *   - ручной засев контура (Р-4): пары вопрос→ответ → `IdeaBlock(canonical,
 *     signalType='expertise')` + `IdeaBlockAccess(via='closed')`. Идемпотентно
 *     по хэшу пары (хранится в `IdeaBlock.externalSource = 'support-seed:<hash>'`,
 *     т.к. в схеме IdeaBlock нет `embeddingHash`).
 *
 * Все запросы tenant-scoped по вендор-Org (`SupportAccessService.getVendorOrgId`).
 * Группа контура должна существовать (Ф1 seed) — иначе BadRequest «контур не
 * инициализирован».
 */
@Injectable()
export class SupportContourService {
  private readonly logger = new Logger(SupportContourService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver,
    @Inject(KnowledgeEmbeddingService)
    private readonly embeddings: KnowledgeEmbeddingService,
  ) {}

  // ─────────────────────────── галочка-членство ──────────────────────────

  /**
   * Список сотрудников поддержки (членов контура). Пусто, если деск выключен
   * или группа ещё не создана.
   */
  async listAgents(): Promise<{
    members: { personId: string; name: string }[];
  }> {
    const vendorOrgId = await this.access.getVendorOrgId();
    if (!vendorOrgId) return { members: [] };
    const groupId = await this.access.getSupportGroupId(vendorOrgId);
    if (!groupId) return { members: [] };

    const members = await this.prisma.knowledgeGroupMember.findMany({
      where: { groupId },
      select: { personId: true },
    });
    const personIds = members.map((m) => m.personId);
    const persons =
      personIds.length > 0
        ? await this.prisma.person.findMany({
            where: { id: { in: personIds } },
            select: { id: true, name: true },
          })
        : [];
    const nameById = new Map(persons.map((p) => [p.id, p.name]));
    return {
      members: members.map((m) => ({
        personId: m.personId,
        name: nameById.get(m.personId) ?? '',
      })),
    };
  }

  /**
   * Добавить сотрудника в контур (галочка). source='manual'. Идемпотентно:
   * повтор = `added:false`. Person резолвится в вендор-Org.
   */
  async addAgent(personId: string): Promise<{ ok: true; added: boolean }> {
    const { vendorOrgId, groupId } = await this.resolveContour();

    const person = await this.prisma.person.findFirst({
      where: { id: personId, tenantId: vendorOrgId, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'person_not_found',
          message: 'Сотрудник не найден в вендор-компании',
        },
      });
    }

    const existing = await this.prisma.knowledgeGroupMember.findUnique({
      where: { groupId_personId: { groupId, personId } },
      select: { personId: true },
    });
    if (existing) {
      return { ok: true, added: false };
    }

    await this.prisma.knowledgeGroupMember.create({
      data: { groupId, personId, source: 'manual' },
    });
    this.accessResolver.invalidateAll();
    this.logger.log(
      `Галочка поддержки выдана: person=${personId} (group=${groupId}, vendor=${vendorOrgId})`,
    );
    return { ok: true, added: true };
  }

  /**
   * Убрать сотрудника из контура. Идемпотентно: нет строки = `removed:false`.
   */
  async removeAgent(personId: string): Promise<{ ok: true; removed: boolean }> {
    const { vendorOrgId, groupId } = await this.resolveContour();

    const result = await this.prisma.knowledgeGroupMember.deleteMany({
      where: { groupId, personId },
    });
    this.accessResolver.invalidateAll();
    this.logger.log(
      `Галочка поддержки снята: person=${personId} (removed=${result.count}, group=${groupId}, vendor=${vendorOrgId})`,
    );
    return { ok: true, removed: result.count > 0 };
  }

  // ─────────────────────────── ручной засев (Р-4) ────────────────────────

  /**
   * Засеять контур парами «вопрос→ответ» (холодный старт). Каждая пара →
   * `IdeaBlock(status='canonical', signalType='expertise')` +
   * `IdeaBlockAccess(via='closed', groupId=support)`.
   *
   * Идемпотентность по хэшу `sha256(question\nanswer)` в
   * `IdeaBlock.externalSource = 'support-seed:<hash>'`. Повтор той же пары —
   * skipped. Каждая пара в своём try/catch — одна плохая не валит батч.
   */
  async seedContour(
    items: { question: string; answer: string }[],
  ): Promise<{ created: number; skipped: number }> {
    const { vendorOrgId, groupId } = await this.resolveContour();

    let created = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        const question = item.question.trim();
        const answer = item.answer.trim();
        if (question.length === 0 || answer.length === 0) {
          skipped++;
          continue;
        }
        const hash = createHash('sha256')
          .update(`${question}\n${answer}`)
          .digest('hex');
        const externalSource = `support-seed:${hash}`;

        const existing = await this.prisma.ideaBlock.findFirst({
          where: {
            tenantId: vendorOrgId,
            externalSource,
            blockAccess: { some: { groupId } },
          },
          select: { id: true },
        });
        if (existing) {
          skipped++;
          continue;
        }

        const block = await this.prisma.ideaBlock.create({
          data: {
            tenantId: vendorOrgId,
            externalSource,
            name: question.slice(0, 500),
            criticalQuestion: question,
            trustedAnswer: answer,
            signalType: 'expertise',
            status: 'canonical',
            dataClass: 'internal',
            confidence: 1.0,
          },
          select: { id: true },
        });

        // Эмбеддинг — best-effort: при отказе провайдера блок остаётся без
        // вектора (ранжируется по recency). Не валим засев.
        const vec = await this.embeddings.embedQuery(`${question} ${answer}`);
        if (vec && vec.length > 0) {
          await this.prisma.$executeRawUnsafe(
            'UPDATE "IdeaBlock" SET embedding = $1::vector(1536) WHERE id = $2',
            `[${vec.join(',')}]`,
            block.id,
          );
        }

        await this.prisma.ideaBlockAccess.create({
          data: { blockId: block.id, groupId, via: 'closed' },
        });

        created++;
      } catch (err) {
        this.logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            question: item.question.slice(0, 80),
          },
          'seedContour: пара не засеялась — пропуск',
        );
        skipped++;
      }
    }

    this.logger.log(
      `Засев контура: created=${created}, skipped=${skipped} (group=${groupId}, vendor=${vendorOrgId})`,
    );
    return { created, skipped };
  }

  // ─────────────────────────── helpers ───────────────────────────────────

  /**
   * Резолвит вендор-Org + группу контура (оба обязательны). vendorOrgId нет →
   * деск выключен; группы нет → контур не инициализирован (Ф1 seed не
   * прогонялся). Используется мутирующими методами (add/remove/seed).
   */
  private async resolveContour(): Promise<{
    vendorOrgId: string;
    groupId: string;
  }> {
    const vendorOrgId = await this.access.getVendorOrgId();
    if (!vendorOrgId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'SUPPORT_DESK_DISABLED',
          message: 'Служба поддержки не настроена (нет вендор-компании)',
        },
      });
    }
    const groupId = await this.access.getSupportGroupId(vendorOrgId);
    if (!groupId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'SUPPORT_CONTOUR_NOT_INITIALIZED',
          message: 'Контур не инициализирован',
        },
      });
    }
    return { vendorOrgId, groupId };
  }
}
