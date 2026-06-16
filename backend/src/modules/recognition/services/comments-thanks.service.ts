import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ToggleThanksResponseDto } from '../dto/recognition.dto';

import { RecognitionService } from './recognition.service';

@Injectable()
export class CommentsThanksService {
  private readonly logger = new Logger(CommentsThanksService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RecognitionService)
    private readonly recognition: RecognitionService,
  ) {}

  async toggle(
    commentId: string,
    tenantId: string,
    userId: string,
  ): Promise<ToggleThanksResponseDto> {
    if (!commentId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'comment_id_required', message: 'commentId обязателен' },
      });
    }
    const comment = await this.prisma.issueComment.findUnique({
      where: { id: commentId },
      include: { issue: { select: { tenantId: true } } },
    });
    if (!comment || comment.deletedAt !== null) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'comment_not_found', message: 'Комментарий не найден' },
      });
    }
    if (comment.issue.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'comment_not_found', message: 'Комментарий не найден' },
      });
    }
    const isSelf = comment.authorId === userId;

    const result = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.issueComment.findUnique({
        where: { id: commentId },
        select: { thanksUserIds: true, authorId: true },
      });
      if (!fresh) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'comment_not_found', message: 'Комментарий не найден' },
        });
      }
      const has = (fresh.thanksUserIds ?? []).includes(userId);
      const next = has
        ? (fresh.thanksUserIds ?? []).filter((id) => id !== userId)
        : [...(fresh.thanksUserIds ?? []), userId];
      await tx.issueComment.update({
        where: { id: commentId },
        data: { thanksUserIds: next },
      });
      return { added: !has, count: next.length, thankedByMe: !has };
    });

    if (result.added && !isSelf) {
      try {
        await this.recognition.enqueueFormulate({
          tenantId,
          type: 'thanks_comment',
          toUserId: comment.authorId,
          fromUserId: userId,
          contextEntityType: 'issue_comment',
          contextEntityId: commentId,
          visibility: 'private',
          contextPayload: { commentId },
        });
      } catch (err) {
        this.logger.warn(
          {
            commentId,
            err: err instanceof Error ? err.message : String(err),
          },
          'comments-thanks: enqueueRecognition fail (toggle применён)',
        );
      }
    }

    return {
      thanksCount: result.count,
      thankedByMe: result.thankedByMe,
    };
  }

  async readState(
    commentId: string,
    tenantId: string,
    userId: string,
  ): Promise<ToggleThanksResponseDto> {
    const comment = await this.prisma.issueComment.findUnique({
      where: { id: commentId },
      include: { issue: { select: { tenantId: true } } },
    });
    if (!comment || comment.deletedAt !== null) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'comment_not_found', message: 'Комментарий не найден' },
      });
    }
    if (comment.issue.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'comment_not_found', message: 'Комментарий не найден' },
      });
    }
    const ids = comment.thanksUserIds ?? [];
    return {
      thanksCount: ids.length,
      thankedByMe: ids.includes(userId),
    };
  }

  ensureUser(userId: string | undefined): string {
    if (!userId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'auth_required', message: 'Требуется авторизация' },
      });
    }
    return userId;
  }
}
