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
  Query,
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
  CreateFromTemplateSchema,
  type CreateFromTemplateDto,
} from '../dto/projects/create-from-template.dto';
import { CreateProjectSchema, type CreateProjectDto } from '../dto/projects/create-project.dto';
import {
  AddProjectMemberSchema,
  type AddProjectMemberDto,
  ListProjectsQuerySchema,
  type ListProjectsQuery,
} from '../dto/projects/list-projects-query.dto';
import type {
  ListProjectsResponse,
  ProjectMemberDto,
  ProjectResponseDto,
} from '../dto/projects/project-response.dto';
import { UpdateProjectSchema, type UpdateProjectDto } from '../dto/projects/update-project.dto';
import {
  ProjectsFromTemplateService,
  type CreateFromTemplateResult,
} from '../services/projects-from-template.service';
import { ProjectsService } from '../services/projects.service';

@ApiTags('tracker / projects')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly svc: ProjectsService,
    @Inject(ProjectsFromTemplateService)
    private readonly fromTemplate: ProjectsFromTemplateService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('projects')
  @ApiOperation({ summary: 'Список проектов организации' })
  async list(
    @Query(new ZodValidationPipe(ListProjectsQuerySchema))
    query: ListProjectsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListProjectsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findAll(t, query);
  }

  @Post('projects')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать проект (admin / owner)' })
  async create(
    @Body(new ZodValidationPipe(CreateProjectSchema))
    body: CreateProjectDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(body, t, user.id);
  }

  @Post('projects/from-template')
  @RequireSubscription()
  @ApiOperation({
    summary: 'Создать проект из шаблона команды (Phase 4 / Sprint 9)',
    description:
      'Создаёт Project на основе TeamTemplate: статусы (IssueState), ProjectMember (admin), ' +
      'опционально 2-3 примера задач и Regulation-заглушки. Метрика team_template_used_total.',
  })
  async createFromTemplate(
    @Body(new ZodValidationPipe(CreateFromTemplateSchema))
    body: CreateFromTemplateDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CreateFromTemplateResult> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.fromTemplate.createFromTemplate({
      tenantId: t,
      userId: user.id,
      dto: body,
    });
  }

  @Get('projects/by-slug/:slug')
  @ApiOperation({ summary: 'Получить проект по slug' })
  async bySlug(
    @Param('slug') slug: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findBySlug(slug, t);
  }

  @Get('projects/:id')
  @ApiOperation({ summary: 'Получить проект по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findById(id, t);
  }

  @Patch('projects/:id')
  @RequireSubscription()
  @ApiOperation({ summary: 'Изменить проект (admin / owner)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProjectSchema))
    body: UpdateProjectDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update(id, body, t, user.id);
  }

  @Delete('projects/:id')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить проект (soft delete)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.softDelete(id, t);
  }

  @Post('projects/:id/archive')
  @RequireSubscription()
  @ApiOperation({ summary: 'Архивировать проект' })
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.archive(id, t, user.id);
  }

  @Post('projects/:id/unarchive')
  @RequireSubscription()
  @ApiOperation({ summary: 'Разархивировать проект' })
  async unarchive(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.unarchive(id, t, user.id);
  }

  @Get('projects/:id/members')
  @ApiOperation({ summary: 'Список участников проекта' })
  async members(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectMemberDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.listMembers(id, t);
  }

  @Post('projects/:id/members')
  @RequireSubscription()
  @ApiOperation({ summary: 'Добавить участника проекта' })
  async addMember(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddProjectMemberSchema))
    body: AddProjectMemberDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectMemberDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.addMember(id, body, t, user.id);
  }

  @Delete('projects/:id/members/:userId')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить участника проекта' })
  async removeMember(
    @Param('id') id: string,
    @Param('userId') memberUserId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.removeMember(id, memberUserId, t);
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
    const ok = await this.rbac.canRead(userId, tenantId, 'project');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение проектов' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'project');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только admin / owner могут изменять проекты',
        },
      });
    }
  }
}
