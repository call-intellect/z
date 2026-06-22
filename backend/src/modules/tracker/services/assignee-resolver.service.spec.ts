import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AssigneeResolverService } from './assignee-resolver.service';

const TENANT = 'org_1';

describe('AssigneeResolverService.resolve', () => {
  let prisma: PrismaService;
  let service: AssigneeResolverService;
  let membershipFindMany: ReturnType<typeof vi.fn>;
  let personFindMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    membershipFindMany = vi.fn(async () => [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]);
    personFindMany = vi.fn(async () => [
      { userId: 'u1', name: 'Айназ' },
      { userId: 'u2', name: 'Иван' },
    ]);
    prisma = {
      membership: { findMany: membershipFindMany },
      person: { findMany: personFindMany },
    } as unknown as PrismaService;
    service = new AssigneeResolverService(prisma);
  });

  it('1 точное совпадение → resolved', async () => {
    const r = await service.resolve(TENANT, 'Айназ');
    expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Айназ' });
  });

  it('точное равенство приоритетнее частичного', async () => {
    personFindMany.mockResolvedValueOnce([
      { userId: 'u1', name: 'Иван' },
      { userId: 'u2', name: 'Иванов Иван' },
    ]);
    const r = await service.resolve(TENANT, 'Иван');
    expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Иван' });
  });

  it('2 одноимённых (разные userId) → ambiguous со списком', async () => {
    personFindMany.mockResolvedValueOnce([
      { userId: 'u1', name: 'Айназ' },
      { userId: 'u2', name: 'Айназ' },
    ]);
    const r = await service.resolve(TENANT, 'Айназ');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.candidates).toHaveLength(2);
      expect(r.candidates.map((c) => c.userId).sort()).toEqual(['u1', 'u2']);
    }
  });

  it('0 совпадений → not_found', async () => {
    const r = await service.resolve(TENANT, 'Пётр');
    expect(r).toEqual({ kind: 'not_found' });
  });

  it('пустое имя → not_found', async () => {
    const r = await service.resolve(TENANT, '   ');
    expect(r).toEqual({ kind: 'not_found' });
  });

  it('cross-tenant: person.findMany фильтруется по tenantId+deletedAt', async () => {
    await service.resolve(TENANT, 'Айназ');
    expect(personFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT, deletedAt: null }),
      }),
    );
  });

  it('person без активного Membership исключается (membership-gate)', async () => {
    membershipFindMany.mockResolvedValueOnce([{ userId: 'u2' }]);
    personFindMany.mockResolvedValueOnce([{ userId: 'u1', name: 'Айназ' }]);
    const r = await service.resolve(TENANT, 'Айназ');
    expect(r).toEqual({ kind: 'not_found' });
  });

  describe('склонения русских имён (Ф1)', () => {
    beforeEach(() => {
      membershipFindMany.mockResolvedValue([{ userId: 'u1' }]);
      personFindMany.mockResolvedValue([{ userId: 'u1', name: 'Сергей' }]);
    });

    it.each(['Сергею', 'Сергея', 'Сергеем', 'Сергее', 'сергею'])(
      'падеж «%s» → резолвится в «Сергей»',
      async (input) => {
        const r = await service.resolve(TENANT, input);
        expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Сергей' });
      },
    );

    it('именительный «Сергей» по-прежнему резолвится', async () => {
      const r = await service.resolve(TENANT, 'Сергей');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Сергей' });
    });

    it('НЕ путает разные имена: «Инне» при сотруднике «Анна» → not_found', async () => {
      personFindMany.mockResolvedValueOnce([{ userId: 'u1', name: 'Анна' }]);
      const r = await service.resolve(TENANT, 'Инне');
      expect(r).toEqual({ kind: 'not_found' });
    });

    it('дательный «Анне» при сотруднике «Анна» → resolved', async () => {
      personFindMany.mockResolvedValueOnce([{ userId: 'u1', name: 'Анна' }]);
      const r = await service.resolve(TENANT, 'Анне');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Анна' });
    });

    it('ФИО в косвенном падеже: «Анне Богачевой» → «Анна Богачева»', async () => {
      personFindMany.mockResolvedValueOnce([{ userId: 'u1', name: 'Анна Богачева' }]);
      const r = await service.resolve(TENANT, 'Анне Богачевой');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Анна Богачева' });
    });

    it('часть имени по токену: «Иван» → «Иванов Иван»', async () => {
      personFindMany.mockResolvedValueOnce([{ userId: 'u1', name: 'Иванов Иван' }]);
      const r = await service.resolve(TENANT, 'Иван');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Иванов Иван' });
    });

    it('две разные персоны со склоняемыми именами не схлопываются ложно', async () => {
      membershipFindMany.mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }]);
      personFindMany.mockResolvedValueOnce([
        { userId: 'u1', name: 'Сергей' },
        { userId: 'u2', name: 'Андрей' },
      ]);
      const r = await service.resolve(TENANT, 'Сергею');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Сергей' });
    });

    it('крутилка tracker.assigneeMatchMaxEdits=0 отключает склонения (точное совпадение)', async () => {
      const cfg = {
        getDynamic: vi.fn(async () => 0),
      } as unknown as TypedConfigService;
      const strict = new AssigneeResolverService(prisma, cfg);
      const r = await strict.resolve(TENANT, 'Сергею');
      expect(r).toEqual({ kind: 'not_found' });
      const exact = await strict.resolve(TENANT, 'Сергей');
      expect(exact).toEqual({ kind: 'resolved', userId: 'u1', name: 'Сергей' });
    });
  });
});
