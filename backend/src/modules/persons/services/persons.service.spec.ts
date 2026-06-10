import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuditLogService } from '../../audit/audit-log.service';

import { PersonsService } from './persons.service';

describe('PersonsService.create — дружелюбный дедуп по email (Ф4)', () => {
  let prismaMock: {
    membership: { findUnique: ReturnType<typeof vi.fn> };
    person: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  };
  let auditMock: { log: ReturnType<typeof vi.fn> };
  let svc: PersonsService;

  beforeEach(() => {
    prismaMock = {
      membership: { findUnique: vi.fn() },
      person: { findFirst: vi.fn(), update: vi.fn(async () => ({})) },
      $queryRaw: vi.fn(async () => []),
      $transaction: vi.fn(async () => 'new-id'),
    };
    auditMock = { log: vi.fn() };
    svc = new PersonsService(
      prismaMock as unknown as PrismaService,
      auditMock as unknown as AuditLogService,
    );
  });

  it('Кейс 1 — ручной дубль email → 409, до создания не доходит', async () => {
    const body = { name: 'Дубль', email: 'dup@x.test' };
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'p-existing', userId: 'u-other' }]);

    await expect(
      svc.create({ tenantId: 'org-1', userId: 'u-actor', body: body as never }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('Кейс 2 — linkUserId + безличная карточка с тем же email → линковка, не новая', async () => {
    const body = { name: 'Иван', email: 'ivan@x.test', linkUserId: 'u-link' };
    prismaMock.membership.findUnique.mockResolvedValueOnce({ userId: 'u-link' });
    prismaMock.person.findFirst.mockResolvedValueOnce(null);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'p-imp', userId: null }]);
    const getSpy = vi.spyOn(svc, 'get').mockResolvedValue({ id: 'p-imp' } as never);

    const result = await svc.create({
      tenantId: 'org-1',
      userId: 'u-actor',
      body: body as never,
    });

    expect(result).toEqual({ id: 'p-imp' });
    expect(prismaMock.person.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p-imp' }, data: { userId: 'u-link' } }),
    );
    expect(auditMock.log).toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(getSpy).toHaveBeenCalled();
  });

  it('Кейс 3 — email задан, дубля нет → доходит до создания', async () => {
    const body = { name: 'Новый', email: 'new@x.test' };
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    vi.spyOn(svc, 'get').mockResolvedValue({ id: 'created' } as never);

    const result = await svc.create({
      tenantId: 'org-1',
      userId: 'u-actor',
      body: body as never,
    });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(result).toEqual({ id: 'created' });
  });
});
