import {
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
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { AdminLlmProvidersService } from './admin-llm-providers.service';
import {
  CreateLlmProviderSchema,
  type CreateLlmProviderDto,
  DiscoverModelsPreviewSchema,
  type DiscoverModelsPreviewDto,
  ListLlmProvidersQuerySchema,
  type ListLlmProvidersQuery,
  RemoveProviderSchema,
  type RemoveProviderDto,
  SetDefaultProviderSchema,
  type SetDefaultProviderDto,
  UpdateLlmProviderSchema,
  type UpdateLlmProviderDto,
} from './dto/admin-llm-providers.dto';
import { ProviderSmokeTestCron } from './provider-smoke-test.cron';

@ApiExcludeController()
@Controller('api/v1/admin/llm-providers')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminLlmProvidersController {
  constructor(
    @Inject(AdminLlmProvidersService)
    private readonly svc: AdminLlmProvidersService,
    @Inject(ProviderSmokeTestCron)
    private readonly smokeTest: ProviderSmokeTestCron,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListLlmProvidersQuerySchema))
    q: ListLlmProvidersQuery,
  ) {
    return this.svc.list({ includeInactive: q.includeInactive });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.svc.getById(id);
  }

  @Get(':id/removal-impact')
  previewRemoval(@Param('id') id: string) {
    return this.svc.previewRemoval(id);
  }

  @Post(':id/set-default')
  setDefault(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetDefaultProviderSchema)) dto: SetDefaultProviderDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.setDefaultProvider(id, dto.model, user.id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateLlmProviderSchema))
    dto: CreateLlmProviderDto,
  ) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateLlmProviderSchema))
    dto: UpdateLlmProviderDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RemoveProviderSchema)) dto: RemoveProviderDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.softDeleteWithFallback(id, dto.reassignDefaultTo, user.id);
  }

  @Post(':id/smoke-test')
  async smoke(@Param('id') id: string) {
    const provider = await this.svc.getById(id);
    return this.smokeTest.testProvider(provider.name);
  }

  @Post('models/discover-preview')
  discoverModelsPreview(
    @Body(new ZodValidationPipe(DiscoverModelsPreviewSchema))
    dto: DiscoverModelsPreviewDto,
  ) {
    return this.svc.discoverModelsPreview(dto);
  }

  @Post(':id/models/discover')
  discoverModels(@Param('id') id: string) {
    return this.svc.discoverModels(id);
  }
}
