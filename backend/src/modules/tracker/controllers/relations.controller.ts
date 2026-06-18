import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  CreateIssueRelationSchema,
  type CreateIssueRelationDto,
  type IssueRelationDto,
} from '../dto/issues/create-relation.dto';
import { RelationsService } from '../services/relations.service';

@ApiTags('tracker / issues / relations')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class RelationsController {
  constructor(
    @Inject(RelationsService) private readonly svc: RelationsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('issues/:id/relations')
  @ApiOperation({ summary: 'Список связей задачи (out + in)' })
  async list(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueRelationDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getRelations(id, t);
  }

  @Post('issues/:id/relations')
  @RequireSubscription()
  @ApiOperation({
    summary:
      'Создать связь (blocks / blocked_by / duplicates / duplicated_by / relates_to). ' +
      'Парная обратная создаётся автоматически.',
  })
  async create(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateIssueRelationSchema))
    body: CreateIssueRelationDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueRelationDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.createRelation(id, body, t, user.id);
  }

  @Delete('relations/:relationId')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Удалить связь по id (вместе с парной обратной)',
  })
  async remove(
    @Param('relationId') relationId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.deleteRelation(relationId, t, user.id);
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение задач' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на изменение задач' },
      });
    }
  }
}
