import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type EventDto,
  type EventKindDto,
  type EventListItemDto,
  type ListEventsQuery,
  type ListEventsResponse,
} from '../dto/events.dto';

/**
 * EventsService (SBA α-3). Read-only на α-3 — list + get.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(args: {
    tenantId: string;
    query: ListEventsQuery;
  }): Promise<ListEventsResponse> {
    const { tenantId, query } = args;
    const where: Prisma.EventWhereInput = { tenantId };

    if (!query.includeDeleted) where.deletedAt = null;
    if (query.kind) where.kind = query.kind;
    if (query.from || query.to) {
      where.startAt = {};
      if (query.from) where.startAt.gte = query.from;
      if (query.to) where.startAt.lte = query.to;
    }
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { location: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        orderBy: [{ startAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      items: items.map((e) => this.toListItem(e)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async getById(args: { tenantId: string; id: string }): Promise<EventDto> {
    const e = await this.prisma.event.findUnique({ where: { id: args.id } });
    if (!e || e.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'event_not_found', message: 'Событие не найдено' },
      });
    }
    return this.toDetail(e);
  }

  // ─────────────────────────── mappers ─────────────────────────────────

  private toListItem(e: {
    id: string;
    entityId: string;
    kind: string;
    title: string;
    startAt: Date;
    endAt: Date | null;
    durationMin: number | null;
    location: string | null;
    relatedMeetingId: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): EventListItemDto {
    return {
      id: e.id,
      entityId: e.entityId,
      kind: e.kind as EventKindDto,
      title: e.title,
      startAt: e.startAt.toISOString(),
      endAt: e.endAt ? e.endAt.toISOString() : null,
      durationMin: e.durationMin,
      location: e.location,
      relatedMeetingId: e.relatedMeetingId,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      deletedAt: e.deletedAt ? e.deletedAt.toISOString() : null,
    };
  }

  private toDetail(e: {
    id: string;
    entityId: string;
    kind: string;
    title: string;
    startAt: Date;
    endAt: Date | null;
    durationMin: number | null;
    location: string | null;
    participantsPersonIds: string[];
    relatedMeetingId: string | null;
    outcomeSummary: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): EventDto {
    return {
      ...this.toListItem(e),
      participantsPersonIds: e.participantsPersonIds,
      outcomeSummary: e.outcomeSummary,
      metadata:
        e.metadata && typeof e.metadata === 'object' && !Array.isArray(e.metadata)
          ? (e.metadata as Record<string, unknown>)
          : null,
    };
  }
}
