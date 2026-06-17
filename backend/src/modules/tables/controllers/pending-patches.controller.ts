import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

import {
  type CellProvenanceDto,
  DecidePendingPatchBodySchema,
  type DecidePendingPatchBody,
  type PendingPatchDto,
  PendingPatchesListQuerySchema,
  type PendingPatchesListQuery,
} from '../dto/tables.dto';
import { TableEnrichService } from '../services/table-enrich.service';

@ApiTags('tables')
@ApiBearerAuth()
@Controller('api/v1/tables')
@UseGuards(CookieAuthGuard, TenantGuard)
export class PendingPatchesController {
  constructor(
    @Inject(TableEnrichService) private readonly enrich: TableEnrichService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('pending-patches')
  @ApiOperation({ summary: 'Список правок ячеек на подтверждение (pending)' })
  @ApiOkResponse({ description: 'Очередь подтверждений' })
  async listPending(
    @Query(new ZodValidationPipe(PendingPatchesListQuerySchema))
    q: PendingPatchesListQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: PendingPatchDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const items = await this.enrich.listPendingPatches({
      tenantId: t,
      ...(q.tableId ? { tableId: q.tableId } : {}),
    });
    return {
      items: items.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  @Post('pending-patches/:id/decide')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подтвердить или отклонить правку ячейки' })
  @ApiOkResponse({ description: 'Новый статус правки' })
  async decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DecidePendingPatchBodySchema))
    body: DecidePendingPatchBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ status: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.enrich.decidePendingPatch({
      tenantId: t,
      patchId: id,
      decision: body.decision,
      userId: user.id,
    });
  }

  @Post('cell-provenance/:id/undo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Откатить авто-правку ячейки (восстановить прежнее)' })
  @ApiOkResponse({ description: 'Результат отката' })
  async undo(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ rolledBack: boolean }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.enrich.undoCellEdit({
      tenantId: t,
      provenanceId: id,
      userId: user.id,
    });
  }

  @Get('rows/:rowId/provenance')
  @ApiOperation({ summary: 'Провенансы значений ячеек строки (источники)' })
  @ApiOkResponse({ description: 'Записи о происхождении значений' })
  async rowProvenance(
    @Param('rowId') rowId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: CellProvenanceDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const items = await this.enrich.listRowProvenance({
      tenantId: t,
      rowId,
    });
    return {
      items: items.map((p) => ({
        ...p,
        appliedAt: p.appliedAt.toISOString(),
        rolledBackAt: p.rolledBackAt ? p.rolledBackAt.toISOString() : null,
      })),
    };
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'table');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения таблиц',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'table', null);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для изменения таблицы',
        },
      });
    }
  }
}
