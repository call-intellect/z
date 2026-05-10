import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import {
  ListPricesQuerySchema,
  type ListPricesQuery,
  SetPriceSchema,
  type SetPriceDto,
} from '../dto/admin-prices.dto';
import { AdminPricesService } from '../services/admin-prices.service';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

@ApiExcludeController()
@Controller('api/v1/admin/llm-prices')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminPricesController {
  constructor(@Inject(AdminPricesService) private readonly svc: AdminPricesService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListPricesQuerySchema)) q: ListPricesQuery,
  ) {
    return this.svc.listPrices({ activeOnly: q.activeOnly });
  }

  @Post()
  set(@Body(new ZodValidationPipe(SetPriceSchema)) dto: SetPriceDto) {
    return this.svc.setPrice({
      provider: dto.provider,
      model: dto.model,
      inputCostPerMillionTokens: dto.inputCostPerMillionTokens,
      outputCostPerMillionTokens: dto.outputCostPerMillionTokens,
      cachedCostPerMillionTokens: dto.cachedCostPerMillionTokens,
      currency: dto.currency,
      ...(dto.effectiveFrom ? { effectiveFrom: dto.effectiveFrom } : {}),
    });
  }
}
