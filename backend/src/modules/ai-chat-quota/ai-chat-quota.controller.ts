import { BadRequestException, Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';

import { AiChatQuotaService } from './ai-chat-quota.service';

@ApiTags('ai-chat-quota')
@Controller('api/v1/me/ai-chat')
@UseGuards(CookieAuthGuard, TenantGuard)
export class AiChatQuotaController {
  constructor(@Inject(AiChatQuotaService) private readonly quota: AiChatQuotaService) {}

  @Get('quota')
  @ApiOperation({
    summary: 'Дневная квота AI-общения текущего пользователя (Concierge + клоны вместе)',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ dailyUsed: сколько уже потрачено сегодня, dailyLimit: лимит роли, role: роль в Org (owner/admin/coo → admin-лимит, иначе → member-лимит) }',
  })
  async getMyQuota(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ dailyUsed: number; dailyLimit: number; role: string }> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Не удалось определить организацию (X-Org-Id не передан)',
        },
      });
    }
    return this.quota.getUsage({ tenantId, userId: user.id });
  }
}
