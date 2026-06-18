import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { OrgAdminGuard } from '../../auth/guards/org-admin.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { AdminAuditInterceptor } from '../admin.audit.interceptor';

import {
  ArchiveSkillTraitConceptSchema,
  type ArchiveSkillTraitConceptDto,
  ListSkillTraitConceptsQuerySchema,
  type ListSkillTraitConceptsQueryDto,
  MergeSkillTraitConceptSchema,
  type MergeSkillTraitConceptDto,
} from './dto/skill-trait-concepts.dto';
import { AdminSkillTraitConceptsService } from './services/skill-trait-concepts.service';

@ApiTags('admin-skill-trait-concepts')
@Controller('api/v1/admin/skill-trait-concepts')
@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminSkillTraitConceptsController {
  constructor(
    @Inject(AdminSkillTraitConceptsService)
    private readonly svc: AdminSkillTraitConceptsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Список «Смысловых блоков навыка» с фильтрами по статусу и поиском по canonicalName/variants.',
  })
  list(
    @CurrentOrg() tenantId: string,
    @Query(new ZodValidationPipe(ListSkillTraitConceptsQuerySchema))
    q: ListSkillTraitConceptsQueryDto,
  ) {
    return this.svc.list({ tenantId, query: q });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Карточка одного «Смыслового блока навыка» с последними 20 связанными чертами.',
  })
  detail(@CurrentOrg() tenantId: string, @Param('id') id: string) {
    return this.svc.detail({ tenantId, conceptId: id });
  }

  @Post(':id/merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Слить «Смысловой блок» в указанный целевой блок (источник помечается merged_into).',
  })
  merge(
    @CurrentOrg() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MergeSkillTraitConceptSchema))
    dto: MergeSkillTraitConceptDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.merge({
      tenantId,
      sourceId: id,
      dto,
      actorUserId: user.id,
    });
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Архивировать «Смысловой блок навыка» с обязательным указанием причины.',
  })
  archive(
    @CurrentOrg() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ArchiveSkillTraitConceptSchema))
    dto: ArchiveSkillTraitConceptDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.archive({
      tenantId,
      conceptId: id,
      dto,
      actorUserId: user.id,
    });
  }
}
