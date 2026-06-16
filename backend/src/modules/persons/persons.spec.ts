import { describe, expect, it, vi } from 'vitest';

import { CreatePersonSchema } from './dto/persons.dto';
import { PersonsService } from './services/persons.service';

const prismaStub = {} as never;
const auditStub = {} as never;
const cfgStubFor = (useAppointment: boolean) => ({ persons: { useAppointment } }) as never;

describe('PersonsService — feature-flag USE_APPOINTMENT_FOR_PERSON_ROLES', () => {
  it('cfg.persons.useAppointment=false → useAppointment=false (читаем из PersonRole)', () => {
    const svc = new PersonsService(prismaStub, auditStub, cfgStubFor(false));
    const flag = (svc as unknown as { useAppointment: boolean }).useAppointment;
    expect(flag).toBe(false);
  });

  it('cfg.persons.useAppointment=true → useAppointment=true (читаем из Appointment)', () => {
    const svc = new PersonsService(prismaStub, auditStub, cfgStubFor(true));
    const flag = (svc as unknown as { useAppointment: boolean }).useAppointment;
    expect(flag).toBe(true);
  });
});

describe.skip('PersonsService — CRUD (требует мок Prisma)', () => {
  it('TODO: покрыть CRUD + PersonRole-temporal + EntityLink', () => {});
});

describe('CreatePersonSchema — email опционален (2026-06-03)', () => {
  it('тело без email валидно (инлайн-создание по имени)', () => {
    const r = CreatePersonSchema.safeParse({ name: 'Никитося' });
    expect(r.success).toBe(true);
  });

  it('тело с email тоже валидно (форма «Новый сотрудник»)', () => {
    const r = CreatePersonSchema.safeParse({
      name: 'Никитося',
      email: 'tozix@yandex.ru',
    });
    expect(r.success).toBe(true);
  });

  it('пустое имя по-прежнему отвергается', () => {
    const r = CreatePersonSchema.safeParse({ name: '' });
    expect(r.success).toBe(false);
  });
});

describe('PersonsService.create — дефолт email при отсутствии', () => {
  it('без email → в БД пишется email="" (колонка non-null)', async () => {
    const auditMock = { log: vi.fn() } as never;
    let capturedData: { name?: string; email?: string } | undefined;
    const tx = {
      person: {
        create: vi.fn(async ({ data }: { data: { name: string; email: string } }) => {
          capturedData = data;
          return { id: 'p1' };
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    } as never;
    const svc = new PersonsService(prisma, auditMock, cfgStubFor(false));
    vi.spyOn(svc, 'get').mockResolvedValue({ id: 'p1' } as never);

    await svc.create({
      tenantId: 't1',
      userId: 'u1',
      body: { name: 'Никитося' } as never,
    });

    expect(capturedData?.email).toBe('');
    expect(capturedData?.name).toBe('Никитося');
  });
});
