import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
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
import { RbacService } from '../../rbac/rbac.service';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import {
  AnalyticsQuerySchema,
  type AnalyticsQueryDto,
  CreatePromptExperimentSchema,
  type CreatePromptExperimentDto,
  ListPromptExperimentsQuerySchema,
  type ListPromptExperimentsQueryDto,
  StopPromptExperimentSchema,
  type StopPromptExperimentDto,
} from './dto/prompt-experiments.dto';
import { type ExperimentRbacContext, PromptExperimentsService } from './prompt-experiments.service';

@ApiExcludeController()
@Controller('api/v1/admin/prompt-experiments')
@UseGuards(CookieAuthGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminPromptExperimentsController {
  constructor(
    @Inject(PromptExperimentsService)
    private readonly svc: PromptExperimentsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListPromptExperimentsQuerySchema))
    query: ListPromptExperimentsQueryDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbacContext(user);
    return this.svc.list(query, rbac);
  }

  @Get(':id')
  async detail(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbacContext(user);
    return this.svc.detail(id, rbac);
  }

  @Get(':id/analytics')
  async analytics(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(AnalyticsQuerySchema)) query: AnalyticsQueryDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbacContext(user);
    return this.svc.analytics(id, rbac, query);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreatePromptExperimentSchema))
    dto: CreatePromptExperimentDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbacContext(user);
    return this.svc.create(dto, rbac);
  }

  @Post(':id/start')
  async start(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload | null | undefined) {
    const rbac = await this.resolveRbacContext(user);
    return this.svc.start(id, rbac);
  }

  @Post(':id/stop')
  async stop(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(StopPromptExperimentSchema)) dto: StopPromptExperimentDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const rbac = await this.resolveRbacContext(user);
    return this.svc.stop(id, dto, rbac);
  }

  private async resolveRbacContext(
    user: CurrentUserPayload | null | undefined,
  ): Promise<ExperimentRbacContext> {
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
    return {
      userId: user.id,
      isSuperAdmin: u.isSuperAdmin === true,
      ownedOrgIds: memberships.map((m) => m.orgId),
    };
  }
}
