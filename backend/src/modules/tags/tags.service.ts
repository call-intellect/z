import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Tag } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';

import type {
  CreateTagDto,
  SetMeetingTagsDto,
  UpdateTagDto,
} from './dto/tag.dto';
import { TagsRepository } from './tags.repository';

@Injectable()
export class TagsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TagsRepository) private readonly repo: TagsRepository,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  list(userId: string): Promise<Tag[]> {
    return this.repo.listByUser(userId);
  }

  async create(userId: string, dto: CreateTagDto): Promise<Tag> {
    const max = this.cfg.workspace.maxTagsPerUser;
    const count = await this.repo.countByUser(userId);
    if (count >= max) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'tags_limit_reached',
          message: `Достигнут лимит тегов (${max})`,
        },
      });
    }
    try {
      return await this.repo.create({
        userId,
        name: dto.name,
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'tag_duplicate',
            message: 'Тег с таким именем уже существует',
          },
        });
      }
      throw err;
    }
  }

  async update(id: string, userId: string, dto: UpdateTagDto): Promise<Tag> {
    const tag = await this.repo.findById(id);
    if (!tag || tag.userId !== userId) {
      throw new NotFoundException('tag_not_found');
    }
    try {
      return await this.repo.update(id, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'tag_duplicate',
            message: 'Тег с таким именем уже существует',
          },
        });
      }
      throw err;
    }
  }

  async delete(id: string, userId: string): Promise<void> {
    const tag = await this.repo.findById(id);
    if (!tag || tag.userId !== userId) {
      throw new NotFoundException('tag_not_found');
    }
    await this.repo.delete(id);
  }

  async setMeetingTags(
    meetingId: string,
    userId: string,
    dto: SetMeetingTagsDto,
  ): Promise<{ ok: true; count: number }> {
    await this.assertMeetingOwner(meetingId, userId);
    const uniqueIds = [...new Set(dto.tagIds)];
    if (uniqueIds.length > 0) {
      const valid = await this.repo.countByIds(userId, uniqueIds);
      if (valid !== uniqueIds.length) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'tag_unknown',
            message: 'Один или несколько тегов не существует или не ваш',
          },
        });
      }
    }
    await this.repo.setMeetingTags(meetingId, uniqueIds);
    return { ok: true, count: uniqueIds.length };
  }

  async listMeetingTags(meetingId: string, userId: string): Promise<Tag[]> {
    await this.assertMeetingOwner(meetingId, userId);
    return this.repo.listMeetingTags(meetingId);
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  private async assertMeetingOwner(meetingId: string, userId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { ownerId: true, deletedAt: true },
    });
    if (!meeting || meeting.deletedAt !== null || meeting.ownerId !== userId) {
      throw new NotFoundException('meeting_not_found');
    }
  }
}
