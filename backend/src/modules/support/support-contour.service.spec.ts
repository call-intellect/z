import { describe, expect, it, vi, beforeEach } from 'vitest';

import { SupportContourService } from './services/support-contour.service';

describe('SupportContourService', () => {
  const VENDOR = 'vendor-org-1';
  const GROUP = 'grp-support';

  let prismaStub: {
    knowledgeGroupMember: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    person: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    ideaBlock: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    ideaBlockAccess: { create: ReturnType<typeof vi.fn> };
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let accessStub: {
    getVendorOrgId: ReturnType<typeof vi.fn>;
    getSupportGroupId: ReturnType<typeof vi.fn>;
  };
  let resolverStub: { invalidateAll: ReturnType<typeof vi.fn> };
  let embeddingsStub: { embedQuery: ReturnType<typeof vi.fn> };
  let svc: SupportContourService;

  beforeEach(() => {
    prismaStub = {
      knowledgeGroupMember: {
        findUnique: vi.fn(),
        create: vi.fn(),
        deleteMany: vi.fn(),
        findMany: vi.fn(),
      },
      person: { findFirst: vi.fn(), findMany: vi.fn() },
      ideaBlock: { findFirst: vi.fn(), create: vi.fn() },
      ideaBlockAccess: { create: vi.fn() },
      $executeRawUnsafe: vi.fn(),
    };
    accessStub = {
      getVendorOrgId: vi.fn(async () => VENDOR),
      getSupportGroupId: vi.fn(async () => GROUP),
    };
    resolverStub = { invalidateAll: vi.fn() };
    embeddingsStub = { embedQuery: vi.fn(async () => null) };

    svc = new SupportContourService(
      prismaStub as unknown as never,
      accessStub as unknown as never,
      resolverStub as unknown as never,
      embeddingsStub as unknown as never,
    );
  });

  describe('addAgent', () => {
    it('создаёт KnowledgeGroupMember(source=manual) + invalidateAll', async () => {
      prismaStub.person.findFirst.mockResolvedValue({ id: 'p-1' });
      prismaStub.knowledgeGroupMember.findUnique.mockResolvedValue(null);
      prismaStub.knowledgeGroupMember.create.mockResolvedValue({});

      const res = await svc.addAgent('p-1');

      expect(res).toEqual({ ok: true, added: true });
      expect(prismaStub.knowledgeGroupMember.create).toHaveBeenCalledWith({
        data: { groupId: GROUP, personId: 'p-1', source: 'manual' },
      });
      expect(resolverStub.invalidateAll).toHaveBeenCalledTimes(1);
    });

    it('идемпотентен: уже член → added=false, без create', async () => {
      prismaStub.person.findFirst.mockResolvedValue({ id: 'p-1' });
      prismaStub.knowledgeGroupMember.findUnique.mockResolvedValue({
        personId: 'p-1',
      });

      const res = await svc.addAgent('p-1');

      expect(res).toEqual({ ok: true, added: false });
      expect(prismaStub.knowledgeGroupMember.create).not.toHaveBeenCalled();
    });

    it('контур не инициализирован (нет группы) → BadRequest', async () => {
      accessStub.getSupportGroupId.mockResolvedValueOnce(null);
      await expect(svc.addAgent('p-1')).rejects.toMatchObject({
        response: { error: { code: 'SUPPORT_CONTOUR_NOT_INITIALIZED' } },
      });
    });
  });

  describe('removeAgent', () => {
    it('удаляет членство + invalidateAll', async () => {
      prismaStub.knowledgeGroupMember.deleteMany.mockResolvedValue({ count: 1 });
      const res = await svc.removeAgent('p-1');
      expect(res).toEqual({ ok: true, removed: true });
      expect(resolverStub.invalidateAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('seedContour', () => {
    it('новая пара → created (block + access создаются)', async () => {
      prismaStub.ideaBlock.findFirst.mockResolvedValue(null);
      prismaStub.ideaBlock.create.mockResolvedValue({ id: 'blk-1' });
      embeddingsStub.embedQuery.mockResolvedValue(null);
      prismaStub.ideaBlockAccess.create.mockResolvedValue({});

      const res = await svc.seedContour([
        { question: 'Как сбросить пароль?', answer: 'Через ссылку восстановления.' },
      ]);

      expect(res).toEqual({ created: 1, skipped: 0 });
      expect(prismaStub.ideaBlock.create).toHaveBeenCalledTimes(1);
      const createArg = prismaStub.ideaBlock.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(createArg.data.status).toBe('canonical');
      expect(createArg.data.signalType).toBe('expertise');
      expect(createArg.data.tenantId).toBe(VENDOR);
      expect(prismaStub.ideaBlockAccess.create).toHaveBeenCalledWith({
        data: { blockId: 'blk-1', groupId: GROUP, tenantId: VENDOR, via: 'closed' },
      });
    });

    it('идемпотентность: пара с существующим хэшем → skipped, без create', async () => {
      prismaStub.ideaBlock.findFirst.mockResolvedValue({ id: 'existing' });

      const res = await svc.seedContour([
        { question: 'Как сбросить пароль?', answer: 'Через ссылку восстановления.' },
      ]);

      expect(res).toEqual({ created: 0, skipped: 1 });
      expect(prismaStub.ideaBlock.create).not.toHaveBeenCalled();
      expect(prismaStub.ideaBlockAccess.create).not.toHaveBeenCalled();
    });

    it('пишет embedding raw-SQL, если вектор есть', async () => {
      prismaStub.ideaBlock.findFirst.mockResolvedValue(null);
      prismaStub.ideaBlock.create.mockResolvedValue({ id: 'blk-2' });
      embeddingsStub.embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
      prismaStub.ideaBlockAccess.create.mockResolvedValue({});

      await svc.seedContour([{ question: 'q', answer: 'a' }]);

      expect(prismaStub.$executeRawUnsafe).toHaveBeenCalledWith(
        'UPDATE "IdeaBlock" SET embedding = $1::vector(1536) WHERE id = $2',
        '[0.1,0.2,0.3]',
        'blk-2',
      );
    });

    it('одна плохая пара не валит батч (try/catch per pair)', async () => {
      prismaStub.ideaBlock.findFirst.mockResolvedValue(null);
      prismaStub.ideaBlock.create
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ id: 'blk-ok' });
      embeddingsStub.embedQuery.mockResolvedValue(null);
      prismaStub.ideaBlockAccess.create.mockResolvedValue({});

      const res = await svc.seedContour([
        { question: 'bad', answer: 'x' },
        { question: 'good', answer: 'y' },
      ]);

      expect(res).toEqual({ created: 1, skipped: 1 });
    });
  });
});
