/**
 * Clones=Roles Ф5 (2026-05-25) — unit-проверка, что `buildForRole`
 * прокидывает `dataClass='internal'` в Prisma create.
 *
 * Не покрываем полный pipeline (LLM, embeddings, метрики) — это
 * integration-test scope. Сюда — только DataClass-аспект.
 */

import { describe, expect, it, vi } from 'vitest';


import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import type { DataClassPolicyService } from './dataclass-policy.service';
import { ExecutablePersonaBuildService } from './executable-persona-build.service';

describe('ExecutablePersonaBuildService.buildForRole — dataClass propagation', () => {
  it('создаёт ExecutablePersona(scope=role) с dataClass=internal', async () => {
    const createSpy = vi.fn(async (q: { data: Record<string, unknown> }) => ({
      id: 'p-1',
      ...q.data,
      status: q.data.status,
    }));
    const updateManySpy = vi.fn(async () => ({ count: 0 }));

    const prisma = {
      personRole: {
        findMany: vi.fn(async () => [
          { personId: 'person-A' },
          { personId: 'person-B' },
        ]),
      },
      skillProfile: {
        findMany: vi.fn(async () => [
          {
            id: 'sp-A',
            person: { name: 'A', relationship: 'employee' },
            traits: [
              {
                id: 't1',
                category: 'cat',
                statement: 's',
                confidence: 'high',
                observationCount: 5,
              },
              {
                id: 't2',
                category: 'cat',
                statement: 's',
                confidence: 'high',
                observationCount: 5,
              },
              {
                id: 't3',
                category: 'cat',
                statement: 's',
                confidence: 'high',
                observationCount: 5,
              },
            ],
          },
          {
            id: 'sp-B',
            person: { name: 'B', relationship: 'employee' },
            traits: [
              {
                id: 't4',
                category: 'cat',
                statement: 's',
                confidence: 'high',
                observationCount: 5,
              },
              {
                id: 't5',
                category: 'cat',
                statement: 's',
                confidence: 'high',
                observationCount: 5,
              },
            ],
          },
        ]),
      },
      role: {
        findUnique: vi.fn(async () => ({ name: 'Маркетолог' })),
      },
      executablePersona: {
        findFirst: vi.fn(async () => ({ version: 1 })),
        updateMany: updateManySpy,
        create: createSpy,
      },
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          executablePersona: {
            updateMany: updateManySpy,
            create: createSpy,
          },
        }),
      ),
    } as unknown as PrismaService;

    const cfg = {
      persona: { minTraits: 3, roleAggMinPersons: 1 },
      aiFeatures: { promptInjectionGuardEnabled: false },
    } as unknown as TypedConfigService;

    const llm = {
      call: vi.fn(async () => ({
        text: 'A'.repeat(200),
        modelUsed: 'mock',
        tier: 'primary',
        inputTokens: 10,
        outputTokens: 20,
      })),
    } as unknown as LlmRouterService;

    const metrics = {
      observePersonaBuildDuration: vi.fn(),
      incCoreSpecialistCards: vi.fn(),
      incExecutablePersonaSnapshot: vi.fn(),
      setExecutablePersonaSnapshotLag: vi.fn(),
      incCoreSpecialistLlmTokens: vi.fn(),
    } as unknown as BusinessMetricsService;

    const dataClassPolicy = {
      derive: vi.fn(() => ({
        dataClass: 'internal' as const,
        subjectPersonId: null,
        audit: {},
      })),
      compareWithLegacy: vi.fn(),
    } as unknown as DataClassPolicyService;

    const svc = new ExecutablePersonaBuildService(
      prisma,
      cfg,
      llm,
      metrics,
      dataClassPolicy,
    );

    // tenantTopLabel требует prisma.org.findUnique — мокаем минимально.
    (prisma as unknown as { org: unknown }).org = {
      findUnique: vi.fn(async () => null),
    };

    const result = await svc.buildForRole({
      tenantId: 't-1',
      roleId: 'role-1',
      triggerReason: 'manual',
    });

    expect(result).not.toBeNull();
    expect(createSpy).toHaveBeenCalledTimes(1);
    const createArg = (createSpy.mock.calls[0] as unknown as [
      { data: { scope: string; scopeRefId: string; dataClassAudit?: unknown } },
    ])[0];
    expect(createArg.data.scope).toBe('role');
    expect(createArg.data.scopeRefId).toBe('role-1');
    // dataClassAudit JSON содержит результат derive (kind='executable_persona').
    expect(createArg.data.dataClassAudit).toBeDefined();

    // updateMany должен погасить pending_rebuild И active.
    expect(updateManySpy).toHaveBeenCalled();
    const updateArg = (updateManySpy.mock.calls[0] as unknown as [
      { where: { status: { in: string[] } } },
    ])[0];
    expect(updateArg.where.status.in).toContain('active');
    expect(updateArg.where.status.in).toContain('pending_rebuild');

    // derive должен быть вызван с правильным kind.
    expect(dataClassPolicy.derive).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ kind: 'executable_persona' }),
      }),
    );
  });

  it('Ф7 (H) — схлопывает черты с одинаковым conceptId (3 носителя → 1 черта)', async () => {
    const createSpy = vi.fn(async (q: { data: Record<string, unknown> }) => ({
      id: 'p-1',
      ...q.data,
      status: q.data.status,
    }));
    const updateManySpy = vi.fn(async () => ({ count: 0 }));

    const prisma = {
      personRole: {
        findMany: vi.fn(async () => [
          { personId: 'person-A' },
          { personId: 'person-B' },
          { personId: 'person-C' },
        ]),
      },
      skillProfile: {
        findMany: vi.fn(async () => [
          {
            id: 'sp-A',
            person: { name: 'A', relationship: 'employee' },
            traits: [
              // общий концепт — представитель с max observationCount (3)
              {
                id: 'shared-A',
                category: 'cat',
                statement: 's',
                confidence: 'medium',
                observationCount: 3,
                conceptId: 'concept-1',
              },
              // уникальная черта A (свой conceptId)
              {
                id: 'uniq-A',
                category: 'cat',
                statement: 's',
                confidence: 'high',
                observationCount: 1,
                conceptId: 'concept-A',
              },
            ],
          },
          {
            id: 'sp-B',
            person: { name: 'B', relationship: 'employee' },
            traits: [
              {
                id: 'shared-B',
                category: 'cat',
                statement: 's',
                confidence: 'high',
                observationCount: 1,
                conceptId: 'concept-1',
              },
              // уникальная черта B без conceptId (не схлопывается)
              {
                id: 'uniq-B',
                category: 'cat',
                statement: 's',
                confidence: 'low',
                observationCount: 1,
                conceptId: null,
              },
            ],
          },
          {
            id: 'sp-C',
            person: { name: 'C', relationship: 'employee' },
            traits: [
              {
                id: 'shared-C',
                category: 'cat',
                statement: 's',
                confidence: 'low',
                observationCount: 2,
                conceptId: 'concept-1',
              },
              {
                id: 'uniq-C',
                category: 'cat',
                statement: 's',
                confidence: 'high',
                observationCount: 4,
                conceptId: 'concept-C',
              },
            ],
          },
        ]),
      },
      role: {
        findUnique: vi.fn(async () => ({ name: 'Маркетолог' })),
      },
      executablePersona: {
        findFirst: vi.fn(async () => ({ version: 1 })),
        updateMany: updateManySpy,
        create: createSpy,
      },
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          executablePersona: {
            updateMany: updateManySpy,
            create: createSpy,
          },
        }),
      ),
    } as unknown as PrismaService;

    const cfg = {
      persona: { minTraits: 3, roleAggMinPersons: 1 },
      aiFeatures: { promptInjectionGuardEnabled: false },
    } as unknown as TypedConfigService;

    const llm = {
      call: vi.fn(async () => ({
        text: 'A'.repeat(200),
        modelUsed: 'mock',
        tier: 'primary',
        inputTokens: 10,
        outputTokens: 20,
      })),
    } as unknown as LlmRouterService;

    const metrics = {
      observePersonaBuildDuration: vi.fn(),
      incCoreSpecialistCards: vi.fn(),
      incExecutablePersonaSnapshot: vi.fn(),
      setExecutablePersonaSnapshotLag: vi.fn(),
      incCoreSpecialistLlmTokens: vi.fn(),
    } as unknown as BusinessMetricsService;

    const dataClassPolicy = {
      derive: vi.fn(() => ({
        dataClass: 'internal' as const,
        subjectPersonId: null,
        audit: {},
      })),
      compareWithLegacy: vi.fn(),
    } as unknown as DataClassPolicyService;

    const svc = new ExecutablePersonaBuildService(
      prisma,
      cfg,
      llm,
      metrics,
      dataClassPolicy,
    );

    (prisma as unknown as { org: unknown }).org = {
      findUnique: vi.fn(async () => null),
    };

    const result = await svc.buildForRole({
      tenantId: 't-1',
      roleId: 'role-1',
      triggerReason: 'manual',
    });

    expect(result).not.toBeNull();
    expect(createSpy).toHaveBeenCalledTimes(1);

    const createArg = (createSpy.mock.calls[0] as unknown as [
      { data: { includedTraitIds: string[]; builtFromTraitsCount: number } },
    ])[0];
    const includedIds = createArg.data.includedTraitIds;

    // concept-1 представлен РОВНО одной чертой — представитель shared-A
    // (max observationCount=3 среди shared-A/B/C).
    const sharedIds = includedIds.filter((id) =>
      id.startsWith('shared-'),
    );
    expect(sharedIds).toEqual(['shared-A']);

    // Все остальные (разные conceptId + null) — на месте.
    expect(includedIds).toContain('uniq-A');
    expect(includedIds).toContain('uniq-B'); // conceptId=null, не схлопнут
    expect(includedIds).toContain('uniq-C');

    // Итог: 1 (shared) + 3 (uniq) = 4 черты, без дублей по concept-1.
    expect(includedIds).toHaveLength(4);
    expect(createArg.data.builtFromTraitsCount).toBe(4);

    // В compile уходит дедуплицированный список (длина traits = 4).
    expect(llm.call).toHaveBeenCalledTimes(1);
  });
});
