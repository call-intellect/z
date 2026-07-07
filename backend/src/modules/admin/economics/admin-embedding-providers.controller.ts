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

import { AdminEmbeddingProvidersService } from './admin-embedding-providers.service';
import {
  CreateEmbeddingModelSchema,
  type CreateEmbeddingModelDto,
  CreateEmbeddingProviderSchema,
  type CreateEmbeddingProviderDto,
  ListEmbeddingProvidersQuerySchema,
  type ListEmbeddingProvidersQuery,
  UpdateEmbeddingModelSchema,
  type UpdateEmbeddingModelDto,
  UpdateEmbeddingProviderSchema,
  type UpdateEmbeddingProviderDto,
} from './dto/admin-embedding-providers.dto';

@ApiExcludeController()
@Controller('api/v1/admin/embedding-providers')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminEmbeddingProvidersController {
  constructor(
    @Inject(AdminEmbeddingProvidersService)
    private readonly svc: AdminEmbeddingProvidersService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListEmbeddingProvidersQuerySchema))
    q: ListEmbeddingProvidersQuery,
  ) {
    return this.svc.list({ includeInactive: q.includeInactive });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.svc.getById(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateEmbeddingProviderSchema))
    dto: CreateEmbeddingProviderDto,
  ) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEmbeddingProviderSchema))
    dto: UpdateEmbeddingProviderDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.softDelete(id);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.svc.activate(id);
  }

  @Post(':id/smoke')
  smoke(@Param('id') id: string) {
    return this.svc.smoke(id);
  }

  @Post(':id/models')
  addModel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateEmbeddingModelSchema))
    dto: CreateEmbeddingModelDto,
  ) {
    return this.svc.addModel(id, dto);
  }

  @Patch(':id/models/:modelId')
  updateModel(
    @Param('id') id: string,
    @Param('modelId') modelId: string,
    @Body(new ZodValidationPipe(UpdateEmbeddingModelSchema))
    dto: UpdateEmbeddingModelDto,
  ) {
    return this.svc.updateModel(id, modelId, dto);
  }

  @Delete(':id/models/:modelId')
  removeModel(@Param('id') id: string, @Param('modelId') modelId: string) {
    return this.svc.softDeleteModel(id, modelId);
  }
}
