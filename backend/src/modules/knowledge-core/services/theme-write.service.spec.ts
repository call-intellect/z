import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { KnowledgeEmbeddingService } from './embedding.service';
import { ThemeWriteService } from './theme-write.service';

describe('ThemeWriteService', () => {
  let prisma: {
    theme: {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    themeIdeaBlock: {
      upsert: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    themeEntity: {
      upsert: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    themeExclusion: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let embeddings: { embedQuery: ReturnType<typeof vi.fn> };
  let svc: ThemeWriteService;

  beforeEach(() => {
    prisma = {
      theme: {
        create: vi.fn().mockResolvedValue({ id: 'theme-1' }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      themeIdeaBlock: {
        upsert: vi.fn().mockResolvedValue(undefined),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      themeEntity: {
        upsert: vi.fn().mockResolvedValue(undefined),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      themeExclusion: {
        findFirst: vi.fn(),
        create: vi.fn().mockResolvedValue(undefined),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    };
    embeddings = { embedQuery: vi.fn() };
    svc = new ThemeWriteService(
      prisma as unknown as PrismaService,
      embeddings as unknown as KnowledgeEmbeddingService,
    );
  });

  it('createTheme создаёт тему с origin=user, visibility, createdByUserId и пишет embedding', async () => {
    embeddings.embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);

    const res = await svc.createTheme({
      tenantId: 't1',
      phrase: '  Онбординг новых клиентов  ',
      visibility: 'team',
      createdByUserId: 'user-1',
    });

    expect(res).toEqual({ id: 'theme-1' });
    expect(prisma.theme.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't1',
          origin: 'user',
          visibility: 'team',
          createdByUserId: 'user-1',
          status: 'active',
          name: 'Онбординг новых клиентов',
          description: 'Онбординг новых клиентов',
        }),
      }),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
  });

  it('createTheme без embedding НЕ пишет вектор', async () => {
    embeddings.embedQuery.mockResolvedValue(null);

    await svc.createTheme({
      tenantId: 't1',
      phrase: 'Тема',
      visibility: 'personal',
      createdByUserId: 'user-1',
    });

    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('pin (block) вызывает themeIdeaBlock.upsert с addedVia:manual', async () => {
    await svc.pin({
      tenantId: 't1',
      themeId: 'theme-1',
      kind: 'block',
      objectId: 'blk-1',
    });

    expect(prisma.themeExclusion.deleteMany).toHaveBeenCalled();
    expect(prisma.themeIdeaBlock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          themeId: 'theme-1',
          blockId: 'blk-1',
          tenantId: 't1',
          addedVia: 'manual',
        }),
      }),
    );
  });

  it('unpin (block) идемпотентен: первый прогон создаёт exclusion, второй — нет', async () => {
    prisma.themeExclusion.findFirst.mockResolvedValueOnce(null);
    await svc.unpin({
      tenantId: 't1',
      themeId: 'theme-1',
      kind: 'block',
      objectId: 'blk-1',
      createdByUserId: 'user-1',
    });

    expect(prisma.themeIdeaBlock.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          themeId: 'theme-1',
          blockId: 'blk-1',
          tenantId: 't1',
        }),
      }),
    );
    expect(prisma.themeExclusion.create).toHaveBeenCalledTimes(1);
    expect(prisma.themeExclusion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          themeId: 'theme-1',
          kind: 'block',
          blockId: 'blk-1',
          entityId: null,
          createdByUserId: 'user-1',
        }),
      }),
    );

    prisma.themeExclusion.findFirst.mockResolvedValueOnce({ id: 'excl-1' });
    await svc.unpin({
      tenantId: 't1',
      themeId: 'theme-1',
      kind: 'block',
      objectId: 'blk-1',
      createdByUserId: 'user-1',
    });

    expect(prisma.themeExclusion.create).toHaveBeenCalledTimes(1);
  });
});
