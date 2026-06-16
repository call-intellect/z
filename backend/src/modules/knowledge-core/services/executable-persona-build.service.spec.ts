import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import type { DataClassPolicyService } from './dataclass-policy.service';
import { ExecutablePersonaBuildService } from './executable-persona-build.service';

const makeCreateSpy = () =>
  vi.fn(async (q: { data: Record<string, unknown> }) => ({
    id: 'p-1',
    ...q.data,
    status: q.data.status,
  }));

const makeUpdateManySpy = () => vi.fn(async () => ({ count: 0 }));

function makePrismaBase(args: {
  createSpy: ReturnType<typeof makeCreateSpy>;
  updateManySpy: ReturnType<typeof makeUpdateManySpy>;
}) {
  return {
    org: { findUnique: vi.fn(async () => null) },
    personRole: { findMany: vi.fn(async (_q: unknown) => [] as unknown[]) },
    appointment: { findMany: vi.fn(async (_q: unknown) => [] as unknown[]) },
    skillTrait: { findMany: vi.fn(async (_q: unknown) => [] as unknown[]) },
    rolePrinciple: { findMany: vi.fn(async (_q: unknown) => [] as unknown[]) },
    practiceSkill: { findMany: vi.fn(async (_q: unknown) => [] as unknown[]) },
    role: { findUnique: vi.fn(async () => ({ name: 'Маркетолог' })) },
    executablePersona: {
      findFirst: vi.fn(async () => ({ version: 1 })),
      updateMany: args.updateManySpy,
      create: args.createSpy,
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        executablePersona: {
          findFirst: vi.fn(async () => null),
          updateMany: args.updateManySpy,
          create: args.createSpy,
        },
      }),
    ),
  };
}

function makeService(prisma: unknown) {
  const llm = {
    call: vi.fn(async () => ({
      text: 'A'.repeat(200),
      modelUsed: 'mock',
      tier: 'primary',
      inputTokens: 10,
      outputTokens: 20,
    })),
  };
  const metrics = {
    observePersonaBuildDuration: vi.fn(),
    incCoreSpecialistCards: vi.fn(),
    incExecutablePersonaSnapshot: vi.fn(),
    setExecutablePersonaSnapshotLag: vi.fn(),
    incCoreSpecialistLlmTokens: vi.fn(),
  };
  const dataClassPolicy = {
    derive: vi.fn(() => ({
      dataClass: 'internal' as const,
      subjectPersonId: null,
      audit: {},
    })),
    compareWithLegacy: vi.fn(),
  };
  const cfg = {
    persona: { minTraits: 3, roleAggMinPersons: 1 },
    aiFeatures: { promptInjectionGuardEnabled: false },
    dataClassPolicy: { enforcement: 'off' },
  };
  const svc = new ExecutablePersonaBuildService(
    prisma as PrismaService,
    cfg as unknown as TypedConfigService,
    llm as unknown as LlmRouterService,
    metrics as unknown as BusinessMetricsService,
    dataClassPolicy as unknown as DataClassPolicyService,
  );
  return { svc, llm, metrics, dataClassPolicy };
}

function getUserMessage(llm: { call: ReturnType<typeof vi.fn> }): string {
  const arg = llm.call.mock.calls[0]?.[0] as { userMessage: string } | undefined;
  if (!arg) throw new Error('llm.call не был вызван');
  return arg.userMessage;
}

const makeSkillTraitRow = (
  id: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  category: 'подход',
  statement: 'обычно сначала собирает данные, потом решает',
  confidence: 'high',
  observationCount: 5,
  conceptId: null,
  ...over,
});

const makeProfileRow = () => ({
  id: 'sp-1',
  status: 'active',
  tenantId: 't-1',
  person: {
    id: 'person-1',
    tenantId: 't-1',
    name: 'Анна',
    relationship: 'employee',
  },
  traits: [
    makeSkillTraitRow('skill-1'),
    makeSkillTraitRow('skill-2'),
    makeSkillTraitRow('skill-3'),
  ],
});

describe('ExecutablePersonaBuildService.buildForRole — dataClass propagation', () => {
  it('Раздел 7 — создаёт ExecutablePersona(scope=role) из ЕДИНСТВЕННОГО носителя с версионными полями + dataClass=internal', async () => {
    const createSpy = makeCreateSpy();
    const updateManySpy = makeUpdateManySpy();
    const prisma = {
      ...makePrismaBase({ createSpy, updateManySpy }),
      personRole: {
        findMany: vi.fn(async () => [
          { personId: 'person-A', validFrom: new Date('2026-01-01T00:00:00Z') },
        ]),
      },
      skillProfile: {
        findFirst: vi.fn(async () => ({
          id: 'sp-A',
          person: { name: 'A', relationship: 'employee' },
          traits: [
            makeSkillTraitRow('t1', { conceptId: undefined }),
            makeSkillTraitRow('t2', { conceptId: undefined }),
            makeSkillTraitRow('t3', { conceptId: undefined }),
          ],
        })),
      },
    };

    const { svc, dataClassPolicy } = makeService(prisma);

    const result = await svc.buildForRole({
      tenantId: 't-1',
      roleId: 'role-1',
      triggerReason: 'manual',
    });

    expect(result).not.toBeNull();
    expect(createSpy).toHaveBeenCalledTimes(1);
    const createArg = (
      createSpy.mock.calls[0] as unknown as [
        {
          data: {
            scope: string;
            scopeRefId: string;
            currentBearerPersonId: string;
            roleVersion: number;
            publicName: string;
            dataClassAudit?: unknown;
          };
        },
      ]
    )[0];
    expect(createArg.data.scope).toBe('role');
    expect(createArg.data.scopeRefId).toBe('role-1');
    expect(createArg.data.currentBearerPersonId).toBe('person-A');
    expect(createArg.data.roleVersion).toBe(1);
    expect(createArg.data.publicName).toContain('Клон');
    expect(createArg.data.dataClassAudit).toBeDefined();

    expect(dataClassPolicy.derive).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ kind: 'executable_persona' }),
      }),
    );
  });

  it('Ф7 (H) — схлопывает черты с одинаковым conceptId внутри профиля носителя (Раздел 7)', async () => {
    const createSpy = makeCreateSpy();
    const updateManySpy = makeUpdateManySpy();
    const prisma = {
      ...makePrismaBase({ createSpy, updateManySpy }),
      personRole: {
        findMany: vi.fn(async () => [
          { personId: 'person-A', validFrom: new Date('2026-01-01T00:00:00Z') },
        ]),
      },
      skillProfile: {
        findFirst: vi.fn(async () => ({
          id: 'sp-A',
          person: { name: 'A', relationship: 'employee' },
          traits: [
            makeSkillTraitRow('shared-hi', {
              observationCount: 3,
              conceptId: 'concept-1',
            }),
            makeSkillTraitRow('shared-lo', {
              confidence: 'low',
              observationCount: 1,
              conceptId: 'concept-1',
            }),
            makeSkillTraitRow('uniq-1', {
              observationCount: 2,
              conceptId: 'concept-2',
            }),
            makeSkillTraitRow('uniq-null', {
              confidence: 'low',
              observationCount: 1,
              conceptId: null,
            }),
          ],
        })),
      },
    };

    const { svc, llm } = makeService(prisma);

    const result = await svc.buildForRole({
      tenantId: 't-1',
      roleId: 'role-1',
      triggerReason: 'manual',
    });

    expect(result).not.toBeNull();
    expect(createSpy).toHaveBeenCalledTimes(1);

    const createArg = (
      createSpy.mock.calls[0] as unknown as [
        { data: { includedTraitIds: string[]; builtFromTraitsCount: number } },
      ]
    )[0];
    const includedIds = createArg.data.includedTraitIds;

    const sharedIds = includedIds.filter((id) => id.startsWith('shared-'));
    expect(sharedIds).toEqual(['shared-hi']);

    expect(includedIds).toContain('uniq-1');
    expect(includedIds).toContain('uniq-null');

    expect(includedIds).toHaveLength(3);
    expect(createArg.data.builtFromTraitsCount).toBe(3);

    expect(llm.call).toHaveBeenCalledTimes(1);
  });
});

describe('ExecutablePersonaBuildService — persona-compile v2 слои метода (ИНТ.1)', () => {
  it('слои заполнены → userMessage содержит «Ценности», «Принципы роли», «Процедуры», «Когда:»', async () => {
    const createSpy = makeCreateSpy();
    const updateManySpy = makeUpdateManySpy();
    const prisma = {
      ...makePrismaBase({ createSpy, updateManySpy }),
      skillProfile: { findUnique: vi.fn(async () => makeProfileRow()) },
      skillTrait: {
        findMany: vi.fn(async (q: { where: { layer: string } }) => {
          if (q.where.layer === 'value') {
            return [
              makeSkillTraitRow('val-1', {
                category: 'качество',
                statement: 'при дедлайне выбирает качество, а не скорость',
              }),
            ];
          }
          if (q.where.layer === 'motivation') {
            return [
              makeSkillTraitRow('mot-1', {
                category: 'автономия',
                statement: 'берётся за задачи, где сам выбирает способ',
              }),
            ];
          }
          if (q.where.layer === 'process_marker') {
            return [
              makeSkillTraitRow('mark-1', {
                category: 'варианты',
                statement: 'перед рекомендацией перечисляет варианты и критерий',
              }),
            ];
          }
          return [];
        }),
      },
      personRole: { findMany: vi.fn(async () => [{ roleId: 'role-1' }]) },
      rolePrinciple: {
        findMany: vi.fn(async () => [
          {
            id: 'rp-1',
            situation: 'срыв срока',
            statement: 'сначала эскалирует владельцу с 2 вариантами, потом режет scope',
            observationCount: 4,
            confidence: 'high',
          },
        ]),
      },
      practiceSkill: {
        findMany: vi.fn(async () => [
          {
            id: 'ps-1',
            trigger: 'клиент возражает на цену',
            steps: [
              { order: 1, action: 'выслушать возражение до конца' },
              { order: 2, action: 'назвать ценность, не скидку' },
            ],
            redFlags: ['не давить'],
            pinned: false,
            successRate: 0.8,
          },
        ]),
      },
    };

    const { svc, llm } = makeService(prisma);
    const result = await svc.buildForProfile({ profileId: 'sp-1' });

    expect(result).not.toBeNull();
    const userMessage = getUserMessage(llm);
    expect(userMessage).toContain('Ценности');
    expect(userMessage).toContain('Мотивация в работе');
    expect(userMessage).toContain('Принципы роли');
    expect(userMessage).toContain('Процедуры');
    expect(userMessage).toContain('Когда:');
    expect(userMessage).toContain('Маркеры процесса');

    const createArg = (
      createSpy.mock.calls[0] as unknown as [{ data: { includedTraitIds: string[] } }]
    )[0];
    expect(createArg.data.includedTraitIds).toEqual(
      expect.arrayContaining(['skill-1', 'val-1', 'mot-1', 'mark-1']),
    );
    expect(createArg.data.includedTraitIds).not.toContain('rp-1');
    expect(createArg.data.includedTraitIds).not.toContain('ps-1');
  });

  it('новые слои пусты → деградация к v1-поведению: только черты, без секций слоёв', async () => {
    const createSpy = makeCreateSpy();
    const updateManySpy = makeUpdateManySpy();
    const prisma = {
      ...makePrismaBase({ createSpy, updateManySpy }),
      skillProfile: { findUnique: vi.fn(async () => makeProfileRow()) },
    };

    const { svc, llm } = makeService(prisma);
    const result = await svc.buildForProfile({ profileId: 'sp-1' });

    expect(result).not.toBeNull();
    const userMessage = getUserMessage(llm);
    expect(userMessage).toContain('Черты подхода');
    expect(userMessage).toContain('обычно сначала собирает данные');
    expect(userMessage).not.toContain('Ценности');
    expect(userMessage).not.toContain('Мотивация в работе');
    expect(userMessage).not.toContain('Принципы роли');
    expect(userMessage).not.toContain('Процедуры');
    expect(userMessage).not.toContain('Маркеры процесса');
  });

  it('выборка traits фильтрует layer=skill (и слои — каждый своим запросом)', async () => {
    const createSpy = makeCreateSpy();
    const updateManySpy = makeUpdateManySpy();
    const prisma = {
      ...makePrismaBase({ createSpy, updateManySpy }),
      skillProfile: {
        findUnique: vi.fn(async (_q: unknown) => makeProfileRow()),
      },
    };

    const { svc } = makeService(prisma);
    await svc.buildForProfile({ profileId: 'sp-1' });

    const findUniqueArg = prisma.skillProfile.findUnique.mock.calls[0]?.[0] as unknown as {
      include: { traits: { where: Record<string, unknown> } };
    };
    expect(findUniqueArg.include.traits.where).toMatchObject({
      status: 'active',
      layer: 'skill',
    });

    const layerQueries = prisma.skillTrait.findMany.mock.calls.map(
      (c) => (c[0] as { where: { layer: string } }).where.layer,
    );
    expect(layerQueries).toEqual(expect.arrayContaining(['value', 'motivation', 'process_marker']));
  });

  it('buildForRole: practiceSkills — union scope role + person носителя; values из профиля носителя (Раздел 7)', async () => {
    const createSpy = makeCreateSpy();
    const updateManySpy = makeUpdateManySpy();
    const prisma = {
      ...makePrismaBase({ createSpy, updateManySpy }),
      personRole: {
        findMany: vi.fn(async () => [
          { personId: 'person-A', validFrom: new Date('2026-01-01T00:00:00Z') },
        ]),
      },
      skillProfile: {
        findFirst: vi.fn(async () => ({
          id: 'sp-A',
          person: { name: 'A', relationship: 'employee' },
          traits: [makeSkillTraitRow('t1'), makeSkillTraitRow('t2'), makeSkillTraitRow('t3')],
        })),
      },
      skillTrait: {
        findMany: vi.fn(async (q: { where: { layer: string } }) =>
          q.where.layer === 'value'
            ? [
                makeSkillTraitRow('val-A', {
                  profileId: 'sp-A',
                  category: 'качество',
                  statement: 'выбирает качество при конфликте со сроком',
                }),
                makeSkillTraitRow('val-B', {
                  profileId: 'sp-A',
                  category: 'прозрачность',
                  statement: 'предпочитает ранние плохие новости поздним',
                  observationCount: 2,
                }),
              ]
            : [],
        ),
      },
      practiceSkill: {
        findMany: vi.fn(async (_q: unknown) => [
          {
            id: 'ps-role',
            trigger: 'возражение на цену',
            steps: [{ order: 1, action: 'назвать ценность' }],
            redFlags: [],
          },
        ]),
      },
    };

    const { svc, llm } = makeService(prisma);
    const result = await svc.buildForRole({
      tenantId: 't-1',
      roleId: 'role-1',
    });

    expect(result).not.toBeNull();

    const psArg = prisma.practiceSkill.findMany.mock.calls[0]?.[0] as unknown as {
      where: { OR: unknown[] };
    };
    expect(psArg.where.OR).toEqual([
      { scope: 'role', scopeRefId: 'role-1' },
      { scope: 'person', scopeRefId: 'person-A' },
    ]);

    const userMessage = getUserMessage(llm);
    expect(userMessage).toContain('Ценности из проявленных выборов (2)');
    expect(userMessage).toContain('Процедуры');
    const createArg = (
      createSpy.mock.calls[0] as unknown as [{ data: { includedTraitIds: string[] } }]
    )[0];
    expect(createArg.data.includedTraitIds).toEqual(expect.arrayContaining(['val-A', 'val-B']));
  });

  it('битый steps-Json у PracticeSkill → скилл пропущен, сборка не падает', async () => {
    const createSpy = makeCreateSpy();
    const updateManySpy = makeUpdateManySpy();
    const prisma = {
      ...makePrismaBase({ createSpy, updateManySpy }),
      skillProfile: { findUnique: vi.fn(async () => makeProfileRow()) },
      practiceSkill: {
        findMany: vi.fn(async () => [
          {
            id: 'ps-broken',
            trigger: 'битый-скилл-триггер',
            steps: 'не-массив-вовсе',
            redFlags: { oops: true },
          },
          {
            id: 'ps-ok',
            trigger: 'валидный-скилл-триггер',
            steps: [{ order: 1, action: 'сделать шаг' }],
            redFlags: ['не спешить'],
          },
        ]),
      },
    };

    const { svc, llm } = makeService(prisma);
    const result = await svc.buildForProfile({ profileId: 'sp-1' });

    expect(result).not.toBeNull();
    const userMessage = getUserMessage(llm);
    expect(userMessage).toContain('валидный-скилл-триггер');
    expect(userMessage).not.toContain('битый-скилл-триггер');
    expect(userMessage).toContain('Процедуры (1)');
  });
});
