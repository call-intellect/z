import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';

import {
  InnInvalidateBodySchema,
  InnInvalidateResultDto,
  InnLookupBodySchema,
  InnLookupResultDto,
  type InnInvalidateBody,
  type InnInvalidateResultBody,
  type InnLookupBody,
  type InnLookupResultBody,
} from './dto/inn-lookup.dto';
import { InnLookupService } from './inn-lookup.service';

@ApiTags('inn-lookup')
@ApiBearerAuth()
@Controller('api/v1')
export class InnLookupController {
  constructor(@Inject(InnLookupService) private readonly service: InnLookupService) {}

  @Post('inn-lookup')
  @UseGuards(CookieAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Лукап реквизитов компании по ИНН.',
    description:
      'Маршрут провайдеров через INN_LOOKUP_PROVIDER ENV (mock / dadata / ' +
      'tochka_then_dadata). Кэш 30 дней. При не-найдено → 404.',
  })
  @ApiOkResponse({ type: InnLookupResultDto })
  async lookup(
    @Body(new ZodValidationPipe(InnLookupBodySchema)) body: InnLookupBody,
  ): Promise<InnLookupResultBody> {
    return this.service.lookup(body.inn);
  }

  @Post('admin/inn-lookup/invalidate')
  @UseGuards(CookieAuthGuard, SuperAdminGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Инвалидировать кэш лукапа для одного ИНН (super_admin).',
  })
  @ApiOkResponse({ type: InnInvalidateResultDto })
  async invalidate(
    @Body(new ZodValidationPipe(InnInvalidateBodySchema)) body: InnInvalidateBody,
  ): Promise<InnInvalidateResultBody> {
    const deleted = await this.service.invalidate(body.inn);
    return { deleted };
  }
}
