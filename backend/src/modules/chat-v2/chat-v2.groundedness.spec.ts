import { describe, expect, it, vi } from 'vitest';

import { ChatV2OrchestrationService } from './chat-v2.service';

const HONEST_ABSTAIN =
  'В памяти компании я этого не нашёл — не хочу выдумывать. Уточните вопрос, и я поищу ещё.';

interface GateHarness {
  service: ChatV2OrchestrationService;
  llmCall: ReturnType<typeof vi.fn>;
  incRagAbstain: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  getDynamic: ReturnType<typeof vi.fn>;
}

function makeHarness(opts: {
  mode: 'off' | 'shadow' | 'on';
  llmText?: string;
  llmThrows?: boolean;
}): GateHarness {
  const getDynamic = vi.fn(async () => opts.mode);
  const findMany = vi.fn(async () => [
    { id: 'b1', name: 'Блок 1', trustedAnswer: 'Содержимое блока 1' },
  ]);
  const llmCall = vi.fn(async () => {
    if (opts.llmThrows) throw new Error('llm down');
    return { text: opts.llmText ?? '{"grounded":true,"reason":""}' };
  });
  const incRagAbstain = vi.fn();

  const cfg = { getDynamic } as unknown;
  const prisma = { ideaBlock: { findMany } } as unknown;
  const metrics = { incRagAbstain } as unknown;
  const llm = { call: llmCall } as unknown;

  const service = new ChatV2OrchestrationService(
    prisma as never,
    cfg as never,
    undefined as never,
    undefined as never,
    metrics as never,
    undefined as never,
    undefined as never,
    llm as never,
  );

  return { service, llmCall, incRagAbstain, findMany, getDynamic };
}

function callGate(h: GateHarness, overrides?: { usedBlockIds?: string[] }) {
  const gate = (
    h.service as unknown as {
      applyGroundednessGate: (args: {
        tenantId: string;
        userId: string;
        question: string;
        text: string;
        citations: unknown[];
        usedBlockIds: string[];
      }) => Promise<{ text: string; citations: unknown[] }>;
    }
  ).applyGroundednessGate.bind(h.service);
  return gate({
    tenantId: 't1',
    userId: 'u1',
    question: 'Какой план продаж?',
    text: 'План продаж — миллион рублей.',
    citations: [{ meetingId: 'm1' }],
    usedBlockIds: overrides?.usedBlockIds ?? ['b1'],
  });
}

describe('ChatV2OrchestrationService.applyGroundednessGate', () => {
  it('(а) выдумка grounded=false + mode=on → честный отказ + incRagAbstain(on)', async () => {
    const h = makeHarness({ mode: 'on', llmText: '{"grounded":false,"reason":"нет опоры"}' });
    const out = await callGate(h);
    expect(out.text).toBe(HONEST_ABSTAIN);
    expect(out.citations).toEqual([]);
    expect(h.incRagAbstain).toHaveBeenCalledWith({ mode: 'on' });
    expect(h.llmCall).toHaveBeenCalledTimes(1);
  });

  it('(б) grounded=false + mode=shadow → ответ не изменён + incRagAbstain(shadow)', async () => {
    const h = makeHarness({ mode: 'shadow', llmText: '{"grounded":false,"reason":"нет опоры"}' });
    const out = await callGate(h);
    expect(out.text).toBe('План продаж — миллион рублей.');
    expect(out.citations).toEqual([{ meetingId: 'm1' }]);
    expect(h.incRagAbstain).toHaveBeenCalledWith({ mode: 'shadow' });
  });

  it('(в) grounded=true → ответ как есть, метрика не тронута', async () => {
    const h = makeHarness({ mode: 'on', llmText: '{"grounded":true,"reason":""}' });
    const out = await callGate(h);
    expect(out.text).toBe('План продаж — миллион рублей.');
    expect(out.citations).toEqual([{ meetingId: 'm1' }]);
    expect(h.incRagAbstain).not.toHaveBeenCalled();
  });

  it('(г) mode=off → гейт пропущен, llm.call НЕ вызван', async () => {
    const h = makeHarness({ mode: 'off' });
    const out = await callGate(h);
    expect(out.text).toBe('План продаж — миллион рублей.');
    expect(h.llmCall).not.toHaveBeenCalled();
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.incRagAbstain).not.toHaveBeenCalled();
  });

  it('fail-open: llm.call упал → ответ не изменён, метрика не тронута', async () => {
    const h = makeHarness({ mode: 'on', llmThrows: true });
    const out = await callGate(h);
    expect(out.text).toBe('План продаж — миллион рублей.');
    expect(h.incRagAbstain).not.toHaveBeenCalled();
  });

  it('fail-open: невалидный JSON от LLM → ответ не изменён', async () => {
    const h = makeHarness({ mode: 'on', llmText: 'не json вовсе' });
    const out = await callGate(h);
    expect(out.text).toBe('План продаж — миллион рублей.');
    expect(h.incRagAbstain).not.toHaveBeenCalled();
  });

  it('пустой ответ (нет usedBlockIds) — блоки не грузятся, гейт всё равно работает', async () => {
    const h = makeHarness({ mode: 'on', llmText: '{"grounded":true,"reason":""}' });
    await callGate(h, { usedBlockIds: [] });
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.llmCall).toHaveBeenCalledTimes(1);
  });

  it('rag-groundedness — отдельный taskType (модель ≠ генератор chat-v2)', async () => {
    const h = makeHarness({ mode: 'on', llmText: '{"grounded":false,"reason":"x"}' });
    await callGate(h);
    expect(h.llmCall.mock.calls[0]?.[0]?.taskType).toBe('rag-groundedness');
  });
});
