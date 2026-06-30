import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { MeetingSkeletonService } from './meeting-skeleton.service';
import type { Segment } from './segment-builder.service';

type LlmCallArg = {
  taskType: string;
  userMessage: string;
  dataClass?: string;
  maxTokens?: number;
};
type LlmCall = (req: LlmCallArg) => Promise<{ text: string }>;
type MockCall = ReturnType<typeof vi.fn<LlmCall>>;

function makeService(call: MockCall): MeetingSkeletonService {
  const llm = { call } as unknown as LlmRouterService;
  return new MeetingSkeletonService(llm);
}

function argAt(call: MockCall, idx: number): LlmCallArg {
  const c = call.mock.calls[idx];
  if (!c) throw new Error(`no call at index ${idx}`);
  return c[0];
}

function seg(index: number, text: string): Segment {
  return { startMs: index * 1000, endMs: index * 1000 + 500, speakers: ['Анна'], text };
}

const validResponse = JSON.stringify({
  agenda: 'Перенос склада и подрядчик',
  milestones: [
    { title: 'Старт', fromIndex: 0, toIndex: 1 },
    { title: 'Подрядчик' },
  ],
  keyNames: ['Марина', 'ООО Ромашка'],
});

const baseArgs = (segments: Segment[]) => ({
  tenantId: 't1',
  rawEventId: 'r1',
  segments,
});

describe('MeetingSkeletonService.buildSkeleton', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('валидный ответ → MeetingSkeleton', async () => {
    const call = vi.fn<LlmCall>(async () => ({ text: validResponse }));
    const svc = makeService(call);

    const out = await svc.buildSkeleton(baseArgs([seg(0, 'привет'), seg(1, 'склад')]));

    expect(out).not.toBeNull();
    expect(out?.agenda).toBe('Перенос склада и подрядчик');
    expect(out?.milestones.length).toBe(2);
    expect(out?.milestones[0]).toEqual({ title: 'Старт', fromIndex: 0, toIndex: 1 });
    expect(out?.milestones[1]).toEqual({ title: 'Подрядчик' });
    expect(out?.keyNames).toEqual(['Марина', 'ООО Ромашка']);
  });

  it('невалидный JSON → null (fail-open)', async () => {
    const call = vi.fn<LlmCall>(async () => ({ text: 'не json' }));
    const svc = makeService(call);

    const out = await svc.buildSkeleton(baseArgs([seg(0, 'привет')]));

    expect(out).toBeNull();
  });

  it('throw в llm.call → null (fail-open)', async () => {
    const call = vi.fn<LlmCall>(async () => {
      throw new Error('boom');
    });
    const svc = makeService(call);

    const out = await svc.buildSkeleton(baseArgs([seg(0, 'привет')]));

    expect(out).toBeNull();
  });

  it('пустой вход → null, llm не зван', async () => {
    const call = vi.fn<LlmCall>(async () => ({ text: validResponse }));
    const svc = makeService(call);

    const out = await svc.buildSkeleton(baseArgs([]));

    expect(out).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('зовёт llm.call с taskType=meeting-skeleton и проброшенным dataClass', async () => {
    const call = vi.fn<LlmCall>(async () => ({ text: validResponse }));
    const svc = makeService(call);

    await svc.buildSkeleton({
      ...baseArgs([seg(0, 'привет')]),
      dataClass: 'private',
    });

    expect(call).toHaveBeenCalledTimes(1);
    const arg = argAt(call, 0);
    expect(arg.taskType).toBe('meeting-skeleton');
    expect(arg.dataClass).toBe('private');
  });

  it('вход сжат: каждый сегмент ≤80 символов текста + индекс', async () => {
    const call = vi.fn<LlmCall>(async () => ({ text: validResponse }));
    const svc = makeService(call);
    const longText = 'x'.repeat(300);

    await svc.buildSkeleton(baseArgs([seg(0, longText), seg(1, 'коротко')]));

    const userMessage = argAt(call, 0).userMessage;
    expect(userMessage).toContain('0: ' + 'x'.repeat(80));
    expect(userMessage).not.toContain('x'.repeat(81));
    expect(userMessage).toContain('1: коротко');
  });
});
