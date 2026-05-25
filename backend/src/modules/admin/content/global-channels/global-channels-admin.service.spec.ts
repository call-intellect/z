/**
 * Admin-redesign Фаза 5 — unit-тесты `GlobalChannelsAdminService`.
 *
 * Покрываем:
 *   1) list(): возвращает только tenantId=null + subscribersCount.
 *   2) create(): шифрует secrets через CryptoService; ответ не содержит plain.
 *   3) update(): partial-update сохраняет ранее зашифрованные секреты.
 *   4) softDelete(): status → global_disabled; 404 для tenantId≠null.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ChannelDirection,
  ChannelKind,
  ChannelStatus,
  DataClass,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { CryptoService } from '../../../../common/crypto/crypto.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';

import { GlobalChannelsAdminService } from './global-channels-admin.service';

interface ChannelRow {
  id: string;
  tenantId: string | null;
  kind: ChannelKind;
  direction: ChannelDirection;
  status: ChannelStatus;
  maxDataClass: DataClass;
  config: Record<string, unknown>;
  brokenReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function buildPrisma(state: {
  rows: ChannelRow[];
  bindingsByChannel: Record<string, number>;
}): PrismaService {
  let nextId = 1;
  const findMany = vi.fn(
    async (args: { where?: { tenantId?: string | null }; include?: unknown }) => {
      const filtered = state.rows.filter((r) => {
        if (args.where?.tenantId === null) return r.tenantId === null;
        return true;
      });
      return filtered.map((r) => ({
        ...r,
        _count: { bindings: state.bindingsByChannel[r.id] ?? 0 },
      }));
    },
  );
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
    return state.rows.find((r) => r.id === where.id) ?? null;
  });
  const findFirst = vi.fn(
    async ({
      where,
    }: {
      where: { tenantId: string | null; kind: ChannelKind };
    }) => {
      return (
        state.rows.find(
          (r) => r.tenantId === where.tenantId && r.kind === where.kind,
        ) ?? null
      );
    },
  );
  const create = vi.fn(async ({ data }: { data: Partial<ChannelRow> }) => {
    const row: ChannelRow = {
      id: `c-${nextId++}`,
      tenantId: data.tenantId ?? null,
      kind: data.kind ?? ChannelKind.in_app,
      direction: data.direction ?? ChannelDirection.bidirectional,
      status: data.status ?? ChannelStatus.active,
      maxDataClass: data.maxDataClass ?? DataClass.internal,
      config: (data.config as Record<string, unknown>) ?? {},
      brokenReason: data.brokenReason ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    state.rows.push(row);
    return row;
  });
  const update = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<ChannelRow>;
    }) => {
      const r = state.rows.find((x) => x.id === where.id);
      if (!r) throw new Error('not found');
      Object.assign(r, data, { updatedAt: new Date() });
      return r;
    },
  );
  const bindingCount = vi.fn(
    async ({ where }: { where: { channelId: string } }) =>
      state.bindingsByChannel[where.channelId] ?? 0,
  );

  return {
    channel: { findMany, findUnique, findFirst, create, update },
    channelBinding: { count: bindingCount },
  } as unknown as PrismaService;
}

function buildCrypto(): CryptoService {
  const encrypt = vi.fn((plain: string) => `gcm:v1:iv:tag:${Buffer.from(plain).toString('base64')}`);
  const decrypt = vi.fn();
  return { encrypt, decrypt } as unknown as CryptoService;
}

function makeRow(over: Partial<ChannelRow>): ChannelRow {
  return {
    id: over.id ?? 'c-1',
    tenantId: over.tenantId === undefined ? null : over.tenantId,
    kind: over.kind ?? ChannelKind.telegram_bot,
    direction: over.direction ?? ChannelDirection.bidirectional,
    status: over.status ?? ChannelStatus.active,
    maxDataClass: over.maxDataClass ?? DataClass.internal,
    config: over.config ?? {},
    brokenReason: over.brokenReason ?? null,
    createdAt: over.createdAt ?? new Date(),
    updatedAt: over.updatedAt ?? new Date(),
  };
}

describe('GlobalChannelsAdminService', () => {
  it('list(): возвращает только tenantId=null + subscribersCount, секреты скрыты', async () => {
    const state = {
      rows: [
        makeRow({
          id: 'c-1',
          tenantId: null,
          kind: ChannelKind.telegram_bot,
          config: { botUsername: '@kora_bot', botTokenEnc: 'gcm:v1:...' },
        }),
        makeRow({
          id: 'c-2',
          tenantId: 'tenant-1',
          kind: ChannelKind.in_app,
        }),
      ],
      bindingsByChannel: { 'c-1': 42 },
    };
    const svc = new GlobalChannelsAdminService(buildPrisma(state), buildCrypto());

    const res = await svc.list();
    expect(res.items.length).toBe(1);
    expect(res.items[0]?.id).toBe('c-1');
    expect(res.items[0]?.subscribersCount).toBe(42);
    // Секрет не должен присутствовать.
    expect((res.items[0]?.config as Record<string, unknown>).botTokenEnc).toBeUndefined();
    expect((res.items[0]?.config as Record<string, unknown>).botUsername).toBe('@kora_bot');
  });

  it('create(): шифрует secrets, конфликт kind → 400', async () => {
    const state = {
      rows: [] as ChannelRow[],
      bindingsByChannel: {} as Record<string, number>,
    };
    const crypto = buildCrypto();
    const svc = new GlobalChannelsAdminService(buildPrisma(state), crypto);

    const created = await svc.create(
      {
        kind: ChannelKind.telegram_bot,
        direction: ChannelDirection.bidirectional,
        config: { botUsername: '@kora_bot' },
        secrets: { botToken: 'super-secret-token' },
      },
      'user-1',
    );
    expect(created.id).toBeDefined();
    expect(created.config.botTokenEnc).toBeUndefined(); // секреты вырезаны из ответа
    expect(created.config.botUsername).toBe('@kora_bot');
    // Проверяем, что в БД лежит зашифрованный токен.
    const stored = state.rows[0]?.config as Record<string, unknown>;
    expect(stored.botTokenEnc).toBeDefined();
    expect(typeof stored.botTokenEnc).toBe('string');
    expect(stored.botTokenEnc).not.toBe('super-secret-token');
    expect(crypto.encrypt).toHaveBeenCalledWith('super-secret-token');

    // Повторный create того же kind — 400.
    await expect(
      svc.create(
        {
          kind: ChannelKind.telegram_bot,
          direction: ChannelDirection.bidirectional,
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update(): partial-update сохраняет ранее зашифрованные секреты', async () => {
    const state = {
      rows: [
        makeRow({
          id: 'c-1',
          tenantId: null,
          kind: ChannelKind.telegram_bot,
          config: {
            botUsername: '@old_bot',
            botTokenEnc: 'gcm:v1:iv:tag:old',
          },
        }),
      ],
      bindingsByChannel: { 'c-1': 5 },
    };
    const svc = new GlobalChannelsAdminService(
      buildPrisma(state),
      buildCrypto(),
    );

    // Меняем только public-config — секрет должен остаться.
    const upd = await svc.update(
      'c-1',
      { config: { botUsername: '@new_bot' } },
      'user-1',
    );
    expect(upd.config.botUsername).toBe('@new_bot');
    expect(upd.subscribersCount).toBe(5);
    expect((state.rows[0]?.config as Record<string, unknown>).botTokenEnc).toBe(
      'gcm:v1:iv:tag:old',
    );
  });

  it('softDelete(): status → global_disabled; 404 для tenantId≠null', async () => {
    const state = {
      rows: [
        makeRow({ id: 'c-1', tenantId: null, status: ChannelStatus.active }),
        makeRow({ id: 'c-2', tenantId: 'tenant-1' }),
      ],
      bindingsByChannel: {} as Record<string, number>,
    };
    const svc = new GlobalChannelsAdminService(
      buildPrisma(state),
      buildCrypto(),
    );

    const res = await svc.softDelete('c-1', 'user-1');
    expect(res.ok).toBe(true);
    expect(state.rows[0]?.status).toBe(ChannelStatus.global_disabled);

    // Per-tenant канал — 404 на admin endpoint глобальных.
    await expect(svc.softDelete('c-2', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
