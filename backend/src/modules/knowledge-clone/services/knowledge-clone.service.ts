import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurationService } from '../../curation/services/curation.service';

import type {
  KnowledgeProfileCategoryDto,
  KnowledgeProfileDto,
  KnowledgeProfileHighlightDto,
  KnowledgeProfileSampleStatementDto,
  MarkWrongBody,
  MarkWrongResponseDto,
} from '../dto/knowledge-clone.dto';

/**
 * SBA β-2 — KnowledgeCloneService.
 *
 * Публичные методы:
 *   - `getMyProfile` — текущий пользователь → Person через User.persons →
 *     возвращает свой профиль.
 *   - `getPersonProfile` — профиль другого Person'а с учётом RBAC-уровня
 *     (member видит только сводку без цитат, owner/admin — с цитатами).
 *   - `markWrong` — создаёт CurationItem (deep review) для admin/manager
 *     review. Носитель профиля помечает категорию как неверную.
 */
@Injectable()
export class KnowledgeCloneService {
  private readonly logger = new Logger(KnowledgeCloneService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurationService) private readonly curation: CurationService,
  ) {}

  async getMyProfile(args: {
    tenantId: string;
    userId: string;
  }): Promise<KnowledgeProfileDto> {
    const person = await this.prisma.person.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: args.userId,
        deletedAt: null,
      },
      select: this.personSelect(),
    });
    if (!person) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'person_not_found',
          message: 'Профиль сотрудника не найден в текущей организации',
        },
      });
    }
    return this.serialize(person, {
      includeSampleStatements: true,
      isSelf: true,
    });
  }

  async getPersonProfile(args: {
    tenantId: string;
    requesterUserId: string;
    requesterRole: 'owner' | 'admin' | 'manager' | 'unknown';
    personId: string;
  }): Promise<KnowledgeProfileDto> {
    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: this.personSelect(),
    });
    if (!person || person.deletedAt || person.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'person_not_found',
          message: 'Сотрудник не найден',
        },
      });
    }
    const isSelf =
      person.userId !== null && person.userId === args.requesterUserId;
    // sampleStatements (цитаты) видят owner / admin / сам носитель;
    // member видит только сводку без цитат.
    const includeSampleStatements =
      isSelf ||
      args.requesterRole === 'owner' ||
      args.requesterRole === 'admin';
    return this.serialize(person, { includeSampleStatements, isSelf });
  }

  /**
   * Текущий пользователь помечает категорию своего профиля как неверную.
   * Создаём CurationItem с level='deep' для admin/manager review.
   *
   * NB: payload пробрасываем в `proposedPayload`, чтобы куратор увидел
   * содержимое (название категории + текст пользователя). Решение
   * куратора (approve/reject) обрабатывается в обычном Curation flow.
   */
  async markWrong(args: {
    tenantId: string;
    userId: string;
    body: MarkWrongBody;
  }): Promise<MarkWrongResponseDto> {
    const person = await this.prisma.person.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: args.userId,
        deletedAt: null,
      },
      select: { id: true, name: true, knowledgeProfile: true },
    });
    if (!person) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'person_not_found',
          message: 'Профиль сотрудника не найден в текущей организации',
        },
      });
    }
    const profile = this.readProfile(person.knowledgeProfile);
    const category = profile?.categories.find(
      (c) => c.name.trim().toLowerCase() === args.body.categoryName.trim().toLowerCase(),
    );
    if (!category) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'category_not_found',
          message: 'Указанная область знаний не найдена в текущем профиле',
        },
      });
    }

    const proposedPayload = {
      action: 'mark_wrong',
      personId: person.id,
      personName: person.name,
      categoryName: category.name,
      reasonFromUser: args.body.reason,
      currentCategory: category,
      reportedAt: new Date().toISOString(),
    };

    // Triage с conflictSignal='hard' и confidence=0.0 — гарантированно
    // упадёт в `deep` review (knowledge_profile НЕ в critical, но hard-сигнал
    // + низкий confidence перевешивают auto-threshold).
    try {
      const res = await this.curation.triage({
        tenantId: args.tenantId,
        resourceType: 'knowledge_profile',
        resourceId: person.id,
        confidence: 0,
        proposedPayload,
        conflictSignal: 'hard',
        createdByUserId: args.userId,
        dataClass: 'internal',
      });
      if (!res.curationItemId) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'triage_unexpected',
            message: 'Не удалось создать заявку на проверку — попробуйте позже',
          },
        });
      }
      return { ok: true, curationItemId: res.curationItemId };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (err instanceof ForbiddenException) throw err;
      this.logger.error(
        {
          personId: person.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'knowledge-clone.markWrong: triage упал',
      );
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'mark_wrong_failed',
          message: 'Не удалось отправить заявку на проверку — попробуйте позже',
        },
      });
    }
  }

  // ─────────────────────────── helpers ────────────────────────────

  private personSelect() {
    return {
      id: true,
      tenantId: true,
      name: true,
      userId: true,
      deletedAt: true,
      knowledgeProfile: true,
      lastProfileBuildAt: true,
      profileBuildVersion: true,
    } as const;
  }

  private readProfile(raw: Prisma.JsonValue | null): {
    version?: number;
    builtAt?: string;
    categories: Array<{
      name: string;
      confidence: 'low' | 'medium' | 'high';
      observationCount: number;
      sampleStatements: Array<{ quote: string; blockId: string }>;
      relatedEntityIds: string[];
      lastObservedAt: string;
    }>;
    experienceHighlights: Array<{ summary: string; blockIds: string[] }>;
  } | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    const categoriesRaw = Array.isArray(obj.categories) ? obj.categories : [];
    const highlightsRaw = Array.isArray(obj.experienceHighlights)
      ? obj.experienceHighlights
      : [];
    const categories: Array<{
      name: string;
      confidence: 'low' | 'medium' | 'high';
      observationCount: number;
      sampleStatements: Array<{ quote: string; blockId: string }>;
      relatedEntityIds: string[];
      lastObservedAt: string;
    }> = [];
    for (const c of categoriesRaw) {
      if (!c || typeof c !== 'object') continue;
      const cat = c as Record<string, unknown>;
      if (typeof cat.name !== 'string') continue;
      const conf =
        cat.confidence === 'low' ||
        cat.confidence === 'medium' ||
        cat.confidence === 'high'
          ? cat.confidence
          : 'low';
      const obsCount =
        typeof cat.observationCount === 'number' ? cat.observationCount : 1;
      const sampleStatements: Array<{ quote: string; blockId: string }> = [];
      if (Array.isArray(cat.sampleStatements)) {
        for (const s of cat.sampleStatements) {
          if (!s || typeof s !== 'object') continue;
          const st = s as Record<string, unknown>;
          if (typeof st.quote === 'string' && typeof st.blockId === 'string') {
            sampleStatements.push({ quote: st.quote, blockId: st.blockId });
          }
        }
      }
      const relatedEntityIds: string[] = [];
      if (Array.isArray(cat.relatedEntityIds)) {
        for (const id of cat.relatedEntityIds) {
          if (typeof id === 'string') relatedEntityIds.push(id);
        }
      }
      const lastObservedAt =
        typeof cat.lastObservedAt === 'string'
          ? cat.lastObservedAt
          : new Date().toISOString();
      categories.push({
        name: cat.name,
        confidence: conf,
        observationCount: obsCount,
        sampleStatements,
        relatedEntityIds,
        lastObservedAt,
      });
    }
    const experienceHighlights: Array<{
      summary: string;
      blockIds: string[];
    }> = [];
    for (const h of highlightsRaw) {
      if (!h || typeof h !== 'object') continue;
      const item = h as Record<string, unknown>;
      if (typeof item.summary !== 'string') continue;
      const blockIds: string[] = [];
      if (Array.isArray(item.blockIds)) {
        for (const id of item.blockIds) {
          if (typeof id === 'string') blockIds.push(id);
        }
      }
      experienceHighlights.push({ summary: item.summary, blockIds });
    }
    return {
      version: typeof obj.version === 'number' ? obj.version : undefined,
      builtAt: typeof obj.builtAt === 'string' ? obj.builtAt : undefined,
      categories,
      experienceHighlights,
    };
  }

  private serialize(
    person: {
      id: string;
      name: string;
      userId: string | null;
      lastProfileBuildAt: Date | null;
      profileBuildVersion: number;
      knowledgeProfile: Prisma.JsonValue | null;
    },
    opts: { includeSampleStatements: boolean; isSelf: boolean },
  ): KnowledgeProfileDto {
    const profile = this.readProfile(person.knowledgeProfile);
    const categories: KnowledgeProfileCategoryDto[] = (
      profile?.categories ?? []
    ).map((c): KnowledgeProfileCategoryDto => {
      const sampleStatements: KnowledgeProfileSampleStatementDto[] =
        opts.includeSampleStatements
          ? c.sampleStatements.map((s) => ({ quote: s.quote, blockId: s.blockId }))
          : [];
      return {
        name: c.name,
        confidence: c.confidence,
        observationCount: c.observationCount,
        sampleStatements,
        relatedEntityIds: c.relatedEntityIds,
        lastObservedAt: c.lastObservedAt,
      };
    });
    const experienceHighlights: KnowledgeProfileHighlightDto[] = (
      profile?.experienceHighlights ?? []
    ).map((h) => ({ summary: h.summary, blockIds: h.blockIds }));

    const builtAt =
      profile?.builtAt ??
      (person.lastProfileBuildAt
        ? person.lastProfileBuildAt.toISOString()
        : '');

    return {
      personId: person.id,
      personName: person.name,
      version: profile?.version ?? person.profileBuildVersion,
      builtAt,
      isEmpty: categories.length === 0 && experienceHighlights.length === 0,
      categories,
      experienceHighlights,
      isSelf: opts.isSelf,
    };
  }
}
