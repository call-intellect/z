import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import {
  decide,
  patchEnableShippedFlags,
  type ExistingSetting,
} from './patch-enable-shipped-flags';

describe('decide', () => {
  it('запись отсутствует → skip-absent', () => {
    expect(decide(null)).toBe('skip-absent');
  });

  it('value=false + updatedBy=null → update', () => {
    const existing: ExistingSetting = { value: false, updatedBy: null };
    expect(decide(existing)).toBe('update');
  });

  it('value=true → skip-already-true', () => {
    const existing: ExistingSetting = { value: true, updatedBy: null };
    expect(decide(existing)).toBe('skip-already-true');
  });

  it('updatedBy != null → skip-admin-edited (уважаем override)', () => {
    const existing: ExistingSetting = { value: false, updatedBy: 'user-1' };
    expect(decide(existing)).toBe('skip-admin-edited');
  });

  it('admin перевёл в true → skip-already-true (already-true имеет приоритет)', () => {
    const existing: ExistingSetting = { value: true, updatedBy: 'user-1' };
    expect(decide(existing)).toBe('skip-already-true');
  });

  it('не-boolean seed-значение → не трогаем', () => {
    const existing: ExistingSetting = { value: 'shadow', updatedBy: null };
    expect(decide(existing)).toBe('skip-already-true');
  });
});

function buildPrisma(byKey: Record<string, ExistingSetting | null>) {
  const update = vi.fn(async () => ({}));
  const prisma = {
    adminSetting: {
      findUnique: vi.fn(async (args: { where: { key: string } }) => byKey[args.where.key] ?? null),
      update,
    },
  };
  return prisma;
}

describe('patchEnableShippedFlags', () => {
  it('все false+updatedBy=null → все updated', async () => {
    const prisma = buildPrisma({
      'feature.tables_text_to_schema': { value: false, updatedBy: null },
      'knowledge.curationAutotuneEnabled': { value: false, updatedBy: null },
    });

    const stats = await patchEnableShippedFlags(prisma as unknown as PrismaClient);

    expect(stats.updated).toBe(2);
    expect(prisma.adminSetting.update).toHaveBeenCalledTimes(2);
  });

  it('идемпотентность: все already-true → 0 updated', async () => {
    const prisma = buildPrisma({
      'feature.tables_text_to_schema': { value: true, updatedBy: null },
      'knowledge.curationAutotuneEnabled': { value: true, updatedBy: null },
    });

    const stats = await patchEnableShippedFlags(prisma as unknown as PrismaClient);

    expect(stats.updated).toBe(0);
    expect(stats.skippedAlreadyTrue).toBe(2);
    expect(prisma.adminSetting.update).not.toHaveBeenCalled();
  });

  it('admin-edited и absent не трогаются', async () => {
    const prisma = buildPrisma({
      'feature.tables_text_to_schema': { value: false, updatedBy: 'u-1' },
      'knowledge.curationAutotuneEnabled': null,
    });

    const stats = await patchEnableShippedFlags(prisma as unknown as PrismaClient);

    expect(stats.updated).toBe(0);
    expect(stats.skippedAdminEdited).toBe(1);
    expect(stats.skippedAbsent).toBe(1);
    expect(prisma.adminSetting.update).not.toHaveBeenCalled();
  });
});
