import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Prisma, type PushToken } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { ApnsSender } from './apns-sender.service';
import { FcmSender } from './fcm-sender.service';
import type { PushTransport, PushTransportSender } from './push-transport.types';
import { RustoreSender } from './rustore-sender.service';
import { WebPushSender } from './web-push-sender.service';

const PUSH_TITLE = 'Кора';
const PUSH_BODY = 'Новое сообщение';

export type PushSignalKind = 'chat.new_message' | 'system';

export interface PushSignal {
  kind: PushSignalKind;
  conversationId?: string;
}

const TOKEN_TRANSPORTS: readonly PushTransport[] = ['apns', 'fcm', 'rustore'];

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly senders: Map<PushTransport, PushTransportSender>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ApnsSender) apns: ApnsSender,
    @Inject(FcmSender) fcm: FcmSender,
    @Inject(RustoreSender) rustore: RustoreSender,
    @Inject(WebPushSender) private readonly webPush: WebPushSender,
  ) {
    this.senders = new Map<PushTransport, PushTransportSender>([
      ['apns', apns],
      ['fcm', fcm],
      ['rustore', rustore],
    ]);
  }

  async ensurePushBinding(args: { tenantId: string; userId: string }): Promise<void> {
    const channel = await this.prisma.channel.upsert({
      where: { tenantId_kind: { tenantId: args.tenantId, kind: 'push' } },
      update: {},
      create: {
        tenantId: args.tenantId,
        kind: 'push',
        direction: 'outbound_only',
        maxDataClass: 'internal',
        status: 'active',
      },
    });
    await this.prisma.channelBinding.upsert({
      where: { channelId_externalId: { channelId: channel.id, externalId: args.userId } },
      update: { verifiedAt: new Date() },
      create: {
        userId: args.userId,
        channelId: channel.id,
        externalId: args.userId,
        verifiedAt: new Date(),
      },
    });
  }

  async registerToken(args: {
    tenantId: string;
    userId: string;
    transport: PushTransport;
    token: string;
    deviceInfo?: Record<string, unknown> | null;
  }): Promise<PushToken> {
    await this.ensurePushBinding({ tenantId: args.tenantId, userId: args.userId });
    const deviceInfo =
      args.deviceInfo != null ? (args.deviceInfo as Prisma.InputJsonValue) : undefined;
    return this.prisma.pushToken.upsert({
      where: {
        userId_transport_token: {
          userId: args.userId,
          transport: args.transport,
          token: args.token,
        },
      },
      create: {
        tenantId: args.tenantId,
        userId: args.userId,
        transport: args.transport,
        token: args.token,
        ...(deviceInfo !== undefined ? { deviceInfo } : {}),
        isActive: true,
        failureCount: 0,
        lastSeenAt: new Date(),
      },
      update: {
        tenantId: args.tenantId,
        ...(deviceInfo !== undefined ? { deviceInfo } : {}),
        isActive: true,
        failureCount: 0,
        lastSeenAt: new Date(),
      },
    });
  }

  async unregisterToken(args: {
    userId: string;
    token: string;
    transport?: PushTransport;
  }): Promise<{ deactivated: number }> {
    const res = await this.prisma.pushToken.updateMany({
      where: {
        userId: args.userId,
        token: args.token,
        ...(args.transport ? { transport: args.transport } : {}),
      },
      data: { isActive: false },
    });
    return { deactivated: res.count };
  }

  async deleteAllForUser(userId: string): Promise<{ deleted: number }> {
    const res = await this.prisma.pushToken.deleteMany({ where: { userId } });
    return { deleted: res.count };
  }

  async sendToUser(args: {
    tenantId: string;
    userId: string;
    signal: PushSignal;
    title?: string;
    body?: string;
  }): Promise<{ delivered: number; failed: number }> {
    const data: Record<string, string> = { kind: args.signal.kind };
    if (args.signal.conversationId) data.conversationId = args.signal.conversationId;

    const payload = {
      title: args.title ?? PUSH_TITLE,
      body: args.body ?? PUSH_BODY,
      data,
    };

    let delivered = 0;
    let failed = 0;

    const tokens = await this.prisma.pushToken.findMany({
      where: {
        userId: args.userId,
        tenantId: args.tenantId,
        isActive: true,
        transport: { in: [...TOKEN_TRANSPORTS] },
      },
    });

    for (const row of tokens) {
      const sender = this.senders.get(row.transport as PushTransport);
      if (!sender) {
        this.logger.warn(`sendToUser: нет sender для transport=${row.transport} — пропуск`);
        continue;
      }
      if (!sender.isConfigured()) {
        this.logger.debug(
          `sendToUser: transport=${row.transport} не настроен (нет кредов) — no-op, ядро не падает (R34)`,
        );
        continue;
      }
      try {
        const result = await sender.sendToToken({ token: row.token, payload });
        if (result.ok) {
          delivered++;
          await this.markSuccess(row.id);
        } else {
          failed++;
          await this.markFailure(row.id, result.invalidToken === true);
        }
      } catch (err) {
        failed++;
        this.logger.warn(
          { tokenId: row.id, transport: row.transport, err: err instanceof Error ? err.message : String(err) },
          'sendToUser: sender threw — учтён как failure',
        );
        await this.markFailure(row.id, false);
      }
    }

    try {
      const web = await this.webPush.sendToUser({
        tenantId: args.tenantId,
        userId: args.userId,
        title: payload.title,
        body: payload.body,
        extraData: data,
      });
      delivered += web.delivered;
      failed += web.failed;
    } catch (err) {
      this.logger.warn(
        { userId: args.userId, err: err instanceof Error ? err.message : String(err) },
        'sendToUser: webpush threw — остальные транспорты не затронуты (R34)',
      );
    }

    return { delivered, failed };
  }

  private async markSuccess(tokenId: string): Promise<void> {
    await this.prisma.pushToken.update({
      where: { id: tokenId },
      data: { lastSeenAt: new Date(), failureCount: 0 },
    });
  }

  private async markFailure(tokenId: string, invalidToken: boolean): Promise<void> {
    const max = this.cfg.push.maxFailures;
    const updated = await this.prisma.pushToken.update({
      where: { id: tokenId },
      data: { failureCount: { increment: 1 } },
      select: { failureCount: true },
    });
    if (invalidToken || updated.failureCount >= max) {
      await this.prisma.pushToken.update({
        where: { id: tokenId },
        data: { isActive: false },
      });
    }
  }
}
