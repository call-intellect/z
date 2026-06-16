import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { EntitlementService } from '../entitlements/entitlement.service';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import { BitrixIntegrationService } from './bitrix-integration.service';
import { BitrixSyncService } from './bitrix-sync.service';
import {
  BitrixAnalysisToggleSchema,
  BitrixAuthorizeUrlQuerySchema,
  BitrixClaimSchema,
  BitrixUserLinkSchema,
  type BitrixAnalysisToggleDto,
  type BitrixAuthorizeUrlQueryDto,
  type BitrixClaimDto,
  type BitrixIntegrationResponseDto,
  type BitrixStatusResponseDto,
  type BitrixUserDto,
  type BitrixUserLinkDto,
  type BitrixUsersResponseDto,
} from './dto/bitrix-integration.dto';
import { type BitrixSyncScope } from './queue/bitrix-sync.queue';
import { BitrixSyncQueueService } from './queue/bitrix-sync.queue.service';

/** Допустимые scope ручного синка Bitrix24. */
const BITRIX_SYNC_SCOPES: readonly BitrixSyncScope[] = [
  'all',
  'users',
  'dialogs',
  'crm',
];

/**
 * REST API Bitrix24-интеграции org.
 * ТЗ: plans/tz/2026-06-09-bitrix24-integration-install.md.
 *
 *   - GET    /api/v1/bitrix/integration               — текущая (read).
 *   - GET    /api/v1/bitrix/integration/authorize-url — URL OAuth-коннекта (manage).
 *   - POST   /api/v1/bitrix/integration/test          — проверка соединения (manage).
 *   - POST   /api/v1/bitrix/integration/claim         — привязать установку из Маркета (manage).
 *   - DELETE /api/v1/bitrix/integration               — отключить (delete).
 *
 * RBAC ресурс — `bitrix`. Фича тарифа — `feature.bitrix`. Формат ошибок
 * `{ ok:false, error:{ code, message } }` — по образцу `chatbox`/`sources`.
 */
@ApiTags('bitrix')
@Controller('api/v1/bitrix/integration')
@UseGuards(CookieAuthGuard, TenantGuard)
export class BitrixIntegrationController {
  constructor(
    @Inject(BitrixIntegrationService)
    private readonly service: BitrixIntegrationService,
    @Inject(BitrixSyncService)
    private readonly syncService: BitrixSyncService,
    @Inject(BitrixSyncQueueService)
    private readonly syncQueue: BitrixSyncQueueService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(EntitlementService)
    private readonly entitlements: EntitlementService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Текущая Bitrix24-интеграция org (без токенов)' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BitrixIntegrationResponseDto | null> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.service.getIntegration(t);
  }

  @Get('authorize-url')
  @ApiOperation({ summary: 'URL авторизации Bitrix24 для подключения портала' })
  async authorizeUrl(
    @Query(new ZodValidationPipe(BitrixAuthorizeUrlQuerySchema))
    query: BitrixAuthorizeUrlQueryDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ url: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    await this.requireFeature(t);
    return { url: this.service.buildAuthorizeUrl(t, query.domain) };
  }

  @Get('status')
  @ApiOperation({
    summary: 'Статус источника Bitrix24: счётчики зеркал, синки, анализ',
  })
  async status(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BitrixStatusResponseDto | null> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.service.getStatus(t);
  }

  @Patch('analysis')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Тумблер AI-анализа диалогов Bitrix24 (вкл/выкл)' })
  async setAnalysis(
    @Body(new ZodValidationPipe(BitrixAnalysisToggleSchema))
    body: BitrixAnalysisToggleDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; analysisEnabled: boolean }> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    await this.requireFeature(t);
    return this.service.setAnalysisEnabled(t, body.enabled);
  }

  @Get('users')
  @ApiOperation({
    summary: 'Сотрудники Bitrix24 + кандидаты Person (сопоставление)',
  })
  async users(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BitrixUsersResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.syncService.listUsers(t);
  }

  @Patch('users/:externalId/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Сопоставить сотрудника Bitrix24 с Person (link/unlink/create)',
  })
  async linkUser(
    @Param('externalId') externalId: string,
    @Body(new ZodValidationPipe(BitrixUserLinkSchema)) body: BitrixUserLinkDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BitrixUserDto> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    await this.requireFeature(t);
    return this.syncService.linkUser(t, externalId, body.mode, body.personId);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Проверка соединения с Bitrix24 (app.info)' })
  async test(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; app: Record<string, unknown> }> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    return this.service.testConnection(t);
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Привязать установку Bitrix24 из Маркета к этой org' })
  async claim(
    @Body(new ZodValidationPipe(BitrixClaimSchema)) body: BitrixClaimDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BitrixIntegrationResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    await this.requireFeature(t);
    return this.service.claim(t, body.memberId);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Запустить синхронизацию Bitrix24 (scope=all|users|dialogs|crm)',
  })
  async sync(
    @Query('scope') scopeRaw: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; jobId: string; scope: BitrixSyncScope }> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    await this.requireFeature(t);
    const scope: BitrixSyncScope = BITRIX_SYNC_SCOPES.includes(
      scopeRaw as BitrixSyncScope,
    )
      ? (scopeRaw as BitrixSyncScope)
      : 'all';
    const { jobId } = await this.syncQueue.enqueue(t, scope);
    return { ok: true, jobId, scope };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отключить Bitrix24-интеграцию' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.service.remove(t);
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireFeature(tenantId: string): Promise<void> {
    const allowed = await this.entitlements.hasFeature(tenantId, 'feature.bitrix');
    if (!allowed) {
      const ent = await this.entitlements.getEntitlement(tenantId);
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'entitlement_required',
          message: `Интеграция с Bitrix24 не входит в тариф ${ent.tier}.`,
          feature: 'feature.bitrix',
          currentTier: ent.tier,
          upgradeUrl: '/settings/billing',
        },
      });
    }
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'bitrix');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет прав на чтение Bitrix24-интеграции',
        },
      });
    }
  }

  private async requireManage(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'bitrix',
      act: 'manage',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Управлять Bitrix24-интеграцией может только владелец или администратор Org',
        },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'bitrix',
      act: 'delete',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Отключение Bitrix24-интеграции доступно только владельцу Org',
        },
      });
    }
  }
}
