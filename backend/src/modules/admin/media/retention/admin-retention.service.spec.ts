import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AdminSettingsService } from '../../settings/admin-settings.service';

import { AdminRetentionService } from './admin-retention.service';

interface RetentionRow {
  type: string;
  days: number;
  description: string | null;
  updatedBy: string | null;
  updatedAt: Date;
}

function buildService(initial: {
  retentionRows?: RetentionRow[];
  shareViews?: Array<{ id: string; viewedAt: Date }>;
  setMock?: ReturnType<typeof vi.fn>;
  envValues?: {
    defaultDays?: number;
    shareViewDays?: number;
    apiAccessLogDays?: number;
    webhookDeliveryDays?: number;
    softDeleteGraceDays?: number;
  };
}) {
  const rows: RetentionRow[] = [...(initial.retentionRows ?? [])];
  const shareViews = initial.shareViews ?? [];

  const findUnique = vi.fn(async (args: { where: { type: string } }) => {
    return rows.find((r) => r.type === args.where.type) ?? null;
  });

  const findMany = vi.fn(async (_args: { orderBy: unknown }) => {
    return [...rows].sort((a, b) => a.type.localeCompare(b.type));
  });

  const create = vi.fn(
    async (args: {
      data: {
        type: string;
        days: number;
        description?: string | null;
        updatedBy?: string | null;
      };
    }) => {
      const row: RetentionRow = {
        type: args.data.type,
        days: args.data.days,
        description: args.data.description ?? null,
        updatedBy: args.data.updatedBy ?? null,
        updatedAt: new Date('2026-05-25T10:00:00Z'),
      };
      rows.push(row);
      return row;
    },
  );

  const upsert = vi.fn(
    async (args: {
      where: { type: string };
      create: {
        type: string;
        days: number;
        description?: string | null;
        updatedBy?: string | null;
      };
      update: { days: number; updatedBy?: string | null };
    }) => {
      const idx = rows.findIndex((r) => r.type === args.where.type);
      if (idx >= 0) {
        const cur = rows[idx];
        if (!cur) throw new Error('unreachable');
        const updated: RetentionRow = {
          type: cur.type,
          days: args.update.days,
          description: cur.description,
          updatedBy: args.update.updatedBy ?? cur.updatedBy,
          updatedAt: new Date('2026-05-25T11:00:00Z'),
        };
        rows[idx] = updated;
        return updated;
      }
      const created: RetentionRow = {
        type: args.create.type,
        days: args.create.days,
        description: args.create.description ?? null,
        updatedBy: args.create.updatedBy ?? null,
        updatedAt: new Date('2026-05-25T11:00:00Z'),
      };
      rows.push(created);
      return created;
    },
  );

  const shareViewCount = vi.fn(async (args: { where: { viewedAt: { lt: Date } } }) => {
    return shareViews.filter((sv) => sv.viewedAt < args.where.viewedAt.lt).length;
  });
  const shareViewFindMany = vi.fn(
    async (args: {
      where: { viewedAt: { lt: Date } };
      select: unknown;
      orderBy: unknown;
      take: number;
    }) => {
      return shareViews
        .filter((sv) => sv.viewedAt < args.where.viewedAt.lt)
        .sort((a, b) => a.viewedAt.getTime() - b.viewedAt.getTime())
        .slice(0, args.take)
        .map((sv) => ({ id: sv.id }));
    },
  );

  const noop = vi.fn(async () => 0);
  const noopList = vi.fn(async () => [] as Array<{ id: string }>);

  const prisma = {
    retentionPolicy: { findUnique, findMany, create, upsert },
    recording: { count: noop, findMany: noopList },
    meetingShareView: { count: shareViewCount, findMany: shareViewFindMany },
    apiAccessLog: { count: noop, findMany: noopList },
    webhookDelivery: { count: noop, findMany: noopList },
  } as unknown as PrismaService;

  const setMock = initial.setMock ?? vi.fn(async () => undefined);
  const settings = {
    set: setMock,
  } as unknown as AdminSettingsService;

  const cfg = {
    retention: {
      defaultDays: initial.envValues?.defaultDays ?? 30,
      shareViewDays: initial.envValues?.shareViewDays ?? 90,
      apiAccessLogDays: initial.envValues?.apiAccessLogDays ?? 30,
      webhookDeliveryDays: initial.envValues?.webhookDeliveryDays ?? 30,
      softDeleteGraceDays: initial.envValues?.softDeleteGraceDays ?? 30,
    },
  } as unknown as TypedConfigService;

  const svc = new AdminRetentionService(prisma, settings, cfg);
  return {
    svc,
    setMock,
    spies: { findMany, create, upsert, shareViewCount },
    rows,
  };
}

describe('AdminRetentionService', () => {
  it('list(): при пустой БД синхронизирует с ENV (создаёт 5 типов)', async () => {
    const { svc, spies, rows } = buildService({
      envValues: { defaultDays: 60, shareViewDays: 120 },
    });
    const result = await svc.list();
    expect(result.length).toBe(5);
    expect(spies.create).toHaveBeenCalledTimes(5);
    const mr = rows.find((r) => r.type === 'meeting_recording');
    expect(mr?.days).toBe(60);
    const sv = rows.find((r) => r.type === 'share_view');
    expect(sv?.days).toBe(120);
    const types = result.map((r) => r.type);
    const sorted = [...types].sort();
    expect(types).toEqual(sorted);
  });

  it('update(): UPSERT в RetentionPolicy + вызов AdminSettings.set с reason', async () => {
    const { svc, setMock, spies } = buildService({
      retentionRows: [
        {
          type: 'share_view',
          days: 90,
          description: 'old',
          updatedBy: null,
          updatedAt: new Date('2026-05-20T10:00:00Z'),
        },
      ],
    });
    const result = await svc.update({
      type: 'share_view',
      days: 60,
      reason: 'Сокращаем для compliance review',
      userId: 'admin-1',
    });
    expect(result.days).toBe(60);
    expect(result.updatedBy).toBe('admin-1');
    expect(spies.upsert).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(
      'retention.share_view',
      60,
      expect.objectContaining({
        userId: 'admin-1',
        reason: 'Сокращаем для compliance review',
      }),
    );
  });

  it('preview(): считает affectedCount для share_view по cutoff', async () => {
    const now = Date.now();
    const tenDaysAgo = new Date(now - 10 * 86400_000);
    const hundredDaysAgo = new Date(now - 100 * 86400_000);
    const { svc } = buildService({
      retentionRows: [
        {
          type: 'share_view',
          days: 90,
          description: null,
          updatedBy: null,
          updatedAt: new Date(),
        },
      ],
      shareViews: [
        { id: 'sv-old-1', viewedAt: hundredDaysAgo },
        { id: 'sv-old-2', viewedAt: hundredDaysAgo },
        { id: 'sv-new', viewedAt: tenDaysAgo },
      ],
    });
    const result = await svc.preview({ type: 'share_view', days: 30 });
    expect(result.currentDays).toBe(90);
    expect(result.proposedDays).toBe(30);
    expect(result.affectedCount).toBe(2);
    expect(result.exampleIds.length).toBe(2);
    expect(result.notCountable).toBe(false);
  });
});
