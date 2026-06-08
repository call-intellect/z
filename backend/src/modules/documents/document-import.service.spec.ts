import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { CoreQueueService } from '../core-queue/core-queue.service';
import type { S3Service } from '../recordings/s3.service';

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

function buildService(batch: BatchRow) {
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

  const service = new DocumentImportService(
    prisma as never,
    s3,
    coreQueue,
    cfg,
    documents,
  );
  return { service, prisma, createOne, batch };
}

function baseBatch(zip: Uint8Array): BatchRow {
  return {
    id: 'imp-1',
    tenantId: 'tenant-1',
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
});
