import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  type ChannelDirection,
  type ChannelKind,
  ChannelStatus,
  type DataClass,
  type Prisma,
} from '@prisma/client';

import { CryptoService } from '../../../../common/crypto/crypto.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';

const SECRET_SUFFIX = 'Enc';
const SECRET_FIELDS = new Set([
  'botToken',
  'apiKey',
  'apiSalt',
  'password',
  'secret',
  'webhookSecret',
]);

export interface GlobalChannelItem {
  id: string;
  kind: ChannelKind;
  direction: ChannelDirection;
  status: ChannelStatus;
  maxDataClass: DataClass;
  config: Record<string, unknown>;
  brokenReason: string | null;
  subscribersCount: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class GlobalChannelsAdminService {
  private readonly logger = new Logger(GlobalChannelsAdminService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  async list(): Promise<{ items: GlobalChannelItem[] }> {
    const rows = await this.prisma.channel.findMany({
      where: { tenantId: null },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { bindings: true } } },
    });
    return {
      items: rows.map((r) =>
        this.toItem(r, (r as unknown as { _count: { bindings: number } })._count.bindings),
      ),
    };
  }

  async create(
    input: {
      kind: ChannelKind;
      direction: ChannelDirection;
      config?: Record<string, unknown>;
      secrets?: Record<string, string>;
      status?: ChannelStatus;
      maxDataClass?: DataClass;
    },
    userId: string | null,
  ): Promise<GlobalChannelItem> {
    void userId;
    const existing = await this.prisma.channel.findFirst({
      where: { tenantId: null, kind: input.kind },
    });
    if (existing) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'global_channel_kind_taken',
          message: `Глобальный канал kind=${input.kind} уже существует (id=${existing.id})`,
        },
      });
    }

    const mergedConfig = this.mergeWithEncryptedSecrets(
      input.config ?? {},
      input.secrets ?? {},
      {},
    );

    const created = await this.prisma.channel.create({
      data: {
        tenantId: null,
        kind: input.kind,
        direction: input.direction,
        config: mergedConfig as Prisma.InputJsonValue,
        status: input.status ?? ChannelStatus.active,
        ...(input.maxDataClass !== undefined ? { maxDataClass: input.maxDataClass } : {}),
      },
    });
    this.logger.log(
      `GlobalChannelsAdminService: создан глобальный канал id=${created.id} kind=${created.kind}`,
    );
    return this.toItem(created, 0);
  }

  async update(
    id: string,
    input: {
      direction?: ChannelDirection;
      config?: Record<string, unknown>;
      secrets?: Record<string, string>;
      status?: ChannelStatus;
      maxDataClass?: DataClass;
      brokenReason?: string | null;
    },
    userId: string | null,
  ): Promise<GlobalChannelItem> {
    void userId;
    const existing = await this.prisma.channel.findUnique({ where: { id } });
    if (!existing || existing.tenantId !== null) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'global_channel_not_found',
          message: `Глобальный канал id="${id}" не найден`,
        },
      });
    }

    const data: Prisma.ChannelUpdateInput = {};
    if (input.direction !== undefined) data.direction = input.direction;
    if (input.status !== undefined) data.status = input.status;
    if (input.maxDataClass !== undefined) data.maxDataClass = input.maxDataClass;
    if (input.brokenReason !== undefined) data.brokenReason = input.brokenReason;

    if (input.config !== undefined || input.secrets !== undefined) {
      const prevConfig =
        typeof existing.config === 'object' && existing.config !== null
          ? (existing.config as Record<string, unknown>)
          : {};
      const publicConfig = input.config ?? this.stripSecrets(prevConfig);
      const merged = this.mergeWithEncryptedSecrets(publicConfig, input.secrets ?? {}, prevConfig);
      data.config = merged as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.channel.update({ where: { id }, data });
    const count = await this.prisma.channelBinding.count({ where: { channelId: id } });
    return this.toItem(updated, count);
  }

  async softDelete(id: string, userId: string | null): Promise<{ ok: true }> {
    void userId;
    const existing = await this.prisma.channel.findUnique({ where: { id } });
    if (!existing || existing.tenantId !== null) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'global_channel_not_found',
          message: `Глобальный канал id="${id}" не найден`,
        },
      });
    }
    await this.prisma.channel.update({
      where: { id },
      data: { status: ChannelStatus.global_disabled },
    });
    return { ok: true };
  }

  private stripSecrets(config: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      if (k.endsWith(SECRET_SUFFIX)) continue;
      if (SECRET_FIELDS.has(k)) continue;
      out[k] = v;
    }
    return out;
  }

  private mergeWithEncryptedSecrets(
    publicConfig: Record<string, unknown>,
    secrets: Record<string, string>,
    prev: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(prev)) {
      if (k.endsWith(SECRET_SUFFIX)) out[k] = v;
    }
    for (const [k, v] of Object.entries(this.stripSecrets(publicConfig))) {
      out[k] = v;
    }
    for (const [field, plain] of Object.entries(secrets)) {
      if (!plain) continue;
      const cipher = this.crypto.encrypt(plain);
      out[`${field}${SECRET_SUFFIX}`] = cipher;
    }
    return out;
  }

  private toItem(
    row: {
      id: string;
      kind: ChannelKind;
      direction: ChannelDirection;
      status: ChannelStatus;
      maxDataClass: DataClass;
      config: unknown;
      brokenReason: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    subscribersCount: number,
  ): GlobalChannelItem {
    const rawConfig =
      typeof row.config === 'object' && row.config !== null
        ? (row.config as Record<string, unknown>)
        : {};
    return {
      id: row.id,
      kind: row.kind,
      direction: row.direction,
      status: row.status,
      maxDataClass: row.maxDataClass,
      config: this.stripSecrets(rawConfig),
      brokenReason: row.brokenReason,
      subscribersCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
