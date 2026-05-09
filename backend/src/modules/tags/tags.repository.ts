import { Inject, Injectable } from '@nestjs/common';
import { type Prisma, type Tag } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TagsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listByUser(userId: string): Promise<Tag[]> {
    return this.prisma.tag.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  }

  findById(id: string): Promise<Tag | null> {
    return this.prisma.tag.findUnique({ where: { id } });
  }

  countByUser(userId: string): Promise<number> {
    return this.prisma.tag.count({ where: { userId } });
  }

  create(data: { userId: string; name: string; color?: string }): Promise<Tag> {
    return this.prisma.tag.create({
      data: {
        userId: data.userId,
        name: data.name,
        ...(data.color !== undefined ? { color: data.color } : {}),
      },
    });
  }

  update(id: string, data: Prisma.TagUpdateInput): Promise<Tag> {
    return this.prisma.tag.update({ where: { id }, data });
  }

  delete(id: string): Promise<Tag> {
    return this.prisma.tag.delete({ where: { id } });
  }

  /**
   * Заменяет связь Meeting↔Tag в одной транзакции:
   *   1. Удаляет все MeetingTag для meetingId.
   *   2. Создаёт по одному MeetingTag для каждого валидированного tagId.
   *
   * Передавать сюда нужно уже отвалидированный набор тегов (все принадлежат
   * userId и существуют). Иначе FK или уникальность могут упасть.
   */
  async setMeetingTags(meetingId: string, tagIds: string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.meetingTag.deleteMany({ where: { meetingId } }),
      ...(tagIds.length > 0
        ? [
            this.prisma.meetingTag.createMany({
              data: tagIds.map((tagId) => ({ meetingId, tagId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  }

  listMeetingTags(meetingId: string): Promise<Tag[]> {
    return this.prisma.tag.findMany({
      where: { meetings: { some: { meetingId } } },
      orderBy: { name: 'asc' },
    });
  }

  countByIds(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return Promise.resolve(0);
    return this.prisma.tag.count({
      where: { userId, id: { in: ids } },
    });
  }
}
