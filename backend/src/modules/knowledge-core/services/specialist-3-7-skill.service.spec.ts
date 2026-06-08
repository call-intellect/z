import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Specialist37Service } from './specialist-3-7-skill.service';

/**
 * Ф3(D) clone-quality-improvements (2026-06-08) — unit-тест grounding-гейта
 * `verifyPendingTraits`:
 *   - grounded=true  → skillTrait.update status:'active' (promoted=1);
 *   - grounded=false → черта остаётся pending, update НЕ зовётся (held=1);
 *   - llm.call throws → FAIL-OPEN: update status:'active' (promoted=1).
 *
 * Конструируем сервис напрямую с замоканными зависимостями (паттерн
 * specialist-3-6-ideas.service.spec.ts) — без NestJS Test-модуля. Метод
 * использует только prisma + llm, остальные DI-зависимости не задействованы.
 */

const TRAIT_ID = 'trait-1';
const PROFILE_ID = 'profile-1';
const TENANT = 'org-1';

interface Mocks {
  prisma: {
    skillTrait: {
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
  };
  llm: { call: ReturnType<typeof vi.fn> };
}

function pendingTrait(overrides: Record<string, unknown> = {}) {
  return {
    id: TRAIT_ID,
    category: 'осторожен с оценками сроков',
    statement: 'Похоже, склонен откладывать коммит по срокам до сбора данных.',
    sourceBlockIds: ['b1', 'b2'],
    profileId: PROFILE_ID,
    profile: { tenantId: TENANT },
    ...overrides,
  };
}

function buildService(m: Mocks): Specialist37Service {
  return new Specialist37Service(
    m.prisma as never,
    {} as never, // cfg
    m.llm as never,
    {} as never, // embedder
    {} as never, // metrics
    {} as never, // probes
    {} as never, // concepts
  );
}

function makeMocks(): Mocks {
  return {
    prisma: {
      skillTrait: {
        findMany: vi.fn().mockResolvedValue([pendingTrait()]),
        update: vi.fn().mockResolvedValue({ id: TRAIT_ID }),
      },
      ideaBlock: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'b1', criticalQuestion: 'Почему откладываешь оценку?', trustedAnswer: 'Обжигался на оценках без замеров.' },
          { id: 'b2', criticalQuestion: 'Почему не даёшь срок?', trustedAnswer: 'Надо разобрать контракт сначала.' },
        ]),
      },
    },
    llm: { call: vi.fn() },
  };
}

describe('Specialist37Service.verifyPendingTraits — grounding-гейт Ф3(D)', () => {
  let m: Mocks;

  beforeEach(() => {
    m = makeMocks();
  });

  it('grounded=true → промоут в active (promoted=1, held=0)', async () => {
    m.llm.call.mockResolvedValue({ text: JSON.stringify({ grounded: true, reason: 'цитаты 1 и 2 подтверждают' }) });
    const svc = buildService(m);

    const res = await svc.verifyPendingTraits();

    expect(res).toEqual({ checked: 1, promoted: 1, held: 0 });
    expect(m.prisma.skillTrait.update).toHaveBeenCalledTimes(1);
    expect(m.prisma.skillTrait.update).toHaveBeenCalledWith({
      where: { id: TRAIT_ID },
      data: { status: 'active' },
    });
    // verify-вызов с правильным taskType.
    expect(m.llm.call).toHaveBeenCalledTimes(1);
    expect(m.llm.call.mock.calls[0]![0].taskType).toBe('skill-trait-verify');
  });

  it('grounded=false → черта остаётся pending (held=1), update НЕ зовётся', async () => {
    m.llm.call.mockResolvedValue({ text: JSON.stringify({ grounded: false, reason: 'только уточняющие вопросы' }) });
    const svc = buildService(m);

    const res = await svc.verifyPendingTraits();

    expect(res).toEqual({ checked: 1, promoted: 0, held: 1 });
    expect(m.prisma.skillTrait.update).not.toHaveBeenCalled();
  });

  it('llm.call throws → FAIL-OPEN промоут в active (promoted=1)', async () => {
    m.llm.call.mockRejectedValue(new Error('LLM timeout'));
    const svc = buildService(m);

    const res = await svc.verifyPendingTraits();

    expect(res).toEqual({ checked: 1, promoted: 1, held: 0 });
    expect(m.prisma.skillTrait.update).toHaveBeenCalledWith({
      where: { id: TRAIT_ID },
      data: { status: 'active' },
    });
  });

  it('нет pending черт → нули', async () => {
    m.prisma.skillTrait.findMany.mockResolvedValue([]);
    const svc = buildService(m);

    const res = await svc.verifyPendingTraits();

    expect(res).toEqual({ checked: 0, promoted: 0, held: 0 });
    expect(m.llm.call).not.toHaveBeenCalled();
  });
});
