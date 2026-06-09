import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';

import { DocumentsService } from './documents.service';

/**
 * ТЗ-4 Волна 2 (B2) — unit-тесты `DocumentsService.setAttribution`.
 *
 * Проверяем:
 *   (a) выставляет docType/attachedTheme + очищает suggested* + проецирует
 *       привязку (roleId/roleRelevant + ThemeIdeaBlock) на блоки документа;
 *   (b) tenant-scope: чужой Org → document_not_found / foreign_tenant;
 *   (c) чужая тема → theme_not_found (404) ДО записи;
 *   (d) нет блоков у документа → запись колонок есть, проекция в граф no-op;
 *   (e) attachedThemeId=null снимает привязку (disconnect), проекция темы не идёт.
 */
describe('DocumentsService.setAttribution (ТЗ-4 Волна 2 B2)', () => {
  const TENANT = 'org_1';
  const DOC = 'doc_1';
  const THEME = 'theme_a';

  let documentFindUnique: ReturnType<typeof vi.fn>;
  let documentUpdate: ReturnType<typeof vi.fn>;
  let themeFindUnique: ReturnType<typeof vi.fn>;
  let projectFindUnique: ReturnType<typeof vi.fn>;
  let evidenceFindMany: ReturnType<typeof vi.fn>;
  let ideaBlockUpdateMany: ReturnType<typeof vi.fn>;
  let themeIdeaBlockCreateMany: ReturnType<typeof vi.fn>;
  let svc: DocumentsService;

  function makeDoc(overrides?: Record<string, unknown>) {
    return {
      id: DOC,
      tenantId: TENANT,
      deletedAt: null,
      docType: null,
      attachedRoleId: null,
      attachedThemeId: null,
      attachedProjectId: null,
      suggestedDocType: 'regulation',
      suggestedThemeId: THEME,
      ...overrides,
    };
  }

  function build() {
    documentFindUnique = vi.fn(async () => makeDoc());
    // update возвращает документ с применёнными полями (для проекции).
    documentUpdate = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) =>
        makeDoc({
          docType:
            (data.docType as string | null | undefined) ?? null,
          attachedThemeId:
            data.attachedTheme && 'connect' in (data.attachedTheme as object)
              ? THEME
              : null,
          suggestedDocType: null,
          suggestedThemeId: null,
        }),
    );
    themeFindUnique = vi.fn(async () => ({ tenantId: TENANT }));
    projectFindUnique = vi.fn(async () => ({ tenantId: TENANT }));
    evidenceFindMany = vi.fn(async () => [
      { blockId: 'b1' },
      { blockId: 'b2' },
    ]);
    ideaBlockUpdateMany = vi.fn(async () => ({ count: 2 }));
    themeIdeaBlockCreateMany = vi.fn(async () => ({ count: 2 }));

    const prisma = {
      document: { findUnique: documentFindUnique, update: documentUpdate },
      theme: { findUnique: themeFindUnique },
      project: { findUnique: projectFindUnique },
      ideaBlockEvidence: { findMany: evidenceFindMany },
      ideaBlock: { updateMany: ideaBlockUpdateMany },
      themeIdeaBlock: { createMany: themeIdeaBlockCreateMany },
    } as unknown as PrismaService;

    const s3 = {} as never;
    const coreQueue = {} as never;
    const dumps = {} as never;
    const cfg = {} as unknown as TypedConfigService;

    svc = new DocumentsService(prisma, s3, coreQueue, dumps, cfg);
  }

  beforeEach(() => build());

  it('(a) ставит docType+тему, чистит suggested*, проецирует тему на блоки', async () => {
    const res = await svc.setAttribution({
      tenantId: TENANT,
      documentId: DOC,
      docType: 'regulation',
      attachedThemeId: THEME,
    });

    // Запись колонок + очистка подсказок.
    expect(documentUpdate).toHaveBeenCalledTimes(1);
    const data = documentUpdate.mock.calls[0]?.[0].data;
    expect(data.docType).toBe('regulation');
    expect(data.suggestedDocType).toBeNull();
    expect(data.suggestedThemeId).toBeNull();
    expect(data.attachedTheme).toEqual({ connect: { id: THEME } });

    // Проекция в граф: ThemeIdeaBlock на все блоки документа (skipDuplicates).
    expect(themeIdeaBlockCreateMany).toHaveBeenCalledTimes(1);
    const tib = themeIdeaBlockCreateMany.mock.calls[0]?.[0];
    expect(tib.skipDuplicates).toBe(true);
    expect(tib.data).toHaveLength(2);
    expect(tib.data[0].themeId).toBe(THEME);

    // attachedRoleId на документе нет → роль на блоки не проецируем.
    expect(ideaBlockUpdateMany).not.toHaveBeenCalled();

    expect(res.suggestedDocType).toBeNull();
  });

  it('(b) чужой Org → ошибка ДО update', async () => {
    documentFindUnique.mockResolvedValueOnce(makeDoc({ tenantId: 'org_2' }));
    await expect(
      svc.setAttribution({ tenantId: TENANT, documentId: DOC, docType: 'policy' }),
    ).rejects.toBeInstanceOf(Error);
    expect(documentUpdate).not.toHaveBeenCalled();
  });

  it('(c) чужая тема → 404 ДО записи', async () => {
    themeFindUnique.mockResolvedValueOnce({ tenantId: 'org_2' });
    await expect(
      svc.setAttribution({
        tenantId: TENANT,
        documentId: DOC,
        attachedThemeId: THEME,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(documentUpdate).not.toHaveBeenCalled();
    expect(themeIdeaBlockCreateMany).not.toHaveBeenCalled();
  });

  it('(d) нет блоков → колонки пишутся, проекция в граф no-op', async () => {
    evidenceFindMany.mockResolvedValueOnce([]);
    await svc.setAttribution({
      tenantId: TENANT,
      documentId: DOC,
      docType: 'regulation',
      attachedThemeId: THEME,
    });
    expect(documentUpdate).toHaveBeenCalledTimes(1);
    expect(themeIdeaBlockCreateMany).not.toHaveBeenCalled();
    expect(ideaBlockUpdateMany).not.toHaveBeenCalled();
  });

  it('(e) attachedThemeId=null снимает привязку, тему не проецирует', async () => {
    await svc.setAttribution({
      tenantId: TENANT,
      documentId: DOC,
      attachedThemeId: null,
    });
    const data = documentUpdate.mock.calls[0]?.[0].data;
    expect(data.attachedTheme).toEqual({ disconnect: true });
    // updated.attachedThemeId === null (мок) → проекция темы не идёт.
    expect(themeIdeaBlockCreateMany).not.toHaveBeenCalled();
  });

  it('проецирует роль на блоки, если у документа есть attachedRoleId', async () => {
    documentUpdate.mockResolvedValueOnce(
      makeDoc({
        docType: 'regulation',
        attachedRoleId: 'role_1',
        attachedThemeId: null,
        suggestedDocType: null,
        suggestedThemeId: null,
      }),
    );
    await svc.setAttribution({
      tenantId: TENANT,
      documentId: DOC,
      docType: 'regulation',
    });
    expect(ideaBlockUpdateMany).toHaveBeenCalledTimes(1);
    const upd = ideaBlockUpdateMany.mock.calls[0]?.[0];
    expect(upd.data).toEqual({ roleId: 'role_1', roleRelevant: true });
    expect(upd.where.id).toEqual({ in: ['b1', 'b2'] });
  });
});
