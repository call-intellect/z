import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { AdminAuditInterceptor } from '../admin.audit.interceptor';

import { PutLlmRouteSchema, type PutLlmRouteDto } from './dto/llm-routes.dto';
import { LlmRoutesService } from './llm-routes.service';

@ApiExcludeController()
@Controller('api/v1/admin/llm-routes')
@UseGuards(CookieAuthGuard, AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class LlmRoutesController {
  constructor(@Inject(LlmRoutesService) private readonly svc: LlmRoutesService) {}

  @Get()
  list() {
    return this.svc.list().then((items) => ({ items }));
  }

  @Put(':taskType')
  upsert(
    @Param('taskType') taskType: string,
    @Body(new ZodValidationPipe(PutLlmRouteSchema)) dto: PutLlmRouteDto,
  ) {
    return this.svc.upsert(taskType, dto);
  }
}
