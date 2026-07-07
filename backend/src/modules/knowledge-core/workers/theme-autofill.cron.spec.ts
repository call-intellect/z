import { describe, expect, it, vi } from 'vitest';

import { ThemeAutofillCron } from './theme-autofill.cron';

interface Opts {
  enabled: boolean;
  threshold: number;
  scanWindowDays: number;
  maxPerScan: number;
  dedupeSimilarity: number;
}

const DEFAULT_OPTS: Opts = {
  enabled: true,
  threshold: 0.72,
  scanWindowDays: 14,
  maxPerScan: 50,
  dedupeSimilarity: 0.97,
};

function makeCron(args: {
  opts?: Partial<Opts>;
  orgs?: Array<{ id: string }>;
  themesByOrg?: Record<string, Array<{ id: string }>>;
  fillResult?: { added: number; addedBlockIds: string[] };
  fillSpy?: ReturnType<typeof vi.fn>;
  themeFindManySpy?: ReturnType<typeof vi.fn>;
  incSpy?: ReturnType<typeof vi.fn>;
  gateThrows?: boolean;
}) {
  const opts: Opts = { ...DEFAULT_OPTS, ...args.opts };
  const orgs = args.orgs ?? [{ id: 'org-1' }];
  const themesByOrg = args.themesByOrg ?? { 'org-1': [{ id: 'theme-1' }] };

  const themeFindManySpy =
    args.themeFindManySpy ??
    vi.fn(async (q: { where: { tenantId: string } }) => themesByOrg[q.where.tenantId] ?? []);

  const fillSpy =
    args.fillSpy ??
    vi.fn(async () => args.fillResult ?? { added: 0, addedBlockIds: [] as string[] });

  const incSpy = args.incSpy ?? vi.fn(() => undefined);

  const fakePrisma = {
    org: { findMany: async () => orgs },
    theme: { findMany: themeFindManySpy },
  } as unknown as ConstructorParameters<typeof ThemeAutofillCron>[0];

  const fakeCfg = {
    themeAutofillOpts: vi.fn(async () => opts),
  } as unknown as ConstructorParameters<typeof ThemeAutofillCron>[1];

  const fakeFill = {
    fillTheme: fillSpy,
  } as unknown as ConstructorParameters<typeof ThemeAutofillCron>[2];

  const fakeGate = {
    checkOrThrow: vi.fn(async () => {
      if (args.gateThrows) throw new Error('gate disabled');
    }),
  } as unknown as ConstructorParameters<typeof ThemeAutofillCron>[3];

  const fakeMetrics = {
    incThemeAutofillAdded: incSpy,
  } as unknown as ConstructorParameters<typeof ThemeAutofillCron>[4];

  const cron = new ThemeAutofillCron(fakePrisma, fakeCfg, fakeFill, fakeGate, fakeMetrics);
  return { cron, fillSpy, themeFindManySpy, incSpy };
}

describe('ThemeAutofillCron', () => {
  it('kill-switch off → fillTheme НЕ вызван, метрика НЕ инкрементнута', async () => {
    const { cron, fillSpy, incSpy } = makeCron({ opts: { enabled: false } });

    const summary = await cron.runForAllOrgs();

    expect(fillSpy).not.toHaveBeenCalled();
    expect(incSpy).not.toHaveBeenCalled();
    expect(summary).toEqual({ scannedOrgs: 0, filledThemes: 0, addedTotal: 0 });
  });

  it('enabled → fillTheme вызван с themeId, метрика инкрементнута с count', async () => {
    const { cron, fillSpy, incSpy } = makeCron({
      opts: { enabled: true },
      orgs: [{ id: 'org-1' }],
      themesByOrg: { 'org-1': [{ id: 'theme-1' }] },
      fillResult: { added: 2, addedBlockIds: ['b1', 'b2'] },
    });

    await cron.runForAllOrgs();

    expect(fillSpy).toHaveBeenCalledTimes(1);
    expect(fillSpy).toHaveBeenCalledWith(expect.objectContaining({ themeId: 'theme-1' }));
    expect(incSpy).toHaveBeenCalledWith(expect.objectContaining({ count: 2 }));
  });

  it('gate.checkOrThrow бросает для Org → тема не сканируется (fillTheme НЕ вызван)', async () => {
    const { cron, fillSpy, incSpy } = makeCron({
      opts: { enabled: true },
      orgs: [{ id: 'org-1' }],
      themesByOrg: { 'org-1': [{ id: 'theme-1' }] },
      gateThrows: true,
    });

    await cron.runForAllOrgs();

    expect(fillSpy).not.toHaveBeenCalled();
    expect(incSpy).not.toHaveBeenCalled();
  });

  it('theme.findMany вызван с where origin=user, status=active', async () => {
    const { cron, themeFindManySpy } = makeCron({
      opts: { enabled: true },
      orgs: [{ id: 'org-1' }],
      themesByOrg: { 'org-1': [{ id: 'theme-1' }] },
      fillResult: { added: 1, addedBlockIds: ['b1'] },
    });

    await cron.runForAllOrgs();

    expect(themeFindManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ origin: 'user', status: 'active' }),
      }),
    );
  });
});
