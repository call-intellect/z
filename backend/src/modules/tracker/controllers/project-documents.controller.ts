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
  Patch,
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
  CreateProjectDocumentSchema,
  type CreateProjectDocumentDto,
  type LinkedCardDto,
  type ProjectDocumentResponseDto,
  type ProjectDocumentSummaryDto,
  UpdateProjectDocumentSchema,
  type UpdateProjectDocumentDto,
} from '../dto/project-documents/project-document.dto';
import { ProjectDocumentsService } from '../services/project-documents.service';

/**
 * REST `/api/v1/projects/:projectId/documents` + `/api/v1/project-documents/...`
 * + `/api/v1/projects/:projectId/linked-cards`.
 *
 * RBAC ResourceType: `project_document`.
 *   - read   ← canRead(user, tenant, 'project_document')
 *   - write  ← canWrite(user, tenant, 'project_document')
 *   - delete ← canDelete(user, tenant, 'project_document')
 *
 * Per-resource ownership (author vs admin) проверяется в
 * `ProjectDocumentsService.requireWritable` — после RBAC прохода в
 * контроллере.
 *
 * ТЗ: plans/tz/2026-05-27-tracker-project-documents.md.
 */
@ApiTags('tracker / projects / documents')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ProjectDocumentsController {
  constructor(
    @Inject(ProjectDocumentsService)
    private readonly svc: ProjectDocumentsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  // ── list / get / linked-cards ─────────────────────────────────────────

  @Get('projects/:projectId/documents')
  @ApiOperation({
    summary:
      'Список документов проекта (плоский, pinned сверху, sortOrder ASC)',
  })
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectDocumentSummaryDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.listForProject(projectId, t);
  }

  @Get('project-documents/:id')
  @ApiOperation({ summary: 'Один документ с контентом' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectDocumentResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findById(id, t);
  }

  @Get('projects/:projectId/linked-cards')
  @ApiOperation({
    summary:
      'Список CRM-карточек, связанных с проектом через подвязанные ко встречам задачи (до 50)',
  })
  async linkedCards(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<LinkedCardDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.listLinkedCards(projectId, t);
  }

  // ── create / update / delete / restore / duplicate ────────────────────

  @Post('projects/:projectId/documents')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать документ проекта' })
  async create(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(CreateProjectDocumentSchema))
    body: CreateProjectDocumentDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectDocumentResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(projectId, body, t, user.id);
  }

  @Patch('project-documents/:id')
  @RequireSubscription()
  @ApiOperation({
    summary:
      'Обновить документ (title/content/pinned/parentId/sortOrder; auto-save идёт сюда)',
  })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProjectDocumentSchema))
    body: UpdateProjectDocumentDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectDocumentResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    // Per-resource ownership: автор ИЛИ admin/owner Org.
    const isAdmin = await this.rbac.check({
      userId: user.id,
      tenantId: t,
      obj: 'project_document',
      act: 'delete',
    });
    await this.svc.requireWritable({
      documentId: id,
      tenantId: t,
      userId: user.id,
      isAdmin,
    });
    return this.svc.update(id, body, t, user.id);
  }

  @Delete('project-documents/:id')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete документа (30-day grace, retention)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    const isAdmin = await this.rbac.check({
      userId: user.id,
      tenantId: t,
      obj: 'project_document',
      act: 'delete',
    });
    await this.svc.requireWritable({
      documentId: id,
      tenantId: t,
      userId: user.id,
      isAdmin,
    });
    await this.svc.delete(id, t);
  }

  @Post('project-documents/:id/restore')
  @RequireSubscription()
  @ApiOperation({ summary: 'Восстановить soft-deleted документ' })
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectDocumentResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.restore(id, t);
  }

  @Post('project-documents/:id/duplicate')
  @RequireSubscription()
  @ApiOperation({
    summary: 'Дублировать документ (создаёт копию с suffix « (копия)»)',
  })
  async duplicate(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectDocumentResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.duplicate(id, t, user.id);
  }

  // ── helpers ───────────────────────────────────────────────────────────

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
    const ok = await this.rbac.canRead(userId, tenantId, 'project_document');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав на чтение документов проекта',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'project_document');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав на изменение документов проекта',
        },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const okDelete = await this.rbac.check({
      userId,
      tenantId,
      obj: 'project_document',
      act: 'delete',
    });
    if (okDelete) return;
    // delete fallback to write — manager open/strict с правом write self+
    // через `requireWritable` сможет удалить свой документ.
    const fallback = await this.rbac.canWrite(
      userId,
      tenantId,
      'project_document',
    );
    if (!fallback) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав на удаление документов проекта',
        },
      });
    }
  }
}
