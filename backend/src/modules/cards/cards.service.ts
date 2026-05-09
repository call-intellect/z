import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { type Card, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiQueueService } from '../ai/ai-queue.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';
import { WebhookDispatcherService } from '../webhooks-out/webhook-dispatcher.service';

import { CardsRepository } from './cards.repository';
import type { CreateCardDto } from './dto/create-card.dto';
import type { ListCardsQuery } from './dto/list-cards.dto';
import type { UpdateCardDto } from './dto/update-card.dto';

/**
 * Бизнес-сервис карточек. Все операции защищены ownership-проверкой:
 * `card.ownerId === currentUser.id`. Для скрытия информации NotFound
 * используется и при «нет такой карточки», и при «не ваша».
 *
 * AI-rollup после link/unlink ставится через `AiQueueService` (глобальный модуль).
 * Если по каким-то причинам недоступен (тесты, изолированный модуль) — тихо
 * пропускается через `@Optional()`.
 */
@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CardsRepository) private readonly repo: CardsRepository,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(AiQueueService)
    private readonly aiQueue?: AiQueueService,
    @Optional()
    @Inject(WebhookDispatcherService)
    private readonly webhookDispatcher?: WebhookDispatcherService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  private async dispatchEvent(
    event: string,
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.webhookDispatcher) return;
    await this.webhookDispatcher
      .dispatch({ event, userId, payload })
      .catch((err) =>
        this.logger.warn(
          `dispatchEvent ${event}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  list(
    userId: string,
    query: ListCardsQuery,
  ): Promise<{ items: Card[]; total: number }> {
    return this.repo.list({
      ownerId: userId,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.pinned !== undefined ? { pinned: query.pinned } : {}),
      ...(query.archived !== undefined ? { archived: query.archived } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
    });
  }

  async getById(id: string, userId: string): Promise<Card> {
    const card = await this.repo.findById(id);
    if (!card || card.ownerId !== userId || card.deletedAt !== null) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'card_not_found', message: 'Карточка не найдена' },
      });
    }
    return card;
  }

  async create(userId: string, dto: CreateCardDto): Promise<Card> {
    // Лимит на пользователя — простая верхняя граница (без скользящего окна).
    // Дёшево и понятно: «у вас уже 500 карточек, удалите неактуальные».
    const max = this.cfg.workspace.maxCardsPerUser;
    const existingCount = await this.repo.countActive(userId);
    if (existingCount >= max) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'cards_limit_exceeded',
          message: `Достигнут лимит карточек (${max}). Архивируйте или удалите старые.`,
        },
      });
    }

    // Дедуп по имени — уникальный индекс [ownerId, name] вернёт P2002, но мы
    // даём более понятную ошибку.
    const existing = await this.repo.findByName(userId, dto.name.trim());
    if (existing) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'card_name_taken',
          message: 'Карточка с таким названием уже существует',
        },
      });
    }

    let card: Card;
    try {
      card = await this.repo.create({
        ownerId: userId,
        name: dto.name.trim(),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.contactName !== undefined ? { contactName: dto.contactName } : {}),
        ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
      });
    } catch (err) {
      // На случай гонки между findByName и create.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'card_name_taken',
            message: 'Карточка с таким названием уже существует',
          },
        });
      }
      throw err;
    }

    await this.audit.log({
      action: AUDIT.CARD_CREATE,
      userId,
      resourceId: card.id,
      metadata: { name: card.name, kind: card.kind },
    });
    await this.dispatchEvent('card.created', userId, {
      cardId: card.id,
      name: card.name,
      kind: card.kind,
      createdAt: card.createdAt.toISOString(),
    });
    this.metrics?.incCardEvent({ kind: card.kind, action: 'created' });
    this.logger.debug({ cardId: card.id, userId }, 'card created');
    return card;
  }

  async update(id: string, userId: string, dto: UpdateCardDto): Promise<Card> {
    const card = await this.getById(id, userId);

    const data: Prisma.CardUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.contactName !== undefined) data.contactName = dto.contactName;
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail;
    if (dto.contactPhone !== undefined) data.contactPhone = dto.contactPhone;
    if (dto.pinned !== undefined) data.pinned = dto.pinned;
    if (dto.archived !== undefined) {
      data.archivedAt = dto.archived ? new Date() : null;
    }

    let updated: Card;
    try {
      updated = await this.repo.update(id, data);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'card_name_taken',
            message: 'Карточка с таким названием уже существует',
          },
        });
      }
      throw err;
    }

    await this.audit.log({
      action: AUDIT.CARD_UPDATE,
      userId,
      resourceId: id,
      metadata: { fields: Object.keys(data) },
    });
    await this.dispatchEvent('card.updated', userId, {
      cardId: id,
      fields: Object.keys(data),
    });
    this.metrics?.incCardEvent({ kind: card.kind, action: 'updated' });
    this.logger.debug({ cardId: id, fields: Object.keys(data) }, 'card updated');
    return updated;
  }

  async softDelete(id: string, userId: string): Promise<void> {
    const card = await this.getById(id, userId);
    await this.repo.softDelete(id);
    await this.audit.log({
      action: AUDIT.CARD_DELETE,
      userId,
      resourceId: id,
      metadata: { name: card.name },
    });
    await this.dispatchEvent('card.deleted', userId, {
      cardId: id,
      name: card.name,
    });
    this.metrics?.incCardEvent({ kind: card.kind, action: 'deleted' });
    this.logger.debug({ cardId: id, userId }, 'card soft-deleted');
  }

  async restore(id: string, userId: string): Promise<Card> {
    // restore работает с softDeleted (deletedAt != null), поэтому getById с фильтром
    // deletedAt: null здесь не подходит — получаем напрямую.
    const card = await this.repo.findById(id);
    if (!card || card.ownerId !== userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'card_not_found', message: 'Карточка не найдена' },
      });
    }
    if (card.deletedAt === null) {
      // Уже не удалена — идемпотентно возвращаем как есть.
      return card;
    }
    const restored = await this.repo.restore(id);
    await this.audit.log({
      action: AUDIT.CARD_RESTORE,
      userId,
      resourceId: id,
    });
    this.metrics?.incCardEvent({ kind: restored.kind, action: 'restored' });
    this.logger.debug({ cardId: id, userId }, 'card restored');
    return restored;
  }

  /**
   * Привязать встречу к карточке. Транзакция с `SELECT ... FOR UPDATE` на
   * Meeting — защита от race-condition при двух одновременных привязках.
   *
   *   - Проверяет владение и карточкой, и встречей у текущего юзера.
   *   - Если у встречи уже есть `cardId == this.id` — идемпотентный success.
   *   - Если у встречи `cardId !== null && != this.id` — 409.
   *   - После update'а — пересчёт счётчиков карточки и enqueue card-rollup.
   */
  async linkMeeting(
    cardId: string,
    meetingId: string,
    userId: string,
    addedBy: 'manual' | 'create-flow' = 'manual',
  ): Promise<{ ok: true }> {
    const card = await this.getById(cardId, userId);

    let alreadyLinked = false;
    let previousCardId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      // FOR UPDATE — лочим строку встречи на время транзакции, чтобы конкурентный
      // link не «обогнал» нас.
      const rows = await tx.$queryRaw<
        Array<{ id: string; ownerId: string; cardId: string | null; deletedAt: Date | null }>
      >(Prisma.sql`
        SELECT id, "ownerId", "cardId", "deletedAt"
        FROM "Meeting"
        WHERE id = ${meetingId}
        FOR UPDATE
      `);
      const meeting = rows[0];
      if (!meeting || meeting.ownerId !== userId || meeting.deletedAt !== null) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'meeting_not_found', message: 'Встреча не найдена' },
        });
      }
      if (meeting.cardId === cardId) {
        alreadyLinked = true;
        return;
      }
      if (meeting.cardId !== null) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'meeting_already_linked',
            message:
              'Встреча уже прикреплена к другой карточке. Сначала отвяжите её.',
          },
        });
      }
      previousCardId = meeting.cardId;
      await tx.meeting.update({
        where: { id: meetingId },
        data: { cardId },
      });
    });

    if (alreadyLinked) {
      return { ok: true };
    }

    await this.repo.recountMeetings(cardId);
    if (previousCardId) {
      // Не должно происходить (выше выбросили 409), но на всякий — пересчёт прежней.
      await this.repo.recountMeetings(previousCardId).catch(() => undefined);
    }

    await this.audit.log({
      action: AUDIT.MEETING_LINK_TO_CARD,
      userId,
      resourceId: meetingId,
      metadata: { cardId, addedBy, cardName: card.name },
    });
    await this.dispatchEvent('meeting.linked_to_card', userId, {
      meetingId,
      cardId,
      addedBy,
    });

    if (this.aiQueue) {
      await this.aiQueue
        .enqueueCardRollup(cardId, 'link')
        .catch((err) =>
          this.logger.warn(
            `linkMeeting: enqueueCardRollup упал: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    this.logger.debug(
      { cardId, meetingId, userId, addedBy },
      'meeting linked to card',
    );
    return { ok: true };
  }

  async unlinkMeeting(
    cardId: string,
    meetingId: string,
    userId: string,
  ): Promise<{ ok: true }> {
    const card = await this.getById(cardId, userId);

    let wasLinked = false;
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; ownerId: string; cardId: string | null; deletedAt: Date | null }>
      >(Prisma.sql`
        SELECT id, "ownerId", "cardId", "deletedAt"
        FROM "Meeting"
        WHERE id = ${meetingId}
        FOR UPDATE
      `);
      const meeting = rows[0];
      if (!meeting || meeting.ownerId !== userId || meeting.deletedAt !== null) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'meeting_not_found', message: 'Встреча не найдена' },
        });
      }
      if (meeting.cardId !== cardId) {
        // Идемпотентность: «отвязать то, что не привязано» — ОК.
        return;
      }
      wasLinked = true;
      await tx.meeting.update({
        where: { id: meetingId },
        data: { cardId: null },
      });
    });

    if (!wasLinked) {
      return { ok: true };
    }

    await this.repo.recountMeetings(cardId);
    await this.audit.log({
      action: AUDIT.MEETING_UNLINK_FROM_CARD,
      userId,
      resourceId: meetingId,
      metadata: { cardId, cardName: card.name },
    });
    await this.dispatchEvent('meeting.unlinked_from_card', userId, {
      meetingId,
      cardId,
    });

    if (this.aiQueue) {
      await this.aiQueue
        .enqueueCardRollup(cardId, 'unlink')
        .catch((err) =>
          this.logger.warn(
            `unlinkMeeting: enqueueCardRollup упал: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    this.logger.debug(
      { cardId, meetingId, userId },
      'meeting unlinked from card',
    );
    return { ok: true };
  }

  // ─────────────────────────── helpers для других модулей ─────────────────

  listRecent(userId: string, limit = 5): Promise<Card[]> {
    return this.repo.listRecent(userId, limit);
  }

  listPinned(userId: string): Promise<Card[]> {
    return this.repo.listPinned(userId);
  }

  search(userId: string, q: string, limit = 10): Promise<Card[]> {
    return this.repo.search(userId, q, limit);
  }

  countActive(userId: string): Promise<number> {
    return this.repo.countActive(userId);
  }
}
