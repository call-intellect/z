import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BearerAuthGuard, RequireScope } from '../api-keys/bearer-auth.guard';
import { CurrentApiUserId } from '../api-keys/current-api-key.decorator';
import { CardsService } from '../cards/cards.service';
import {
  type CreateCardDto,
  CreateCardSchema,
} from '../cards/dto/create-card.dto';
import {
  type ListCardsQuery,
  ListCardsQuerySchema,
} from '../cards/dto/list-cards.dto';
import {
  type UpdateCardDto,
  UpdateCardSchema,
} from '../cards/dto/update-card.dto';
import { RequireEntitlement } from '../entitlements/require-entitlement.decorator';

import { ApiAccessLogInterceptor } from './api-access-log.interceptor';

/**
 * Public REST API: cards.
 *
 * Все эндпоинты под `/api/public/v1/cards`, защищены `BearerAuthGuard`.
 * Read-эндпоинты — `read` scope, mutating — `write`.
 */
@ApiTags('public-cards')
@ApiBearerAuth()
@Controller('api/public/v1')
@UseGuards(BearerAuthGuard)
@UseInterceptors(ApiAccessLogInterceptor)
@RequireEntitlement('feature.public_api')
export class CardsPublicController {
  constructor(
    @Inject(CardsService) private readonly cards: CardsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('cards')
  @RequireScope('read')
  @ApiOperation({ summary: 'Список карточек владельца ключа' })
  async list(
    @CurrentApiUserId() userId: string,
    @Query(new ZodValidationPipe(ListCardsQuerySchema)) query: ListCardsQuery,
  ) {
    const res = await this.cards.list(userId, query);
    return {
      items: res.items.map((c) => this.serializeCard(c)),
      page: query.page,
      limit: query.limit,
      total: res.total,
    };
  }

  @Get('cards/:id')
  @RequireScope('read')
  @ApiOperation({ summary: 'Карточка по id' })
  async get(
    @CurrentApiUserId() userId: string,
    @Param('id') id: string,
  ) {
    const card = await this.cards.getById(id, userId);
    return this.serializeCard(card);
  }

  @Get('cards/:id/meetings')
  @RequireScope('read')
  @ApiOperation({ summary: 'Встречи в карточке' })
  async meetings(
    @CurrentApiUserId() userId: string,
    @Param('id') id: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    // Owner-проверка (выкинет 404 если чужая).
    await this.cards.getById(id, userId);
    const limit = limitRaw ? Math.min(100, Math.max(1, Number(limitRaw))) : 50;
    const offset = offsetRaw ? Math.max(0, Number(offsetRaw)) : 0;
    if (Number.isNaN(limit) || Number.isNaN(offset)) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_pagination', message: 'limit/offset must be integers' },
      });
    }
    const where = { cardId: id, ownerId: userId, deletedAt: null };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.meeting.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          startedAt: true,
          endedAt: true,
          durationMs: true,
          createdAt: true,
        },
      }),
      this.prisma.meeting.count({ where }),
    ]);
    return { items, total };
  }

  @Post('cards')
  @RequireScope('write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать карточку' })
  async create(
    @CurrentApiUserId() userId: string,
    @Body(new ZodValidationPipe(CreateCardSchema)) body: CreateCardDto,
  ) {
    const card = await this.cards.create(userId, body);
    return this.serializeCard(card);
  }

  @Patch('cards/:id')
  @RequireScope('write')
  @ApiOperation({ summary: 'Обновить карточку' })
  async update(
    @CurrentApiUserId() userId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCardSchema)) body: UpdateCardDto,
  ) {
    const card = await this.cards.update(id, userId, body);
    return this.serializeCard(card);
  }

  @Delete('cards/:id')
  @RequireScope('write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete карточки' })
  async remove(
    @CurrentApiUserId() userId: string,
    @Param('id') id: string,
  ) {
    await this.cards.softDelete(id, userId);
  }

  @Post('cards/:cardId/meetings/:meetingId')
  @RequireScope('write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Прикрепить встречу к карточке' })
  async link(
    @CurrentApiUserId() userId: string,
    @Param('cardId') cardId: string,
    @Param('meetingId') meetingId: string,
  ) {
    return this.cards.linkMeeting(cardId, meetingId, userId, 'manual');
  }

  @Delete('cards/:cardId/meetings/:meetingId')
  @RequireScope('write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отвязать встречу от карточки' })
  async unlink(
    @CurrentApiUserId() userId: string,
    @Param('cardId') cardId: string,
    @Param('meetingId') meetingId: string,
  ) {
    await this.cards.unlinkMeeting(cardId, meetingId, userId);
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  private serializeCard(c: {
    id: string;
    name: string;
    kind: string;
    color: string;
    description: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    pinned: boolean;
    archivedAt: Date | null;
    summaryCache: string | null;
    summaryUpdatedAt: Date | null;
    meetingCount: number;
    lastMeetingAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      color: c.color,
      description: c.description,
      contact: {
        name: c.contactName,
        email: c.contactEmail,
        phone: c.contactPhone,
      },
      pinned: c.pinned,
      archivedAt: c.archivedAt?.toISOString() ?? null,
      summary: c.summaryCache,
      summaryUpdatedAt: c.summaryUpdatedAt?.toISOString() ?? null,
      meetingCount: c.meetingCount,
      lastMeetingAt: c.lastMeetingAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
