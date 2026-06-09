import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentsService } from './documents.service';

/**
 * ТЗ-4 Ф3 — multipart-загрузка с атрибуцией и дедупликацией.
 *
 * Юнит-тесты сервиса на моках (Prisma / S3 / CoreQueue / Config). Проверяем:
 *   - multifile: возвращает items[] по числу файлов;
 *   - dedup: повторная идентичная загрузка → deduped:true и 2-й Document
 *     НЕ создаётся (document.create вызван 1 раз на 2 идентичных файла);
 *   - attachedThemeId чужой Org → theme_not_found (404);
 *   - лимиты Ф6: too_many_files / unsupported_format / file_too_large.
 */

const TENANT = 'org_1';
const PERSON = 'person_1';

function makeFile(name: string, content: string, mime = 'text/plain') {
  const buffer = Buffer.from(content, 'utf8');
  return { buffer, originalName: name, mimeType: mime, size: buffer.length };
}

function buildService(opts?: {
  limits?: Partial<{
    maxSizeMb: number;
    maxFilesPerUpload: number;
    acceptedFormats: readonly string[];
  }>;
  existingByHash?: Map<string, { id: string; status: string }>;
}) {
  const existingByHash = opts?.existingByHash ?? new Map();
  const createdDocs: Array<Record<string, unknown>> = [];

  const document = {
    findFirst: vi.fn(async ({ where }: { where: { contentHash?: string } }) => {
      const hit = where.contentHash
        ? existingByHash.get(where.contentHash)
        : undefined;
      return hit ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const id = `doc_${createdDocs.length + 1}`;
      const doc = { id, status: 'uploaded', ...data };
      createdDocs.push(doc);
      // Зеркалим дедуп-индекс: следующий идентичный файл найдётся как существующий.
      if (typeof data.contentHash === 'string') {
        existingByHash.set(data.contentHash, { id, status: 'uploaded' });
      }
      return doc;
    }),
    count: vi.fn(async () => createdDocs.length),
  };
  const role = { findUnique: vi.fn(async () => ({ tenantId: TENANT })) };
  const theme = {
    findUnique: vi.fn(
      async (): Promise<{ tenantId: string } | null> => null,
    ),
  };
  const project = { findUnique: vi.fn(async () => ({ tenantId: TENANT })) };

  const prisma = { document, role, theme, project } as never;
  const s3 = { putObject: vi.fn(async () => undefined) } as never;
  const coreQueue = {
    enqueueDocumentUploaded: vi.fn(async () => ({ jobId: 'j1' })),
  } as never;
  const dumps = {} as never;

  const limits = {
    maxSizeMb: 50,
    maxSizeBytes: 50 * 1024 * 1024,
    maxFilesPerUpload: 20,
    acceptedFormats: ['pdf', 'docx', 'txt', 'md', 'csv'] as readonly string[],
    ...opts?.limits,
  };
  // maxSizeBytes пересчитываем из переопределённого maxSizeMb.
  limits.maxSizeBytes = limits.maxSizeMb * 1024 * 1024;

  const cfg = {
    documentLimits: vi.fn(async () => limits),
    document: { inlineThresholdBytes: 5 * 1024 * 1024 },
  } as never;

  const service = new DocumentsService(prisma, s3, coreQueue, dumps, cfg);
  return { service, document, theme, project, coreQueue, createdDocs };
}

describe('DocumentsService.uploadMany (ТЗ-4 Ф3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('multifile: возвращает items[] по числу файлов, все deduped:false', async () => {
    const { service, document } = buildService();
    const res = await service.uploadMany({
      tenantId: TENANT,
      uploaderPersonId: PERSON,
      files: [makeFile('a.txt', 'alpha'), makeFile('b.txt', 'bravo')],
    });
    expect(res.items).toHaveLength(2);
    expect(res.items.map((i) => i.name)).toEqual(['a.txt', 'b.txt']);
    expect(res.items.every((i) => i.deduped === false)).toBe(true);
    expect(document.create).toHaveBeenCalledTimes(2);
  });

  it('dedup: повторная идентичная загрузка → deduped:true, 2-й Document не создаётся', async () => {
    const { service, document } = buildService();
    const first = await service.uploadMany({
      tenantId: TENANT,
      uploaderPersonId: PERSON,
      files: [makeFile('doc.txt', 'identical-content')],
    });
    expect(first.items[0]?.deduped).toBe(false);

    const second = await service.uploadMany({
      tenantId: TENANT,
      uploaderPersonId: PERSON,
      files: [makeFile('doc-renamed.txt', 'identical-content')],
    });
    expect(second.items[0]?.deduped).toBe(true);
    // тот же существующий id, что у первого
    expect(second.items[0]?.id).toBe(first.items[0]?.id);
    // create вызван ровно 1 раз за обе загрузки
    expect(document.create).toHaveBeenCalledTimes(1);
    // prisma.count подтверждает: в «БД» только 1 Document
    expect(await document.count()).toBe(1);
  });

  it('attachedThemeId чужой Org → theme_not_found (404)', async () => {
    const { service, theme, document } = buildService();
    // theme.findUnique возвращает null (как для чужой/несуществующей темы)
    theme.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.uploadMany({
        tenantId: TENANT,
        uploaderPersonId: PERSON,
        files: [makeFile('a.txt', 'x')],
        attachedThemeId: 'theme_foreign',
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'theme_not_found' } },
    });
    // На несоответствии атрибуции ни один Document не создан.
    expect(document.create).not.toHaveBeenCalled();
  });

  it('attachedThemeId своей Org → проходит', async () => {
    const { service, theme } = buildService();
    theme.findUnique.mockResolvedValueOnce({ tenantId: TENANT });
    const res = await service.uploadMany({
      tenantId: TENANT,
      uploaderPersonId: PERSON,
      files: [makeFile('a.txt', 'x')],
      attachedThemeId: 'theme_own',
    });
    expect(res.items).toHaveLength(1);
  });

  it('лимит Ф6: too_many_files', async () => {
    const { service } = buildService({ limits: { maxFilesPerUpload: 1 } });
    await expect(
      service.uploadMany({
        tenantId: TENANT,
        uploaderPersonId: PERSON,
        files: [makeFile('a.txt', 'x'), makeFile('b.txt', 'y')],
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'too_many_files' } },
    });
  });

  it('лимит Ф6: unsupported_format', async () => {
    const { service } = buildService();
    await expect(
      service.uploadMany({
        tenantId: TENANT,
        uploaderPersonId: PERSON,
        files: [makeFile('a.exe', 'x', 'application/octet-stream')],
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'unsupported_format' } },
    });
  });

  it('лимит Ф6: file_too_large', async () => {
    const { service } = buildService({ limits: { maxSizeMb: 1 } });
    // 2 МБ > 1 МБ лимита
    const big = {
      buffer: Buffer.alloc(2 * 1024 * 1024, 1),
      originalName: 'big.txt',
      mimeType: 'text/plain',
      size: 2 * 1024 * 1024,
    };
    await expect(
      service.uploadMany({
        tenantId: TENANT,
        uploaderPersonId: PERSON,
        files: [big],
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'file_too_large' } },
    });
  });

  it('attachedProjectId чужой Org → project_not_found (404)', async () => {
    const { service, project } = buildService();
    project.findUnique.mockResolvedValueOnce({ tenantId: 'org_other' });
    await expect(
      service.uploadMany({
        tenantId: TENANT,
        uploaderPersonId: PERSON,
        files: [makeFile('a.txt', 'x')],
        attachedProjectId: 'proj_foreign',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
