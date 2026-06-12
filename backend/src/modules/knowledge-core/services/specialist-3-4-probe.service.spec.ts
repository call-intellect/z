/**
 * M-2 (2026-06-12) — Specialist34ProbeService × «лестница владельца» для
 * `card.missing_owner`: АВТО-записи владельца у Card НЕТ.
 *
 * Card.ownerId — namespace/creator-ключ (@@unique([ownerId,name]) + cascade):
 * его авто-перезапись опасна. resolved-исход лестницы трактуется как
 * ambiguous с единственным кандидатом → probe-вопрос «Назначить владельцем
 * X? Ответьте, кого назначить.» (текст, без кнопок). Метрика
 * incOwnerResolution для card — только ambiguous | none.
 *
 * Все зависимости мокированы.
 */
import type { Card } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { ProbeService } from '../../probe/probe.service';

import type { OwnerResolverService } from './owner-resolver.service';
import { Specialist34ProbeService } from './specialist-3-4-probe.service';

function makeCard(): Card {
  return {
    id: 'card-1',
    tenantId: 'org-1',
    kind: 'project',
    name: 'Проект Альфа',
    ownerId: 'user-fired', // creator без активного Membership
    entityId: null,
    relatedEntityIds: [],
    personSubjectIds: ['person-1'],
    summaryCache: 'дедлайн 01.07', // missing_deadline не срабатывает
    lastConfirmedAt: null, // outdated_summary не срабатывает
    deletedAt: null,
    createdAt: new Date(),
  } as unknown as Card;
}

function makeEnv(resolution:
  | { kind: 'resolved'; userId: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'none' },
): {
  service: Specialist34ProbeService;
  suggest: ReturnType<typeof vi.fn>;
  cardUpdateMany: ReturnType<typeof vi.fn>;
  incOwnerResolution: ReturnType<typeof vi.fn>;
} {
  const cardUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    card: { updateMany: cardUpdateMany },
    membership: {
      // owner-creator не имеет Membership (триггер missing_owner)…
      findUnique: vi.fn().mockResolvedValue(null),
      // …admin'ы и активные кандидаты есть.
      findMany: vi
        .fn()
        .mockResolvedValue([{ userId: 'admin-1' }, { userId: 'user-cand' }]),
    },
    person: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: 'person-1', name: 'Иван Иванов', userId: 'user-cand' },
        ]),
    },
  } as unknown as PrismaService;

  const sendNotification = vi.fn().mockResolvedValue({ id: 'n-1' });
  const conversational = {
    sendNotification,
  } as unknown as ConversationalService;

  const incOwnerResolution = vi.fn();
  const metrics = {
    incCoreSpecialistProbeEvent: vi.fn(),
    incOwnerResolution,
  } as unknown as BusinessMetricsService;

  const suggest = vi.fn().mockResolvedValue({ ok: true, probeEventId: 'p-1' });
  const probeService = { suggest } as unknown as ProbeService;

  const ownerResolver = {
    resolve: vi.fn().mockResolvedValue(resolution),
  } as unknown as OwnerResolverService;

  return {
    service: new Specialist34ProbeService(
      prisma,
      conversational,
      metrics,
      probeService,
      ownerResolver,
    ),
    suggest,
    cardUpdateMany,
    incOwnerResolution,
  };
}

describe('Specialist34ProbeService × OwnerResolver (card.missing_owner) — M-2 без АВТО-записи', () => {
  it('resolved (единственный кандидат) → Card.updateMany НЕ вызывается, probe-вопрос «Назначить владельцем …? Ответьте, кого назначить.»', async () => {
    const env = makeEnv({ kind: 'resolved', userId: 'user-cand' });

    await env.service.checkAndEmitProbes(makeCard());

    // Главный инвариант M-2: никакой записи владельца карточки.
    expect(env.cardUpdateMany).not.toHaveBeenCalled();

    expect(env.suggest).toHaveBeenCalledTimes(1);
    const call = env.suggest.mock.calls[0]![0] as {
      reason: string;
      payload: { message: string };
    };
    expect(call.reason).toBe('card.missing_owner');
    expect(call.payload.message).toContain('Назначить владельцем Иван Иванов?');
    expect(call.payload.message).toContain('Ответьте, кого назначить');

    // Метрика для card: resolved → ambiguous (не auto).
    expect(env.incOwnerResolution).toHaveBeenCalledWith({
      outcome: 'ambiguous',
    });
    expect(env.incOwnerResolution).not.toHaveBeenCalledWith({
      outcome: 'auto',
    });
  });

  it('none → прежний probe «кто-то из команды возьмёт?», без записи', async () => {
    const env = makeEnv({ kind: 'none' });

    await env.service.checkAndEmitProbes(makeCard());

    expect(env.cardUpdateMany).not.toHaveBeenCalled();
    expect(env.suggest).toHaveBeenCalledTimes(1);
    const call = env.suggest.mock.calls[0]![0] as {
      payload: { message: string };
    };
    expect(call.payload.message).toContain('кто-то из команды возьмёт?');
    expect(env.incOwnerResolution).toHaveBeenCalledWith({ outcome: 'none' });
  });
});
