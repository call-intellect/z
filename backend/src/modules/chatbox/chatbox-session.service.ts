import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';

/**
 * ChatboxSessionService — сегментация сообщений чата на сессии для LLM-анализа
 * (ТЗ plans/tz/2026-06-05-chatbox-integration.md, Фаза 3).
 *
 * Сессия = непрерывный диалог: смежные сообщения с паузой ≤ `idle_gap_hours`
 * относятся к одной сессии; пауза дольше открывает новую. Пересборка
 * идемпотентна (upsert по `seq`), не сбрасывает уже выполненный анализ
 * (`analysisStatus='done'`), кроме случаев, когда сессия дозаполнилась или
 * закрылась — тогда требуется пере-анализ.
 */

/** Один сегмент-сессия: окно времени + id входящих сообщений. */
export interface ChatboxSegment {
  startedAt: Date;
  endedAt: Date | null;
  messageIds: string[];
}

/**
 * Чистая сегментация (без БД) — для unit-тестов и переиспользования.
 *
 * @param msgs сообщения чата, отсортированные по времени ASC.
 * @param idleGapHours порог паузы в часах: пауза > порога открывает новый
 *   сегмент. Граница (ровно = порог) НЕ разрывает сессию.
 * @param chatActive активен ли чат: у последнего сегмента `endedAt=null`,
 *   если чат активен; иначе — время последнего сообщения сегмента.
 */
export function segmentMessages(
  msgs: { id: string; at: Date }[],
  idleGapHours: number,
  chatActive: boolean,
): ChatboxSegment[] {
  if (msgs.length === 0) return [];

  const gapMs = idleGapHours * 60 * 60 * 1000;
  const segments: ChatboxSegment[] = [];
  let current: { startedAt: Date; lastAt: Date; messageIds: string[] } | null =
    null;

  for (const msg of msgs) {
    if (current === null) {
      current = { startedAt: msg.at, lastAt: msg.at, messageIds: [msg.id] };
      continue;
    }
    const delta = msg.at.getTime() - current.lastAt.getTime();
    if (delta > gapMs) {
      // Закрыть текущий сегмент по времени последнего его сообщения.
      segments.push({
        startedAt: current.startedAt,
        endedAt: current.lastAt,
        messageIds: current.messageIds,
      });
      current = { startedAt: msg.at, lastAt: msg.at, messageIds: [msg.id] };
    } else {
      current.lastAt = msg.at;
      current.messageIds.push(msg.id);
    }
  }

  // Последний (открытый) сегмент: endedAt=null только если чат активен.
  if (current !== null) {
    segments.push({
      startedAt: current.startedAt,
      endedAt: chatActive ? null : current.lastAt,
      messageIds: current.messageIds,
    });
  }

  return segments;
}

@Injectable()
export class ChatboxSessionService {
  private readonly logger = new Logger(ChatboxSessionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
  ) {}

  /**
   * Пересобрать сессии чата из его сообщений. Идемпотентно: upsert по `seq`,
   * чистит осиротевшие сессии. Возвращает число сегментов.
   */
  async rebuildSessions(
    tenantId: string,
    chatId: string,
  ): Promise<{ sessionCount: number }> {
    const idleGapHours =
      (await this.adminSettings.get<number>(
        'chatbox.session.idle_gap_hours',
        12,
      )) ?? 12;

    const messages = await this.prisma.chatboxMessage.findMany({
      where: { tenantId, chatId },
      orderBy: { externalCreatedAt: 'asc' },
      select: { id: true, externalCreatedAt: true },
    });
    if (messages.length === 0) {
      return { sessionCount: 0 };
    }

    const chat = await this.prisma.chatboxChat.findUnique({
      where: { id: chatId },
      select: { status: true },
    });
    const chatActive = chat?.status === 'active';

    const segments = segmentMessages(
      messages.map((m) => ({ id: m.id, at: m.externalCreatedAt })),
      idleGapHours,
      chatActive,
    );

    let previousSessionId: string | null = null;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const seq = i + 1;
      const ids = seg.messageIds;

      const existing = await this.prisma.chatboxChatSession.findUnique({
        where: { tenantId_chatId_seq: { tenantId, chatId, seq } },
        select: {
          id: true,
          endedAt: true,
          messageCount: true,
        },
      });

      // Решаем, требуется ли пере-анализ при апдейте: открытая сессия
      // закрылась (endedAt был null → стал не-null) ИЛИ доросло число сообщений.
      const needsReanalysis =
        existing !== null &&
        ((existing.endedAt === null && seg.endedAt !== null) ||
          ids.length > existing.messageCount);

      const updateData: Prisma.ChatboxChatSessionUpdateInput = {
        startedAt: seg.startedAt,
        endedAt: seg.endedAt,
        messageCount: ids.length,
        previousSessionId,
      };
      // analysisStatus НЕ трогаем в общем случае (не сбрасываем 'done');
      // только при дозаполнении/закрытии — заново 'pending'.
      if (needsReanalysis) {
        updateData.analysisStatus = 'pending';
      }

      const session: { id: string } = await this.prisma.chatboxChatSession.upsert({
        where: { tenantId_chatId_seq: { tenantId, chatId, seq } },
        select: { id: true },
        create: {
          tenantId,
          chatId,
          seq,
          startedAt: seg.startedAt,
          endedAt: seg.endedAt,
          messageCount: ids.length,
          previousSessionId,
          analysisStatus: 'pending',
        },
        update: updateData,
      });

      await this.prisma.chatboxMessage.updateMany({
        where: { tenantId, id: { in: ids } },
        data: { sessionId: session.id },
      });

      previousSessionId = session.id;
    }

    // Осиротевшие сессии (seq за пределами текущего числа сегментов).
    await this.prisma.chatboxChatSession.deleteMany({
      where: { tenantId, chatId, seq: { gt: segments.length } },
    });

    return { sessionCount: segments.length };
  }
}
