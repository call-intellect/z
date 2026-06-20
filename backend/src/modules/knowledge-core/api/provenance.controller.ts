import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  ProvenanceService,
  type ProvenanceEntityType,
} from '../services/provenance.service';

import { ProvenanceEntityTypeSchema, type ProvenanceResponse } from './dto/provenance.dto';

@ApiTags('knowledge-core')
@Controller('api/v1/provenance')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ProvenanceController {
  constructor(
    @Inject(ProvenanceService) private readonly provenance: ProvenanceService,
  ) {}

  @Get(':entityType/:entityId')
  @ApiOperation({ summary: 'Провенанс сущности — источники, цитаты, deep-link' })
  async resolve(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProvenanceResponse> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const parsed = ProvenanceEntityTypeSchema.safeParse(entityType);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'invalid_entity_type' });
    }
    const type: ProvenanceEntityType = parsed.data;

    const nodes = await this.provenance.resolve(type, entityId, {
      tenantId,
      userId: user.id,
    });

    const meetingRefIds = new Set<string>();
    for (const n of nodes) {
      if (n.source.type === 'meeting' && n.source.refId) {
        meetingRefIds.add(n.source.refId);
      }
    }

    return {
      nodes,
      coverage: {
        blocks: nodes.length,
        meetings: meetingRefIds.size,
      },
    };
  }
}
