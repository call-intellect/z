import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { KnowledgeEmbeddingService } from './embedding.service';
import { EntityResolutionService } from './entity-resolution.service';

function buildPrismaMock() {
  return {
    person: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    entity: {
      findMany: vi.fn(),
    },
    participant: {
      findUnique: vi.fn(),
    },
  };
}

function buildSvc(prismaMock: ReturnType<typeof buildPrismaMock>) {
  const embed = {
    embedEntityNames: vi.fn(),
    embedQuery: vi.fn(),
  } as unknown as KnowledgeEmbeddingService;
  return new EntityResolutionService(prismaMock as unknown as PrismaService, embed);
}

describe('EntityResolutionService — attribution (unit, Фаза 1)', () => {
  describe('linkPersonEntity', () => {
    it('линкует каждый Person к СВОему person-Entity по имени, не к первому', async () => {
      const prismaMock = buildPrismaMock();
      const svc = buildSvc(prismaMock);

      prismaMock.entity.findMany.mockResolvedValue([
        { id: 'ent-anna', canonicalName: 'Анна' },
        { id: 'ent-boris', canonicalName: 'Борис' },
      ]);

      prismaMock.person.findUnique.mockResolvedValueOnce({
        tenantId: 't1',
        name: 'Борис',
        entityId: null,
        deletedAt: null,
      });
      await svc.linkPersonEntity({ tenantId: 't1', personId: 'p-boris' });
      expect(prismaMock.person.update).toHaveBeenCalledWith({
        where: { id: 'p-boris' },
        data: { entityId: 'ent-boris', entityTenantId: 't1' },
      });

      prismaMock.person.findUnique.mockResolvedValueOnce({
        tenantId: 't1',
        name: 'Анна',
        entityId: null,
        deletedAt: null,
      });
      await svc.linkPersonEntity({ tenantId: 't1', personId: 'p-anna' });
      expect(prismaMock.person.update).toHaveBeenCalledWith({
        where: { id: 'p-anna' },
        data: { entityId: 'ent-anna', entityTenantId: 't1' },
      });
    });
  });

  describe('ensurePersonEntity', () => {
    it('создаёт person-Entity, заполняет Person.entityId, возвращает entity.id', async () => {
      const prismaMock = buildPrismaMock();
      const svc = buildSvc(prismaMock);

      prismaMock.person.findUnique.mockResolvedValue({
        tenantId: 't1',
        name: 'Настя',
        entityId: null,
        deletedAt: null,
      });
      const findOrCreateSpy = vi.spyOn(svc, 'findOrCreateEntity').mockResolvedValue({
        entity: { id: 'ent-new' } as never,
        created: true,
      });

      const result = await svc.ensurePersonEntity({
        tenantId: 't1',
        personId: 'p1',
      });

      expect(findOrCreateSpy).toHaveBeenCalledWith({
        tenantId: 't1',
        type: 'person',
        name: 'Настя',
      });
      expect(prismaMock.person.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { entityId: 'ent-new', entityTenantId: 't1' },
      });
      expect(result).toBe('ent-new');
    });

    it('идемпотентен: entityId уже задан → no-op, findOrCreateEntity не вызван', async () => {
      const prismaMock = buildPrismaMock();
      const svc = buildSvc(prismaMock);

      prismaMock.person.findUnique.mockResolvedValue({
        tenantId: 't1',
        name: 'Настя',
        entityId: 'ent-existing',
        deletedAt: null,
      });
      const findOrCreateSpy = vi.spyOn(svc, 'findOrCreateEntity');

      const result = await svc.ensurePersonEntity({
        tenantId: 't1',
        personId: 'p1',
      });

      expect(result).toBe('ent-existing');
      expect(findOrCreateSpy).not.toHaveBeenCalled();
      expect(prismaMock.person.update).not.toHaveBeenCalled();
    });
  });

  describe('resolveSubjectEntityId', () => {
    it('(a) authorUserId → Person по userId → entityId', async () => {
      const prismaMock = buildPrismaMock();
      const svc = buildSvc(prismaMock);

      prismaMock.person.findFirst.mockResolvedValue({
        id: 'pp1',
        entityId: 'e1',
      });

      const result = await svc.resolveSubjectEntityId('t1', {
        authorUserId: 'u1',
      });
      expect(result).toBe('e1');
      expect(prismaMock.person.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 't1', userId: 'u1', deletedAt: null },
        select: { id: true, entityId: true },
      });
    });

    it('(b) speakerParticipantId → Participant.personId → Person.entityId', async () => {
      const prismaMock = buildPrismaMock();
      const svc = buildSvc(prismaMock);

      prismaMock.participant.findUnique.mockResolvedValue({
        personId: 'pp1',
        userId: null,
      });
      prismaMock.person.findUnique.mockResolvedValue({
        id: 'pp1',
        entityId: 'e2',
        deletedAt: null,
      });

      const result = await svc.resolveSubjectEntityId('t1', {
        speakerParticipantId: 'p1',
      });
      expect(result).toBe('e2');
    });

    it('(c) speakerName → resolvePersonByHint → ensurePersonEntity создаёт e3', async () => {
      const prismaMock = buildPrismaMock();
      const svc = buildSvc(prismaMock);

      vi.spyOn(svc, 'resolvePersonByHint').mockResolvedValue('pp3');
      prismaMock.person.findUnique.mockResolvedValue({
        id: 'pp3',
        entityId: null,
      });
      const ensureSpy = vi.spyOn(svc, 'ensurePersonEntity').mockResolvedValue('e3');

      const result = await svc.resolveSubjectEntityId('t1', {
        speakerName: 'Настя',
      });
      expect(result).toBe('e3');
      expect(ensureSpy).toHaveBeenCalledWith({
        tenantId: 't1',
        personId: 'pp3',
      });
    });

    it('(d) ничего не нашлось → null', async () => {
      const prismaMock = buildPrismaMock();
      const svc = buildSvc(prismaMock);

      prismaMock.person.findFirst.mockResolvedValue(null);
      prismaMock.participant.findUnique.mockResolvedValue(null);
      vi.spyOn(svc, 'resolvePersonByHint').mockResolvedValue(null);

      const result = await svc.resolveSubjectEntityId('t1', {
        authorUserId: 'u-x',
        speakerParticipantId: 'p-x',
        speakerName: 'Неизвестный',
      });
      expect(result).toBeNull();
    });
  });
});
