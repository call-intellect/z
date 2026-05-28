/**
 * MeetingsBalanceController — клиентский эндпоинт «сколько встреч у меня осталось».
 *
 * Маршрут:
 *   GET /api/v1/billing/meetings-balance  (auth + tenant)
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.1.
 */

import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';

import {
  MeetingsBalanceResponseDto,
  type MeetingsBalanceResponseBody,
} from './dto/meetings-balance.dto';
import { MeetingsBalanceService } from './meetings-balance.service';

@ApiTags('billing')
@ApiBearerAuth()
@Controller('api/v1/billing')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MeetingsBalanceController {
  constructor(
    @Inject(MeetingsBalanceService)
    private readonly service: MeetingsBalanceService,
  ) {}

  @Get('meetings-balance')
  @ApiOperation({
    summary: 'Текущий накопительный баланс встреч Org.',
    description:
      'Заменяет старую квоту meetings_per_month: баланс копится без потолка ' +
      'и без обнуления в конце месяца. Начисляется при активации/продлении ' +
      'подписки (см. Billing Фаза 4).',
  })
  @ApiOkResponse({ type: MeetingsBalanceResponseDto })
  async getMyBalance(
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MeetingsBalanceResponseBody> {
    if (!tenantId) {
      throw new ForbiddenException('Не определён tenantId (нужен X-Org-Id)');
    }
    const view = await this.service.getBalance(tenantId);
    return {
      balance: view.balance,
      totalGranted: view.totalGranted,
      totalConsumed: view.totalConsumed,
      lastGrantedAt: view.lastGrantedAt?.toISOString() ?? null,
    };
  }
}
