import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import {
  ListOrgsQuerySchema,
  type ListOrgsQuery,
  UpdateOrgSchema,
  type UpdateOrgDto,
} from '../dto/admin-orgs.dto';
import { AdminOrgsService } from '../services/admin-orgs.service';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

@ApiExcludeController()
@Controller('api/v1/admin/orgs')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminOrgsController {
  constructor(@Inject(AdminOrgsService) private readonly svc: AdminOrgsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListOrgsQuerySchema)) q: ListOrgsQuery) {
    return this.svc.listOrgs({
      period: q.period,
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
      ...(q.search ? { search: q.search } : {}),
      limit: q.limit,
      includeDeleted: q.includeDeleted,
    });
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateOrgSchema)) dto: UpdateOrgDto,
  ) {
    return this.svc.updateOrg(id, {
      ...(dto.tier !== undefined ? { tier: dto.tier } : {}),
      ...(dto.freeze !== undefined ? { freeze: dto.freeze } : {}),
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.deleteOrg(id);
  }
}
