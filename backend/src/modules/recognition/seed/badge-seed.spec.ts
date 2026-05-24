import type { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BASE_BADGES, seedBaseBadges } from './badge-seed';

describe('seedBaseBadges', () => {
  beforeEach(() => vi.clearAllMocks());

  it('создаёт все 5 базовых бейджей в пустой БД', async () => {
    const created: Array<{ slug: string }> = [];
    const prisma = {
      badge: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }: { data: { slug: string } }) => {
          created.push({ slug: data.slug });
          return data;
        }),
      },
    } as unknown as PrismaClient;
    const stats = await seedBaseBadges(prisma);
    expect(stats.inserted).toBe(BASE_BADGES.length);
    expect(stats.skipped).toBe(0);
    expect(created.map((c) => c.slug).sort()).toEqual(
      [...BASE_BADGES].map((b) => b.slug).sort(),
    );
  });

  it('пропускает существующие — admin-edited защита', async () => {
    const prisma = {
      badge: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'badge-1', slug: 'ideator', name: 'X' }),
        create: vi.fn(),
      },
    } as unknown as PrismaClient;
    const stats = await seedBaseBadges(prisma);
    expect(stats.inserted).toBe(0);
    expect(stats.skipped).toBe(BASE_BADGES.length);
    expect(prisma.badge.create).not.toHaveBeenCalled();
  });

  it('каталог содержит все 5 нужных slug', () => {
    const slugs = BASE_BADGES.map((b) => b.slug);
    expect(slugs).toEqual([
      'ideator',
      'expert',
      'helper',
      'aligned',
      'consistent',
    ]);
  });

  it('у каждого badge есть валидный condition', () => {
    for (const b of BASE_BADGES) {
      expect(b.condition).toHaveProperty('type');
      expect(b.condition).toHaveProperty('threshold');
      expect(typeof b.condition.threshold).toBe('number');
    }
  });
});
