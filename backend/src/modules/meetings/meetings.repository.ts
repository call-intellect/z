import { Inject, Injectable } from '@nestjs/common';
import { type Meeting, type MeetingStatus, type MeetingType, type Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

import type {
  MeetingWithOwner,
  MeetingWithOwnerAndParticipants,
  MeetingWithParticipants,
} from './domain/meeting.domain';

@Injectable()
export class MeetingsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findById(id: string, tx?: Prisma.TransactionClient): Promise<Meeting | null> {
    const client = tx ?? this.prisma;
    return client.meeting.findUnique({ where: { id } });
  }

  findByIdWithOwner(id: string): Promise<MeetingWithOwner | null> {
    return this.prisma.meeting.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, externalId: true, email: true, name: true },
        },
      },
    });
  }

  findByIdWithParticipants(id: string): Promise<MeetingWithParticipants | null> {
    return this.prisma.meeting.findUnique({
      where: { id },
      include: { participants: true },
    });
  }

  findByIdWithOwnerAndParticipants(id: string): Promise<MeetingWithOwnerAndParticipants | null> {
    return this.prisma.meeting.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, externalId: true, email: true, name: true },
        },
        participants: true,
      },
    });
  }

  create(
    data: {
      id: string;
      title: string;
      type: MeetingType;
      ownerId: string;
      tenantId: string;
      customPrompt: string | null;
      cardId?: string | null;
      recordByDefault?: boolean;
      closedGroupKind?: 'leadership' | 'council' | 'personal' | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<Meeting> {
    const client = tx ?? this.prisma;
    return client.meeting.create({
      data: {
        id: data.id,
        roomName: data.id,
        title: data.title,
        type: data.type,
        ownerId: data.ownerId,
        tenantId: data.tenantId,
        customPrompt: data.customPrompt,
        recordByDefault: data.recordByDefault ?? true,
        ...(data.cardId !== undefined && data.cardId !== null ? { cardId: data.cardId } : {}),
        ...(data.closedGroupKind != null ? { closedGroupKind: data.closedGroupKind } : {}),
        status: 'scheduled',
      },
    });
  }

  updateStatus(
    id: string,
    status: MeetingStatus,
    extra: {
      failureReason?: string | null;
      startedAt?: Date | null;
      endedAt?: Date | null;
    } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<Meeting> {
    const client = tx ?? this.prisma;
    return client.meeting.update({
      where: { id },
      data: {
        status,
        ...(extra.failureReason !== undefined ? { failureReason: extra.failureReason } : {}),
        ...(extra.startedAt !== undefined ? { startedAt: extra.startedAt } : {}),
        ...(extra.endedAt !== undefined ? { endedAt: extra.endedAt } : {}),
      },
    });
  }

  async listVisible(
    visibilityWhere: Prisma.MeetingWhereInput,
    filters: {
      page: number;
      limit: number;
      query?: string;
      dateFrom?: Date;
      dateTo?: Date;
      status?: MeetingStatus[];
      type?: MeetingType[];
      cardId?: string;
    },
  ): Promise<{ items: Meeting[]; total: number }> {
    const createdAtFilter: Prisma.DateTimeFilter | undefined =
      filters.dateFrom || filters.dateTo
        ? {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          }
        : undefined;

    const where: Prisma.MeetingWhereInput = {
      ...visibilityWhere,
      deletedAt: null,
      ...(filters.status && filters.status.length > 0 ? { status: { in: filters.status } } : {}),
      ...(filters.type && filters.type.length > 0 ? { type: { in: filters.type } } : {}),
      ...(filters.query ? { title: { contains: filters.query, mode: 'insensitive' } } : {}),
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      ...(filters.cardId ? { cardId: filters.cardId } : {}),
    };
    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.meeting.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.meeting.count({ where }),
    ]);

    return { items, total };
  }
}
