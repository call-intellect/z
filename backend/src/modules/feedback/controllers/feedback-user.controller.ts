/**
 * FeedbackUserController — пользовательская сторона канала «Ваши предложения».
 *
 * Маршруты (см. ТЗ § Пользовательские эндпоинты):
 *   POST /api/v1/feedback           — отправка (под FeedbackRateLimitGuard)
 *   GET  /api/v1/feedback/my        — история своих сообщений
 *   GET  /api/v1/feedback/my/limit  — usedToday / limit / resetAt
 *
 * Все эндпоинты под CookieAuthGuard.
 *
 * Каркас — Фаза 1: только заглушки. Логика — Фаза 2.
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
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
  FeedbackLimitResponseDto,
  FeedbackMessageDto,
  FeedbackMessagesListQuerySchema,
  FeedbackMessagesListResponseDto,
  type FeedbackLimitResponse,
  type FeedbackMessage,
  type FeedbackMessagesListQuery,
  type FeedbackMessagesListResponse,
} from '../dto/feedback-message.dto';
import {
  SubmitFeedbackSchema,
  type SubmitFeedbackBody,
} from '../dto/submit-feedback.dto';
import { FeedbackRateLimitGuard } from '../guards/feedback-rate-limit.guard';
import { FeedbackService } from '../services/feedback.service';

@ApiTags('feedback')
@ApiBearerAuth()
@Controller('api/v1/feedback')
@UseGuards(CookieAuthGuard)
export class FeedbackUserController {
  constructor(
    @Inject(FeedbackService) private readonly feedback: FeedbackService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(FeedbackRateLimitGuard)
  @ApiOperation({
    summary: 'Отправить предложение / жалобу / благодарность команде Z.',
    description:
      'Лимит 5 сообщений в сутки на пользователя (окно UTC). При превышении — 429.',
  })
  @ApiOkResponse({ type: FeedbackMessageDto })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async submit(
    @Body(new ZodValidationPipe(SubmitFeedbackSchema)) _body: SubmitFeedbackBody,
    @CurrentUser() _user: CurrentUserPayload,
  ): Promise<FeedbackMessage> {
    throw new Error(
      'FeedbackUserController.submit not implemented yet (фаза 2)',
    );
  }

  @Get('my')
  @ApiOperation({
    summary: 'История моих сообщений обратной связи (пагинация, новые сверху).',
  })
  @ApiOkResponse({ type: FeedbackMessagesListResponseDto })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listMine(
    @Query(new ZodValidationPipe(FeedbackMessagesListQuerySchema))
    _query: FeedbackMessagesListQuery,
    @CurrentUser() _user: CurrentUserPayload,
  ): Promise<FeedbackMessagesListResponse> {
    throw new Error(
      'FeedbackUserController.listMine not implemented yet (фаза 2)',
    );
  }

  @Get('my/limit')
  @ApiOperation({
    summary:
      'Сколько сообщений я отправил сегодня и когда счётчик обнулится (00:00 UTC).',
  })
  @ApiOkResponse({ type: FeedbackLimitResponseDto })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getLimit(
    @CurrentUser() _user: CurrentUserPayload,
  ): Promise<FeedbackLimitResponse> {
    throw new Error(
      'FeedbackUserController.getLimit not implemented yet (фаза 2)',
    );
  }
}
