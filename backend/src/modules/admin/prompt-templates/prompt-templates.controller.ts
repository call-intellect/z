import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import {
  CopyToOrgSchema,
  type CopyToOrgDto,
  CreatePromptTemplateSchema,
  type CreatePromptTemplateDto,
  CreatePromptVersionSchema,
  type CreatePromptVersionDto,
  ListPromptTemplatesQuerySchema,
  type ListPromptTemplatesQueryDto,
  PreviewPromptSchema,
  type PreviewPromptDto,
  UpdatePromptTemplateSchema,
  type UpdatePromptTemplateDto,
} from './dto/prompt-templates.dto';
import { PromptTemplatesPreviewService } from './prompt-templates-preview.service';
import {
  AdminPromptTemplatesService,
  type PromptTemplateRbacContext,
} from './prompt-templates.service';

@ApiExcludeController()
@Controller('api/v1/admin/prompt-templates')
@UseGuards(CookieAuthGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminPromptTemplatesController {
  constructor(
    @Inject(AdminPromptTemplatesService)
    private readonly svc: AdminPromptTemplatesService,
    @Inject(PromptTemplatesPreviewService)
    private readonly previewSvc: PromptTemplatesPreviewService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListPromptTemplatesQuerySchema))
    query: ListPromptTemplatesQueryDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbac(user);
    return this.svc.list(query, rbac);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreatePromptTemplateSchema))
    dto: CreatePromptTemplateDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbac(user);
    return this.svc.create(dto, rbac.userId, rbac);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePromptTemplateSchema))
    dto: UpdatePromptTemplateDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbac(user);
    return this.svc.update(id, dto, rbac.userId, rbac);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbac(user);
    return this.svc.softDelete(id, rbac.userId, rbac);
  }

  @Post(':id/versions')
  async createVersion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreatePromptVersionSchema))
    dto: CreatePromptVersionDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbac(user);
    return this.svc.createVersion(id, dto, rbac.userId, rbac);
  }

  @Get(':id/versions/:versionId')
  async getVersion(@Param('id') id: string, @Param('versionId') versionId: string) {
    return this.svc.getVersion(id, versionId);
  }

  @Post(':id/activate-version/:versionId')
  async activateVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbac(user);
    return this.svc.activateVersion(id, versionId, rbac);
  }

  @Post(':id/copy-to-org')
  async copyToOrg(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CopyToOrgSchema)) dto: CopyToOrgDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbac(user);
    return this.svc.copyToOrg(id, dto, rbac.userId, rbac);
  }

  @Post(':id/preview')
  async preview(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PreviewPromptSchema)) dto: PreviewPromptDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbac(user);
    return this.previewSvc.runPreview(id, dto, rbac.userId);
  }

  private async resolveRbac(
    user: CurrentUserPayload | null | undefined,
  ): Promise<PromptTemplateRbacContext> {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { isSuperAdmin: true },
    });
    if (!u) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_found' },
      });
    }
    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id, role: { in: ['owner', 'admin'] } },
      select: { orgId: true },
    });
    const ownedOrgIds = memberships.map((m) => m.orgId);
    if (!u.isSuperAdmin && ownedOrgIds.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'not_org_admin' },
      });
    }
    return {
      userId: user.id,
      isSuperAdmin: u.isSuperAdmin === true,
      ownedOrgIds,
    };
  }
}
