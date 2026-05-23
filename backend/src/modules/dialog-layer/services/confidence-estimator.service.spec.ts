import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ConfidenceEstimatorService } from './confidence-estimator.service';

/**
 * SBA α-5 dialog-layer — unit-тесты ConfidenceEstimatorService.
 */
describe('ConfidenceEstimatorService', () => {
  let llmCallMock: ReturnType<typeof vi.fn>;
  let svc: ConfidenceEstimatorService;
  let cfg: { dialogLayer: { contextualizerConfidenceMin: number } };
  let metrics: {
    observeDialogProcessingDuration: ReturnType<typeof vi.fn>;
    incDialogConfidenceLow: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    llmCallMock = vi.fn();
    cfg = { dialogLayer: { contextualizerConfidenceMin: 0.5 } };
    metrics = {
      observeDialogProcessingDuration: vi.fn(),
      incDialogConfidenceLow: vi.fn(),
    };
    svc = new ConfidenceEstimatorService(
      { call: llmCallMock } as unknown as never,
      cfg as unknown as never,
      metrics as unknown as never,
    );
  });

  it('standalone === original → confidence=1.0 без LLM', async () => {
    const r = await svc.estimate({
      tenantId: 't',
      userId: 'u',
      originalQuestion: 'Какой бюджет?',
      standaloneQuestion: 'Какой бюджет?',
      conversationId: null,
    });
    expect(r.confidence).toBe(1.0);
    expect(r.llmCalled).toBe(false);
    expect(r.shouldFallback).toBe(false);
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('high confidence из LLM → не fallback', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"confidence": 0.95, "reason": "OK"}',
    });
    const r = await svc.estimate({
      tenantId: 't',
      userId: 'u',
      originalQuestion: 'А сколько?',
      standaloneQuestion: 'Сколько стоит продукт X?',
      conversationId: null,
    });
    expect(r.confidence).toBe(0.95);
    expect(r.shouldFallback).toBe(false);
    expect(metrics.incDialogConfidenceLow).not.toHaveBeenCalled();
  });

  it('low confidence → shouldFallback=true + метрика', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"confidence": 0.3, "reason": "lost meaning"}',
    });
    const r = await svc.estimate({
      tenantId: 't',
      userId: 'u',
      originalQuestion: 'Что?',
      standaloneQuestion: 'Что такое квантовая запутанность?',
      conversationId: null,
    });
    expect(r.confidence).toBe(0.3);
    expect(r.shouldFallback).toBe(true);
    expect(metrics.incDialogConfidenceLow).toHaveBeenCalledOnce();
  });

  it('LLM error → safe (high confidence, не fallback)', async () => {
    llmCallMock.mockRejectedValue(new Error('LLM 500'));
    const r = await svc.estimate({
      tenantId: 't',
      userId: 'u',
      originalQuestion: 'А?',
      standaloneQuestion: 'Что ты имел в виду в прошлом сообщении?',
      conversationId: null,
    });
    expect(r.confidence).toBe(1.0);
    expect(r.shouldFallback).toBe(false);
  });
});
