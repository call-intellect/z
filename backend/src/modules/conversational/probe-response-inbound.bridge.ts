import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

import { ConversationalService } from './conversational.service';
import type { InboundMessage } from './types/channel.types';

interface DigestItem {
  probeEventId?: string;
  question?: string;
  objectTitle?: string;
}

const DIGEST_TOKEN_MIN_LEN = 4;

function tokenize(text: string): Set<string> {
  return new Set(
    (text ?? '')
      .toLowerCase()
      .split(/[^a-zа-яё0-9]+/u)
      .filter((w) => w.length >= DIGEST_TOKEN_MIN_LEN),
  );
}

export function resolveDigestProbeEventId(
  items: DigestItem[],
  answerText: string,
): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const withId = items.filter((it) => typeof it?.probeEventId === 'string');
  if (withId.length === 0) return null;
  if (withId.length === 1) return withId[0]!.probeEventId ?? null;
  const ans = tokenize(answerText);
  if (ans.size === 0) return null;
  let best: string | null = null;
  let bestScore = 0;
  let tie = false;
  for (const it of withId) {
    const q = tokenize(`${it.question ?? ''} ${it.objectTitle ?? ''}`);
    let score = 0;
    for (const t of ans) if (q.has(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = it.probeEventId ?? null;
      tie = false;
    } else if (score === bestScore && score > 0) {
      tie = true;
    }
  }
  return bestScore > 0 && !tie ? best : null;
}

@Injectable()
export class ProbeResponseInboundBridge implements OnModuleInit {
  private readonly logger = new Logger(ProbeResponseInboundBridge.name);

  constructor(
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.conversational.subscribeInbound('response', async (msg) => {
      await this.handleResponse(msg);
    });
    this.logger.log('ProbeResponseInboundBridge: подписан на inbound response');
  }

  private async handleResponse(msg: InboundMessage): Promise<void> {
    if (msg.type !== 'response') return;
    try {
      let payload = (msg.payload ?? {}) as Record<string, unknown>;
      const notif = await this.prisma.notification.findUnique({
        where: { id: msg.notificationId },
        select: { eventType: true, payload: true },
      });
      if (notif?.eventType === 'probe.digest') {
        const items = this.extractDigestItems(notif.payload);
        const target = resolveDigestProbeEventId(items, this.extractText(payload));
        if (target) {
          payload = { ...payload, probeEventId: target };
        }
      }
      await this.conversational.respondToProbe({
        notificationId: msg.notificationId,
        userId: msg.userId,
        payload,
      });
    } catch (err) {
      this.logger.warn(
        {
          notificationId: msg.notificationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'response handler упал — ответ не проведён',
      );
    }
  }

  private extractDigestItems(payload: unknown): DigestItem[] {
    if (payload === null || typeof payload !== 'object') return [];
    const items = (payload as { items?: unknown }).items;
    return Array.isArray(items) ? (items as DigestItem[]) : [];
  }

  private extractText(payload: Record<string, unknown>): string {
    for (const key of ['text', 'response', 'body', 'answer'] as const) {
      const v = payload[key];
      if (typeof v === 'string') return v;
    }
    return '';
  }
}
