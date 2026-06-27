import { describe, expect, it, vi } from 'vitest';

import { ALL_LLM_TASK_TYPES } from '../ai/services/llm-router.service';
import { DOCUMENT_SUMMARIZE_SYSTEM_PROMPT } from '../ai/services/prompts/document-summarize.prompt';

import { DocumentSummaryService } from './document-summary.service';

function buildService(llmCall: ReturnType<typeof vi.fn>) {
  const llm = { call: llmCall } as never;
  const cfg = {
    getDynamic: vi.fn(async (_key: string, _env?: unknown, def?: unknown) => def),
  } as never;
  return new DocumentSummaryService(llm, cfg);
}

describe('DocumentSummaryService — Ф8 AI-title + summary документа', () => {
  it('PDF без осмысленного имени → AI-title из LLM (не имя файла)', async () => {
    const llmCall = vi.fn(async () => ({
      text: JSON.stringify({
        title: 'План логистики на 2026 год',
        summary: 'Документ описывает маршруты доставки и склады.',
      }),
    }));
    const svc = buildService(llmCall);

    const res = await svc.summarize({
      tenantId: 't1',
      documentId: 'doc-1',
      fileName: 'scan_0001.pdf',
      parsedText: 'Логистика. Маршруты. Склады. '.repeat(50),
    });

    expect(res.title).toBe('План логистики на 2026 год');
    expect(res.summary).toContain('маршруты');
    expect(llmCall).toHaveBeenCalledOnce();
    const params = (llmCall.mock.calls[0] as unknown[])[0] as { taskType: string };
    expect(params.taskType).toBe('document-summarize');
  });

  it('LLM упал → fallback на имя файла (без расширения), summary пуст, не падает', async () => {
    const llmCall = vi.fn(async () => {
      throw new Error('all providers failed');
    });
    const svc = buildService(llmCall);

    const res = await svc.summarize({
      tenantId: 't1',
      documentId: 'doc-2',
      fileName: 'Договор поставки.docx',
      parsedText: 'Какой-то текст договора.',
    });

    expect(res.title).toBe('Договор поставки');
    expect(res.summary).toBe('');
  });

  it('LLM вернул мусор → fallback title из имени файла, summary пуст', async () => {
    const llmCall = vi.fn(async () => ({ text: 'не json вовсе' }));
    const svc = buildService(llmCall);

    const res = await svc.summarize({
      tenantId: 't1',
      documentId: 'doc-3',
      fileName: 'noname',
      parsedText: 'Текст.',
    });

    expect(res.title).toBe('noname');
    expect(res.summary).toBe('');
  });

  it('пустой parsedText → LLM не вызывается, fallback title', async () => {
    const llmCall = vi.fn(async () => ({ text: '{}' }));
    const svc = buildService(llmCall);

    const res = await svc.summarize({
      tenantId: 't1',
      documentId: 'doc-4',
      fileName: 'empty.txt',
      parsedText: '   ',
    });

    expect(res.title).toBe('empty');
    expect(res.summary).toBe('');
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('обрезает parsedText по крутилке knowledge.document_summary_input_chars перед LLM', async () => {
    const llmCall = vi.fn(async () => ({ text: JSON.stringify({ title: 't', summary: 's' }) }));
    const llm = { call: llmCall } as never;
    const cfg = {
      getDynamic: vi.fn(async (key: string) =>
        key === 'knowledge.document_summary_input_chars' ? 100 : undefined,
      ),
    } as never;
    const svc = new DocumentSummaryService(llm, cfg);

    await svc.summarize({
      tenantId: 't1',
      documentId: 'doc-5',
      fileName: 'big.pdf',
      parsedText: 'X'.repeat(5000),
    });

    const params = (llmCall.mock.calls[0] as unknown[])[0] as { userMessage: string };
    expect(params.userMessage.length).toBeLessThan(1000);
  });

  it('taskType document-summarize зарегистрирован в реестре LlmTaskType', () => {
    expect(ALL_LLM_TASK_TYPES).toContain('document-summarize');
  });

  it('code-fallback системного промпта существует и содержит правила JSON', () => {
    expect(DOCUMENT_SUMMARIZE_SYSTEM_PROMPT).toContain('title');
    expect(DOCUMENT_SUMMARIZE_SYSTEM_PROMPT).toContain('summary');
    expect(DOCUMENT_SUMMARIZE_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });
});
