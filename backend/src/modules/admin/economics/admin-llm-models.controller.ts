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

import { AdminLlmModelsService } from './admin-llm-models.service';
import {
  CreateLlmModelSchema,
  type CreateLlmModelDto,
  ListLlmModelsQuerySchema,
  type ListLlmModelsQuery,
  UpdateLlmModelSchema,
  type UpdateLlmModelDto,
} from './dto/admin-llm-models.dto';

@ApiExcludeController()
@Controller('api/v1/admin/llm-models')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminLlmModelsController {
  constructor(@Inject(AdminLlmModelsService) private readonly svc: AdminLlmModelsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListLlmModelsQuerySchema))
    q: ListLlmModelsQuery,
  ) {
    return this.svc.list({
      ...(q.providerId ? { providerId: q.providerId } : {}),
      ...(q.category ? { category: q.category } : {}),
      includeInactive: q.includeInactive,
    });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.svc.getById(id);
  }

  @Get(':id/price-history')
  priceHistory(@Param('id') id: string) {
    return this.svc.listPriceHistory(id);
  }

  @Post()
  create(@Body(new ZodValidationPipe(CreateLlmModelSchema)) dto: CreateLlmModelDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateLlmModelSchema)) dto: UpdateLlmModelDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.softDelete(id);
  }
}
