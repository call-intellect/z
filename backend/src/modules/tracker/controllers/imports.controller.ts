import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import type {
  ImportLogResponseDto,
  ListImportLogsResponseDto,
} from '../dto/imports/import-log-response.dto';
import {
  ListImportsQuerySchema,
  type ListImportsQuery,
  StartBitrix24ImportSchema,
  type StartBitrix24ImportDto,
  StartTrelloImportSchema,
  type StartTrelloImportDto,
  StartYandexTrackerImportSchema,
  type StartYandexTrackerImportDto,
} from '../dto/imports/start-import.dto';
import { ImportService } from '../services/import.service';

/**
 * Wave 3 / Tracker Phase 5 part 1 (2026-05-24).
 *
 * REST `/api/v1/tracker/imports/*` — миграционный wizard под трекер.
 *
 * Все эндпоинты под TenantGuard + RBAC ResourceType='import_tracker'.
 * Trello — единственный source с полной реализацией; Bitrix24 / Я.Трекер —
 * заглушки (worker сразу throw'ит NotImplemented, ImportLog → 'failed').
 *
 * Контракты совпадают с frontend wizard'ом (см. ТЗ §UX).
 */
@ApiTags('tracker / imports')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ImportsController {
  constructor(
    @Inject(ImportService) private readonly svc: ImportService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Post('tracker/imports/trello')
  @RequireSubscription()
  @ApiOperation({ summary: 'Запустить импорт из Trello (JSON-export)' })
  async startTrello(
    @Body(new ZodValidationPipe(StartTrelloImportSchema))
    body: StartTrelloImportDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ importLogId: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.start({
      tenantId: t,
      userId: user.id,
      source: 'trello',
      paramsJson: body,
    });
  }

  @Post('tracker/imports/bitrix24')
  @RequireSubscription()
  @ApiOperation({
    summary:
      'Запустить импорт из Битрикс24 (TODO Phase 5 part 2 — worker сразу падает)',
  })
  async startBitrix24(
    @Body(new ZodValidationPipe(StartBitrix24ImportSchema))
    body: StartBitrix24ImportDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ importLogId: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.start({
      tenantId: t,
      userId: user.id,
      source: 'bitrix24',
      paramsJson: body,
    });
  }

  @Post('tracker/imports/yandex-tracker')
  @RequireSubscription()
  @ApiOperation({
    summary:
      'Запустить импорт из Я.Трекера (TODO Phase 5 part 2 — worker сразу падает)',
  })
  async startYandexTracker(
    @Body(new ZodValidationPipe(StartYandexTrackerImportSchema))
    body: StartYandexTrackerImportDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ importLogId: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.start({
      tenantId: t,
      userId: user.id,
      source: 'yandex_tracker',
      paramsJson: body,
    });
  }

  @Get('tracker/imports')
  @ApiOperation({ summary: 'Список импортов организации' })
  async list(
    @Query(new ZodValidationPipe(ListImportsQuerySchema))
    query: ListImportsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListImportLogsResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.list({
      tenantId: t,
      limit: query.limit,
      cursor: query.cursor,
      source: query.source,
      status: query.status,
    });
  }

  @Get('tracker/imports/:id')
  @ApiOperation({ summary: 'Детали импорта (включая ошибки и unmatched email)' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ImportLogResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getById({ tenantId: t, importLogId: id });
  }

  @Post('tracker/imports/:id/cancel')
  @RequireSubscription()
  @ApiOperation({ summary: 'Отменить импорт (worker прервётся между батчами)' })
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ImportLogResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.cancel({ tenantId: t, importLogId: id });
  }

  // ── helpers ──

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

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'import_tracker');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет прав на чтение импортов',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'import_tracker');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Только admin / owner Org могут запускать/отменять импорты',
        },
      });
    }
  }
}
