import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * ChatboxSessionService — нарезка сообщений чата на сессии для LLM-анализа
 * (ТЗ 2026-06-05; пересмотр 2026-06-17 — окно синхронизации).
 *
 * Сессия = ОКНО СИНХРОНИЗАЦИИ (сутки): на каждом синке берём только новые
 * сообщения (ещё не привязанные к сессии, `sessionId=null`), группируем по
 * календарному дню (UTC) и на каждый день создаём НОВУЮ ЗАКРЫТУЮ сессию
 * (`endedAt` выставлен) → она сразу анализируема. Это чинит сквозной
 * (непрерывный) чат: раньше (gap-based) он зависал одной вечно-открытой сессией
 * (`endedAt=null`) и не анализировался ни одним из путей (все требуют
 * `endedAt != null`). Уже привязанные сообщения и их сессии не трогаем —
 * выполненный анализ (`analysisStatus='done'`) не сбрасывается.
 *
 * `segmentMessages` (gap-based, ниже) оставлена как чистая утилита для
 * unit-тестов, но `rebuildSessions` её больше НЕ использует.
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
  ) {}

  /**
   * Нарезать НОВЫЕ (ещё не привязанные) сообщения чата на сессии-сутки.
   * Каждый календарный день новых сообщений → отдельная ЗАКРЫТАЯ сессия
   * (`endedAt` = время последнего сообщения дня) → сразу анализируема. Уже
   * привязанные сообщения и существующие сессии не трогаем. Идемпотентно:
   * повторный вызов без новых сообщений — no-op. Возвращает число созданных сессий.
   */
  async rebuildSessions(
    tenantId: string,
    chatId: string,
  ): Promise<{ sessionCount: number }> {
    // Только новые сообщения с прошлого синка (привязанные — уже в сессиях).
    const fresh = await this.prisma.chatboxMessage.findMany({
      where: { tenantId, chatId, sessionId: null },
      orderBy: { externalCreatedAt: 'asc' },
      select: { id: true, externalCreatedAt: true },
    });
    if (fresh.length === 0) {
      return { sessionCount: 0 };
    }

    // Группировка по календарному дню (UTC). fresh уже ASC → порядок дней и
    // endedAt (последнее сообщение дня) проставляются естественно.
    const groups = new Map<
      string,
      { startedAt: Date; endedAt: Date; ids: string[] }
    >();
    for (const m of fresh) {
      const dayKey = m.externalCreatedAt.toISOString().slice(0, 10);
      const g = groups.get(dayKey);
      if (g) {
        g.endedAt = m.externalCreatedAt;
        g.ids.push(m.id);
      } else {
        groups.set(dayKey, {
          startedAt: m.externalCreatedAt,
          endedAt: m.externalCreatedAt,
          ids: [m.id],
        });
      }
    }

    // Продолжаем нумерацию seq и цепочку previousSessionId от последней сессии.
    const agg = await this.prisma.chatboxChatSession.aggregate({
      where: { tenantId, chatId },
      _max: { seq: true },
    });
    let seq = agg._max.seq ?? 0;
    const lastSession = await this.prisma.chatboxChatSession.findFirst({
      where: { tenantId, chatId },
      orderBy: { seq: 'desc' },
      select: { id: true },
    });
    let previousSessionId: string | null = lastSession?.id ?? null;

    for (const g of groups.values()) {
      seq += 1;
      const session = await this.prisma.chatboxChatSession.create({
        data: {
          tenantId,
          chatId,
          seq,
          startedAt: g.startedAt,
          endedAt: g.endedAt, // закрыта сразу → анализируема
          messageCount: g.ids.length,
          analysisStatus: 'pending',
          previousSessionId,
        },
        select: { id: true },
      });
      await this.prisma.chatboxMessage.updateMany({
        where: { tenantId, id: { in: g.ids } },
        data: { sessionId: session.id },
      });
      previousSessionId = session.id;
    }

    return { sessionCount: groups.size };
  }
}
