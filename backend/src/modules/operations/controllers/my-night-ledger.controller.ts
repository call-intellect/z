import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { NightLedgerService, type NightLedgerDto } from '../services/night-ledger.service';
import { RequiresYouService, type RequiresYouDto } from '../services/requires-you.service';
import { SelfPersonResolverService } from '../services/self-person-resolver.service';

@ApiTags('me-night-ledger')
@Controller('api/v1/me')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MyNightLedgerController {
  constructor(
    @Inject(NightLedgerService) private readonly ledger: NightLedgerService,
    @Inject(RequiresYouService) private readonly requiresYou: RequiresYouService,
    @Inject(SelfPersonResolverService)
    private readonly selfPerson: SelfPersonResolverService,
  ) {}

  @Get('night-ledger')
  @ApiOperation({
    summary: 'Кора за ночь: авто-черновики прогресса + задачи из встреч + ответы клона (self-scope)',
  })
  async nightLedger(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<NightLedgerDto> {
    const uid = req.user?.id;
    if (!uid) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'Требуется авторизация' },
      });
    }
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    let personId: string | null = null;
    try {
      personId = (await this.selfPerson.resolveSelfPerson({ tenantId, userId: uid })).id;
    } catch {
      personId = null;
    }
    return this.ledger.getForUser({ tenantId, userId: uid, personId, now: new Date() });
  }

  @Get('requires-you')
  @ApiOperation({
    summary: 'Требует тебя: решения без задачи (ты решил) + твои просроченные обещания (self-scope)',
  })
  async requiresYouFeed(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<RequiresYouDto> {
    const uid = req.user?.id;
    if (!uid) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'Требуется авторизация' },
      });
    }
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    let personId: string | null = null;
    try {
      personId = (await this.selfPerson.resolveSelfPerson({ tenantId, userId: uid })).id;
    } catch {
      personId = null;
    }
    return this.requiresYou.getForPerson({ tenantId, personId, now: new Date() });
  }
}
