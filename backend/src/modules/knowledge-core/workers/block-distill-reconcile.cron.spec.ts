import { describe, expect, it, vi } from 'vitest';

import { BlockDistillReconcileCron } from './block-distill-reconcile.cron';

/**
 * Аудит-баг Б4 (high, класс K7) — unit-гард реконсиляции застрявших
 * draft-блоков. Проверяет: stale draft → ре-enqueue distill; правильный
 * where-фильтр выборки (status='draft' + createdAt lt порог); gate-skip;
 * идемпотентность повторного прогона.
 *
 * Б36 [K7] — second pass: canonical-блоки в окне → ре-router.dispatch
 * (специалисты могли не запуститься, если dispatch упал после commit'а).
 */

const STALE_DRAFT_MS = 10 * 60 * 1000;
const CANONICAL_STALE_MS = 10 * 60 * 1000;
const CANONICAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function makeCron(args: {
  // draft-блоки по Org (первый проход)
  blocksByOrg: Record<string, Array<{ id: string }>>;
  // canonical-блоки по Org (второй проход, Б36)
  canonicalByOrg?: Record<
    string,
    Array<{ id: string; tenantId: string; signalType: string }>
  >;
  findManySpy?: ReturnType<typeof vi.fn>;
  enqueueSpy?: ReturnType<typeof vi.fn>;
  dispatchSpy?: ReturnType<typeof vi.fn>;
  gateThrows?: boolean;
  orgs?: Array<{ id: string }>;
}) {
  const orgs = args.orgs ?? Object.keys(args.blocksByOrg).map((id) => ({ id }));
  // Один findMany на ideaBlock обслуживает оба прохода: по where.status
  // выбираем draft- или canonical-набор.
  const findManySpy =
    args.findManySpy ??
    vi.fn(async (q: { where: { tenantId: string; status: string } }) => {
      if (q.where.status === 'canonical') {
        return args.canonicalByOrg?.[q.where.tenantId] ?? [];
      }
      return args.blocksByOrg[q.where.tenantId] ?? [];
    });
  const enqueueSpy = args.enqueueSpy ?? vi.fn(async () => undefined);
  const dispatchSpy =
    args.dispatchSpy ??
    vi.fn(async () => ({ dispatched: [], fanOutBeforeTrim: 0 }));

  const fakePrisma = {
    org: { findMany: async () => orgs },
    ideaBlock: { findMany: findManySpy },
  } as unknown as ConstructorParameters<typeof BlockDistillReconcileCron>[0];

  const fakeCoreQueue = {
    enqueueBlockDistill: enqueueSpy,
  } as unknown as ConstructorParameters<typeof BlockDistillReconcileCron>[1];

  const fakeGate = {
    checkOrThrow: vi.fn(async () => {
      if (args.gateThrows) throw new Error('worker_disabled_for_org');
    }),
  } as unknown as ConstructorParameters<typeof BlockDistillReconcileCron>[2];

  const fakeRouter = {
    dispatch: dispatchSpy,
  } as unknown as ConstructorParameters<typeof BlockDistillReconcileCron>[3];

  return {
    cron: new BlockDistillReconcileCron(
      fakePrisma,
      fakeCoreQueue,
      fakeGate,
      fakeRouter,
    ),
    findManySpy,
    enqueueSpy,
    dispatchSpy,
  };
}

describe('BlockDistillReconcileCron.runForAllOrgs', () => {
  it('stale draft-блоки → enqueueBlockDistill вызван по каждому', async () => {
    const { cron, enqueueSpy } = makeCron({
      blocksByOrg: { org_1: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }] },
    });

    const res = await cron.runForAllOrgs();

    expect(res.scannedOrgs).toBe(1);
    expect(res.staleDraft).toBe(3);
    expect(res.reEnqueued).toBe(3);
    expect(enqueueSpy).toHaveBeenCalledTimes(3);
    expect(enqueueSpy).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ delayMs: 0 }),
    );
    expect(enqueueSpy).toHaveBeenCalledWith(
      'b2',
      expect.objectContaining({ delayMs: 0 }),
    );
    expect(enqueueSpy).toHaveBeenCalledWith(
      'b3',
      expect.objectContaining({ delayMs: 0 }),
    );
  });

  it('выборка фильтрует status=draft + createdAt lt порог (свежие/non-draft не попадают)', async () => {
    const before = Date.now();
    const { cron, findManySpy, enqueueSpy } = makeCron({
      blocksByOrg: { org_1: [] }, // мок findMany возвращает пусто (всё отфильтровано)
    });

    await cron.runForAllOrgs();
    const after = Date.now();

    // Два прохода на Org: draft (первый call) + canonical (второй, Б36).
    expect(findManySpy).toHaveBeenCalledTimes(2);
    const callArg = findManySpy.mock.calls[0]![0] as {
      where: {
        tenantId: string;
        status: string;
        createdAt: { lt: Date };
      };
      take: number;
      orderBy: { createdAt: string };
    };
    expect(callArg.where.status).toBe('draft');
    expect(callArg.where.tenantId).toBe('org_1');
    // createdAt lt = (now - STALE_DRAFT_MS) — в пределах окна прогона.
    const lt = callArg.where.createdAt.lt.getTime();
    expect(lt).toBeGreaterThanOrEqual(before - STALE_DRAFT_MS - 50);
    expect(lt).toBeLessThanOrEqual(after - STALE_DRAFT_MS + 50);
    expect(callArg.orderBy.createdAt).toBe('asc');
    expect(callArg.take).toBeGreaterThan(0);
    // Пустая выборка → ничего не enqueue.
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('Б36: второй проход фильтрует status=canonical + updatedAt в окне (MAX_AGE, STALE)', async () => {
    const before = Date.now();
    const { cron, findManySpy, dispatchSpy } = makeCron({
      blocksByOrg: { org_1: [] },
      canonicalByOrg: { org_1: [] },
    });

    await cron.runForAllOrgs();
    const after = Date.now();

    // Второй call (индекс 1) — canonical-проход.
    const canonArg = findManySpy.mock.calls[1]![0] as {
      where: {
        tenantId: string;
        status: string;
        updatedAt: { gt: Date; lt: Date };
      };
      take: number;
      orderBy: { updatedAt: string };
    };
    expect(canonArg.where.status).toBe('canonical');
    expect(canonArg.where.tenantId).toBe('org_1');
    const gt = canonArg.where.updatedAt.gt.getTime();
    const lt = canonArg.where.updatedAt.lt.getTime();
    // gt = now - MAX_AGE; lt = now - STALE.
    expect(gt).toBeGreaterThanOrEqual(before - CANONICAL_MAX_AGE_MS - 50);
    expect(gt).toBeLessThanOrEqual(after - CANONICAL_MAX_AGE_MS + 50);
    expect(lt).toBeGreaterThanOrEqual(before - CANONICAL_STALE_MS - 50);
    expect(lt).toBeLessThanOrEqual(after - CANONICAL_STALE_MS + 50);
    expect(canonArg.orderBy.updatedAt).toBe('asc');
    expect(canonArg.take).toBeGreaterThan(0);
    // Пустая выборка → dispatch не вызван.
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('Б36: canonical-блоки без проекций (в окне) → router.dispatch вызван по каждому', async () => {
    const { cron, dispatchSpy } = makeCron({
      blocksByOrg: { org_1: [] },
      canonicalByOrg: {
        org_1: [
          { id: 'c1', tenantId: 'org_1', signalType: 'decision' },
          { id: 'c2', tenantId: 'org_1', signalType: 'pain' },
        ],
      },
    });

    const res = await cron.runForAllOrgs();

    expect(res.staleCanonical).toBe(2);
    expect(res.reDispatched).toBe(2);
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', signalType: 'decision' }),
    );
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c2', signalType: 'pain' }),
    );
  });

  it('Б36: router.dispatch падает на одном блоке → проход не валится, reDispatched честный', async () => {
    const dispatchSpy = vi
      .fn()
      .mockResolvedValueOnce({ dispatched: [], fanOutBeforeTrim: 0 })
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce({ dispatched: [], fanOutBeforeTrim: 0 });
    const { cron } = makeCron({
      blocksByOrg: { org_1: [] },
      canonicalByOrg: {
        org_1: [
          { id: 'c1', tenantId: 'org_1', signalType: 'decision' },
          { id: 'c2', tenantId: 'org_1', signalType: 'pain' },
          { id: 'c3', tenantId: 'org_1', signalType: 'idea' },
        ],
      },
      dispatchSpy,
    });

    const res = await cron.runForAllOrgs();

    expect(res.staleCanonical).toBe(3);
    expect(res.reDispatched).toBe(2); // c2 упал — не зачтён, но проход дошёл до c3
    expect(dispatchSpy).toHaveBeenCalledTimes(3);
  });

  it('gate disabled (checkOrThrow кидает) → Org пропущен, enqueue не вызван', async () => {
    const { cron, findManySpy, enqueueSpy } = makeCron({
      blocksByOrg: { org_1: [{ id: 'b1' }] },
      gateThrows: true,
    });

    const res = await cron.runForAllOrgs();

    expect(res.scannedOrgs).toBe(1);
    expect(res.staleDraft).toBe(0);
    expect(res.reEnqueued).toBe(0);
    // Org за выключенным gate — findMany даже не вызывается.
    expect(findManySpy).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('идемпотентность: повторный прогон с теми же stale-блоками не падает и снова безопасно enqueue', async () => {
    const { cron, enqueueSpy } = makeCron({
      blocksByOrg: { org_1: [{ id: 'b1' }, { id: 'b2' }] },
    });

    const first = await cron.runForAllOrgs();
    const second = await cron.runForAllOrgs();

    expect(first.reEnqueued).toBe(2);
    expect(second.reEnqueued).toBe(2);
    // Повторный enqueue безопасен (jobId-дедуп BullMQ + skip not-draft в worker).
    expect(enqueueSpy).toHaveBeenCalledTimes(4);
  });

  it('enqueue падает на одном блоке → проход не валится, счётчик reEnqueued честный', async () => {
    const enqueueSpy = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce(undefined);
    const { cron } = makeCron({
      blocksByOrg: { org_1: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }] },
      enqueueSpy,
    });

    const res = await cron.runForAllOrgs();

    expect(res.staleDraft).toBe(3);
    expect(res.reEnqueued).toBe(2); // b2 упал — не зачтён, но проход дошёл до b3
    expect(enqueueSpy).toHaveBeenCalledTimes(3);
  });
});
