import { Controller, ForbiddenException, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
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
    summary: 'Срез IdeaBlock + EntityLink, активных на момент `at` (bi-temporal)',
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
      userId: user.id,
      at: new Date(query.at),
      entityId: query.entityId,
      signalTypes: query.signalTypes,
      limit: query.limit,
    });
  }
}
