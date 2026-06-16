import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
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
import { SubmitFeedbackSchema, type SubmitFeedbackBody } from '../dto/submit-feedback.dto';
import { FeedbackRateLimitGuard } from '../guards/feedback-rate-limit.guard';
import { FeedbackService } from '../services/feedback.service';

@ApiTags('feedback')
@ApiBearerAuth()
@Controller('api/v1/feedback')
@UseGuards(CookieAuthGuard)
export class FeedbackUserController {
  constructor(@Inject(FeedbackService) private readonly feedback: FeedbackService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(FeedbackRateLimitGuard)
  @ApiOperation({
    summary: 'Отправить предложение / жалобу / благодарность команде Кора.',
    description: 'Лимит 5 сообщений в сутки на пользователя (окно UTC). При превышении — 429.',
  })
  @ApiOkResponse({ type: FeedbackMessageDto })
  async submit(
    @Body(new ZodValidationPipe(SubmitFeedbackSchema)) body: SubmitFeedbackBody,
    @CurrentUser() user: CurrentUserPayload,
    @Headers('x-org-id') orgIdHeader: string | undefined,
  ): Promise<FeedbackMessage> {
    const orgId = orgIdHeader && orgIdHeader.trim().length > 0 ? orgIdHeader.trim() : null;
    return this.feedback.submit(user.id, orgId, body.text);
  }

  @Get('my')
  @ApiOperation({
    summary: 'История моих сообщений обратной связи (пагинация, новые сверху).',
  })
  @ApiOkResponse({ type: FeedbackMessagesListResponseDto })
  async listMine(
    @Query(new ZodValidationPipe(FeedbackMessagesListQuerySchema))
    query: FeedbackMessagesListQuery,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<FeedbackMessagesListResponse> {
    return this.feedback.listMine(user.id, query.page, query.pageSize);
  }

  @Get('my/limit')
  @ApiOperation({
    summary: 'Сколько сообщений я отправил сегодня и когда счётчик обнулится (00:00 UTC).',
  })
  @ApiOkResponse({ type: FeedbackLimitResponseDto })
  async getLimit(@CurrentUser() user: CurrentUserPayload): Promise<FeedbackLimitResponse> {
    return this.feedback.getLimit(user.id);
  }
}
