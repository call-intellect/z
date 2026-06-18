import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

import { MyCustomerRiskController } from './my-customer-risk.controller';

describe('MyCustomerRiskController', () => {
  const req = { user: { id: 'user-1' } } as unknown as Request;
  const query = { limit: 20 } as never;

  it('self-scope: listForResponsible вызывается с resolved selfPersonId, не из query', async () => {
    const commitments = {
      resolveSelfPerson: vi.fn().mockResolvedValue({ id: 'person-mine' }),
    };
    const customerRisk = {
      listForResponsible: vi.fn().mockResolvedValue({
        items: [],
        criticalCount: 0,
        warningCount: 0,
      }),
    };
    const ctrl = new MyCustomerRiskController(commitments as never, customerRisk as never);

    await ctrl.list('org1', req, query);

    expect(commitments.resolveSelfPerson).toHaveBeenCalledWith({
      tenantId: 'org1',
      userId: 'user-1',
    });
    expect(customerRisk.listForResponsible).toHaveBeenCalledWith({
      tenantId: 'org1',
      selfPersonId: 'person-mine',
      query,
    });
  });

  it('нет Person (no_person) → пустой список 200, без утечки', async () => {
    const commitments = {
      resolveSelfPerson: vi.fn().mockRejectedValue(
        new ForbiddenException({
          ok: false,
          error: { code: 'no_person', message: 'нет Person' },
        }),
      ),
    };
    const customerRisk = {
      listForResponsible: vi.fn(),
    };
    const ctrl = new MyCustomerRiskController(commitments as never, customerRisk as never);

    const res = await ctrl.list('org1', req, query);
    expect(res).toEqual({ items: [], criticalCount: 0, warningCount: 0 });
    expect(customerRisk.listForResponsible).not.toHaveBeenCalled();
  });

  it('другая Forbidden-ошибка (не no_person) — пробрасывается', async () => {
    const commitments = {
      resolveSelfPerson: vi.fn().mockRejectedValue(
        new ForbiddenException({
          ok: false,
          error: { code: 'forbidden_role', message: 'нет доступа' },
        }),
      ),
    };
    const customerRisk = { listForResponsible: vi.fn() };
    const ctrl = new MyCustomerRiskController(commitments as never, customerRisk as never);

    await expect(ctrl.list('org1', req, query)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('нет tenantId → BadRequest', async () => {
    const commitments = { resolveSelfPerson: vi.fn() };
    const customerRisk = { listForResponsible: vi.fn() };
    const ctrl = new MyCustomerRiskController(commitments as never, customerRisk as never);
    await expect(ctrl.list(undefined, req, query)).rejects.toThrow();
    expect(commitments.resolveSelfPerson).not.toHaveBeenCalled();
  });
});
