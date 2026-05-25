/**
 * Admin-redesign Фаза 6 — unit-тесты `AdminWebhooksMgmtService`.
 *
 * Покрываем:
 *   1) listActive(): возвращает только подписки status=active с маппингом полей.
 *   2) listDlq(): фильтрует по status=failed.
 *   3) retryDelivery(): обновляет статус delivery в pending и не падает,
 *      даже если scheduler-очередь не существует (best-effort enqueue).
 */

import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AdminWebhooksMgmtService } from './admin-webhooks-mgmt.service';

interface SubRow {
  id: string;
  tenantId: string | null;
  url: string;
  events: string[];
  status: string;
  lastDeliveryAt: Date | null;
  createdAt: Date;
}
interface DeliveryRow {
  id: string;
  subscriptionId: string;
  event: string;
  status: string;
  attempts: number;
  lastStatus: number | null;
  lastResponse: string | null;
  nextAttemptAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  subscription?: { url: string };
}

function buildService(initial: {
  subs?: SubRow[];
  deliveries?: DeliveryRow[];
}) {
  const subs = initial.subs ?? [];
  const deliveries = initial.deliveries ?? [];

  const prisma = {
    webhookSubscription: {
      findMany: vi.fn(
        async ({ where }: { where?: { status?: string } }) => {
          if (where?.status) {
            return subs.filter((s) => s.status === where.status);
          }
          return subs;
        },
      ),
    },
    webhookDelivery: {
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where?: { status?: string };
          take?: number;
        }) => {
          let result = deliveries;
          if (where?.status) {
            result = result.filter((d) => d.status === where.status);
          }
          return result.slice(0, take ?? result.length);
        },
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => {
          return deliveries.find((d) => d.id === where.id) ?? null;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<DeliveryRow>;
        }) => {
          const d = deliveries.find((x) => x.id === where.id);
          if (!d) throw new Error('not found');
          Object.assign(d, data);
          return d;
        },
      ),
    },
  } as unknown as ConstructorParameters<typeof AdminWebhooksMgmtService>[0];

  // Redis mock — без падений на add(), но без реального BullMQ. Сервис
  // должен поглотить ошибку и вернуть enqueued=false.
  const redis = {
    client: {} as never,
  } as unknown as ConstructorParameters<typeof AdminWebhooksMgmtService>[1];

  const svc = new AdminWebhooksMgmtService(prisma, redis);
  return { svc, subs, deliveries };
}

describe('AdminWebhooksMgmtService', () => {
  it('listActive: возвращает только active-подписки с маппингом', async () => {
    const { svc } = buildService({
      subs: [
        {
          id: 's1',
          tenantId: 't1',
          url: 'https://example.com/hook',
          events: ['meeting.created'],
          status: 'active',
          lastDeliveryAt: new Date('2026-05-01T10:00:00Z'),
          createdAt: new Date('2026-04-01T00:00:00Z'),
        },
      ],
    });
    const rows = await svc.listActive();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 's1',
      tenantId: 't1',
      url: 'https://example.com/hook',
      status: 'active',
    });
    expect(rows[0]?.events).toEqual(['meeting.created']);
  });

  it('listDlq: фильтрует только failed-доставки', async () => {
    const { svc } = buildService({
      deliveries: [
        {
          id: 'd1',
          subscriptionId: 's1',
          event: 'a',
          status: 'failed',
          attempts: 5,
          lastStatus: 500,
          lastResponse: 'err',
          nextAttemptAt: null,
          deliveredAt: null,
          createdAt: new Date('2026-05-01T00:00:00Z'),
          subscription: { url: 'https://x.example.com' },
        },
        {
          id: 'd2',
          subscriptionId: 's1',
          event: 'b',
          status: 'delivered',
          attempts: 1,
          lastStatus: 200,
          lastResponse: null,
          nextAttemptAt: null,
          deliveredAt: new Date('2026-05-01T00:01:00Z'),
          createdAt: new Date('2026-05-01T00:01:00Z'),
        },
      ],
    });
    const page = await svc.listDlq({ limit: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe('d1');
    expect(page.items[0]?.url).toBe('https://x.example.com');
  });

  it('retryDelivery: переводит в pending; enqueue best-effort', async () => {
    const { svc, deliveries } = buildService({
      deliveries: [
        {
          id: 'd1',
          subscriptionId: 's1',
          event: 'a',
          status: 'failed',
          attempts: 5,
          lastStatus: 500,
          lastResponse: 'err',
          nextAttemptAt: null,
          deliveredAt: null,
          createdAt: new Date('2026-05-01T00:00:00Z'),
        },
      ],
    });
    const result = await svc.retryDelivery('d1');
    expect(result.ok).toBe(true);
    expect(deliveries[0]?.status).toBe('pending');
    expect(deliveries[0]?.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('retryDelivery: 404 если доставка не найдена', async () => {
    const { svc } = buildService({});
    await expect(svc.retryDelivery('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
