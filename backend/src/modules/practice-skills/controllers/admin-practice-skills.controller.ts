import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PracticeSkill, Prisma } from '@prisma/client';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { OrgAdminGuard } from '../../auth/guards/org-admin.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  ArchivePracticeSkillBodySchema,
  type ArchivePracticeSkillBody,
  ListPracticeSkillsQuerySchema,
  type ListPracticeSkillsQuery,
  type ListPracticeSkillsResponse,
  type PracticeSkillDto,
  type PracticeSkillExampleDto,
  type PracticeSkillStepDto,
  UpdatePinnedBodySchema,
  type UpdatePinnedBody,
  UpdateTrafficShareBodySchema,
  type UpdateTrafficShareBody,
} from '../dto/practice-skills.dto';
import { PracticeSkillExtractWorker } from '../workers/practice-skill-extract.worker';

/**
 * Agents v2 Фаза C1 (2026-05-30) — Admin REST API для PracticeSkill.
 *
 *   GET    /api/v1/admin/practice-skills                             — list с фильтрами
 *   POST   /api/v1/admin/practice-skills/extract                     — manual trigger (body: {conceptId})
 *   PATCH  /api/v1/admin/practice-skills/:id/archive                 — body: {archivedReason}
 *   PATCH  /api/v1/admin/practice-skills/:id/traffic                 — body: {trafficShare}
 *   PATCH  /api/v1/admin/practice-skills/:id/pin                     — body: {pinned}
 *
 * RBAC:
 *   - `CookieAuthGuard + TenantGuard + OrgAdminGuard` — owner/admin Org.
 *   - Org-admin видит/правит только свои per-tenant skill'ы. Контроллер
 *     проверяет `skill.tenantId === currentTenantId`.
 *
 * Метрик не инкрементируем (action-level — не делаем по решению Фазы C1;
 * админ-операции редкие и фиксируются через AuditLog в каркасе админ-guard'а).
 */
@ApiTags('admin-practice-skills')
@Controller('api/v1/admin/practice-skills')
@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)
export class AdminPracticeSkillsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PracticeSkillExtractWorker)
    private readonly extractWorker: PracticeSkillExtractWorker,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список PracticeSkill (admin)' })
  async list(
    @Query(new ZodValidationPipe(ListPracticeSkillsQuerySchema))
    q: ListPracticeSkillsQuery,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListPracticeSkillsResponse> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'no_tenant',
          message: 'Не выбрана организация',
        },
      });
    }
    const where: Prisma.PracticeSkillWhereInput = {
      tenantId,
    };
    if (q.scope) where.scope = q.scope;
    if (q.status) where.status = q.status;
    if (q.scopeRefId) where.scopeRefId = q.scopeRefId;
    if (q.q) {
      // Простой case-insensitive contains по trigger.
      where.trigger = { contains: q.q, mode: 'insensitive' };
    }
    const [items, total] = await Promise.all([
      this.prisma.practiceSkill.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      this.prisma.practiceSkill.count({ where }),
    ]);
    return {
      items: items.map((s) => toDto(s)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  @Post('extract')
  @ApiOperation({
    summary: 'Запустить extract для конкретного SkillTraitConcept (admin)',
  })
  async extract(
    @Body() body: { conceptId?: string },
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ created: number }> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_tenant', message: 'Не выбрана организация' },
      });
    }
    const conceptId = body?.conceptId?.trim();
    if (!conceptId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'concept_id_required', message: 'conceptId обязателен' },
      });
    }
    // Проверка тенанта.
    const concept = await this.prisma.skillTraitConcept.findFirst({
      where: { id: conceptId, tenantId },
      select: { id: true },
    });
    if (!concept) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'concept_not_found', message: 'Концепт не найден' },
      });
    }
    const created = await this.extractWorker.runForConcept(tenantId, conceptId);
    return { created };
  }

  @Patch(':id/archive')
  @ApiOperation({ summary: 'Архивировать PracticeSkill' })
  async archive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ArchivePracticeSkillBodySchema))
    body: ArchivePracticeSkillBody,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PracticeSkillDto> {
    const skill = await this.requireOwnedSkill(id, tenantId ?? null);
    const updated = await this.prisma.practiceSkill.update({
      where: { id: skill.id },
      data: {
        status: 'archived',
        archivedAt: new Date(),
        archivedReason: body.archivedReason,
      },
    });
    return toDto(updated);
  }

  @Patch(':id/traffic')
  @ApiOperation({ summary: 'Изменить trafficShare PracticeSkill' })
  async traffic(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTrafficShareBodySchema))
    body: UpdateTrafficShareBody,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PracticeSkillDto> {
    const skill = await this.requireOwnedSkill(id, tenantId ?? null);
    const updated = await this.prisma.practiceSkill.update({
      where: { id: skill.id },
      data: { trafficShare: body.trafficShare },
    });
    return toDto(updated);
  }

  @Patch(':id/pin')
  @ApiOperation({
    summary: 'Закрепить / снять закрепление PracticeSkill (manual priority)',
  })
  async pin(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePinnedBodySchema))
    body: UpdatePinnedBody,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PracticeSkillDto> {
    const skill = await this.requireOwnedSkill(id, tenantId ?? null);
    const updated = await this.prisma.practiceSkill.update({
      where: { id: skill.id },
      data: { pinned: body.pinned },
    });
    return toDto(updated);
  }

  /**
   * Загружает skill и проверяет, что текущий tenant имеет право его править.
   * Чужие per-tenant skill'ы — притворяемся, что не существуют.
   */
  private async requireOwnedSkill(
    id: string,
    currentTenantId: string | null,
  ): Promise<PracticeSkill> {
    if (!currentTenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_tenant', message: 'Не выбрана организация' },
      });
    }
    const skill = await this.prisma.practiceSkill.findUnique({ where: { id } });
    if (!skill || skill.tenantId !== currentTenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'practice_skill_not_found', message: 'Навык не найден' },
      });
    }
    return skill;
  }
}

// ──────────────────────────── helpers ────────────────────────────

function toDto(s: PracticeSkill): PracticeSkillDto {
  return {
    id: s.id,
    tenantId: s.tenantId,
    scope: s.scope,
    scopeRefId: s.scopeRefId,
    trigger: s.trigger,
    steps: Array.isArray(s.steps)
      ? (s.steps as unknown as PracticeSkillStepDto[])
      : [],
    examples: Array.isArray(s.examples)
      ? (s.examples as unknown as PracticeSkillExampleDto[])
      : [],
    redFlags: Array.isArray(s.redFlags)
      ? (s.redFlags as unknown as string[])
      : [],
    status: s.status,
    trafficShare: s.trafficShare,
    shadowMetrics:
      s.shadowMetrics && typeof s.shadowMetrics === 'object'
        ? (s.shadowMetrics as Record<string, unknown>)
        : null,
    successRate: s.successRate ?? null,
    lastUsed: s.lastUsed?.toISOString() ?? null,
    derivedFromConceptIds: s.derivedFromConceptIds,
    derivedFromTraitIds: s.derivedFromTraitIds,
    derivedFromEpisodeCount: s.derivedFromEpisodeCount,
    pinned: s.pinned,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    promotedAt: s.promotedAt?.toISOString() ?? null,
    archivedAt: s.archivedAt?.toISOString() ?? null,
    archivedReason: s.archivedReason ?? null,
    version: s.version,
  };
}
