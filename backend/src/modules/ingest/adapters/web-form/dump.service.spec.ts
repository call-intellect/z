import { describe, expect, it, vi } from 'vitest';

import { DumpService, deriveTextNoteName } from './dump.service';

function build(overrides: { ensure?: () => Promise<{ id: string }> }) {
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
    ensurePersonForUser: vi.fn(overrides.ensure ?? (async () => ({ id: 'person-1' }))),
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
    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ uploaderId: 'person-1' }),
      }),
    );
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

    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(ingest.ingest).toHaveBeenCalledOnce();
    expect(res.rawEventId).toBe('raw-1');
    expect(res.documentId).toBeUndefined();
  });

  it('asIdea=true → Document НЕ создаётся, идёт в граф (legacy ingest)', async () => {
    const { svc, prisma, ingest } = build({});

    const res = await svc.createDump({
      tenantId: 'org-1',
      userId: 'u-1',
      userName: 'Влад',
      text: 'короткая идея',
      asIdea: true,
    });

    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(ingest.ingest).toHaveBeenCalledOnce();
    expect(res.rawEventId).toBe('raw-1');
    expect(res.documentId).toBeUndefined();
  });
});

describe('DumpService.createTextDocumentAndPublish — имя из первой строки (R16)', () => {
  it('имя = первая непустая строка (не «Дамп от …»)', async () => {
    const { svc, prisma } = build({});

    await svc.createTextDocumentAndPublish({
      tenantId: 'org-1',
      uploaderPersonId: 'person-1',
      userId: 'u-1',
      text: '  Нанять второго дизайнера\n\nДетали ниже...',
    });

    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Нанять второго дизайнера' }),
      }),
    );
  });
});

describe('deriveTextNoteName', () => {
  const d = new Date('2026-06-22T09:05:00');

  it('берёт первую непустую строку и тримит', () => {
    expect(deriveTextNoteName('  Привет мир  \nвторая строка', d)).toBe('Привет мир');
  });

  it('пропускает пустые ведущие строки', () => {
    expect(deriveTextNoteName('\n\n  Идея дня\nещё', d)).toBe('Идея дня');
  });

  it('обрезает длинную строку до ~80 символов с многоточием', () => {
    const long = 'a'.repeat(200);
    const name = deriveTextNoteName(long, d);
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith('…')).toBe(true);
  });

  it('пустой текст → запасное «Текстовая заметка от …», без слова «Дамп»', () => {
    const name = deriveTextNoteName('   \n  \n ', d);
    expect(name.startsWith('Текстовая заметка от ')).toBe(true);
    expect(name).not.toContain('Дамп');
  });
});
