import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

export interface ChatboxSegment {
  startedAt: Date;
  endedAt: Date | null;
  messageIds: string[];
}

export function segmentMessages(
  msgs: { id: string; at: Date }[],
  idleGapHours: number,
  chatActive: boolean,
): ChatboxSegment[] {
  if (msgs.length === 0) return [];

  const gapMs = idleGapHours * 60 * 60 * 1000;
  const segments: ChatboxSegment[] = [];
  let current: { startedAt: Date; lastAt: Date; messageIds: string[] } | null = null;

  for (const msg of msgs) {
    if (current === null) {
      current = { startedAt: msg.at, lastAt: msg.at, messageIds: [msg.id] };
      continue;
    }
    const delta = msg.at.getTime() - current.lastAt.getTime();
    if (delta > gapMs) {
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

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async rebuildSessions(tenantId: string, chatId: string): Promise<{ sessionCount: number }> {
    const fresh = await this.prisma.chatboxMessage.findMany({
      where: { tenantId, chatId, sessionId: null },
      orderBy: { externalCreatedAt: 'asc' },
      select: { id: true, externalCreatedAt: true },
    });
    if (fresh.length === 0) {
      return { sessionCount: 0 };
    }

    const groups = new Map<string, { startedAt: Date; endedAt: Date; ids: string[] }>();
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
          endedAt: g.endedAt,
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
