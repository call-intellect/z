/**
 * IDOR-fence spec для CardsController (Phase F.7).
 *
 * Карточки в Z привязаны к user.id (ownerId), а не к tenantId — это
 * legacy-модель Phase 0. IDOR-фенс делается в CardsService.getById:
 *   `if (!card || card.ownerId !== userId || card.deletedAt !== null) → NotFound`.
 * Контроллер просто пробрасывает user.id из @CurrentUser.
 *
 * Проверяем: cross-user запрос → сервис бросает NotFound (а не вернёт чужие
 * данные). Контроллер делегирует, не подмешивая своего user'а.
 */
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';


import type { PrismaService } from '../../common/prisma/prisma.service';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';

import { CardsController } from './cards.controller';
import type { CardsService } from './cards.service';

const userAlice: CurrentUserPayload = { id: 'u-alice', email: 'a@x', role: 'user' };
const userBob: CurrentUserPayload = { id: 'u-bob', email: 'b@x', role: 'user' };

function fakeCard(over: { id?: string; ownerId?: string } = {}) {
  return {
    id: over.id ?? 'c-1',
    ownerId: over.ownerId ?? 'u-alice',
    tenantId: 't-A',
    name: 'Test Card',
    kind: 'topic',
    description: null,
    pinned: false,
    archived: false,
    sortOrder: 0,
    entityId: null,
    relatedEntityIds: [],
    bornFromThemeId: null,
    meetingCount: 0,
    lastMeetingAt: null,
    rollupSummary: null,
    rollupGeneratedAt: null,
    rollupModel: null,
    deletedAt: null,
    createdAt: new Date('2026-05-24T10:00:00Z'),
    updatedAt: new Date('2026-05-24T10:00:00Z'),
  };
}

function build(opts: { simulateForeignCard?: boolean } = {}) {
  const cards = {
    getById: vi.fn(async (id: string, userId: string) => {
      // Сервис: если карточка чужая (или удалена) — NotFoundException.
      if (opts.simulateForeignCard && userId !== 'u-alice') {
        throw new NotFoundException({
          ok: false,
          error: { code: 'card_not_found', message: 'Карточка не найдена' },
        });
      }
      return fakeCard({ id }) as never;
    }),
    list: vi.fn(async (userId: string) => ({
      items: [fakeCard({ ownerId: userId })],
      total: 1,
    }) as never),
  } as unknown as CardsService;
  const prisma = {} as unknown as PrismaService;
  return { ctrl: new CardsController(cards, prisma), cards };
}

describe('CardsController (IDOR fence)', () => {
  it('cross-user getOne → NotFoundException (не возвращает данные)', async () => {
    const { ctrl } = build({ simulateForeignCard: true });
    await expect(ctrl.getOne('c-alice', userBob)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('owner getOne → возвращает карточку', async () => {
    const { ctrl } = build({ simulateForeignCard: true });
    const res = await ctrl.getOne('c-alice', userAlice);
    expect(res.id).toBe('c-alice');
    // mapCard скрывает ownerId из public DTO — это корректно. Сам факт
    // успешного возврата карточки = owner-доступ работает.
    expect(res.name).toBeDefined();
  });

  it('контроллер передаёт user.id из @CurrentUser в service.getById', async () => {
    const { ctrl, cards } = build();
    await ctrl.getOne('c-1', userAlice);
    expect(cards.getById).toHaveBeenCalledWith('c-1', 'u-alice');
  });

  it('list передаёт user.id и не позволяет указать чужой owner', async () => {
    const { ctrl, cards } = build();
    const q = { page: 1, limit: 20, sort: 'recent' as const };
    await ctrl.list(q as never, userAlice);
    expect(cards.list).toHaveBeenCalledWith('u-alice', q);
  });
});
