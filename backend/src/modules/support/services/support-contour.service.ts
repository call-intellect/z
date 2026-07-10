import { createHash } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { KnowledgeEmbeddingService } from '../../knowledge-core/services/embedding.service';
import { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import { SupportAccessService } from './support-access.service';

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

        const result = await this.createContourBlock({
          vendorOrgId,
          groupId,
          question,
          answer,
          confidence: 1.0,
          provenance: 'support-seed',
        });
        if (result.created) {
          created++;
        } else {
          skipped++;
        }
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

  async promoteAnswer(
    question: string,
    answer: string,
  ): Promise<{ promoted: boolean; blockId?: string }> {
    const { vendorOrgId, groupId } = await this.resolveContour();

    const q = question.trim();
    const a = answer.trim();
    if (q.length === 0 || a.length === 0) {
      return { promoted: false };
    }

    const result = await this.createContourBlock({
      vendorOrgId,
      groupId,
      question: q,
      answer: a,
      confidence: 0.7,
      provenance: 'clone-accepted',
    });
    return result.created ? { promoted: true, blockId: result.blockId } : { promoted: false };
  }

  private async createContourBlock(args: {
    vendorOrgId: string;
    groupId: string;
    question: string;
    answer: string;
    confidence: number;
    provenance: 'support-seed' | 'clone-accepted';
  }): Promise<{ created: boolean; blockId?: string }> {
    const { vendorOrgId, groupId, question, answer, confidence, provenance } = args;

    const hash = createHash('sha256').update(`${question}\n${answer}`).digest('hex');
    const externalSource = `${provenance}:${hash}`;

    const existing = await this.prisma.ideaBlock.findFirst({
      where: {
        tenantId: vendorOrgId,
        externalSource,
        blockAccess: { some: { groupId } },
      },
      select: { id: true },
    });
    if (existing) {
      return { created: false };
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
        confidence,
      },
      select: { id: true },
    });

    const vec = await this.embeddings.embedQuery(`${question} ${answer}`);
    if (vec && vec.length > 0) {
      await this.prisma.$executeRawUnsafe(
        'UPDATE "IdeaBlock" SET embedding = $1::vector WHERE id = $2',
        `[${vec.join(',')}]`,
        block.id,
      );
    }

    await this.prisma.ideaBlockAccess.create({
      data: { tenantId: vendorOrgId, blockId: block.id, groupId, via: 'closed' },
    });

    return { created: true, blockId: block.id };
  }

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
