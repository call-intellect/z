import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AdminSettingsBootstrapService } from './admin-settings-bootstrap.service';

interface BuildOpts {
  rows?: Array<{ key: string; value: unknown }>;
  throwOnFindMany?: boolean;
}

function build(opts: BuildOpts = {}): {
  svc: AdminSettingsBootstrapService;
  hydrate: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
} {
  const hydrate = vi.fn();
  const findMany = vi.fn(async () => {
    if (opts.throwOnFindMany) throw new Error('db down');
    return opts.rows ?? [];
  });

  const prisma = {
    adminSetting: { findMany },
  } as unknown as PrismaService;

  const cfg = {
    hydrateSync: hydrate,
  } as unknown as TypedConfigService;

  return { svc: new AdminSettingsBootstrapService(prisma, cfg), hydrate, findMany };
}

describe('AdminSettingsBootstrapService', () => {
  it('onApplicationBootstrap читает строки и вызывает hydrateSync с правильным набором', async () => {
    const { svc, hydrate, findMany } = build({
      rows: [
        { key: 'limits.maxX', value: 99 },
        { key: 'retention.shareViewDays', value: 30 },
      ],
    });

    await svc.onApplicationBootstrap();

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledTimes(1);
    const arg = hydrate.mock.calls[0]?.[0] as Array<[string, unknown]>;
    expect(arg).toEqual([
      ['limits.maxX', 99],
      ['retention.shareViewDays', 30],
    ]);
  });

  it('при ошибке prisma.findMany — не падает, hydrateSync не вызывается', async () => {
    const { svc, hydrate } = build({ throwOnFindMany: true });

    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(hydrate).not.toHaveBeenCalled();
  });

  it('пустой набор настроек — hydrateSync вызывается с пустым массивом', async () => {
    const { svc, hydrate } = build({ rows: [] });
    await svc.onApplicationBootstrap();
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(hydrate.mock.calls[0]?.[0]).toEqual([]);
  });
});
