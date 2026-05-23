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
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { AdminLlmProvidersService } from './admin-llm-providers.service';
import {
  CreateLlmProviderSchema,
  type CreateLlmProviderDto,
  ListLlmProvidersQuerySchema,
  type ListLlmProvidersQuery,
  UpdateLlmProviderSchema,
  type UpdateLlmProviderDto,
} from './dto/admin-llm-providers.dto';
import { ProviderSmokeTestCron } from './provider-smoke-test.cron';

/**
 * SBA α-10 wave 3 — /api/v1/admin/llm-providers.
 * SuperAdminGuard — глобальный реестр, доступ только super_admin.
 */
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
  remove(@Param('id') id: string) {
    return this.svc.softDelete(id);
  }

  /**
   * Manual smoke-test: один провайдер. Результат пишет в LlmProvider +
   * метрики (как и автоматический cron).
   */
  @Post(':id/smoke-test')
  async smoke(@Param('id') id: string) {
    const provider = await this.svc.getById(id);
    return this.smokeTest.testProvider(provider.name);
  }
}
