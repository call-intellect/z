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
import { z } from 'zod';

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

const PaginationQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

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
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateOrgSchema)) dto: UpdateOrgDto) {
    return this.svc.updateOrg(id, {
      ...(dto.tier !== undefined ? { tier: dto.tier } : {}),
      ...(dto.freeze !== undefined ? { freeze: dto.freeze } : {}),
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.deleteOrg(id);
  }

  @Get(':id/overview')
  overview(@Param('id') id: string) {
    return this.svc.getOrgOverview(id);
  }

  @Get(':id/members')
  members(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(PaginationQuerySchema)) q: PaginationQuery,
  ) {
    return this.svc.getOrgMembers(id, {
      ...(q.cursor ? { cursor: q.cursor } : {}),
      limit: q.limit,
    });
  }

  @Get(':id/sources')
  sources(@Param('id') id: string) {
    return this.svc.getOrgSources(id);
  }

  @Get(':id/audit')
  audit(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(PaginationQuerySchema)) q: PaginationQuery,
  ) {
    return this.svc.getOrgAudit(id, {
      ...(q.cursor ? { cursor: q.cursor } : {}),
      limit: q.limit,
    });
  }
}
