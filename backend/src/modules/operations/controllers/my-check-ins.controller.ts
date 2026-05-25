import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
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
  CreateCheckInSchema,
  type CreateCheckInInput,
  type DailyCheckInDto,
  HistoryCheckInsQuerySchema,
  type HistoryCheckInsQuery,
  ListCheckInsQuerySchema,
  type ListCheckInsQuery,
  stripSentimentForRole,
} from '../dto/daily-check-in.dto';
import { DailyCheckInService } from '../services/daily-checkin.service';

/**
 * SBA β-8 — `/api/v1/me/check-ins`.
 *
 *   GET /?date=YYYY-MM-DD&kind=morning|evening — список своих
 *   POST / — manual create (плюс upsert по уникальности дня+kind)
 *   GET /history?days=30 — окно
 *
 * Auth: CookieAuthGuard + TenantGuard. Self-only: чтения и записи —
 * только своих чек-инов (через Person.userId = currentUserId).
 */
@ApiTags('me-check-ins')
@Controller('api/v1/me/check-ins')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MyCheckInsController {
  constructor(
    @Inject(DailyCheckInService)
    private readonly svc: DailyCheckInService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список моих чек-инов (фильтр по date/kind)' })
  async list(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(ListCheckInsQuerySchema))
    q: ListCheckInsQuery,
  ): Promise<{ items: DailyCheckInDto[] }> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    const person = await this.svc.resolveSelfPerson({
      tenantId: tenantId!,
      userId: uid,
    });
    const items = await this.svc.listMine({
      tenantId: tenantId!,
      personId: person.id,
      date: q.date,
      kind: q.kind,
    });
    // SBA β-8.1 — `/me/check-ins` всегда отдаётся без полей `sentiment*`.
    // Маппер вызываем с role=null (не из whitelist'а) — гарантирует, что
    // сотрудник никогда не увидит своё настроение.
    return { items: items.map((it) => stripSentimentForRole(it, null)) };
  }

  @Post()
  @ApiOperation({ summary: 'Создать (или обновить) свой чек-ин' })
  async create(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Body(new ZodValidationPipe(CreateCheckInSchema))
    body: CreateCheckInInput,
  ): Promise<DailyCheckInDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    const person = await this.svc.resolveSelfPerson({
      tenantId: tenantId!,
      userId: uid,
    });
    const dto = await this.svc.createOrUpsertManual({
      tenantId: tenantId!,
      personId: person.id,
      personTimezone: person.timezone,
      input: body,
    });
    return stripSentimentForRole(dto, null);
  }

  @Get('history')
  @ApiOperation({ summary: 'История моих чек-инов за N дней' })
  async history(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(HistoryCheckInsQuerySchema))
    q: HistoryCheckInsQuery,
  ): Promise<{ items: DailyCheckInDto[] }> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    const person = await this.svc.resolveSelfPerson({
      tenantId: tenantId!,
      userId: uid,
    });
    const items = await this.svc.historyMine({
      tenantId: tenantId!,
      personId: person.id,
      days: q.days,
    });
    return { items: items.map((it) => stripSentimentForRole(it, null)) };
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
