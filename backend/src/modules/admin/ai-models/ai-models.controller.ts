import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { AdminAiModelsService } from './ai-models.service';
import {
  AddProviderSchema,
  type AddProviderDto,
  CreateExperimentSchema,
  type CreateExperimentDto,
  ListAiModelsQuerySchema,
  type ListAiModelsQueryDto,
  MetricsQuerySchema,
  type MetricsQueryDto,
  SwitchPrimarySchema,
  type SwitchPrimaryDto,
} from './dto/ai-models.dto';

@ApiExcludeController()
@Controller('api/v1/admin')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminAiModelsController {
  constructor(@Inject(AdminAiModelsService) private readonly svc: AdminAiModelsService) {}

  @Get('ai-models')
  async list(@Query(new ZodValidationPipe(ListAiModelsQuerySchema)) query: ListAiModelsQueryDto) {
    const items = await this.svc.list({
      ...(query.group ? { group: query.group } : {}),
      ...(query.search ? { search: query.search } : {}),
    });
    return { items };
  }

  @Get('ai-models/:taskType')
  async detail(@Param('taskType') taskType: string) {
    return this.svc.detail(taskType);
  }

  @Post('ai-models/:taskType/switch-primary')
  async switchPrimary(
    @Param('taskType') taskType: string,
    @Body(new ZodValidationPipe(SwitchPrimarySchema)) dto: SwitchPrimaryDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.switchPrimary(taskType, dto, user.id);
  }

  @Post('ai-models/:taskType/add-provider')
  async addProvider(
    @Param('taskType') taskType: string,
    @Body(new ZodValidationPipe(AddProviderSchema)) dto: AddProviderDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.addProvider(taskType, dto, user.id);
  }

  @Delete('ai-models/:taskType/provider/:providerId')
  async removeProvider(
    @Param('taskType') taskType: string,
    @Param('providerId') providerId: string,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.removeProvider(taskType, providerId, user.id);
  }

  @Get('ai-models/:taskType/history')
  async history(@Param('taskType') taskType: string) {
    const items = await this.svc.history(taskType, 50);
    return { items };
  }

  @Get('ai-models/:taskType/metrics')
  async metrics(
    @Param('taskType') taskType: string,
    @Query(new ZodValidationPipe(MetricsQuerySchema)) query: MetricsQueryDto,
  ) {
    return this.svc.metrics_(taskType, query);
  }

  @Post('llm-model-experiments')
  async createExperiment(
    @Body(new ZodValidationPipe(CreateExperimentSchema)) dto: CreateExperimentDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.createExperiment(dto, user.id);
  }

  @Get('llm-model-experiments')
  async listExperiments(@Query('status') status?: string, @Query('taskType') taskType?: string) {
    const items = await this.svc.listExperiments({
      ...(status ? { status } : {}),
      ...(taskType ? { taskType } : {}),
    });
    return { items };
  }

  @Post('llm-model-experiments/:id/start')
  async startExperiment(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.startExperiment(id, user.id);
  }

  @Post('llm-model-experiments/:id/stop')
  async stopExperiment(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.stopExperiment(id, user.id);
  }

  @Get('llm-model-experiments/:id/analytics')
  async experimentAnalytics(@Param('id') id: string) {
    return this.svc.experimentAnalytics(id);
  }

  private assertUser(
    user: CurrentUserPayload | null | undefined,
  ): asserts user is CurrentUserPayload {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
  }
}
