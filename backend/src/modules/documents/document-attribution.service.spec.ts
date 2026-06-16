import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';

import { DocumentAttributionService } from './document-attribution.service';

describe('DocumentAttributionService', () => {
  const TENANT = 'org-1';
  const DOC = 'doc-1';

  const THEMES = [
    { id: 'theme-a', name: 'Продажи' },
    { id: 'theme-b', name: 'HR' },
  ];

  let call: ReturnType<typeof vi.fn>;
  let getDynamic: ReturnType<typeof vi.fn>;
  let docFindUnique: ReturnType<typeof vi.fn>;
  let docUpdateMany: ReturnType<typeof vi.fn>;
  let themeFindMany: ReturnType<typeof vi.fn>;
  let svc: DocumentAttributionService;

  function makeDoc(overrides?: Record<string, unknown>) {
    return {
      tenantId: TENANT,
      status: 'parsed',
      parsedText: 'Регламент согласования договоров. Шаг 1...',
      docType: null,
      attachedThemeId: null,
      suggestedDocType: null,
      ...overrides,
    };
  }

  function reply(obj: unknown) {
    return {
      text: JSON.stringify(obj),
      modelUsed: 'deepseek:deepseek-v4-flash',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
    };
  }

  beforeEach(() => {
    call = vi.fn();
    getDynamic = vi.fn(async () => true);
    docFindUnique = vi.fn(async () => makeDoc());
    docUpdateMany = vi.fn(async () => ({ count: 1 }));
    themeFindMany = vi.fn(async () => THEMES);

    const llm = { call } as unknown as LlmRouterService;
    const prisma = {
      document: { findUnique: docFindUnique, updateMany: docUpdateMany },
      theme: { findMany: themeFindMany },
    } as unknown as PrismaService;
    const cfg = { getDynamic } as unknown as TypedConfigService;

    svc = new DocumentAttributionService(llm, prisma, cfg);
  });

  it('(a) пишет suggested* (НЕ docType) для документа без атрибуции', async () => {
    call.mockResolvedValueOnce(
      reply({ docType: 'regulation', themeId: 'theme-a', confidence: 0.9 }),
    );

    await svc.suggestForDocument({ documentId: DOC, tenantId: TENANT });

    expect(call).toHaveBeenCalledTimes(1);
    const callArg = call.mock.calls[0]?.[0];
    expect(callArg.taskType).toBe('document-attribution-suggest');

    expect(docUpdateMany).toHaveBeenCalledTimes(1);
    const update = docUpdateMany.mock.calls[0]?.[0];
    expect(update.data).toEqual({
      suggestedDocType: 'regulation',
      suggestedThemeId: 'theme-a',
    });
    expect(update.data).not.toHaveProperty('docType');
    expect(update.data).not.toHaveProperty('attachedThemeId');
    expect(update.where).toMatchObject({
      id: DOC,
      docType: null,
      attachedThemeId: null,
      suggestedDocType: null,
    });
  });

  it('(b) kill-switch OFF → LLM не вызывается, записи нет', async () => {
    getDynamic.mockResolvedValueOnce(false);

    await svc.suggestForDocument({ documentId: DOC, tenantId: TENANT });

    expect(call).not.toHaveBeenCalled();
    expect(docUpdateMany).not.toHaveBeenCalled();
  });

  it('(c) идемпотентность: suggestedDocType уже стоит → skip', async () => {
    docFindUnique.mockResolvedValueOnce(makeDoc({ suggestedDocType: 'policy' }));

    await svc.suggestForDocument({ documentId: DOC, tenantId: TENANT });

    expect(call).not.toHaveBeenCalled();
    expect(docUpdateMany).not.toHaveBeenCalled();
  });

  it('(d) документ атрибутирован вручную (docType != null) → skip', async () => {
    docFindUnique.mockResolvedValueOnce(makeDoc({ docType: 'instruction' }));

    await svc.suggestForDocument({ documentId: DOC, tenantId: TENANT });

    expect(call).not.toHaveBeenCalled();
    expect(docUpdateMany).not.toHaveBeenCalled();
  });

  it('(e) выдуманный themeId / неизвестный docType отбрасываются', async () => {
    call.mockResolvedValueOnce(
      reply({ docType: 'made_up_type', themeId: 'theme-zzz', confidence: 0.8 }),
    );

    await svc.suggestForDocument({ documentId: DOC, tenantId: TENANT });

    expect(docUpdateMany).not.toHaveBeenCalled();
  });

  it('(e2) валидный docType + выдуманный themeId → пишем тип, тему null', async () => {
    call.mockResolvedValueOnce(
      reply({ docType: 'process', themeId: 'theme-zzz', confidence: 0.7 }),
    );

    await svc.suggestForDocument({ documentId: DOC, tenantId: TENANT });

    expect(docUpdateMany).toHaveBeenCalledTimes(1);
    expect(docUpdateMany.mock.calls[0]?.[0].data).toEqual({
      suggestedDocType: 'process',
      suggestedThemeId: null,
    });
  });

  it('(f) LLM бросил → best-effort, исключение не пробрасывается', async () => {
    call.mockRejectedValueOnce(new Error('provider down'));

    await expect(
      svc.suggestForDocument({ documentId: DOC, tenantId: TENANT }),
    ).resolves.toBeUndefined();
    expect(docUpdateMany).not.toHaveBeenCalled();
  });

  it('пустой parsedText → LLM не вызывается', async () => {
    docFindUnique.mockResolvedValueOnce(makeDoc({ parsedText: '   ' }));

    await svc.suggestForDocument({ documentId: DOC, tenantId: TENANT });

    expect(call).not.toHaveBeenCalled();
    expect(docUpdateMany).not.toHaveBeenCalled();
  });
});
