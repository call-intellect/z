import {
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
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Card, Meeting } from '@prisma/client';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { pickPrimarySummary } from '../ai/utils/pick-primary-summary';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { CardsService } from './cards.service';
import {
  type CreateCardDto,
  CreateCardSchema,
} from './dto/create-card.dto';
import {
  type ListCardsQuery,
  ListCardsQuerySchema,
} from './dto/list-cards.dto';
import {
  type UpdateCardDto,
  UpdateCardSchema,
} from './dto/update-card.dto';

/**
 * Внутренний REST API карточек.
 *
 *   GET    /api/v1/cards                                — список с фильтрами
 *   GET    /api/v1/cards/:id                            — карточка
 *   GET    /api/v1/cards/:id/meetings                   — лента встреч карточки
 *   POST   /api/v1/cards                                — создать
 *   PATCH  /api/v1/cards/:id                            — обновить
 *   DELETE /api/v1/cards/:id                            — soft-delete
 *   POST   /api/v1/cards/:id/restore                    — восстановить (в grace 30d)
 *   POST   /api/v1/cards/:id/meetings/:meetingId        — прикрепить встречу
 *   DELETE /api/v1/cards/:id/meetings/:meetingId        — отвязать встречу
 */
@ApiTags('cards')
@Controller('api/v1')
@UseGuards(CookieAuthGuard)
export class CardsController {
  constructor(
    @Inject(CardsService) private readonly cards: CardsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('cards')
  @ApiOperation({ summary: 'Список карточек владельца' })
  async list(
    @Query(new ZodValidationPipe(ListCardsQuerySchema)) query: ListCardsQuery,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    items: ReturnType<CardsController['mapCard']>[];
    page: number;
    limit: number;
    total: number;
  }> {
    const result = await this.cards.list(user.id, query);
    return {
      items: result.items.map((c) => this.mapCard(c)),
      page: query.page,
      limit: query.limit,
      total: result.total,
    };
  }

  @Get('cards/:id')
  @ApiOperation({ summary: 'Карточка по id' })
  async getOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<CardsController['mapCard']>> {
    const card = await this.cards.getById(id, user.id);
    return this.mapCard(card);
  }

  @Get('cards/:id/themes')
  @ApiOperation({ summary: 'Топ-3 темы, связанные с карточкой через её блоки' })
  async listThemes(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    items: Array<{
      id: string;
      name: string;
      description: string;
      branch: string | null;
      blocksInCommon: number;
    }>;
  }> {
    const card = await this.cards.getById(id, user.id);
    if (!card.tenantId) {
      // Legacy: до backfill tenant'а — нет смысла искать темы.
      return { items: [] };
    }

    // 1) Собираем блоки карточки: через meetings (RawEvent.sourceExternalId)
    //    + через card.entityId / relatedEntityIds.
    const meetingIds = (
      await this.prisma.meeting.findMany({
        where: { cardId: card.id, deletedAt: null },
        select: { id: true },
      })
    ).map((m) => m.id);
    const candidateEntityIds = [
      ...(card.entityId ? [card.entityId] : []),
      ...card.relatedEntityIds,
    ];

    const blockIdSet = new Set<string>();
    if (meetingIds.length > 0) {
      const evRows = await this.prisma.ideaBlockEvidence.findMany({
        where: {
          rawEvent: {
            tenantId: card.tenantId,
            sourceExternalId: { in: meetingIds },
          },
          block: { status: 'canonical', tenantId: card.tenantId },
        },
        select: { blockId: true },
        take: 500,
      });
      for (const r of evRows) blockIdSet.add(r.blockId);
    }
    if (candidateEntityIds.length > 0) {
      const entRows = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: { in: candidateEntityIds },
          block: { status: 'canonical', tenantId: card.tenantId },
        },
        select: { blockId: true },
        take: 500,
      });
      for (const r of entRows) blockIdSet.add(r.blockId);
    }
    if (blockIdSet.size === 0) return { items: [] };

    // 2) Находим темы, связанные с этими блоками, и считаем сколько общих.
    const themeRows = await this.prisma.themeIdeaBlock.findMany({
      where: {
        blockId: { in: [...blockIdSet] },
        theme: { tenantId: card.tenantId, status: 'active' },
      },
      select: { themeId: true },
    });
    const counts = new Map<string, number>();
    for (const r of themeRows) {
      counts.set(r.themeId, (counts.get(r.themeId) ?? 0) + 1);
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (top.length === 0) return { items: [] };

    const themes = await this.prisma.theme.findMany({
      where: { id: { in: top.map(([tid]) => tid) } },
      select: { id: true, name: true, description: true, branch: true },
    });
    const byId = new Map(themes.map((t) => [t.id, t] as const));
    const items: Array<{
      id: string;
      name: string;
      description: string;
      branch: string | null;
      blocksInCommon: number;
    }> = [];
    for (const [tid, blocksInCommon] of top) {
      const t = byId.get(tid);
      if (!t) continue;
      items.push({
        id: t.id,
        name: t.name,
        description: t.description,
        branch: t.branch as string | null,
        blocksInCommon,
      });
    }
    return { items };
  }

  @Get('cards/:id/meetings')
  @ApiOperation({ summary: 'Встречи в карточке (лента таймлайна)' })
  async listMeetings(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<{
    items: ReturnType<CardsController['mapMeetingItem']>[];
    page: number;
    limit: number;
    total: number;
  }> {
    // Owner-проверка карточки.
    await this.cards.getById(id, user.id);

    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(limitRaw ?? '20', 10) || 20),
    );
    const skip = (page - 1) * limit;

    const where = { cardId: id, deletedAt: null, ownerId: user.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.meeting.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          // Р6: тянем все три summary-поля для pickPrimarySummary.
          aiResult: {
            select: { summaryFast: true, summaryV2: true, summary: true },
          },
        },
      }),
      this.prisma.meeting.count({ where }),
    ]);
    return {
      items: items.map((m) => this.mapMeetingItem(m)),
      page,
      limit,
      total,
    };
  }

  @Post('cards')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать карточку' })
  @ApiResponse({ status: 201, description: 'Создано' })
  @ApiResponse({ status: 409, description: 'Имя уже занято у владельца' })
  async create(
    @Body(new ZodValidationPipe(CreateCardSchema)) body: CreateCardDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<CardsController['mapCard']>> {
    const card = await this.cards.create(user.id, body);
    return this.mapCard(card);
  }

  @Patch('cards/:id')
  @ApiOperation({ summary: 'Обновить карточку' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCardSchema)) body: UpdateCardDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<CardsController['mapCard']>> {
    const card = await this.cards.update(id, user.id, body);
    return this.mapCard(card);
  }

  @Delete('cards/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete карточки (30-дневный grace)' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.cards.softDelete(id, user.id);
  }

  @Post('cards/:id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Восстановить soft-deleted карточку (в grace 30d)' })
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<CardsController['mapCard']>> {
    const card = await this.cards.restore(id, user.id);
    return this.mapCard(card);
  }

  @Post('cards/:id/meetings/:meetingId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Прикрепить встречу к карточке' })
  @ApiResponse({ status: 200, description: 'Привязка установлена' })
  @ApiResponse({
    status: 409,
    description: 'Встреча уже привязана к другой карточке',
  })
  async linkMeeting(
    @Param('id') id: string,
    @Param('meetingId') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    return this.cards.linkMeeting(id, meetingId, user.id, 'manual');
  }

  @Delete('cards/:id/meetings/:meetingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отвязать встречу от карточки (идемпотентно)' })
  async unlinkMeeting(
    @Param('id') id: string,
    @Param('meetingId') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.cards.unlinkMeeting(id, meetingId, user.id);
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  private mapCard(c: Card): {
    id: string;
    name: string;
    kind: string;
    color: string;
    icon: string | null;
    description: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    pinned: boolean;
    archivedAt: string | null;
    summary: string | null;
    summaryUpdatedAt: string | null;
    meetingCount: number;
    lastMeetingAt: string | null;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      color: c.color,
      icon: c.icon,
      description: c.description,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      contactPhone: c.contactPhone,
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

  private mapMeetingItem(
    m: Meeting & {
      aiResult: {
        summaryFast: string | null;
        summaryV2: string | null;
        summary: string;
      } | null;
    },
  ): {
    id: string;
    title: string;
    type: string;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
    summary: string | null;
    createdAt: string;
  } {
    return {
      id: m.id,
      title: m.title,
      type: m.type,
      status: m.status,
      startedAt: m.startedAt?.toISOString() ?? null,
      endedAt: m.endedAt?.toISOString() ?? null,
      durationMs: m.durationMs,
      summary: m.aiResult ? pickPrimarySummary(m.aiResult) || null : null,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
