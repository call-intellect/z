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
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  CreateWorklogSchema,
  type CreateWorklogDto,
} from '../dto/worklogs/create-worklog.dto';
import {
  WorklogsService,
  type WorklogListResponseDto,
  type WorklogResponseDto,
} from '../services/worklogs.service';

@ApiTags('tracker / worklog')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class WorklogsController {
  constructor(
    @Inject(WorklogsService) private readonly svc: WorklogsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('issues/:id/worklogs')
  @ApiOperation({
    summary: 'Список записей учёта времени по задаче + сумма минут',
  })
  async list(
    @Param('id') issueId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<WorklogListResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.listByIssue(issueId, t);
  }

  @Post('issues/:id/worklogs')
  @RequireSubscription()
  @ApiOperation({ summary: 'Добавить запись учёта времени' })
  async create(
    @Param('id') issueId: string,
    @Body(new ZodValidationPipe(CreateWorklogSchema)) body: CreateWorklogDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<WorklogResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(issueId, body, t, user.id);
  }

  @Delete('worklogs/:id')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить запись учёта времени (автор или admin)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    const ctx = await this.rbac.loadContext(user.id, t);
    const isAdmin =
      ctx?.role === 'admin' || ctx?.role === 'owner' || !!ctx?.isSuperAdmin;
    await this.svc.remove(id, t, user.id, isAdmin);
  }

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
    const ok = await this.rbac.canRead(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав на чтение задач',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав на изменение задач',
        },
      });
    }
  }
}
