/**
 * FeedbackAdminController — super-admin сторона канала обратной связи.
 *
 * Маршруты (см. ТЗ § Админские эндпоинты):
 *   GET    /api/v1/admin/feedback/topics                              — список блоков
 *   GET    /api/v1/admin/feedback/topics/:id                          — детали блока
 *   GET    /api/v1/admin/feedback/topics/:id/items                    — items блока
 *   GET    /api/v1/admin/feedback/topics/:id/items/:itemId/message    — исходный текст
 *   PATCH  /api/v1/admin/feedback/topics/:id                          — rename
 *   POST   /api/v1/admin/feedback/topics/:sourceId/merge              — merge
 *   POST   /api/v1/admin/feedback/topics/:id/archive
 *   POST   /api/v1/admin/feedback/topics/:id/unarchive
 *   POST   /api/v1/admin/feedback/digest/run                          — STUB (Phase 5)
 *   GET    /api/v1/admin/feedback/messages/failed                     — failedRuns >= 3
 *
 * Все эндпоинты под CookieAuthGuard + SuperAdminGuard.
 *
 * Read-методы делегируют в FeedbackService (тонкий фасад над agg-логикой).
 * Mutations — в FeedbackTopicManagerService (там вся транзакционная логика).
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
  NotImplementedException,
  Param,
  Patch,
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
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import {
  FeedbackItemMessageResponseDto,
  FeedbackItemsListQuerySchema,
  FeedbackItemsListResponseDto,
  type FeedbackItemMessageResponse,
  type FeedbackItemsListQuery,
  type FeedbackItemsListResponse,
} from '../dto/feedback-item.dto';
import {
  FeedbackFailedMessagesListQuerySchema,
  FeedbackFailedMessagesListResponseDto,
  type FeedbackFailedMessagesListQuery,
  type FeedbackFailedMessagesListResponse,
} from '../dto/feedback-message.dto';
import {
  FeedbackTopicDetailDto,
  FeedbackTopicsListResponseDto,
  type FeedbackTopicDetail,
  type FeedbackTopicsListResponse,
} from '../dto/feedback-topic.dto';
import {
  MergeTopicsSchema,
  type MergeTopicsBody,
} from '../dto/merge-topics.dto';
import {
  RenameTopicSchema,
  type RenameTopicBody,
} from '../dto/rename-topic.dto';
import {
  TopicDetailsQuerySchema,
  TopicListFiltersSchema,
  type TopicDetailsQuery,
  type TopicListFilters,
} from '../dto/topic-list-filters.dto';
import { FeedbackTopicManagerService } from '../services/feedback-topic-manager.service';
import { FeedbackService } from '../services/feedback.service';

@ApiTags('admin-feedback')
@ApiBearerAuth()
@Controller('api/v1/admin/feedback')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
export class FeedbackAdminController {
  constructor(
    @Inject(FeedbackService) private readonly feedback: FeedbackService,
    @Inject(FeedbackTopicManagerService)
    private readonly topics: FeedbackTopicManagerService,
  ) {}

  // ──────────────────────── read: topics ────────────────────────

  @Get('topics')
  @ApiOperation({
    summary:
      'Список смысловых блоков обратной связи с метриками за выбранное окно (30/90/all).',
  })
  @ApiOkResponse({ type: FeedbackTopicsListResponseDto })
  async listTopics(
    @Query(new ZodValidationPipe(TopicListFiltersSchema))
    query: TopicListFilters,
  ): Promise<FeedbackTopicsListResponse> {
    return this.feedback.listTopics(query);
  }

  @Get('topics/:id')
  @ApiOperation({ summary: 'Детали блока обратной связи + агрегаты за окно.' })
  @ApiOkResponse({ type: FeedbackTopicDetailDto })
  async getTopic(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(TopicDetailsQuerySchema))
    query: TopicDetailsQuery,
  ): Promise<FeedbackTopicDetail> {
    return this.feedback.getTopicDetails(id, query.window);
  }

  // ──────────────────────── read: items ─────────────────────────

  @Get('topics/:id/items')
  @ApiOperation({
    summary: 'Items блока (тезисы с автором, Org, датой). Сортировка по дате убыв.',
  })
  @ApiOkResponse({ type: FeedbackItemsListResponseDto })
  async listItems(
    @Param('id') topicId: string,
    @Query(new ZodValidationPipe(FeedbackItemsListQuerySchema))
    query: FeedbackItemsListQuery,
  ): Promise<FeedbackItemsListResponse> {
    return this.feedback.getTopicItems(topicId, query.page, query.pageSize);
  }

  @Get('topics/:id/items/:itemId/message')
  @ApiOperation({
    summary:
      'Полный текст исходного сообщения, из которого выделен тезис (для разворота строки).',
  })
  @ApiOkResponse({ type: FeedbackItemMessageResponseDto })
  async getItemMessage(
    @Param('id') topicId: string,
    @Param('itemId') itemId: string,
  ): Promise<FeedbackItemMessageResponse> {
    return this.feedback.getMessageById(topicId, itemId);
  }

  // ──────────────────────── mutations: topics ────────────────────

  @Patch('topics/:id')
  @ApiOperation({ summary: 'Переименовать блок (title + description).' })
  @ApiOkResponse({ type: FeedbackTopicDetailDto })
  async rename(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RenameTopicSchema)) body: RenameTopicBody,
  ): Promise<FeedbackTopicDetail> {
    return this.topics.rename(id, body);
  }

  @Post('topics/:sourceId/merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Объединить блок с другим: items source переносятся в target, source → MERGED.',
  })
  async merge(
    @Param('sourceId') sourceId: string,
    @Body(new ZodValidationPipe(MergeTopicsSchema)) body: MergeTopicsBody,
  ): Promise<{ movedItems: number; mergedIntoId: string }> {
    return this.topics.merge(sourceId, body);
  }

  @Post('topics/:id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Архивировать блок (status=ARCHIVED).' })
  @ApiOkResponse({ type: FeedbackTopicDetailDto })
  async archive(@Param('id') id: string): Promise<FeedbackTopicDetail> {
    return this.topics.archive(id);
  }

  @Post('topics/:id/unarchive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Восстановить блок из архива (status=ACTIVE).' })
  @ApiOkResponse({ type: FeedbackTopicDetailDto })
  async unarchive(@Param('id') id: string): Promise<FeedbackTopicDetail> {
    return this.topics.unarchive(id);
  }

  // ──────────────────────── digest ──────────────────────────────

  @Post('digest/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Запустить AI-кластеризацию обратной связи прямо сейчас (форс-обработка нового батча).',
  })
  // eslint-disable-next-line @typescript-eslint/require-await
  async runDigest(): Promise<{ jobId: string }> {
    // Phase 5 заменит этот stub реальным enqueue. Сейчас — явный 501,
    // чтобы фронт не вызывал случайно.
    throw new NotImplementedException(
      'POST /admin/feedback/digest/run будет включен в Фазе 5',
    );
  }

  // ──────────────────────── failed messages ────────────────────

  @Get('messages/failed')
  @ApiOperation({
    summary:
      'Сообщения, упавшие в обработке (failedRuns >= 3) — для ручного разбора.',
  })
  @ApiOkResponse({ type: FeedbackFailedMessagesListResponseDto })
  async listFailedMessages(
    @Query(new ZodValidationPipe(FeedbackFailedMessagesListQuerySchema))
    query: FeedbackFailedMessagesListQuery,
  ): Promise<FeedbackFailedMessagesListResponse> {
    return this.feedback.listFailedMessages(query.page, query.pageSize);
  }
}
