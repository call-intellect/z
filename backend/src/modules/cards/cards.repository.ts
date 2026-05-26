import { Inject, Injectable } from '@nestjs/common';
import { type Card, type Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Тонкий слой над Prisma для модели `Card`. Все запросы фильтруют по
 * `ownerId` — кросс-юзерский доступ не должен быть возможен на уровне
 * репозитория.
 *
 * Soft-delete: запросы по умолчанию исключают `deletedAt != null`.
 * Жёсткое удаление — только из retention-cron.
 */
export interface CardListFilters {
  ownerId: string;
  page: number;
  limit: number;
  kind?: string;
  pinned?: boolean;
  /** false — без архивных, true — только архивные, undefined — все. */
  archived?: boolean;
  q?: string;
  sort: 'lastMeetingAt' | 'createdAt' | 'name';
}

@Injectable()
export class CardsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Card | null> {
    return this.prisma.card.findUnique({ where: { id } });
  }

  findByName(ownerId: string, name: string): Promise<Card | null> {
    return this.prisma.card.findFirst({
      where: { ownerId, name, deletedAt: null },
    });
  }

  async list(filters: CardListFilters): Promise<{ items: Card[]; total: number }> {
    const where: Prisma.CardWhereInput = {
      ownerId: filters.ownerId,
      deletedAt: null,
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.pinned !== undefined ? { pinned: filters.pinned } : {}),
      ...(filters.archived === false
        ? { archivedAt: null }
        : filters.archived === true
          ? { archivedAt: { not: null } }
          : {}),
      ...(filters.q
        ? {
            OR: [
              { name: { contains: filters.q, mode: 'insensitive' } },
              { contactName: { contains: filters.q, mode: 'insensitive' } },
              { contactEmail: { contains: filters.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.CardOrderByWithRelationInput[] =
      filters.sort === 'name'
        ? [{ name: 'asc' }]
        : filters.sort === 'createdAt'
          ? [{ createdAt: 'desc' }]
          : [
              { pinned: 'desc' },
              { lastMeetingAt: { sort: 'desc', nulls: 'last' } },
              { createdAt: 'desc' },
            ];

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.card.findMany({
        where,
        orderBy,
        skip,
        take: filters.limit,
      }),
      this.prisma.card.count({ where }),
    ]);
    return { items, total };
  }

  /** Топ-N последних активных карточек (для sidebar Recent). */
  listRecent(ownerId: string, limit: number): Promise<Card[]> {
    return this.prisma.card.findMany({
      where: {
        ownerId,
        deletedAt: null,
        archivedAt: null,
        lastMeetingAt: { not: null },
      },
      orderBy: { lastMeetingAt: 'desc' },
      take: limit,
    });
  }

  listPinned(ownerId: string): Promise<Card[]> {
    return this.prisma.card.findMany({
      where: { ownerId, deletedAt: null, archivedAt: null, pinned: true },
      orderBy: { lastMeetingAt: { sort: 'desc', nulls: 'last' } },
    });
  }

  /** Поиск по имени и контактным полям — для `⌘K` командной палитры. */
  search(ownerId: string, q: string, limit: number): Promise<Card[]> {
    return this.prisma.card.findMany({
      where: {
        ownerId,
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { contactName: { contains: q, mode: 'insensitive' } },
          { contactEmail: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ pinned: 'desc' }, { lastMeetingAt: 'desc' }],
      take: limit,
    });
  }

  countActive(ownerId: string): Promise<number> {
    return this.prisma.card.count({
      where: { ownerId, deletedAt: null },
    });
  }

  create(data: {
    ownerId: string;
    name: string;
    kind?: string;
    color?: string;
    icon?: string | null;
    description?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
  }): Promise<Card> {
    return this.prisma.card.create({
      data: {
        ownerId: data.ownerId,
        name: data.name,
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.contactName !== undefined ? { contactName: data.contactName } : {}),
        ...(data.contactEmail !== undefined ? { contactEmail: data.contactEmail } : {}),
        ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone } : {}),
      },
    });
  }

  update(id: string, data: Prisma.CardUpdateInput): Promise<Card> {
    return this.prisma.card.update({ where: { id }, data });
  }

  softDelete(id: string): Promise<Card> {
    return this.prisma.card.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  restore(id: string): Promise<Card> {
    return this.prisma.card.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  /**
   * Пересчитывает денормализованные `meetingCount` и `lastMeetingAt`
   * по реальным связям. Вызывается после link/unlink.
   */
  async recountMeetings(id: string): Promise<void> {
    const agg = await this.prisma.meeting.aggregate({
      where: { cardId: id, deletedAt: null },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    await this.prisma.card.update({
      where: { id },
      data: {
        meetingCount: agg._count._all,
        lastMeetingAt: agg._max.createdAt,
      },
    });
  }
}
