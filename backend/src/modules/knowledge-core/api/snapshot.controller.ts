import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

import {
  SnapshotQueryRawSchema,
  type SnapshotQueryDto,
  type SnapshotResponseDto,
} from './dto/snapshot.dto';
import { SnapshotService } from './snapshot.service';

/**
 * KC-Temporal W1.3 (2026-05-25) — `GET /api/v1/knowledge/snapshot`.
 *
 * Возвращает срез знаний компании на момент `at`: IdeaBlock'и и EntityLink-рёбра,
 * активные на эту дату, с подгруженными evidence и Entity для каждого блока.
 *
 * Auth/RBAC — как у `/knowledge/search`: CookieAuthGuard + TenantGuard +
 * `rbac.canRead('block')`.
 */
@ApiTags('knowledge-core')
@Controller('api/v1/knowledge')
@UseGuards(CookieAuthGuard, TenantGuard)
export class KnowledgeSnapshotController {
  constructor(
    @Inject(SnapshotService) private readonly svc: SnapshotService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('snapshot')
  @ApiOperation({
    summary:
      'Срез IdeaBlock + EntityLink, активных на момент `at` (bi-temporal)',
  })
  @ApiQuery({
    name: 'at',
    required: true,
    description: 'ISO8601 — дата среза',
  })
  @ApiQuery({
    name: 'entityId',
    required: false,
    description: 'Фильтр: только блоки/связи, касающиеся этой Entity',
  })
  @ApiQuery({
    name: 'signalTypes',
    required: false,
    description: 'CSV типов сигнала (insight,decision,...)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '1..500, default 100',
  })
  @ApiResponse({
    status: 200,
    description: 'Снапшот IdeaBlock + EntityLink на момент `at`',
  })
  async snapshot(
    @Query(new ZodValidationPipe(SnapshotQueryRawSchema))
    query: SnapshotQueryDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SnapshotResponseDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canRead(user.id, tenantId, 'block');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }

    return this.svc.getSnapshot({
      tenantId,
      at: new Date(query.at),
      entityId: query.entityId,
      signalTypes: query.signalTypes,
      limit: query.limit,
    });
  }
}
