/**
 * TZ clone-method Э3.1 (2026-06-12) — unit-тесты CDM-интервью носителя
 * (`Specialist37ProbeService.checkCdmInterview`).
 *
 * Покрывает:
 *   1. Гейт ON + нет прошлых вопросов + есть свежий reasoning-блок →
 *      `probeService.suggest` вызван с reason='skill.cdm_interview',
 *      payload.suggestedQuestion из LLM, recipientCandidates=[userId носителя].
 *   2. Уже maxQuestions задано → suggest НЕ вызван.
 *   3. Cooldown не истёк → suggest НЕ вызван.
 *   4. Флаг OFF → suggest НЕ вызван (и LLM не дёргается).
 *   5. LLM упал → skip без throw, suggest НЕ вызван.
 *
 * Все Prisma/LLM/Probe/Metrics/Cfg мокированы (без БД, без сети).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { ProbeService } from '../../probe/probe.service';

import { Specialist37ProbeService } from './specialist-3-7-skill-probe.service';

const CDM_ARGS = {
  tenantId: 'org-cdm',
  profileId: 'profile-cdm-1',
  personId: 'person-cdm-1',
  personName: 'Сергей',
  entityId: 'entity-cdm-1',
};

interface Mocks {
  prisma: PrismaService;
  metrics: BusinessMetricsService;
  cfg: TypedConfigService;
  llmCall: ReturnType<typeof vi.fn>;
  suggest: ReturnType<typeof vi.fn>;
}

function makeMocks(opts: {
  enabled?: boolean;
  userId?: string | null;
  askedCount?: number;
  lastAskedAt?: Date | null;
  freshMentions?: Array<{ blockId: string }>;
  llmResponse?: { text: string };
  llmThrow?: Error;
}): Mocks {
  const prisma = {
    person: {
      findUnique: vi.fn().mockResolvedValue({
        userId: opts.userId === undefined ? 'user-subject-1' : opts.userId,
        entityId: 'entity-cdm-1',
      }),
    },
    probeEvent: {
      count: vi.fn().mockResolvedValue(opts.askedCount ?? 0),
      findFirst: vi
        .fn()
        .mockResolvedValue(
          opts.lastAskedAt ? { createdAt: opts.lastAskedAt } : null,
        ),
    },
    ideaBlockEntity: {
      findMany: vi
        .fn()
        .mockResolvedValue(opts.freshMentions ?? [{ blockId: 'b1' }]),
    },
    ideaBlock: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'b1',
          name: 'Перенос релиза',
          trustedAnswer: 'Решил перенести релиз ради нагрузочного теста',
          createdAt: new Date('2026-06-01T10:00:00.000Z'),
          evidence: [
            { quote: 'Лучше неделя задержки, чем падение у клиентов' },
          ],
        },
      ]),
    },
  } as unknown as PrismaService;

  const metrics = {
    incCoreSpecialistProbeEvent: vi.fn(),
  } as unknown as BusinessMetricsService;

  const cfg = {
    skill: { cdmInterviewEnabled: opts.enabled ?? true },
    aiFeatures: { promptInjectionGuardEnabled: false },
    probe: { subjectAddressingEnabled: true },
    getDynamic: vi
      .fn()
      .mockImplementation(
        async (_key: string, _tenantId: unknown, dflt: unknown) => dflt,
      ),
  } as unknown as TypedConfigService;

  const llmCall = vi.fn();
  if (opts.llmThrow) {
    llmCall.mockRejectedValue(opts.llmThrow);
  } else {
    llmCall.mockResolvedValue(
      opts.llmResponse ?? {
        text: JSON.stringify({
          question:
            'Какие ещё варианты вы рассматривали, когда переносили релиз, и почему от них отказались?',
          cdmAngle: 'alternatives_rejected',
        }),
      },
    );
  }

  const suggest = vi.fn().mockResolvedValue({ ok: true, probeEventId: 'pe-1' });

  return { prisma, metrics, cfg, llmCall, suggest };
}

function makeService(m: Mocks): Specialist37ProbeService {
  return new Specialist37ProbeService(
    m.prisma,
    m.metrics,
    m.cfg,
    { call: m.llmCall } as unknown as LlmRouterService,
    { suggest: m.suggest } as unknown as ProbeService,
  );
}

describe('Specialist37ProbeService.checkCdmInterview — TZ clone-method Э3.1', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = makeMocks({});
  });

  it('гейт ON + нет прошлых вопросов + свежий блок → suggest с reason=skill.cdm_interview, suggestedQuestion из LLM, адресат — носитель', async () => {
    const svc = makeService(mocks);
    await svc.checkCdmInterview(CDM_ARGS);

    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    const llmArgs = mocks.llmCall.mock.calls[0]![0] as {
      taskType: string;
      sourceRef: { type: string; id: string };
      dataClass: string;
    };
    expect(llmArgs.taskType).toBe('cdm-case-interview');
    expect(llmArgs.sourceRef).toEqual({
      type: 'skill_profile',
      id: 'profile-cdm-1',
    });
    expect(llmArgs.dataClass).toBe('internal');

    expect(mocks.suggest).toHaveBeenCalledTimes(1);
    const suggestArgs = mocks.suggest.mock.calls[0]![0] as {
      reason: string;
      recipientCandidates: string[];
      priorityHint: number;
      payload: Record<string, unknown>;
    };
    expect(suggestArgs.reason).toBe('skill.cdm_interview');
    // Адресат — САМ носитель (subject), не менеджер.
    expect(suggestArgs.recipientCandidates).toEqual(['user-subject-1']);
    expect(suggestArgs.priorityHint).toBe(0.4);
    expect(suggestArgs.payload.suggestedQuestion).toBe(
      'Какие ещё варианты вы рассматривали, когда переносили релиз, и почему от них отказались?',
    );
    expect(suggestArgs.payload.contextCardId).toBe('profile-cdm-1');
    expect(suggestArgs.payload.contextCardKind).toBe('skill_profile');
    expect(suggestArgs.payload.contextCardTitle).toBe(
      'Разбор кейса для клона роли',
    );
  });

  it('уже maxQuestions (5) задано → suggest НЕ вызван', async () => {
    mocks = makeMocks({ askedCount: 5 });
    const svc = makeService(mocks);
    await svc.checkCdmInterview(CDM_ARGS);

    expect(mocks.llmCall).not.toHaveBeenCalled();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('cooldown не истёк (последний вопрос вчера, окно 7 дней) → suggest НЕ вызван', async () => {
    mocks = makeMocks({
      askedCount: 1,
      lastAskedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const svc = makeService(mocks);
    await svc.checkCdmInterview(CDM_ARGS);

    expect(mocks.llmCall).not.toHaveBeenCalled();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('флаг OFF (kill-switch) → ничего не делает', async () => {
    mocks = makeMocks({ enabled: false });
    const svc = makeService(mocks);
    await svc.checkCdmInterview(CDM_ARGS);

    expect(
      (mocks.prisma.person.findUnique as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);
    expect(mocks.llmCall).not.toHaveBeenCalled();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('у носителя нет userId → skip (CDM отвечает только сам носитель)', async () => {
    mocks = makeMocks({ userId: null });
    const svc = makeService(mocks);
    await svc.checkCdmInterview(CDM_ARGS);

    expect(mocks.llmCall).not.toHaveBeenCalled();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('нет свежих reasoning-кейсов за 30 дней → skip', async () => {
    mocks = makeMocks({ freshMentions: [] });
    const svc = makeService(mocks);
    await svc.checkCdmInterview(CDM_ARGS);

    expect(mocks.llmCall).not.toHaveBeenCalled();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('Б21: бюджет вопросов считается только по доставленным probe (status IN pending/dispatched)', async () => {
    const svc = makeService(mocks);
    await svc.checkCdmInterview(CDM_ARGS);

    const countWhere = (
      mocks.prisma.probeEvent.count as ReturnType<typeof vi.fn>
    ).mock.calls[0]![0].where as { status?: { in?: string[] }; reason: string };
    expect(countWhere.reason).toBe('skill.cdm_interview');
    expect(countWhere.status).toEqual({ in: ['pending', 'dispatched'] });
    // НЕдоставленные статусы (queued_digest/dropped_*/routed_to_digest/...) в
    // бюджет НЕ входят — иначе deferrable-CDM копит queued_digest и не задаётся.
    expect(countWhere.status?.in).not.toContain('queued_digest');
    expect(countWhere.status?.in).not.toContain('dropped_rate_limit');
  });

  it('Б21: cooldown отсчитывается от доставленного probe (findFirst фильтрует status IN pending/dispatched)', async () => {
    const svc = makeService(mocks);
    await svc.checkCdmInterview(CDM_ARGS);

    const ffWhere = (
      mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>
    ).mock.calls[0]![0].where as { status?: { in?: string[] } };
    expect(ffWhere.status).toEqual({ in: ['pending', 'dispatched'] });
  });

  it('LLM упал → skip без throw, suggest НЕ вызван (best-effort)', async () => {
    mocks = makeMocks({ llmThrow: new Error('llm proxy 500') });
    const svc = makeService(mocks);

    await expect(svc.checkCdmInterview(CDM_ARGS)).resolves.toBeUndefined();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('checkAndEmitProbes прокидывает entityId в CDM-проверку (упавший starved не мешает)', async () => {
    const svc = makeService(mocks);
    // starved упадёт на person.relationship (мок без relationship) — это
    // нормально: try/catch в checkAndEmitProbes изолирует триггеры.
    await svc.checkAndEmitProbes(CDM_ARGS);
    expect(mocks.suggest).toHaveBeenCalledTimes(1);
    const suggestArgs = mocks.suggest.mock.calls[0]![0] as { reason: string };
    expect(suggestArgs.reason).toBe('skill.cdm_interview');
  });
});
