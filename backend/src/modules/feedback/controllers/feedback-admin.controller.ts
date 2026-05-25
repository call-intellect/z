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
 *   POST   /api/v1/admin/feedback/digest/run                          — ручной прогон
 *   GET    /api/v1/admin/feedback/messages/failed                     — failedRuns >= 3
 *
 * Все эндпоинты под CookieAuthGuard + SuperAdminGuard.
 *
 * Каркас — Фаза 1. Логика — Фаза 6 (read-эндпоинты) и Фаза 8 (mutations).
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
  TopicListFiltersSchema,
  type TopicListFilters,
} from '../dto/topic-list-filters.dto';
import { FeedbackDigestService } from '../services/feedback-digest.service';
import { FeedbackTopicManagerService } from '../services/feedback-topic-manager.service';

@ApiTags('admin-feedback')
@ApiBearerAuth()
@Controller('api/v1/admin/feedback')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
export class FeedbackAdminController {
  constructor(
    @Inject(FeedbackTopicManagerService)
    private readonly topics: FeedbackTopicManagerService,
    @Inject(FeedbackDigestService)
    private readonly digest: FeedbackDigestService,
  ) {}

  // ──────────────────────── read: topics ────────────────────────

  @Get('topics')
  @ApiOperation({
    summary:
      'Список смысловых блоков обратной связи с метриками за выбранное окно (30/90/all).',
  })
  @ApiOkResponse({ type: FeedbackTopicsListResponseDto })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listTopics(
    @Query(new ZodValidationPipe(TopicListFiltersSchema))
    _query: TopicListFilters,
  ): Promise<FeedbackTopicsListResponse> {
    throw new Error(
      'FeedbackAdminController.listTopics not implemented yet (фаза 6)',
    );
  }

  @Get('topics/:id')
  @ApiOperation({ summary: 'Детали блока обратной связи + агрегаты за окно.' })
  @ApiOkResponse({ type: FeedbackTopicDetailDto })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getTopic(@Param('id') _id: string): Promise<FeedbackTopicDetail> {
    throw new Error(
      'FeedbackAdminController.getTopic not implemented yet (фаза 6)',
    );
  }

  // ──────────────────────── read: items ─────────────────────────

  @Get('topics/:id/items')
  @ApiOperation({
    summary: 'Items блока (тезисы с автором, Org, датой). Сортировка по дате убыв.',
  })
  @ApiOkResponse({ type: FeedbackItemsListResponseDto })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listItems(
    @Param('id') _topicId: string,
    @Query(new ZodValidationPipe(FeedbackItemsListQuerySchema))
    _query: FeedbackItemsListQuery,
  ): Promise<FeedbackItemsListResponse> {
    throw new Error(
      'FeedbackAdminController.listItems not implemented yet (фаза 6)',
    );
  }

  @Get('topics/:id/items/:itemId/message')
  @ApiOperation({
    summary:
      'Полный текст исходного сообщения, из которого выделен тезис (для разворота строки).',
  })
  @ApiOkResponse({ type: FeedbackItemMessageResponseDto })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getItemMessage(
    @Param('id') _topicId: string,
    @Param('itemId') _itemId: string,
  ): Promise<FeedbackItemMessageResponse> {
    throw new Error(
      'FeedbackAdminController.getItemMessage not implemented yet (фаза 6)',
    );
  }

  // ──────────────────────── mutations: topics ────────────────────

  @Patch('topics/:id')
  @ApiOperation({ summary: 'Переименовать блок (title + description).' })
  @ApiOkResponse({ type: FeedbackTopicDetailDto })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async rename(
    @Param('id') _id: string,
    @Body(new ZodValidationPipe(RenameTopicSchema)) _body: RenameTopicBody,
  ): Promise<FeedbackTopicDetail> {
    throw new Error(
      'FeedbackAdminController.rename not implemented yet (фаза 8)',
    );
  }

  @Post('topics/:sourceId/merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Объединить блок с другим: items source переносятся в target, source → MERGED.',
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async merge(
    @Param('sourceId') _sourceId: string,
    @Body(new ZodValidationPipe(MergeTopicsSchema)) _body: MergeTopicsBody,
  ): Promise<{ movedItems: number; mergedIntoId: string }> {
    throw new Error(
      'FeedbackAdminController.merge not implemented yet (фаза 8)',
    );
  }

  @Post('topics/:id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Архивировать блок (status=ARCHIVED).' })
  @ApiOkResponse({ type: FeedbackTopicDetailDto })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async archive(@Param('id') _id: string): Promise<FeedbackTopicDetail> {
    throw new Error(
      'FeedbackAdminController.archive not implemented yet (фаза 8)',
    );
  }

  @Post('topics/:id/unarchive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Восстановить блок из архива (status=ACTIVE).' })
  @ApiOkResponse({ type: FeedbackTopicDetailDto })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async unarchive(@Param('id') _id: string): Promise<FeedbackTopicDetail> {
    throw new Error(
      'FeedbackAdminController.unarchive not implemented yet (фаза 8)',
    );
  }

  // ──────────────────────── digest ──────────────────────────────

  @Post('digest/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Запустить AI-кластеризацию обратной связи прямо сейчас (форс-обработка нового батча).',
  })
  async runDigest(): Promise<{ jobId: string }> {
    throw new Error(
      'FeedbackAdminController.runDigest not implemented yet (фаза 5/8)',
    );
  }

  @Get('messages/failed')
  @ApiOperation({
    summary:
      'Сообщения, упавшие в обработке (failedRuns >= 3) — для ручного разбора.',
  })
  async listFailedMessages(): Promise<{
    items: Array<{
      id: string;
      text: string;
      createdAt: string;
      failedRuns: number;
      userId: string;
    }>;
  }> {
    throw new Error(
      'FeedbackAdminController.listFailedMessages not implemented yet (фаза 6)',
    );
  }
}
