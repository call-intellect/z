import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  DailyBriefQuerySchema,
  emptyDailyBriefDto,
  KnowsWhoQuerySchema,
  toDailyBriefDto,
  toKnowsWhoListDto,
  type DailyBriefDto,
  type DailyBriefQuery,
  type KnowsWhoListDto,
  type KnowsWhoQuery,
} from '../dto/personal-daily-brief.dto';
import { CommitmentsService } from '../services/commitments.service';
import { KnowsWhoService } from '../services/knows-who.service';
import { PersonalDailyBriefService } from '../services/personal-daily-brief.service';
import { getLocalDate } from '../utils/local-date';

/**
 * TZ-1 Фаза 2 (daily-value-engine) — `/api/v1/me/daily-brief`, `/me/knows-who`.
 *
 * Движок рядового. ТОЛЬКО self-scope (по `Person.userId`): сотрудник видит свой
 * бриф, своих носителей знания — операционные данные (чужие задачи/клиенты) НЕ
 * открываем (Р8). Self-person резолвится сервером из cookie-сессии, query/param
 * НЕ задают чужой personId.
 *
 * Auth: CookieAuthGuard + TenantGuard. Если у пользователя нет Person-записи —
 * отдаём пустой бриф / пустой список (200), как `/me/customer-risk`.
 */
@ApiTags('me-daily-brief')
@Controller('api/v1/me')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MyDailyBriefController {
  constructor(
    @Inject(CommitmentsService)
    private readonly commitments: CommitmentsService,
    @Inject(PersonalDailyBriefService)
    private readonly briefs: PersonalDailyBriefService,
    @Inject(KnowsWhoService)
    private readonly knowsWho: KnowsWhoService,
  ) {}

  @Get('daily-brief')
  @ApiOperation({
    summary: 'Мой персональный бриф «Твой день» (self-scope)',
  })
  async getBrief(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(DailyBriefQuerySchema)) q: DailyBriefQuery,
  ): Promise<DailyBriefDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);

    const dateLocal = q.date ?? getLocalDate(new Date(), 'Europe/Moscow');

    const personId = await this.resolveSelfPersonId(tenantId!, uid);
    if (!personId) return emptyDailyBriefDto(dateLocal);

    const stored = await this.briefs.getForPerson({
      tenantId: tenantId!,
      personId,
      dateLocal,
    });
    if (!stored) return emptyDailyBriefDto(dateLocal);

    return toDailyBriefDto({
      id: stored.id,
      payload: stored.payload,
      deliveredAt: stored.deliveredAt,
      openedAt: stored.openedAt,
    });
  }

  @Post('daily-brief/:id/opened')
  @ApiOperation({
    summary: 'Отметить бриф открытым (self-scope, проверка владения)',
  })
  async markOpened(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    if (!id || id.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'id_required', message: 'Не передан id брифа' },
      });
    }

    const personId = await this.resolveSelfPersonId(tenantId!, uid);
    if (!personId) {
      // Нет Person — чужой бриф открыть нельзя.
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Бриф не найден' },
      });
    }

    const ok = await this.briefs.markOpened({
      tenantId: tenantId!,
      personId,
      briefId: id,
    });
    if (!ok) {
      // Чужой/несуществующий бриф — не раскрываем, отдаём 404.
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Бриф не найден' },
      });
    }
    return { ok: true };
  }

  @Get('knows-who')
  @ApiOperation({
    summary: 'Кто знает X — носители знания по моему блокеру/вопросу (self-scope)',
  })
  async knowsWhoEndpoint(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(KnowsWhoQuerySchema)) q: KnowsWhoQuery,
  ): Promise<KnowsWhoListDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);

    // Self-person нужен, чтобы исключить самого себя из носителей.
    const personId = await this.resolveSelfPersonId(tenantId!, uid);

    const experts = await this.knowsWho.findExpertsForBlocker({
      tenantId: tenantId!,
      blockId: q.blockId,
      blockerText: q.q,
      excludePersonId: personId,
      topK: q.limit,
    });
    return toKnowsWhoListDto(experts);
  }

  // ── helpers ──

  /** Резолв self-person (graceful: null если Person нет — не 403). */
  private async resolveSelfPersonId(
    tenantId: string,
    userId: string,
  ): Promise<string | null> {
    try {
      const person = await this.commitments.resolveSelfPerson({
        tenantId,
        userId,
      });
      return person.id;
    } catch (err) {
      if (err instanceof ForbiddenException && this.isNoPersonError(err)) {
        return null;
      }
      throw err;
    }
  }

  private isNoPersonError(err: ForbiddenException): boolean {
    const response = err.getResponse();
    return (
      typeof response === 'object' &&
      response !== null &&
      (response as { error?: { code?: string } }).error?.code === 'no_person'
    );
  }

  private requireUser(req: Request): string {
    const uid = req.user?.id;
    if (!uid) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'Требуется авторизация' },
      });
    }
    return uid;
  }

  private requireTenant(tenantId: string | undefined): void {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Не передан tenantId' },
      });
    }
  }
}
