import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { CryptoService } from '../../common/crypto/crypto.service';
import type { CoreQueueService } from '../core-queue/core-queue.service';
import type { S3Service } from '../recordings/s3.service';

import {
  ConfluenceAuthError,
  type ConfluenceClient,
} from './confluence-client';
import { DocumentImportService } from './document-import.service';
import type { DocumentsService } from './documents.service';

/**
 * ТЗ-4 Ф7 — unit-тесты `DocumentImportService.processImport`.
 *
 * Проверяем:
 *   1. ZIP с 3 поддерживаемыми записями → totalFiles=3, doneFiles+failedFiles=3,
 *      все done, createOne вызван 3 раза.
 *   2. ZIP с неподдержанной/пустой записью → errorLog содержит её,
 *      failedFiles инкрементнут, импорт НЕ failed (status=completed).
 *   3. Повторный processImport того же importId → no-op (status-guard:
 *      updateMany вернул count=0).
 *
 * Поднимаем сервис напрямую с замоканными prisma / s3 / coreQueue / cfg /
 * documents — без DI-графа и Redis.
 */

interface BatchRow {
  id: string;
  tenantId: string;
  source: 'upload_zip' | 'notion' | 'confluence';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalFiles: number;
  doneFiles: number;
  failedFiles: number;
  errorLog: unknown;
  createdById: string;
  attachedThemeId: string | null;
  attachedProjectId: string | null;
  docType: string | null;
  zipS3Key: string | null;
  zipInline: Uint8Array | null;
  zipSize: number;
}

const ACCEPTED = ['pdf', 'docx', 'xlsx', 'pptx', 'md', 'txt', 'html', 'rtf', 'odt', 'csv'];

function buildService(
  batch: BatchRow,
  confluencePages?: ConfluenceClient['fetchSpacePages'],
) {
  // Stateful in-memory DocumentImport row. updateMany соблюдает where.status,
  // чтобы воспроизвести status-guard идемпотентности.
  const prisma = {
    documentImport: {
      findUnique: vi.fn(async () => ({ ...batch })),
      updateMany: vi.fn(
        async (args: {
          where: { id: string; status?: string };
          data: Partial<BatchRow>;
        }) => {
          if (args.where.status && batch.status !== args.where.status) {
            return { count: 0 };
          }
          Object.assign(batch, args.data);
          return { count: 1 };
        },
      ),
      update: vi.fn(async (args: { data: Partial<BatchRow> }) => {
        Object.assign(batch, args.data);
        return { ...batch };
      }),
      create: vi.fn(),
    },
  };

  const createOne = vi.fn(async () => ({
    id: 'doc-' + Math.random().toString(36).slice(2),
    status: 'uploaded' as const,
    name: 'x',
    deduped: false,
  }));

  const documents = { createOne } as unknown as DocumentsService;
  const s3 = { getObject: vi.fn(), putObject: vi.fn() } as unknown as S3Service;
  const coreQueue = {} as unknown as CoreQueueService;
  const cfg = {
    documentLimits: vi.fn(async () => ({
      maxSizeMb: 50,
      maxSizeBytes: 50 * 1024 * 1024,
      maxFilesPerUpload: 20,
      acceptedFormats: ACCEPTED,
      maxZipSizeMb: 200,
      maxZipSizeBytes: 200 * 1024 * 1024,
    })),
  } as unknown as TypedConfigService;

  const fetchSpacePages = vi.fn(
    confluencePages ?? (async () => []),
  );
  const confluence = { fetchSpacePages } as unknown as ConfluenceClient;
  // Crypto-мок: encrypt/decrypt round-trip без реального ключа (для Ф9 транзита).
  const crypto = {
    encrypt: vi.fn((s: string) => `gcm:v1:enc(${s})`),
    decrypt: vi.fn((s: string) => s.replace(/^gcm:v1:enc\((.*)\)$/, '$1')),
  } as unknown as CryptoService;

  const service = new DocumentImportService(
    prisma as never,
    s3,
    coreQueue,
    cfg,
    documents,
    confluence,
    crypto,
  );
  return { service, prisma, createOne, batch, fetchSpacePages };
}

function baseBatch(
  zip: Uint8Array,
  source: BatchRow['source'] = 'upload_zip',
): BatchRow {
  return {
    id: 'imp-1',
    tenantId: 'tenant-1',
    source,
    status: 'pending',
    totalFiles: 0,
    doneFiles: 0,
    failedFiles: 0,
    errorLog: null,
    createdById: 'person-1',
    attachedThemeId: null,
    attachedProjectId: null,
    docType: null,
    zipS3Key: null,
    zipInline: zip,
    zipSize: zip.byteLength,
  };
}

describe('DocumentImportService.processImport', () => {
  it('3 поддержанные записи → totalFiles=3, все done', async () => {
    const zip = zipSync({
      'reglament.md': strToU8('# Регламент\nтекст'),
      'docs/instruction.txt': strToU8('инструкция шаг 1, шаг 2'),
      'policy.csv': strToU8('a,b,c\n1,2,3'),
    });
    const { service, createOne, batch } = buildService(baseBatch(zip));

    await service.processImport('imp-1');

    expect(createOne).toHaveBeenCalledTimes(3);
    expect(batch.status).toBe('completed');
    expect(batch.totalFiles).toBe(3);
    expect(batch.doneFiles).toBe(3);
    expect(batch.failedFiles).toBe(0);
    // Нет ошибок → service пишет Prisma.JsonNull (правильный sentinel для
    // обнуления JSON-поля), не литеральный null.
    expect(batch.errorLog).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ file: expect.any(String) })]),
    );
    // importBatchId проброшен в createOne.
    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({ importBatchId: 'imp-1', tenantId: 'tenant-1' }),
    );
  });

  it('неподдержанная + пустая запись → в errorLog, failedFiles++, импорт completed', async () => {
    const zip = zipSync({
      'good.md': strToU8('# ok'),
      'image.png': strToU8('not-really-png-but-unsupported-ext'),
      'empty.txt': new Uint8Array([]),
    });
    const { service, createOne, batch } = buildService(baseBatch(zip));

    await service.processImport('imp-1');

    // Только good.md создан.
    expect(createOne).toHaveBeenCalledTimes(1);
    expect(batch.status).toBe('completed');
    expect(batch.doneFiles).toBe(1);
    expect(batch.failedFiles).toBe(2);
    const log = batch.errorLog as Array<{ file: string; error: string }>;
    expect(log).toHaveLength(2);
    const files = log.map((e) => e.file).sort();
    expect(files).toEqual(['empty.txt', 'image.png']);
    expect(log.find((e) => e.file === 'image.png')?.error).toContain('png');
  });

  it('повторный processImport того же importId → no-op (status-guard)', async () => {
    const zip = zipSync({ 'a.md': strToU8('# a') });
    const { service, prisma, createOne, batch } = buildService(baseBatch(zip));

    await service.processImport('imp-1');
    expect(batch.status).toBe('completed');
    expect(createOne).toHaveBeenCalledTimes(1);

    // Второй прогон: status уже completed → updateMany(where status pending)
    // вернёт count=0 → ранний выход, createOne больше не зовётся.
    await service.processImport('imp-1');
    expect(createOne).toHaveBeenCalledTimes(1);
    // update (финализация) вызван ровно один раз — только в первом прогоне.
    expect(prisma.documentImport.update).toHaveBeenCalledTimes(1);
  });

  it('битый архив → status=failed, errorLog с записью про архив', async () => {
    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0xff]);
    const { service, createOne, batch } = buildService(baseBatch(corrupt));

    await service.processImport('imp-1');

    expect(createOne).not.toHaveBeenCalled();
    expect(batch.status).toBe('failed');
    const log = batch.errorLog as Array<{ file: string; error: string }>;
    expect(log[0]?.file).toBe('(архив)');
  });

  // ─────────────────────────── Ф8 — Notion ──────────────────────────────────

  it('Notion-экспорт → имена страниц чищены от 32-hex id, source=notion', async () => {
    const zip = zipSync({
      'Команда abcdef0123456789abcdef0123456789/Регламент онбординга 0123456789abcdef0123456789abcdef.md':
        strToU8('# Онбординг\nшаги'),
      'База знаний 11112222333344445555666677778888.md': strToU8('# База'),
    });
    const { service, createOne, batch } = buildService(baseBatch(zip, 'notion'));

    await service.processImport('imp-1');

    expect(batch.status).toBe('completed');
    expect(batch.doneFiles).toBe(2);
    expect(createOne).toHaveBeenCalledTimes(2);

    // Имена очищены: нет 32-hex id, путь сохранён хлебной крошкой.
    const names = (createOne.mock.calls as unknown[][]).map(
      (c) =>
        (c[0] as { file: { originalName: string } }).file.originalName,
    );
    expect(names).toContain('Команда / Регламент онбординга');
    expect(names).toContain('База знаний');
    // Никакого hex-хвоста не осталось.
    for (const n of names) {
      expect(n).not.toMatch(/[0-9a-f]{32}/i);
    }
    // kind выведен из .md → markdown (формат не сломан чисткой имени).
    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'markdown', importBatchId: 'imp-1' }),
    );
  });

  // ─────────────────────────── Ф9 — Confluence ──────────────────────────────

  it('Confluence: 2 страницы из клиента → 2 Document(text), source=confluence', async () => {
    const fetchPages = async () => [
      { title: 'Политика отпусков', text: 'Текст про отпуска' },
      { title: 'Регламент релизов', text: 'Текст про релизы' },
    ];
    // Confluence-batch без ZIP (zipInline=null).
    const batchRow = baseBatch(new Uint8Array([]), 'confluence');
    batchRow.zipInline = null;
    batchRow.zipSize = 0;
    const { service, createOne, batch, fetchSpacePages } = buildService(
      batchRow,
      fetchPages,
    );

    await service.processImport('imp-1', {
      baseUrl: 'https://acme.atlassian.net',
      email: 'a@acme.com',
      apiToken: 'secret-token',
      spaceKey: 'ENG',
    });

    expect(fetchSpacePages).toHaveBeenCalledTimes(1);
    expect(batch.status).toBe('completed');
    expect(batch.doneFiles).toBe(2);
    expect(batch.failedFiles).toBe(0);
    expect(createOne).toHaveBeenCalledTimes(2);
    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'text', importBatchId: 'imp-1' }),
    );
  });

  it('Confluence: неверный токен → status=failed + confluence_auth_failed', async () => {
    const fetchPages = async () => {
      throw new ConfluenceAuthError('доступ отклонён', 401);
    };
    const batchRow = baseBatch(new Uint8Array([]), 'confluence');
    batchRow.zipInline = null;
    const { service, createOne, batch } = buildService(batchRow, fetchPages);

    await service.processImport('imp-1', {
      baseUrl: 'https://acme.atlassian.net',
      email: 'a@acme.com',
      apiToken: 'bad-token',
      spaceKey: 'ENG',
    });

    expect(createOne).not.toHaveBeenCalled();
    expect(batch.status).toBe('failed');
    const log = batch.errorLog as Array<{ file: string; error: string }>;
    expect(log[0]?.file).toBe('(confluence)');
    expect(log[0]?.error).toContain('confluence_auth_failed');
  });

  it('encrypt/decrypt токена — round-trip через CryptoService', () => {
    const { service } = buildService(baseBatch(new Uint8Array([])));
    const enc = service.encryptConfluenceToken('my-secret');
    expect(enc).not.toBe('my-secret');
    expect(service.decryptConfluenceToken(enc)).toBe('my-secret');
  });
});
