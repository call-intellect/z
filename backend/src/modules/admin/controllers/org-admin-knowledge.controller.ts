import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { OrgAdminGuard } from '../../auth/guards/org-admin.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  BulkDeleteLinksSchema,
  type BulkDeleteLinksDto,
  DeleteLinkQuerySchema,
  type DeleteLinkQuery,
  ListLinksQuerySchema,
  type ListLinksQuery,
  MergeEntitiesSchema,
  type MergeEntitiesDto,
  parseEntityTypesCsv,
  PatchEntitySchema,
  type PatchEntityDto,
  RecentAuditQuerySchema,
  type RecentAuditQuery,
  SetWorkersSchema,
  type SetWorkersDto,
} from '../dto/org-admin-knowledge.dto';
import { OrgAdminKnowledgeService } from '../services/org-admin-knowledge.service';

@ApiExcludeController()
@Controller('api/v1/org-admin/knowledge')
@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)
export class OrgAdminKnowledgeController {
  constructor(
    @Inject(OrgAdminKnowledgeService)
    private readonly svc: OrgAdminKnowledgeService,
  ) {}

  @Patch('workers')
  async setWorkers(
    @CurrentOrg() tenantId: string,
    @Req() req: Request,
    @Body(new ZodValidationPipe(SetWorkersSchema)) dto: SetWorkersDto,
  ) {
    const userId = requireUserId(req);
    return this.svc.setWorkersEnabled(tenantId, dto, { userId });
  }

  @Get('audit-logs')
  async auditLogs(
    @CurrentOrg() tenantId: string,
    @Query(new ZodValidationPipe(RecentAuditQuerySchema)) q: RecentAuditQuery,
  ) {
    const entityTypes = parseEntityTypesCsv(q.entityTypes);
    return this.svc.getRecentAuditLogs(tenantId, {
      limit: q.limit,
      ...(entityTypes ? { entityTypes } : {}),
    });
  }

  @Get('links')
  async listLinks(
    @CurrentOrg() tenantId: string,
    @Query(new ZodValidationPipe(ListLinksQuerySchema)) q: ListLinksQuery,
  ) {
    return this.svc.listLinks(tenantId, {
      kind: q.kind,
      sortBy: q.sortBy,
      ...(q.minConfidence !== undefined ? { minConfidence: q.minConfidence } : {}),
      status: q.status,
      limit: q.limit,
    });
  }

  @Delete('links/:id')
  async deleteLink(
    @CurrentOrg() tenantId: string,
    @Req() req: Request,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(DeleteLinkQuerySchema)) q: DeleteLinkQuery,
  ) {
    const userId = requireUserId(req);
    try {
      return await this.svc.deleteLink(tenantId, q.kind, id, { userId });
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'link_not_found' },
        });
      }
      throw err;
    }
  }

  @Post('links/bulk-delete')
  async bulkDelete(
    @CurrentOrg() tenantId: string,
    @Req() req: Request,
    @Query('confirm') confirm: string | undefined,
    @Body(new ZodValidationPipe(BulkDeleteLinksSchema)) dto: BulkDeleteLinksDto,
  ) {
    if (confirm !== 'YES') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'bulk_delete_requires_confirm',
          message: 'Добавьте ?confirm=YES к URL',
        },
      });
    }
    const userId = requireUserId(req);
    return this.svc.bulkDeleteLinks(tenantId, dto, { userId });
  }

  @Post('entities/:id/merge')
  async mergeEntities(
    @CurrentOrg() tenantId: string,
    @Req() req: Request,
    @Param('id') fromEntityId: string,
    @Body(new ZodValidationPipe(MergeEntitiesSchema)) dto: MergeEntitiesDto,
  ) {
    const userId = requireUserId(req);
    try {
      return await this.svc.mergeEntities(tenantId, fromEntityId, dto.intoEntityId, { userId });
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'merge_failed',
          message: err instanceof Error ? err.message : 'Failed to merge',
        },
      });
    }
  }

  @Patch('entities/:id')
  async patchEntity(
    @CurrentOrg() tenantId: string,
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchEntitySchema)) dto: PatchEntityDto,
  ) {
    const userId = requireUserId(req);
    return this.svc.patchEntity(tenantId, id, dto, { userId });
  }

  @Post('raw-events/:id/reprocess')
  async reprocess(@CurrentOrg() tenantId: string, @Req() req: Request, @Param('id') id: string) {
    const userId = requireUserId(req);
    try {
      return await this.svc.reprocessRawEvent(tenantId, id, { userId });
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'raw_event_not_found' },
        });
      }
      throw err;
    }
  }

  @Get('metrics')
  async metrics(@CurrentOrg() tenantId: string) {
    return this.svc.getOrgMetrics(tenantId);
  }
}

function requireUserId(req: Request): string {
  const userId = req.user?.id;
  if (!userId) throw new BadRequestException('user_required');
  return userId;
}
