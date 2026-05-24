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

/**
 * Wave 2 — CommentsThanksService.
 *
 * Реализует toggle-логику «спасибо за комментарий»:
 *   - POST /api/v1/issues/comments/:id/thanks → toggle (добавить или убрать
 *     текущего user'а в `IssueComment.thanksUserIds`). Идемпотентно: повторный
 *     POST не дублирует.
 *
 *   - При ДОБАВЛЕНИИ (а не убирании) enqueue Recognition type='thanks_comment'
 *     для автора комментария. jobId идемпотентен → повторный thanks/unthanks
 *     не создаст дубль Recognition.
 *
 *   - Самому себе «спасибо» НЕ засчитывается (не enqueue Recognition); в массив
 *     thanksUserIds попадает (UX-выбор — пусть видит, что toggled), но
 *     thanksReceived не растёт.
 *
 *   - НЕ переиспользует `CommentsService` (tracker) — изолирована.
 */
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
    // Найти комментарий + проверить tenant scope через Issue.
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
      // cross-tenant — отвечаем 404, как и tracker/comments.service.ts.
      throw new NotFoundException({
        ok: false,
        error: { code: 'comment_not_found', message: 'Комментарий не найден' },
      });
    }
    // Защита от self-thanks: блокируем «спасибо» себе самому (можно
    // нажать toggle на свой комментарий, но не повышаем thanksReceived).
    const isSelf = comment.authorId === userId;

    // Toggle в одной транзакции с защитой от гонок (читаем актуальное
    // thanksUserIds внутри транзакции).
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

    // Enqueue Recognition только на ДОБАВЛЕНИИ и не для self-thanks.
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
        // Запись «спасибо» в массиве уже произошла; Recognition не сложилась —
        // логируем, но не падаем (UI получит обновлённый count корректно).
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

  /**
   * Read-only — вспомогательно для UI, чтобы получить state без toggle.
   * Используется в `GET /api/v1/issues/comments/:id/thanks`.
   */
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

  /** Утилита для тестов: гарантированный requireWrite-проверщик. */
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
