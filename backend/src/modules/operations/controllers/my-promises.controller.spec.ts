/**
 * Юнит-тесты `MyPromisesController` (Ф9 graceful no_person,
 * `plans/tz/2026-06-04-razblokirovka-konveyera.md`).
 *
 * Покрытие:
 *   - list() при ForbiddenException code='no_person' → {items:[]} (200);
 *   - list() при other ForbiddenException → пробрасывается;
 *   - mark() при no_person → пробрасывается (403, нужен реальный subject).
 */
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { MyPromisesController } from './my-promises.controller';

function noPersonError(): ForbiddenException {
  return new ForbiddenException({
    ok: false,
    error: { code: 'no_person', message: 'нет Person' },
  });
}

function req(userId: string | undefined): Request {
  return { user: userId ? { id: userId } : undefined } as unknown as Request;
}

describe('MyPromisesController.list — graceful no_person', () => {
  it('no_person → {items:[], openQuestions:[]} (200), listMine не вызывается', async () => {
    const svc = {
      resolveSelfPerson: vi.fn(async () => {
        throw noPersonError();
      }),
      listMine: vi.fn(),
    };
    const ctrl = new MyPromisesController(svc as never);

    const res = await ctrl.list('org-1', req('u-1'), { status: 'open', limit: 50 });

    expect(res).toEqual({ items: [], openQuestions: [] });
    expect(svc.listMine).not.toHaveBeenCalled();
  });

  it('есть Person → делегирует в listMine (items + openQuestions)', async () => {
    const svc = {
      resolveSelfPerson: vi.fn(async () => ({ id: 'p-1' })),
      listMine: vi.fn(async () => ({
        items: [{ id: 'b1' }],
        openQuestions: [{ id: 'q1' }],
      })),
    };
    const ctrl = new MyPromisesController(svc as never);

    const res = await ctrl.list('org-1', req('u-1'), { status: 'open', limit: 50 });

    expect(svc.listMine).toHaveBeenCalledWith(
      expect.objectContaining({ selfPersonId: 'p-1', tenantId: 'org-1' }),
    );
    expect(res).toEqual({ items: [{ id: 'b1' }], openQuestions: [{ id: 'q1' }] });
  });

  it('другой ForbiddenException (не no_person) → пробрасывается', async () => {
    const other = new ForbiddenException({
      ok: false,
      error: { code: 'some_other', message: 'x' },
    });
    const svc = {
      resolveSelfPerson: vi.fn(async () => {
        throw other;
      }),
      listMine: vi.fn(),
    };
    const ctrl = new MyPromisesController(svc as never);

    await expect(
      ctrl.list('org-1', req('u-1'), { status: 'open', limit: 50 }),
    ).rejects.toBe(other);
  });
});

describe('MyPromisesController.mark — строгий (403 на no_person)', () => {
  it('no_person → ForbiddenException пробрасывается', async () => {
    const svc = {
      resolveSelfPerson: vi.fn(async () => {
        throw noPersonError();
      }),
      markMine: vi.fn(),
    };
    const ctrl = new MyPromisesController(svc as never);

    await expect(
      ctrl.mark('org-1', req('u-1'), 'b1', { status: 'fulfilled' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.markMine).not.toHaveBeenCalled();
  });
});
