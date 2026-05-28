/**
 * TourProgressController — REST для onboarding-тура.
 *
 *   GET   /api/v1/users/me/tour-progress         — текущий прогресс
 *   PATCH /api/v1/users/me/tour-progress         — merge { tourId, completedAt?, skipped? }
 *   POST  /api/v1/users/me/tour-progress/reset   — обнулить (debug/«Показать заново»)
 *
 * Authentication: CookieAuthGuard. TenantGuard НЕ требуется — туры
 * персональные, не привязаны к Org. `X-Org-Id` (если есть) используется
 * только как label для метрик Prometheus.
 *
 * Источник: plans/tz/2026-05-27-tracker-onboarding-tour.md.
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import {
  TourProgressResetResponseDto,
  TourProgressResponseDto,
  UpdateTourProgressDto,
  UpdateTourProgressSchema,
  type TourProgressResetResponse,
  type TourProgressResponse,
  type UpdateTourProgressBody,
} from '../dto/tour-progress.dto';
import { TourProgressService } from '../tour-progress.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('api/v1/users/me/tour-progress')
@UseGuards(CookieAuthGuard)
export class TourProgressController {
  constructor(
    @Inject(TourProgressService)
    private readonly svc: TourProgressService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Текущий прогресс onboarding-туров пользователя',
    description: 'Возвращает Json. Пустой объект — ни один тур не начат.',
  })
  @ApiOkResponse({ type: TourProgressResponseDto })
  async get(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<TourProgressResponse> {
    return this.svc.get(user.id);
  }

  @Patch()
  @ApiOperation({
    summary: 'Обновить прогресс одного тура (merge)',
    description:
      'Принимает { tourId, completedAt?, skipped? }. Merge в существующий объект.',
  })
  @ApiOkResponse({ type: TourProgressResponseDto })
  async update(
    @Body(new ZodValidationPipe(UpdateTourProgressSchema))
    body: UpdateTourProgressBody,
    @CurrentUser() user: CurrentUserPayload,
    @Headers('x-org-id') orgIdHeader: string | undefined,
  ): Promise<TourProgressResponse> {
    const tenantId =
      orgIdHeader && orgIdHeader.trim().length > 0
        ? orgIdHeader.trim()
        : null;
    return this.svc.update(user.id, tenantId, body);
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Обнулить все туры пользователя (debug / «Показать заново»)',
  })
  @ApiOkResponse({ type: TourProgressResetResponseDto })
  async reset(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<TourProgressResetResponse> {
    return this.svc.reset(user.id);
  }
}

/**
 * Свободно-стоящий export для swagger-генератора (NestJS видит классы DTO
 * через @ApiOkResponse + декораторы createZodDto; UpdateTourProgressDto —
 * чтобы Swagger показал тело PATCH).
 */
export { UpdateTourProgressDto };
