/**
 * InnLookupController — эндпоинты лукапа реквизитов по ИНН.
 *
 * Маршруты:
 *   POST /api/v1/inn-lookup               (auth + throttle 30/min/IP)
 *   POST /api/v1/admin/inn-lookup/invalidate (super_admin + throttle 60/min)
 *
 * Body вместо path-param — чтобы ИНН не светился в access-логах.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §8 + §11.
 */

import {
  Body,
  Controller,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
  constructor(
    @Inject(InnLookupService) private readonly service: InnLookupService,
  ) {}

  /**
   * Лукап по ИНН. Кэш 30 дней (Redis). Под auth, throttle 30/min на IP.
   */
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

  /**
   * Сбросить кэш по конкретному ИНН (super_admin). Полезно если DaData
   * обновила данные раньше истечения TTL.
   */
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
