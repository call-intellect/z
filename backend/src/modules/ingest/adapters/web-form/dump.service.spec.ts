/**
 * Юнит-тесты `DumpService.createDump` (Ф9 «владелец без Person»,
 * `plans/tz/2026-06-04-razblokirovka-konveyera.md`).
 *
 * Покрытие:
 *   - ensurePersonForUser нашёл/создал Person → дамп идёт через Document-путь
 *     (createTextDocumentAndPublish, uploaderPersonId), НЕ legacy ingest;
 *   - ensurePersonForUser бросил → graceful fallback на legacy ingest
 *     (не валим дамп).
 */
import { describe, expect, it, vi } from 'vitest';

import { DumpService } from './dump.service';

function build(overrides: {
  ensure?: () => Promise<{ id: string }>;
}) {
  const prisma = {
    person: { findFirst: vi.fn() },
    document: {
      create: vi.fn(async () => ({ id: 'doc-1' })),
    },
    source: {
      findUnique: vi.fn(async () => ({
        id: 'src-1',
        dataClass: 'internal',
      })),
      create: vi.fn(),
    },
  };
  const ingest = {
    ingest: vi.fn(async () => ({
      rawEvent: { id: 'raw-1' },
      idempotent: false,
    })),
  };
  const quota = { checkAndIncrement: vi.fn(async () => undefined) };
  const audit = { log: vi.fn(async () => undefined) };
  const cfg = {};
  const coreQueue = { enqueueDumpCreated: vi.fn(async () => undefined) };
  const persons = {
    ensurePersonForUser: vi.fn(
      overrides.ensure ?? (async () => ({ id: 'person-1' })),
    ),
  };

  const svc = new DumpService(
    prisma as never,
    ingest as never,
    quota as never,
    audit as never,
    cfg as never,
    coreQueue as never,
    persons as never,
  );
  return { svc, prisma, ingest, persons, coreQueue, audit };
}

describe('DumpService.createDump — Ф9 Document-путь', () => {
  it('Person есть → Document-путь (uploaderPersonId), legacy ingest НЕ вызывается', async () => {
    const { svc, prisma, ingest, persons } = build({});

    const res = await svc.createDump({
      tenantId: 'org-1',
      userId: 'u-1',
      userName: 'Влад',
      text: 'мысль',
    });

    expect(persons.ensurePersonForUser).toHaveBeenCalledWith({
      tenantId: 'org-1',
      userId: 'u-1',
    });
    // Document создан с uploaderId = personId.
    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ uploaderId: 'person-1' }),
      }),
    );
    // Legacy ingest-путь не задействован.
    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(res.documentId).toBe('doc-1');
  });

  it('ensurePersonForUser бросил → graceful fallback на legacy ingest', async () => {
    const { svc, prisma, ingest } = build({
      ensure: async () => {
        throw new Error('db down');
      },
    });

    const res = await svc.createDump({
      tenantId: 'org-1',
      userId: 'u-1',
      userName: 'Влад',
      text: 'мысль',
    });

    // Document НЕ создан, ушли в legacy RawEvent.
    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(ingest.ingest).toHaveBeenCalledOnce();
    expect(res.rawEventId).toBe('raw-1');
    expect(res.documentId).toBeUndefined();
  });
});
