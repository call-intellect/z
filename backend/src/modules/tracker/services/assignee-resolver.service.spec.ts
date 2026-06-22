import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { SubjectMemoryService } from '../../probe/subject-memory/subject-memory.service';

import { AssigneeResolverService } from './assignee-resolver.service';

const TENANT = 'org_1';

describe('AssigneeResolverService.resolve', () => {
  let prisma: PrismaService;
  let service: AssigneeResolverService;
  let membershipFindMany: ReturnType<typeof vi.fn>;
  let personFindMany: ReturnType<typeof vi.fn>;
  let departmentFindMany: ReturnType<typeof vi.fn>;
  let roleFindMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    membershipFindMany = vi.fn(async () => [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]);
    personFindMany = vi.fn(async () => [
      { userId: 'u1', name: 'Айназ' },
      { userId: 'u2', name: 'Иван' },
    ]);
    departmentFindMany = vi.fn(async () => []);
    roleFindMany = vi.fn(async () => []);
    prisma = {
      membership: { findMany: membershipFindMany },
      person: { findMany: personFindMany },
      department: { findMany: departmentFindMany },
      role: { findMany: roleFindMany },
    } as unknown as PrismaService;
    service = new AssigneeResolverService(prisma);
  });

  it('1 точное совпадение → resolved (via name)', async () => {
    const r = await service.resolve(TENANT, 'Айназ');
    expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Айназ', via: 'name' });
  });

  it('точное равенство приоритетнее частичного', async () => {
    personFindMany.mockResolvedValueOnce([
      { userId: 'u1', name: 'Иван' },
      { userId: 'u2', name: 'Иванов Иван' },
    ]);
    const r = await service.resolve(TENANT, 'Иван');
    expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Иван', via: 'name' });
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
        expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Сергей', via: 'name' });
      },
    );

    it('именительный «Сергей» по-прежнему резолвится', async () => {
      const r = await service.resolve(TENANT, 'Сергей');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Сергей', via: 'name' });
    });

    it('НЕ путает разные имена: «Инне» при сотруднике «Анна» → not_found', async () => {
      personFindMany.mockResolvedValueOnce([{ userId: 'u1', name: 'Анна' }]);
      const r = await service.resolve(TENANT, 'Инне');
      expect(r).toEqual({ kind: 'not_found' });
    });

    it('дательный «Анне» при сотруднике «Анна» → resolved', async () => {
      personFindMany.mockResolvedValueOnce([{ userId: 'u1', name: 'Анна' }]);
      const r = await service.resolve(TENANT, 'Анне');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Анна', via: 'name' });
    });

    it('ФИО в косвенном падеже: «Анне Богачевой» → «Анна Богачева»', async () => {
      personFindMany.mockResolvedValueOnce([{ userId: 'u1', name: 'Анна Богачева' }]);
      const r = await service.resolve(TENANT, 'Анне Богачевой');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Анна Богачева', via: 'name' });
    });

    it('часть имени по токену: «Иван» → «Иванов Иван»', async () => {
      personFindMany.mockResolvedValueOnce([{ userId: 'u1', name: 'Иванов Иван' }]);
      const r = await service.resolve(TENANT, 'Иван');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Иванов Иван', via: 'name' });
    });

    it('две разные персоны со склоняемыми именами не схлопываются ложно', async () => {
      membershipFindMany.mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }]);
      personFindMany.mockResolvedValueOnce([
        { userId: 'u1', name: 'Сергей' },
        { userId: 'u2', name: 'Андрей' },
      ]);
      const r = await service.resolve(TENANT, 'Сергею');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Сергей', via: 'name' });
    });

    it('крутилка tracker.assigneeMatchMaxEdits=0 отключает склонения (точное совпадение)', async () => {
      const cfg = {
        getDynamic: vi.fn(async () => 0),
      } as unknown as TypedConfigService;
      const strict = new AssigneeResolverService(prisma, cfg);
      const r = await strict.resolve(TENANT, 'Сергею');
      expect(r).toEqual({ kind: 'not_found' });
      const exact = await strict.resolve(TENANT, 'Сергей');
      expect(exact).toEqual({ kind: 'resolved', userId: 'u1', name: 'Сергей', via: 'name' });
    });
  });

  describe('retrieve-before-ask через SubjectMemory (Ф A4)', () => {
    function makeMemory(rule: {
      kind: string;
      ruleText: string;
      similarity: number;
    } | null): {
      findApplicableRule: ReturnType<typeof vi.fn>;
    } {
      return { findApplicableRule: vi.fn(async () => rule) };
    }

    it('правило disambiguation «отдел дизайна → Анна» резолвит в Анну (via memory)', async () => {
      membershipFindMany.mockResolvedValue([{ userId: 'u1' }]);
      personFindMany.mockResolvedValue([{ userId: 'u1', name: 'Анна' }]);
      const memory = makeMemory({ kind: 'disambiguation', ruleText: 'Анна', similarity: 0.9 });
      const svc = new AssigneeResolverService(
        prisma,
        undefined,
        memory as unknown as SubjectMemoryService,
      );
      const r = await svc.resolve(TENANT, 'отдел дизайна');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Анна', via: 'memory' });
    });

    it('findApplicableRule вызывается с правильным tenantId и исходным текстом', async () => {
      membershipFindMany.mockResolvedValue([{ userId: 'u1' }]);
      personFindMany.mockResolvedValue([{ userId: 'u1', name: 'Анна' }]);
      const memory = makeMemory({ kind: 'disambiguation', ruleText: 'Анна', similarity: 0.9 });
      const svc = new AssigneeResolverService(
        prisma,
        undefined,
        memory as unknown as SubjectMemoryService,
      );
      await svc.resolve(TENANT, 'отдел дизайна');
      expect(memory.findApplicableRule).toHaveBeenCalledWith(TENANT, 'отдел дизайна');
    });

    it('прямой матч по имени имеет приоритет — память не вызывается', async () => {
      const memory = makeMemory({ kind: 'disambiguation', ruleText: 'Иван', similarity: 0.9 });
      const svc = new AssigneeResolverService(
        prisma,
        undefined,
        memory as unknown as SubjectMemoryService,
      );
      const r = await svc.resolve(TENANT, 'Айназ');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Айназ', via: 'name' });
      expect(memory.findApplicableRule).not.toHaveBeenCalled();
    });

    it('правило не типа disambiguation игнорируется', async () => {
      membershipFindMany.mockResolvedValue([{ userId: 'u1' }]);
      personFindMany.mockResolvedValue([{ userId: 'u1', name: 'Анна' }]);
      const memory = makeMemory({ kind: 'term', ruleText: 'Анна', similarity: 0.9 });
      const svc = new AssigneeResolverService(
        prisma,
        undefined,
        memory as unknown as SubjectMemoryService,
      );
      const r = await svc.resolve(TENANT, 'неизвестный');
      expect(r.kind).not.toBe('resolved');
    });
  });

  describe('детект коллективного адресата (Ф A4)', () => {
    it('правила нет, человека нет, но есть отдел → collective с departmentId', async () => {
      departmentFindMany.mockResolvedValueOnce([{ id: 'dep_1', name: 'Дизайн' }]);
      const memory = { findApplicableRule: vi.fn(async () => null) };
      const svc = new AssigneeResolverService(
        prisma,
        undefined,
        memory as unknown as SubjectMemoryService,
      );
      const r = await svc.resolve(TENANT, 'отдел дизайна');
      expect(r).toEqual({ kind: 'collective', label: 'отдел дизайна', departmentId: 'dep_1' });
    });

    it('совпадение по роли → collective с roleId', async () => {
      roleFindMany.mockResolvedValueOnce([{ id: 'role_1', name: 'Маркетолог' }]);
      const r = await service.resolve(TENANT, 'маркетолог');
      expect(r).toEqual({ kind: 'collective', label: 'маркетолог', roleId: 'role_1' });
    });

    it('ключевое слово без отдела/роли → collective без id (label = исходный текст)', async () => {
      const r = await service.resolve(TENANT, 'вся команда');
      expect(r).toEqual({ kind: 'collective', label: 'вся команда' });
    });

    it('нет ни человека, ни отдела/роли, ни ключевого слова → not_found', async () => {
      const r = await service.resolve(TENANT, 'Пётр');
      expect(r).toEqual({ kind: 'not_found' });
    });

    it('detect не вызывается без памяти если найден человек', async () => {
      const r = await service.resolve(TENANT, 'Айназ');
      expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Айназ', via: 'name' });
      expect(departmentFindMany).not.toHaveBeenCalled();
      expect(roleFindMany).not.toHaveBeenCalled();
    });
  });
});
