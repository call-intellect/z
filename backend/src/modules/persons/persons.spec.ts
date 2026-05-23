import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersonsService } from './services/persons.service';

/**
 * Юнит-тесты `PersonsService`.
 *
 * TODO (Фаза 0a.4): покрыть CRUD + EntityLink-temporal через моки Prisma:
 *   - create Person + PersonRole + EntityLink executes_role/member_of;
 *   - PATCH roleId закрывает старую PersonRole и старую EntityLink, создаёт новые;
 *   - softDelete закрывает все исходящие/входящие EntityLink + PersonRole;
 *   - фильтр invitationStatus по последнему OrgInvitation;
 *   - tenant isolation.
 *
 * SBA α-8 wave 3 — добавлены smoke-тесты feature-flag
 * `USE_APPOINTMENT_FOR_PERSON_ROLES`: проверяем что `useAppointment`
 * корректно резолвится из ENV.
 */

const prismaStub = {} as never;
const auditStub = {} as never;

describe('PersonsService — feature-flag USE_APPOINTMENT_FOR_PERSON_ROLES', () => {
  const originalEnv = process.env.USE_APPOINTMENT_FOR_PERSON_ROLES;

  beforeEach(() => {
    delete process.env.USE_APPOINTMENT_FOR_PERSON_ROLES;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.USE_APPOINTMENT_FOR_PERSON_ROLES;
    } else {
      process.env.USE_APPOINTMENT_FOR_PERSON_ROLES = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it('default (no ENV) → useAppointment=false (читаем из PersonRole)', () => {
    const svc = new PersonsService(prismaStub, auditStub);
    // приватное поле — обращаемся через unknown-каст.
    const flag = (svc as unknown as { useAppointment: boolean }).useAppointment;
    expect(flag).toBe(false);
  });

  it('ENV="true" → useAppointment=true (читаем из Appointment)', () => {
    process.env.USE_APPOINTMENT_FOR_PERSON_ROLES = 'true';
    const svc = new PersonsService(prismaStub, auditStub);
    const flag = (svc as unknown as { useAppointment: boolean }).useAppointment;
    expect(flag).toBe(true);
  });

  it('ENV="false" → useAppointment=false', () => {
    process.env.USE_APPOINTMENT_FOR_PERSON_ROLES = 'false';
    const svc = new PersonsService(prismaStub, auditStub);
    const flag = (svc as unknown as { useAppointment: boolean }).useAppointment;
    expect(flag).toBe(false);
  });

  it('ENV="garbage" → useAppointment=false (только строгое "true")', () => {
    process.env.USE_APPOINTMENT_FOR_PERSON_ROLES = 'yes';
    const svc = new PersonsService(prismaStub, auditStub);
    const flag = (svc as unknown as { useAppointment: boolean }).useAppointment;
    expect(flag).toBe(false);
  });
});

describe.skip('PersonsService — CRUD (требует мок Prisma)', () => {
  it('TODO: покрыть CRUD + PersonRole-temporal + EntityLink', () => {
    // см. план 2026-05-21-phase-0a-data-model-and-graph-infra.md §7-§10
  });
});
