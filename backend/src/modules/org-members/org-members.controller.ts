import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';

import {
  OrgMembersSearchQuerySchema,
  type OrgMembersSearchQuery,
  type OrgMembersSearchResponseDto,
} from './dto/org-members.dto';
import { OrgMembersService } from './services/org-members.service';

@ApiTags('org-members')
@Controller('api/v1/org-members')
@UseGuards(CookieAuthGuard, TenantGuard)
export class OrgMembersController {
  constructor(
    @Inject(OrgMembersService)
    private readonly orgMembers: OrgMembersService,
  ) {}

  @Get('search')
  @ApiOperation({
    summary:
      'Поиск по членам Org (User + Person) для ParticipantPicker — объединённый список с dedup',
    description:
      'Возвращает до `limit` результатов (default 10, max 20). User приоритетнее Person с тем же userId (dedup). Сортировка: точное начало имени → User раньше Person → по алфавиту.',
  })
  async search(
    @Query(new ZodValidationPipe(OrgMembersSearchQuerySchema))
    query: OrgMembersSearchQuery,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<OrgMembersSearchResponseDto> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return this.orgMembers.search({
      tenantId,
      q: query.q,
      limit: query.limit,
    });
  }
}
