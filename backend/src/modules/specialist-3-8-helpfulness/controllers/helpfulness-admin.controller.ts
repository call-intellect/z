import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import type {
  TeamHelperRow,
  UnansweredQuestionRow,
} from '../dto/helpfulness.dto';
import { HelpfulnessApiService } from '../services/helpfulness-api.service';

/**
 * SBA Wave 2 — Admin endpoints Specialist 3.8.
 *
 *   GET /api/v1/admin/helpfulness/team-map         — карта помощи в команде.
 *   GET /api/v1/admin/helpfulness/unanswered       — ⚠ PRIVATE — вопросы без ответов.
 *
 * ⚠ /unanswered содержит restricted-traits (question_unanswered +
 * question_acknowledged_no_action). Никогда не отображается публично.
 * Доступ ТОЛЬКО для owner/admin/руководителя — проверка через
 * RBAC.canWrite('helpfulness_trait').
 */
@ApiTags('helpfulness-admin')
@Controller('api/v1/admin')
@UseGuards(CookieAuthGuard, TenantGuard)
export class HelpfulnessAdminController {
  constructor(
    @Inject(HelpfulnessApiService) private readonly svc: HelpfulnessApiService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('helpfulness/team-map')
  @ApiOperation({ summary: 'Карта помощников команды (admin only)' })
  async teamMap(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TeamHelperRow[]> {
    const t = this.requireTenant(tenantId);
    await this.requireAdmin(user.id, t);
    return this.svc.getTeamMap({ tenantId: t });
  }

  @Get('helpfulness/unanswered')
  @ApiOperation({
    summary:
      '⚠ PRIVATE — вопросы без ответов (только admin/руководитель команды)',
  })
  async unanswered(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<UnansweredQuestionRow[]> {
    const t = this.requireTenant(tenantId);
    await this.requireAdmin(user.id, t);
    return this.svc.listUnanswered({ tenantId: t });
  }

  // ────────────── Helpers ──────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Организация не определена',
        },
      });
    }
    return tenantId;
  }

  /**
   * Доступ к админ-эндпоинтам: canWrite('helpfulness_trait'). В policies.csv
   * это разрешено только owner/admin (см. отчёт — строки добавить вручную).
   */
  private async requireAdmin(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(
      userId,
      tenantId,
      'helpfulness_trait',
    );
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Доступ только для администратора или руководителя команды',
        },
      });
    }
  }
}
