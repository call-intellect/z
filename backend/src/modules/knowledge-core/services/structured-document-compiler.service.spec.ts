/**
 * Unit-тесты для `StructuredDocumentCompilerService` (Волна 6 A7).
 *
 * LlmRouterService мокаем; проверяем:
 *   - СОЗДАНИЕ (пустой existingContentMd → собирает документ из материала);
 *   - ДОПОЛНЕНИЕ (есть existingContentMd → промпт-вход содержит старое тело,
 *     результат собирается, ничего не теряя);
 *   - best-effort fallback при ошибке LLM (возврат existingContentMd, ok=false);
 *   - kill-switch docCompilerEnabled=false → isEnabled()=false.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  COMPILE_ORG_DOCUMENT_TASK_TYPE,
  COMPILE_ORG_DOCUMENT_TOOL_NAME,
} from '../prompts/structured-document-compiler.prompt';

import { StructuredDocumentCompilerService } from './structured-document-compiler.service';

function makeLlmMock(toolInput: unknown) {
  return {
    call: vi.fn().mockResolvedValue({
      text: '',
      modelUsed: 'deepseek:deepseek-v4-pro',
      inputTokens: 800,
      outputTokens: 300,
      cachedTokens: 0,
      durationMs: 1000,
      providerUsed: 'deepseek',
      tier: 'primary',
      toolCalls: [{ name: COMPILE_ORG_DOCUMENT_TOOL_NAME, input: toolInput }],
    }),
  };
}

function makeCfgMock(opts: {
  docCompilerEnabled?: boolean;
  injectionGuard?: boolean;
}) {
  return {
    aiFeatures: {
      docCompilerEnabled: opts.docCompilerEnabled ?? true,
      promptInjectionGuardEnabled: opts.injectionGuard ?? true,
    },
  };
}

describe('StructuredDocumentCompilerService.compile', () => {
  it('СОЗДАНИЕ: пустой existingContentMd → собирает документ из материала', async () => {
    const llm = makeLlmMock({
      contentMd: '## Назначение\nОформление возврата.',
      steps: [],
      changeReason: 'первичная сборка из материала',
      signals: [],
    });
    const cfg = makeCfgMock({});
    const svc = new StructuredDocumentCompilerService(llm as any, cfg as any);

    const res = await svc.compile(
      {
        kind: 'instruction',
        name: 'Возврат товара',
        newSourceBlocks: [
          {
            name: 'Как оформить возврат',
            question: 'Как менеджеру оформить возврат?',
            answer: 'Менеджер проверяет чек и создаёт заявку.',
            quotes: ['проверяет чек и создаёт заявку'],
          },
        ],
        existingContentMd: '',
        nowIso: '2026-06-10T00:00:00.000Z',
      },
      { tenantId: 'org-1' },
    );

    expect(llm.call).toHaveBeenCalledTimes(1);
    const callArg = llm.call.mock.calls[0]![0];
    expect(callArg.taskType).toBe(COMPILE_ORG_DOCUMENT_TASK_TYPE);
    expect(callArg.tools).toHaveLength(1);
    // СОЗДАНИЕ: режим виден в user.
    expect(callArg.userMessage).toContain('mode: СОЗДАНИЕ');
    expect(res.ok).toBe(true);
    expect(res.contentMd).toContain('Назначение');
    expect(res.changeReason).toContain('первичная сборка');
    // Для не-process типов steps игнорируются → [].
    expect(res.steps).toEqual([]);
  });

  it('ДОПОЛНЕНИЕ: existingContentMd попадает в промпт-вход и документ дополняется', async () => {
    const existing = '## Назначение\nСтарый текст инструкции.\n[требует уточнения: срок]';
    const llm = makeLlmMock({
      contentMd:
        '## Назначение\nСтарый текст инструкции.\n## Срок\n3 рабочих дня.',
      steps: [],
      changeReason: 'дополнено сроком из материала',
      signals: [],
    });
    const cfg = makeCfgMock({});
    const svc = new StructuredDocumentCompilerService(llm as any, cfg as any);

    const res = await svc.compile(
      {
        kind: 'instruction',
        name: 'Возврат товара',
        newSourceBlocks: [
          {
            name: 'Срок возврата',
            answer: 'Срок возврата — 3 рабочих дня.',
            quotes: ['3 рабочих дня'],
          },
        ],
        existingContentMd: existing,
      },
      { tenantId: 'org-1' },
    );

    expect(llm.call).toHaveBeenCalledTimes(1);
    const callArg = llm.call.mock.calls[0]![0];
    // КЛЮЧЕВОЕ: existingContentMd передан в промпт-вход (режим ДОПОЛНЕНИЕ).
    expect(callArg.userMessage).toContain('mode: ДОПОЛНЕНИЕ');
    expect(callArg.userMessage).toContain('Старый текст инструкции');
    expect(res.ok).toBe(true);
    // Не теряет старое: старый раздел сохранён, новый добавлен.
    expect(res.contentMd).toContain('Старый текст инструкции');
    expect(res.contentMd).toContain('3 рабочих дня');
    expect(res.changeReason).toBe('дополнено сроком из материала');
  });

  it('process: steps пробрасываются из вывода компилятора', async () => {
    const llm = makeLlmMock({
      contentMd: '## Цель\nСквозной процесс.',
      steps: [
        { title: 'Приём заявки', description: 'вход: заявка → проверка → выход: тикет' },
        { title: 'Обработка', description: 'вход: тикет → решение → выход: ответ' },
      ],
      changeReason: 'первичная сборка из материала',
      signals: [],
    });
    const cfg = makeCfgMock({});
    const svc = new StructuredDocumentCompilerService(llm as any, cfg as any);

    const res = await svc.compile(
      {
        kind: 'process',
        name: 'Обработка обращений',
        newSourceBlocks: [{ name: 'Поток', answer: 'Заявка → тикет → ответ.' }],
        existingContentMd: '',
      },
      { tenantId: 'org-1' },
    );

    expect(res.ok).toBe(true);
    expect(res.steps).toHaveLength(2);
    expect(res.steps[0]!.title).toBe('Приём заявки');
  });

  it('best-effort: при ошибке LLM возвращает fallback (existingContentMd, ok=false)', async () => {
    const existing = '## Назначение\nТело документа.';
    const llm = {
      call: vi.fn().mockRejectedValue(new Error('LLM down')),
    };
    const cfg = makeCfgMock({});
    const svc = new StructuredDocumentCompilerService(llm as any, cfg as any);

    const res = await svc.compile(
      {
        kind: 'regulation',
        name: 'Регламент X',
        newSourceBlocks: [{ name: 'b', answer: 'что-то' }],
        existingContentMd: existing,
      },
      { tenantId: 'org-1' },
    );

    expect(res.ok).toBe(false);
    expect(res.contentMd).toBe(existing);
  });

  it('best-effort: пустой contentMd от LLM → fallback', async () => {
    const existing = '## Назначение\nТело.';
    const llm = makeLlmMock({
      contentMd: '   ',
      steps: [],
      changeReason: 'x',
      signals: [],
    });
    const cfg = makeCfgMock({});
    const svc = new StructuredDocumentCompilerService(llm as any, cfg as any);

    const res = await svc.compile(
      {
        kind: 'policy',
        name: 'Политика Y',
        newSourceBlocks: [{ name: 'b', answer: 'a' }],
        existingContentMd: existing,
      },
      { tenantId: 'org-1' },
    );

    expect(res.ok).toBe(false);
    expect(res.contentMd).toBe(existing);
  });

  it('kill-switch: docCompilerEnabled=false → isEnabled()=false', () => {
    const llm = makeLlmMock({ contentMd: 'x', steps: [], changeReason: '', signals: [] });
    const cfgOff = makeCfgMock({ docCompilerEnabled: false });
    const svc = new StructuredDocumentCompilerService(llm as any, cfgOff as any);
    expect(svc.isEnabled()).toBe(false);

    const cfgOn = makeCfgMock({ docCompilerEnabled: true });
    const svcOn = new StructuredDocumentCompilerService(llm as any, cfgOn as any);
    expect(svcOn.isEnabled()).toBe(true);
  });
});
