import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportEditClassifyService } from './services/support-edit-classify.service';

describe('SupportEditClassifyService.classify', () => {
  const TENANT = 'vendor-org-1';

  let llmStub: { call: ReturnType<typeof vi.fn> };
  let svc: SupportEditClassifyService;

  beforeEach(() => {
    llmStub = { call: vi.fn() };
    svc = new SupportEditClassifyService(llmStub as unknown as never);
  });

  it('возвращает editType из строгого JSON LLM', async () => {
    llmStub.call.mockResolvedValue({
      text: JSON.stringify({ editType: 'tone' }),
      modelUsed: 'deepseek:deepseek-v4-flash',
    });

    const res = await svc.classify({
      tenantId: TENANT,
      draft: 'черновик',
      final: 'финал',
    });

    expect(res).toBe('tone');
    expect(llmStub.call).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'support-edit-classify' }),
    );
  });

  it('LLM бросает → fallback factual', async () => {
    llmStub.call.mockRejectedValue(new Error('boom'));

    const res = await svc.classify({
      tenantId: TENANT,
      draft: 'черновик',
      final: 'финал',
    });

    expect(res).toBe('factual');
  });

  it('непарсимый JSON → fallback factual', async () => {
    llmStub.call.mockResolvedValue({
      text: 'не json',
      modelUsed: 'deepseek:deepseek-v4-flash',
    });

    const res = await svc.classify({
      tenantId: TENANT,
      draft: 'черновик',
      final: 'финал',
    });

    expect(res).toBe('factual');
  });

  it('неизвестное значение editType → fallback factual', async () => {
    llmStub.call.mockResolvedValue({
      text: JSON.stringify({ editType: 'whatever' }),
      modelUsed: 'deepseek:deepseek-v4-flash',
    });

    const res = await svc.classify({
      tenantId: TENANT,
      draft: 'черновик',
      final: 'финал',
    });

    expect(res).toBe('factual');
  });
});
