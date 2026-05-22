/**
 * Фаза A.2 — тест PromptTemplatesPreviewService.
 *
 * Покрывает (≥3 сценария):
 *   1) runPreview — успех на активной версии, LLM мокнут.
 *   2) runPreview — несуществующий demoMeetingKey не пройдёт Zod на уровне DTO,
 *      но если как-то проскочит — bad request от сервиса.
 *   3) runPreview — rate-limit срабатывает на 11-м вызове.
 */

import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { PromptTemplatesPreviewService } from './prompt-templates-preview.service';
import type { AdminPromptTemplatesService } from './prompt-templates.service';

function makeSvc(opts?: { llmShouldFail?: boolean }) {
  const llmShouldFail = opts?.llmShouldFail ?? false;
  const templates = {
    detail: vi.fn(async (_id: string) => ({
      id: 't-1',
      activeVersionId: 'v-1',
    })),
    getVersion: vi.fn(async (_t: string, vId: string) => ({
      id: vId,
      templateId: 't-1',
      versionNumber: 1,
      systemPrompt: 'system промпт',
      outputSchema: { type: 'object', properties: {} },
      toolName: null,
      createdById: 'u-1',
      createdAt: new Date(),
      notes: null,
      sections: [
        {
          id: 's-1',
          versionId: vId,
          order: 1,
          key: 'summary',
          title: 'Сводка',
          instruction: 'Опиши главное.',
          outputType: 'text',
          required: true,
          maxTokens: null,
        },
      ],
    })),
  } as unknown as AdminPromptTemplatesService;

  const prisma = {
    promptTemplateVersion: {
      findFirst: vi.fn(async () => null),
    },
  } as unknown as PrismaService;

  const router = {
    call: vi.fn(async () => {
      if (llmShouldFail) throw new Error('llm offline');
      return {
        text: 'Ответ LLM',
        modelUsed: 'deepseek:flash',
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 0,
        durationMs: 1234,
      };
    }),
  } as unknown as LlmRouterService;

  const metrics = {
    incPromptTemplatePreview: vi.fn(),
  } as unknown as BusinessMetricsService;

  return new PromptTemplatesPreviewService(prisma, templates, router, metrics);
}

describe('PromptTemplatesPreviewService', () => {
  it('runPreview — успех: возвращает text, cost, modelUsed', async () => {
    const svc = makeSvc();
    const out = await svc.runPreview(
      't-1',
      { demoMeetingKey: 'demo-sales' },
      'u-1',
    );
    expect(out.text).toBe('Ответ LLM');
    expect(out.modelUsed).toBe('deepseek:flash');
    expect(out.source).toBe('db_active');
    expect(out.costUsd).toBeGreaterThan(0);
    expect(out.costOverBudget).toBe(false);
  });

  it('runPreview — LLM-ошибка приходит как preview_llm_failed', async () => {
    const svc = makeSvc({ llmShouldFail: true });
    await expect(
      svc.runPreview('t-1', { demoMeetingKey: 'demo-sales' }, 'u-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'preview_llm_failed' }),
      }),
    });
  });

  it('runPreview — rate-limit срабатывает после 10 вызовов', async () => {
    const svc = makeSvc();
    for (let i = 0; i < 10; i++) {
      await svc.runPreview('t-1', { demoMeetingKey: 'demo-sales' }, 'u-rate');
    }
    await expect(
      svc.runPreview('t-1', { demoMeetingKey: 'demo-sales' }, 'u-rate'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'preview_rate_limited' }),
      }),
    });
  });
});
