import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CoreQueueService } from '../core-queue/core-queue.service';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  CreateDecisionPointBodySchema,
  type CreateDecisionPointBody,
  CreateProcessHandoffBodySchema,
  type CreateProcessHandoffBody,
  CreateProcessTemplateBodySchema,
  type CreateProcessTemplateBody,
  CreateProcessTemplateVersionBodySchema,
  type CreateProcessTemplateVersionBody,
  type DecisionPointDto,
  ExtractProcessTemplateBodySchema,
  type ExtractProcessTemplateBody,
  type ExtractProcessTemplateResponse,
  ListDecisionPointsQuerySchema,
  type ListDecisionPointsQuery,
  type ListDecisionPointsResponse,
  ListProcessHandoffsQuerySchema,
  type ListProcessHandoffsQuery,
  type ListProcessHandoffsResponse,
  ListProcessTemplatesQuerySchema,
  type ListProcessTemplatesQuery,
  type ListProcessTemplatesResponse,
  type ListProcessTemplateVersionsResponse,
  type ProcessHandoffDto,
  type ProcessTemplateDetailDto,
  type ProcessTemplateVersionDto,
  UpdateDecisionPointBodySchema,
  type UpdateDecisionPointBody,
  UpdateProcessHandoffBodySchema,
  type UpdateProcessHandoffBody,
  UpdateProcessTemplateBodySchema,
  type UpdateProcessTemplateBody,
} from './dto/processes.dto';
import { DecisionPointService } from './services/decision-point.service';
import { ProcessHandoffService } from './services/process-handoff.service';
import { ProcessTemplateService } from './services/process-template.service';

@ApiTags('processes')
@Controller('api/v1/processes')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ProcessesController {
  constructor(
    @Inject(ProcessTemplateService)
    private readonly templates: ProcessTemplateService,
    @Inject(DecisionPointService)
    private readonly decisionPoints: DecisionPointService,
    @Inject(ProcessHandoffService)
    private readonly handoffs: ProcessHandoffService,
    @Inject(CoreQueueService) private readonly queue: CoreQueueService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('templates')
  @ApiOperation({
    summary: 'Список ProcessTemplate Org (фильтры status / category / scope / search)',
  })
  async listTemplates(
    @Query(new ZodValidationPipe(ListProcessTemplatesQuerySchema))
    q: ListProcessTemplatesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListProcessTemplatesResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.templates.list({ tenantId: t, query: q });
  }

  @Post('templates')
  @ApiOperation({ summary: 'Создать ProcessTemplate (черновик, status=draft)' })
  async createTemplate(
    @Body(new ZodValidationPipe(CreateProcessTemplateBodySchema))
    body: CreateProcessTemplateBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProcessTemplateDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.templates.create({ tenantId: t, body });
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'Детальная карточка ProcessTemplate' })
  async getTemplate(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProcessTemplateDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.templates.detail({ tenantId: t, id });
  }

  @Patch('templates/:id')
  @ApiOperation({ summary: 'Обновить метаданные ProcessTemplate' })
  async updateTemplate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProcessTemplateBodySchema))
    body: UpdateProcessTemplateBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProcessTemplateDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.templates.update({ tenantId: t, id, body });
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: 'Архивировать ProcessTemplate (soft delete)' })
  async deleteTemplate(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.templates.softDelete({ tenantId: t, id });
  }

  @Get('templates/:id/versions')
  @ApiOperation({ summary: 'История ProcessTemplateVersion' })
  async listVersions(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListProcessTemplateVersionsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.templates.listVersions({ tenantId: t, id });
  }

  @Post('templates/:id/versions')
  @ApiOperation({
    summary: 'Создать новую ProcessTemplateVersion (immutable snapshot)',
  })
  async createVersion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateProcessTemplateVersionBodySchema))
    body: CreateProcessTemplateVersionBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProcessTemplateVersionDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.templates.createVersion({
      tenantId: t,
      id,
      body,
      publishedByUserId: user.id,
    });
  }

  @Post('templates/:id/versions/:versionId/activate')
  @ApiOperation({
    summary: 'Активировать version (установить как currentVersionId)',
  })
  async activateVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProcessTemplateVersionDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.templates.activateVersion({
      tenantId: t,
      id,
      versionId,
      publishedByUserId: user.id,
    });
  }

  @Get('decision-points')
  @ApiOperation({ summary: 'Список DecisionPoint (фильтр по templateId)' })
  async listDecisionPoints(
    @Query(new ZodValidationPipe(ListDecisionPointsQuerySchema))
    q: ListDecisionPointsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListDecisionPointsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.decisionPoints.list({ tenantId: t, query: q });
  }

  @Post('decision-points')
  @ApiOperation({ summary: 'Создать DecisionPoint в указанном template' })
  async createDecisionPoint(
    @Body(new ZodValidationPipe(CreateDecisionPointBodySchema))
    body: CreateDecisionPointBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DecisionPointDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.decisionPoints.create({ tenantId: t, body });
  }

  @Patch('decision-points/:id')
  @ApiOperation({ summary: 'Обновить DecisionPoint' })
  async updateDecisionPoint(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDecisionPointBodySchema))
    body: UpdateDecisionPointBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DecisionPointDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.decisionPoints.update({ tenantId: t, id, body });
  }

  @Delete('decision-points/:id')
  @ApiOperation({ summary: 'Удалить DecisionPoint' })
  async deleteDecisionPoint(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.decisionPoints.delete({ tenantId: t, id });
  }

  @Get('handoffs')
  @ApiOperation({
    summary: 'Список ProcessHandoff (фильтр по source/target template, kind)',
  })
  async listHandoffs(
    @Query(new ZodValidationPipe(ListProcessHandoffsQuerySchema))
    q: ListProcessHandoffsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListProcessHandoffsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.handoffs.list({ tenantId: t, query: q });
  }

  @Post('handoffs')
  @ApiOperation({ summary: 'Создать ProcessHandoff между template/role' })
  async createHandoff(
    @Body(new ZodValidationPipe(CreateProcessHandoffBodySchema))
    body: CreateProcessHandoffBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProcessHandoffDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.handoffs.create({ tenantId: t, body });
  }

  @Patch('handoffs/:id')
  @ApiOperation({ summary: 'Обновить ProcessHandoff' })
  async updateHandoff(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProcessHandoffBodySchema))
    body: UpdateProcessHandoffBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProcessHandoffDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.handoffs.update({ tenantId: t, id, body });
  }

  @Delete('handoffs/:id')
  @ApiOperation({ summary: 'Удалить ProcessHandoff' })
  async deleteHandoff(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.handoffs.delete({ tenantId: t, id });
  }

  @Post('extract')
  @ApiOperation({
    summary: 'Принудительно запустить ProcessTemplate-extraction по списку blockIds (admin-only)',
  })
  async extract(
    @Body(new ZodValidationPipe(ExtractProcessTemplateBodySchema))
    body: ExtractProcessTemplateBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ExtractProcessTemplateResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    const jobIds: string[] = [];
    for (const blockId of body.blockIds) {
      const res = await this.queue.enqueueSpecialistRouting({
        specialistName: '3-1-process-detector',
        blockId,
        tenantId: t,
        signalType: 'process_step',
      });
      jobIds.push(res.jobId);
    }
    return {
      ok: true,
      enqueuedJobId: jobIds[0] ?? '',
      blockIdsCount: body.blockIds.length,
    };
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
    const ok = await this.rbac.canRead(userId, tenantId, 'process_template');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения шаблонов процессов',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'process_template',
      act: 'write',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только admin/owner могут изменять шаблоны процессов',
        },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'process_template',
      act: 'delete',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только admin/owner могут удалять шаблоны процессов',
        },
      });
    }
  }
}
