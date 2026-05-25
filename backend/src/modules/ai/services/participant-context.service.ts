import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

import type { AiParticipantContext } from './prompts/participant-context';

/**
 * Загружает контекст участников встречи для AI-промптов жёсткой
 * идентификации (ТЗ 2026-05-25 `hard-participant-identification`).
 *
 * Не пишет в БД, не зависит от LLM-провайдеров. Используется
 * `tasks-extract.worker`, `meeting-analyze-v2.worker` и любым другим
 * caller'ом, которому нужно передать список участников в промпт.
 */
@Injectable()
export class ParticipantContextService {
  private readonly logger = new Logger(ParticipantContextService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Возвращает список участников встречи в формате для AI-промпта.
   *
   *   - Host'ы (`role='host'`, `isRegisteredUser=true`) — с полным
   *     контекстом (userId, fullName из User).
   *   - Гости — userId=null, fullName=null.
   *   - Soft-deleted/duplicate участников НЕ фильтруем здесь — на уровне
   *     `Participant` в БД дублей нет (есть `@@unique([meetingId,
   *     livekitIdentity])`).
   *
   * Сортировка: host'ы первыми, затем гости — чтобы LLM «видел» сначала
   * сотрудников. Внутри группы — стабильно по `id` (детерминированно
   * для тестов/snapshot'ов).
   */
  async loadForMeeting(meetingId: string): Promise<AiParticipantContext[]> {
    const participants = await this.prisma.participant.findMany({
      where: { meetingId },
      orderBy: [{ role: 'asc' }, { id: 'asc' }],
    });
    if (participants.length === 0) return [];

    // Подгружаем User'ов для host'ов одним запросом, чтобы достать `name`
    // (fullName). `Participant.name` — display name, введённый в форме,
    // может отличаться от User.name.
    const userIds = participants
      .map((p) => p.userId)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    const result: AiParticipantContext[] = participants.map((p) => {
      const isHost = p.role === 'host';
      const user = p.userId ? userById.get(p.userId) ?? null : null;
      return {
        livekitIdentity: p.livekitIdentity,
        displayName: p.name,
        userId: isHost && p.userId ? p.userId : null,
        fullName: user?.name ?? null,
        role: isHost ? 'host' : 'guest',
      };
    });
    return result;
  }
}
