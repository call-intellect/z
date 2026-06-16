import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RbacService } from '../rbac/rbac.service';

import { CapabilitiesService } from './capabilities.service';
import { CAPABILITIES } from './dto/capability-override.dto';

const ORG = 'org_1';
const ACTOR = 'actor_1';
const TARGET = 'target_1';

const ownerCtx = { role: 'owner', visibility: 'open', isSuperAdmin: false, fetchedAt: Date.now() };
const managerCtx = {
  role: 'manager',
  visibility: 'open',
  isSuperAdmin: false,
  fetchedAt: Date.now(),
};

describe('CapabilitiesService (Фаза 5)', () => {
  let prisma: {
    employeeCapabilityOverride: {
      findMany: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    membership: { findUnique: ReturnType<typeof vi.fn> };
  };
  let rbac: { loadContext: ReturnType<typeof vi.fn> };
  let service: CapabilitiesService;

  beforeEach(() => {
    prisma = {
      employeeCapabilityOverride: {
        findMany: vi.fn(),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
      membership: { findUnique: vi.fn() },
    };
    rbac = { loadContext: vi.fn() };
    service = new CapabilitiesService(
      prisma as unknown as PrismaService,
      rbac as unknown as RbacService,
    );
  });

  describe('getEffectiveOverrides', () => {
    it('возвращает только активные override как map capability→effect', async () => {
      prisma.employeeCapabilityOverride.findMany.mockResolvedValue([
        { capability: 'memory:regulations', effect: 'allow' },
        { capability: 'feature:graph', effect: 'deny' },
      ]);

      const map = await service.getEffectiveOverrides(TARGET, ORG);

      expect(map).toEqual({
        'memory:regulations': 'allow',
        'feature:graph': 'deny',
      });
      const findArg = prisma.employeeCapabilityOverride.findMany.mock.calls[0]?.[0];
      expect(findArg?.where.revokedAt).toBeNull();
      expect(findArg?.where.OR).toEqual([
        { expiresAt: null },
        { expiresAt: { gt: expect.any(Date) } },
      ]);
    });

    it('игнорирует capability вне канонического списка', async () => {
      prisma.employeeCapabilityOverride.findMany.mockResolvedValue([
        { capability: 'memory:entities', effect: 'allow' },
        { capability: 'billing:seats', effect: 'allow' },
      ]);

      const map = await service.getEffectiveOverrides(TARGET, ORG);

      expect(map).toEqual({ 'memory:entities': 'allow' });
    });
  });

  describe('listForMember', () => {
    it('возвращает строку по каждой возможности; effect только для активного override', async () => {
      rbac.loadContext.mockResolvedValue(ownerCtx);
      prisma.membership.findUnique.mockResolvedValue({ id: 'm1' });
      const expires = new Date('2099-01-01T00:00:00.000Z');
      prisma.employeeCapabilityOverride.findMany.mockResolvedValue([
        { capability: 'feature:graph', effect: 'deny', expiresAt: expires },
      ]);

      const items = await service.listForMember(ORG, ACTOR, TARGET);

      expect(items).toHaveLength(CAPABILITIES.length);
      const graph = items.find((i) => i.capability === 'feature:graph');
      expect(graph).toEqual({
        capability: 'feature:graph',
        effect: 'deny',
        expiresAt: expires.toISOString(),
      });
      const others = items.filter((i) => i.capability !== 'feature:graph');
      for (const o of others) {
        expect(o.effect).toBeNull();
        expect(o.expiresAt).toBeNull();
      }
    });

    it('не-owner/admin actor → Forbidden', async () => {
      rbac.loadContext.mockResolvedValue(managerCtx);
      await expect(service.listForMember(ORG, ACTOR, TARGET)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('не участник Org → BadRequest', async () => {
      rbac.loadContext.mockResolvedValue(ownerCtx);
      prisma.membership.findUnique.mockResolvedValue(null);
      await expect(service.listForMember(ORG, ACTOR, TARGET)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('upsert', () => {
    it('вызывает prisma.upsert с верным where (unique-ключ) и effect', async () => {
      rbac.loadContext.mockResolvedValue(ownerCtx);
      prisma.membership.findUnique.mockResolvedValue({ id: 'm1' });
      prisma.employeeCapabilityOverride.upsert.mockResolvedValue({
        capability: 'memory:entities',
        effect: 'allow',
        expiresAt: null,
      });

      const item = await service.upsert(ORG, ACTOR, TARGET, 'memory:entities', {
        effect: 'allow',
      });

      expect(item).toEqual({ capability: 'memory:entities', effect: 'allow', expiresAt: null });
      const arg = prisma.employeeCapabilityOverride.upsert.mock.calls[0]?.[0];
      expect(arg).toBeDefined();
      expect(arg!.where).toEqual({
        tenantId_grantedToUserId_capability: {
          tenantId: ORG,
          grantedToUserId: TARGET,
          capability: 'memory:entities',
        },
      });
      expect(arg!.create.effect).toBe('allow');
      expect(arg!.create.grantedById).toBe(ACTOR);
      expect(arg!.update.effect).toBe('allow');
      expect(arg!.update.revokedAt).toBeNull();
      expect(arg!.update.revokedBy).toBeNull();
    });

    it('неизвестная capability → BadRequest', async () => {
      rbac.loadContext.mockResolvedValue(ownerCtx);
      await expect(
        service.upsert(ORG, ACTOR, TARGET, 'totally:unknown', { effect: 'allow' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.employeeCapabilityOverride.upsert).not.toHaveBeenCalled();
    });

    it('не-owner/admin actor → Forbidden', async () => {
      rbac.loadContext.mockResolvedValue(managerCtx);
      await expect(
        service.upsert(ORG, ACTOR, TARGET, 'memory:entities', { effect: 'deny' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.employeeCapabilityOverride.upsert).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('вызывает deleteMany с верным where', async () => {
      rbac.loadContext.mockResolvedValue(ownerCtx);
      prisma.employeeCapabilityOverride.deleteMany.mockResolvedValue({ count: 1 });

      const res = await service.remove(ORG, ACTOR, TARGET, 'panel:operations');

      expect(res).toEqual({ ok: true });
      expect(prisma.employeeCapabilityOverride.deleteMany).toHaveBeenCalledWith({
        where: {
          tenantId: ORG,
          grantedToUserId: TARGET,
          capability: 'panel:operations',
        },
      });
    });
  });
});
