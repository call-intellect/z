/**
 * Юнит-тесты `PersonsService.quickCreate` (Calendar MVP Фаза P4).
 *
 * Покрытие:
 *   - dedup по email: возвращает existing вместо создания;
 *   - dedup по name (case-insensitive) когда email пуст;
 *   - создаёт нового Person если ничего не найдено;
 *   - email нормализуется в lower-case и trimmed;
 *   - email отсутствует → сохраняется пустая строка в БД, в ответе — null.
 */
import { describe, expect, it, vi } from 'vitest';

import { PersonsService } from './persons.service';

const auditStub = { log: vi.fn(async () => undefined) } as never;
const cfgStub = { persons: { useAppointment: false } } as never;

function buildPrismaStub(opts: {
  findFirst?: (args: unknown) => Promise<unknown>;
  create?: (args: unknown) => Promise<unknown>;
}) {
  const stub = {
    person: {
      findFirst: vi.fn(opts.findFirst ?? (async () => null)),
      create: vi.fn(opts.create ?? (async () => ({}))),
    },
  };
  return stub;
}

describe('PersonsService.quickCreate', () => {
  it('dedup по email: возвращает existing вместо создания', async () => {
    const prisma = buildPrismaStub({
      findFirst: async () => ({
        id: 'p-existing',
        name: 'Иван Иванов',
        email: 'ivan@x.test',
      }),
    });
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);
    const res = await svc.quickCreate({
      tenantId: 'org-1',
      userId: 'u-1',
      body: { name: 'Иван Иванов', email: 'ivan@x.test' },
    });
    expect(res).toEqual({
      personId: 'p-existing',
      name: 'Иван Иванов',
      email: 'ivan@x.test',
    });
    expect(prisma.person.create).not.toHaveBeenCalled();
  });

  it('email нормализуется в lower-case при dedup-запросе', async () => {
    const prisma = buildPrismaStub({
      findFirst: async () => ({
        id: 'p-existing',
        name: 'Иван',
        email: 'ivan@x.test',
      }),
    });
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);
    await svc.quickCreate({
      tenantId: 'org-1',
      userId: 'u-1',
      // ZodValidation уже нормализовал бы, но проверим стойкость сервиса.
      body: { name: 'Иван', email: '  IVAN@x.TEST  ' },
    });
    expect(prisma.person.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'org-1',
          email: 'ivan@x.test',
          deletedAt: null,
        }),
      }),
    );
  });

  it('создаёт нового Person если dedup не сработал', async () => {
    const prisma = buildPrismaStub({
      findFirst: async () => null,
      create: async () => ({
        id: 'p-new',
        name: 'Новый Контакт',
        email: 'new@x.test',
      }),
    });
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);
    const res = await svc.quickCreate({
      tenantId: 'org-1',
      userId: 'u-1',
      body: { name: 'Новый Контакт', email: 'new@x.test' },
    });
    expect(prisma.person.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'org-1',
          name: 'Новый Контакт',
          email: 'new@x.test',
          relationship: 'external',
          userId: null,
        }),
      }),
    );
    expect(res).toEqual({
      personId: 'p-new',
      name: 'Новый Контакт',
      email: 'new@x.test',
    });
  });

  it('без email: ищет по точному совпадению name (case-insensitive)', async () => {
    const prisma = buildPrismaStub({
      findFirst: async () => null,
      create: async () => ({
        id: 'p-no-email',
        name: 'Контакт Без Почты',
        email: '',
      }),
    });
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);
    const res = await svc.quickCreate({
      tenantId: 'org-1',
      userId: 'u-1',
      body: { name: 'Контакт Без Почты' },
    });
    expect(prisma.person.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'org-1',
          email: '',
          deletedAt: null,
          name: { equals: 'Контакт Без Почты', mode: 'insensitive' },
        }),
      }),
    );
    expect(prisma.person.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: '',
          relationship: 'external',
        }),
      }),
    );
    // email в ответе → null (а не пустая строка).
    expect(res.email).toBeNull();
    expect(res.personId).toBe('p-no-email');
  });

  it('без email: возвращает существующий Person если есть с тем же name', async () => {
    const prisma = buildPrismaStub({
      findFirst: async () => ({
        id: 'p-existing-no-email',
        name: 'Контакт Без Почты',
        email: '',
      }),
    });
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);
    const res = await svc.quickCreate({
      tenantId: 'org-1',
      userId: 'u-1',
      body: { name: 'Контакт Без Почты' },
    });
    expect(res).toEqual({
      personId: 'p-existing-no-email',
      name: 'Контакт Без Почты',
      email: null,
    });
    expect(prisma.person.create).not.toHaveBeenCalled();
  });
});
