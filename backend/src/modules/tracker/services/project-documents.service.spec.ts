import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ProjectDocumentsService } from './project-documents.service';
import type { ProjectsService } from './projects.service';
import type { TrackerEmitterService } from './tracker-emitter.service';
import type { TrackerEventsService } from './tracker-events.service';

/**
 * Unit-тесты `ProjectDocumentsService` (2026-05-27).
 *
 * Покрытие:
 *  1. listForProject — фильтрация по tenantId + deletedAt=null.
 *  2. create — sortOrder=max+1, metrics, WS-event, knowledge-core ingest emit.
 *  3. create — 409 на duplicate title (Prisma P2002).
 *  4. update — author может писать; non-author без admin → 403; admin → ok.
 *  5. update — emit ingest только при изменении content или title.
 *  6. delete — soft-delete (deletedAt) + WS deleted.
 *  7. listLinkedCards — вызывает $queryRaw с tenant+projectId, инкремент метрики.
 *
 * Тест работает с in-memory store, без реальной БД.
 */

interface FakeDoc {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  content: unknown;
  contentHtml: string | null;
  contentStripped: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface Store {
  docs: Map<string, FakeDoc>;
  linkedCards: Array<{
    id: string;
    name: string;
    kind: string;
    color: string;
    meetingCount: number;
    lastMeetingAt: Date | null;
    contactName: string | null;
  }>;
}

function makeStore(): Store {
  return {
    docs: new Map<string, FakeDoc>(),
    linkedCards: [],
  };
}

function makeService(store: Store): {
  svc: ProjectDocumentsService;
  metrics: {
    incProjectDocumentCreated: ReturnType<typeof vi.fn>;
    incProjectDocumentUpdated: ReturnType<typeof vi.fn>;
    incLinkedCardsView: ReturnType<typeof vi.fn>;
  };
  events: {
    publishProjectDocumentCreated: ReturnType<typeof vi.fn>;
    publishProjectDocumentUpdated: ReturnType<typeof vi.fn>;
    publishProjectDocumentDeleted: ReturnType<typeof vi.fn>;
  };
  emitter: {
    emitProjectDocumentChanged: ReturnType<typeof vi.fn>;
  };
} {
  let idSeq = 1;
  const nextId = (): string => `doc-${idSeq++}`;

  const prisma = {
    projectDocument: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            id?: string;
            projectId?: string;
            tenantId?: string;
            deletedAt?: null;
            title?: string;
          };
        }) => {
          for (const d of store.docs.values()) {
            if (where.id !== undefined && d.id !== where.id) continue;
            if (where.tenantId !== undefined && d.tenantId !== where.tenantId)
              continue;
            if (
              where.projectId !== undefined &&
              d.projectId !== where.projectId
            )
              continue;
            if (where.title !== undefined && d.title !== where.title) continue;
            if (where.deletedAt === null && d.deletedAt !== null) continue;
            return d;
          }
          return null;
        },
      ),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            projectId?: string;
            tenantId?: string;
            deletedAt?: null;
            // audit С20: cascading soft-delete передаёт parentId: { in: [...] }.
            parentId?: { in: string[] };
          };
        }) => {
          let rows = Array.from(store.docs.values()).filter((d) => {
            if (where.tenantId !== undefined && d.tenantId !== where.tenantId)
              return false;
            if (where.projectId !== undefined && d.projectId !== where.projectId)
              return false;
            if (where.deletedAt === null && d.deletedAt !== null) return false;
            if (
              where.parentId?.in !== undefined &&
              (d.parentId === null || !where.parentId.in.includes(d.parentId))
            )
              return false;
            return true;
          });
          // orderBy для listForProject (pinned/sortOrder/createdAt).
          rows = rows.sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            return a.createdAt.getTime() - b.createdAt.getTime();
          });
          return rows;
        },
      ),
      aggregate: vi.fn(
        async ({
          where,
        }: {
          where: { projectId: string; tenantId: string; deletedAt: null };
        }) => {
          const arr = Array.from(store.docs.values()).filter(
            (d) =>
              d.projectId === where.projectId &&
              d.tenantId === where.tenantId &&
              d.deletedAt === null,
          );
          if (arr.length === 0) return { _max: { sortOrder: null } };
          return {
            _max: { sortOrder: Math.max(...arr.map((d) => d.sortOrder)) },
          };
        },
      ),
      create: vi.fn(
        async ({ data }: { data: Partial<FakeDoc> & { title: string } }) => {
          // Эмуляция P2002 на уникальность (projectId, title).
          for (const d of store.docs.values()) {
            if (
              d.projectId === data.projectId &&
              d.tenantId === data.tenantId &&
              d.title === data.title &&
              d.deletedAt === null
            ) {
              throw new Prisma.PrismaClientKnownRequestError(
                'Unique constraint failed',
                {
                  code: 'P2002',
                  clientVersion: 'test',
                },
              );
            }
          }
          const id = nextId();
          const now = new Date();
          const doc: FakeDoc = {
            id,
            tenantId: data.tenantId ?? 'tenant-1',
            projectId: data.projectId ?? 'project-1',
            title: data.title,
            content: data.content ?? { type: 'doc', content: [] },
            contentHtml: data.contentHtml ?? null,
            contentStripped: data.contentStripped ?? null,
            parentId: data.parentId ?? null,
            sortOrder: data.sortOrder ?? 0,
            pinned: data.pinned ?? false,
            entityId: data.entityId ?? null,
            createdById: data.createdById ?? 'user-1',
            updatedById: data.updatedById ?? data.createdById ?? 'user-1',
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          };
          store.docs.set(id, doc);
          return doc;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<FakeDoc> & {
            parent?: { connect?: { id: string }; disconnect?: boolean };
          };
        }) => {
          const existing = store.docs.get(where.id);
          if (!existing) throw new Error('not found');
          // Эмуляция связи parent → parentId.
          let parentId = existing.parentId;
          if (data.parent) {
            if (data.parent.disconnect) parentId = null;
            else if (data.parent.connect) parentId = data.parent.connect.id;
          }
          const next: FakeDoc = {
            ...existing,
            ...data,
            parentId,
            updatedAt: new Date(),
          };
          store.docs.set(where.id, next);
          return next;
        },
      ),
      // audit С20 (2026-05-29): cascading soft-delete делает BFS+updateMany.
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id?: { in: string[] };
            tenantId?: string;
            deletedAt?: null;
          };
          data: { deletedAt?: Date };
        }) => {
          let count = 0;
          for (const d of store.docs.values()) {
            if (where.id?.in && !where.id.in.includes(d.id)) continue;
            if (where.tenantId !== undefined && d.tenantId !== where.tenantId)
              continue;
            if (where.deletedAt === null && d.deletedAt !== null) continue;
            if (data.deletedAt !== undefined) d.deletedAt = data.deletedAt;
            count += 1;
          }
          return { count };
        },
      ),
    },
    $queryRaw: vi.fn(async () => store.linkedCards),
  } as unknown as PrismaService;

  const projects = {
    requireProject: vi.fn(async (id: string, tenantId: string) => {
      return { id, tenantId };
    }),
  } as unknown as ProjectsService;

  const events = {
    publishProjectDocumentCreated: vi.fn(),
    publishProjectDocumentUpdated: vi.fn(),
    publishProjectDocumentDeleted: vi.fn(),
  } as unknown as TrackerEventsService & {
    publishProjectDocumentCreated: ReturnType<typeof vi.fn>;
    publishProjectDocumentUpdated: ReturnType<typeof vi.fn>;
    publishProjectDocumentDeleted: ReturnType<typeof vi.fn>;
  };

  const emitter = {
    emitProjectDocumentChanged: vi.fn(),
  } as unknown as TrackerEmitterService & {
    emitProjectDocumentChanged: ReturnType<typeof vi.fn>;
  };

  const metrics = {
    incProjectDocumentCreated: vi.fn(),
    incProjectDocumentUpdated: vi.fn(),
    incLinkedCardsView: vi.fn(),
  } as unknown as BusinessMetricsService & {
    incProjectDocumentCreated: ReturnType<typeof vi.fn>;
    incProjectDocumentUpdated: ReturnType<typeof vi.fn>;
    incLinkedCardsView: ReturnType<typeof vi.fn>;
  };

  const svc = new ProjectDocumentsService(
    prisma,
    projects,
    events,
    emitter,
    metrics,
  );

  return {
    svc,
    metrics: {
      incProjectDocumentCreated: metrics.incProjectDocumentCreated,
      incProjectDocumentUpdated: metrics.incProjectDocumentUpdated,
      incLinkedCardsView: metrics.incLinkedCardsView,
    },
    events: {
      publishProjectDocumentCreated: events.publishProjectDocumentCreated,
      publishProjectDocumentUpdated: events.publishProjectDocumentUpdated,
      publishProjectDocumentDeleted: events.publishProjectDocumentDeleted,
    },
    emitter: {
      emitProjectDocumentChanged: emitter.emitProjectDocumentChanged,
    },
  };
}

describe('ProjectDocumentsService', () => {
  let store: Store;

  beforeEach(() => {
    store = makeStore();
  });

  it('create: первый документ — sortOrder=0, метрика, WS-event, ingest emit', async () => {
    const { svc, metrics, events, emitter } = makeService(store);
    const doc = await svc.create(
      'project-1',
      { title: 'Бриф', contentStripped: 'Текст брифа' },
      'tenant-1',
      'user-1',
    );

    expect(doc.title).toBe('Бриф');
    expect(doc.sortOrder).toBe(0);
    expect(doc.createdById).toBe('user-1');
    expect(metrics.incProjectDocumentCreated).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      project: 'project-1',
    });
    expect(events.publishProjectDocumentCreated).toHaveBeenCalledTimes(1);
    expect(emitter.emitProjectDocumentChanged).toHaveBeenCalledTimes(1);
    expect(emitter.emitProjectDocumentChanged.mock.calls[0]?.[0]).toMatchObject(
      {
        changeType: 'created',
        documentId: doc.id,
        fullText: 'Текст брифа',
      },
    );
  });

  it('create: второй документ — sortOrder=max+1', async () => {
    const { svc } = makeService(store);
    await svc.create(
      'project-1',
      { title: 'Бриф' },
      'tenant-1',
      'user-1',
    );
    const second = await svc.create(
      'project-1',
      { title: 'Спецификация' },
      'tenant-1',
      'user-1',
    );
    expect(second.sortOrder).toBe(1);
  });

  it('create: дубль title → 409 ConflictException', async () => {
    const { svc } = makeService(store);
    await svc.create('project-1', { title: 'Бриф' }, 'tenant-1', 'user-1');
    await expect(
      svc.create('project-1', { title: 'Бриф' }, 'tenant-1', 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('listForProject: только активные документы, отсортированы pinned+sortOrder', async () => {
    const { svc } = makeService(store);
    const a = await svc.create(
      'project-1',
      { title: 'A' },
      'tenant-1',
      'user-1',
    );
    const b = await svc.create(
      'project-1',
      { title: 'B' },
      'tenant-1',
      'user-1',
    );
    // pin B — должен подняться наверх.
    await svc.update(b.id, { pinned: true }, 'tenant-1', 'user-1');

    const list = await svc.listForProject('project-1', 'tenant-1');
    expect(list.map((d) => d.id)).toEqual([b.id, a.id]);
    expect(list[0]?.pinned).toBe(true);
  });

  it('update: author может изменить documemt, emit ingest при изменении content', async () => {
    const { svc, emitter, metrics } = makeService(store);
    const doc = await svc.create(
      'project-1',
      { title: 'A', contentStripped: 'v1' },
      'tenant-1',
      'user-1',
    );
    emitter.emitProjectDocumentChanged.mockClear();

    // author=user-1 пытается изменить content:
    const updated = await svc.update(
      doc.id,
      {
        contentStripped: 'v2-updated text',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
      'tenant-1',
      'user-1',
    );

    expect(updated.contentStripped).toBe('v2-updated text');
    expect(metrics.incProjectDocumentUpdated).toHaveBeenCalledTimes(1);
    expect(emitter.emitProjectDocumentChanged).toHaveBeenCalledTimes(1);
    expect(emitter.emitProjectDocumentChanged.mock.calls[0]?.[0]).toMatchObject(
      {
        changeType: 'updated',
        fullText: 'v2-updated text',
      },
    );
  });

  it('update: только pinned — ingest emit НЕ срабатывает (content не менялся)', async () => {
    const { svc, emitter } = makeService(store);
    const doc = await svc.create(
      'project-1',
      { title: 'A' },
      'tenant-1',
      'user-1',
    );
    emitter.emitProjectDocumentChanged.mockClear();

    await svc.update(doc.id, { pinned: true }, 'tenant-1', 'user-1');

    expect(emitter.emitProjectDocumentChanged).not.toHaveBeenCalled();
  });

  it('requireWritable: автор — ок; чужой без admin — 403; admin — ок', async () => {
    const { svc } = makeService(store);
    const doc = await svc.create(
      'project-1',
      { title: 'A' },
      'tenant-1',
      'user-author',
    );

    // автор:
    const okSelf = await svc.requireWritable({
      documentId: doc.id,
      tenantId: 'tenant-1',
      userId: 'user-author',
      isAdmin: false,
    });
    expect(okSelf.id).toBe(doc.id);

    // чужой без admin:
    await expect(
      svc.requireWritable({
        documentId: doc.id,
        tenantId: 'tenant-1',
        userId: 'user-other',
        isAdmin: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // admin:
    const okAdmin = await svc.requireWritable({
      documentId: doc.id,
      tenantId: 'tenant-1',
      userId: 'user-other',
      isAdmin: true,
    });
    expect(okAdmin.id).toBe(doc.id);
  });

  it('delete: soft-delete (deletedAt становится Date) + WS deleted', async () => {
    const { svc, events } = makeService(store);
    const doc = await svc.create(
      'project-1',
      { title: 'A' },
      'tenant-1',
      'user-1',
    );

    await svc.delete(doc.id, 'tenant-1');

    const raw = store.docs.get(doc.id);
    expect(raw?.deletedAt).toBeInstanceOf(Date);
    expect(events.publishProjectDocumentDeleted).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      projectId: 'project-1',
      documentId: doc.id,
    });

    // listForProject — больше не показывает удалённый:
    const list = await svc.listForProject('project-1', 'tenant-1');
    expect(list).toEqual([]);
  });

  it('listLinkedCards: вызывает $queryRaw + метрика; маппит даты в ISO', async () => {
    const { svc, metrics } = makeService(store);
    const lastAt = new Date('2026-05-01T10:00:00Z');
    store.linkedCards.push({
      id: 'card-1',
      name: 'Клиент Иванов',
      kind: 'client',
      color: '#5EEAD4',
      meetingCount: 3,
      lastMeetingAt: lastAt,
      contactName: 'Иван Иванов',
    });

    const result = await svc.listLinkedCards('project-1', 'tenant-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'card-1',
      name: 'Клиент Иванов',
      kind: 'client',
      meetingCount: 3,
      lastMeetingAt: lastAt.toISOString(),
    });
    expect(metrics.incLinkedCardsView).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      project: 'project-1',
    });
  });
});
