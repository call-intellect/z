import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import {
  buildProvenanceDeepLink,
  documentAnchorParam,
  PROVENANCE_ACCESS_MASK,
  ProvenanceService,
} from './provenance.service';

describe('documentAnchorParam (B4 — якорь цитаты в документе)', () => {
  it('пустой quote → пустая строка (без ?q=)', () => {
    expect(documentAnchorParam('')).toBe('');
    expect(documentAnchorParam(null)).toBe('');
    expect(documentAnchorParam(undefined)).toBe('');
  });

  it('короткая цитата → целиком encodeURIComponent', () => {
    expect(documentAnchorParam('Клиент просит скидку')).toBe(
      encodeURIComponent('Клиент просит скидку'),
    );
  });

  it('длинная цитата → обрезка ~60 символов по границе слова + кодирование', () => {
    const quote =
      'Переходим на недельные спринты с обязательным демо каждую пятницу в конце дня';
    const param = documentAnchorParam(quote);
    const decoded = decodeURIComponent(param);
    expect(decoded.length).toBeLessThanOrEqual(60);
    expect(quote.startsWith(decoded)).toBe(true);
    expect(decoded.endsWith(' ')).toBe(false);
  });

  it('нормализует переносы и лишние пробелы', () => {
    expect(documentAnchorParam('  Клиент\n\nпросит   скидку ')).toBe(
      encodeURIComponent('Клиент просит скидку'),
    );
  });
});

describe('buildProvenanceDeepLink — документ с якорем ?q=', () => {
  it('document с quote → /documents/:id?q=<encoded>', () => {
    expect(
      buildProvenanceDeepLink({
        sourceType: 'document',
        externalId: 'd1',
        quote: 'Клиент просит скидку',
      }),
    ).toBe(`/documents/d1?q=${encodeURIComponent('Клиент просит скидку')}`);
  });

  it('document без quote → /documents/:id (graceful)', () => {
    expect(
      buildProvenanceDeepLink({ sourceType: 'document', externalId: 'd1' }),
    ).toBe('/documents/d1');
  });
});

describe('buildProvenanceDeepLink (RC-6 — мс → сек)', () => {
  it('meeting: startMs делится на 1000 в ?t=<sec>', () => {
    expect(
      buildProvenanceDeepLink({ sourceType: 'meeting', externalId: 'm1', startMs: 90_000 }),
    ).toBe('/meetings/m1?t=90');
  });

  it('meeting: startMs null → ?t=0', () => {
    expect(buildProvenanceDeepLink({ sourceType: 'meeting', externalId: 'm1' })).toBe(
      '/meetings/m1?t=0',
    );
  });

  it('document → /documents/:id (без таймкода)', () => {
    expect(buildProvenanceDeepLink({ sourceType: 'document', externalId: 'd1' })).toBe(
      '/documents/d1',
    );
  });

  it('chat без messageExternalId → /chats/:chatId (graceful на чат)', () => {
    expect(buildProvenanceDeepLink({ sourceType: 'chat', externalId: 'chat-1' })).toBe(
      '/chats/chat-1',
    );
  });

  it('chat с messageExternalId → /chats/:chatId?m=:messageExternalId', () => {
    expect(
      buildProvenanceDeepLink({
        sourceType: 'chat',
        externalId: 'chat-1',
        messageExternalId: 'msg 42/7',
      }),
    ).toBe('/chats/chat-1?m=msg%2042%2F7');
  });

  it('пустой externalId → null', () => {
    expect(buildProvenanceDeepLink({ sourceType: 'meeting', externalId: '', startMs: 1000 })).toBeNull();
  });
});

function buildService(opts: {
  prisma: Partial<Record<string, unknown>>;
  isBypass?: boolean;
  accessibleIds?: Set<string>;
}): ProvenanceService {
  const accessResolver = {
    resolveAccessibleGroups: vi.fn(async () => ({
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: opts.isBypass ?? true,
    })),
    partitionProjectionsByAccess: vi.fn(
      async (_ctx: unknown, items: Array<{ id: string }>) => ({
        accessibleIds:
          opts.accessibleIds ?? new Set(items.map((i) => i.id)),
        denied: 0,
      }),
    ),
  } as unknown as KnowledgeAccessResolver;
  return new ProvenanceService(
    opts.prisma as unknown as PrismaService,
    accessResolver,
  );
}

describe('ProvenanceService.resolve — последняя миля', () => {
  function meetingPrisma() {
    return {
      decision: {
        findFirst: vi.fn(async () => ({ sourceBlockIds: ['b-1'] })),
      },
      ideaBlock: {
        findMany: vi.fn(async () => [{ id: 'b-1', primarySource: 'transcript' }]),
      },
      ideaBlockEvidence: {
        findMany: vi.fn(async () => [
          {
            blockId: 'b-1',
            rawEventId: 'raw-1',
            quote: 'Переходим на недельные спринты',
            startMs: 90_000,
            endMs: 95_000,
            sourceTimestamp: new Date('2026-03-10T09:00:00.000Z'),
          },
        ]),
      },
      rawEvent: {
        findMany: vi.fn(async () => [
          { id: 'raw-1', sourceType: 'meeting', sourceExternalId: 'm-1' },
        ]),
      },
      meeting: {
        findMany: vi.fn(async () => [{ id: 'm-1', title: 'Планёрка' }]),
      },
      document: { findMany: vi.fn(async () => []) },
    };
  }

  it('meeting-источник: цитата + deepLink с точным таймкодом + attribution=quoted', async () => {
    const svc = buildService({ prisma: meetingPrisma(), isBypass: true });
    const nodes = await svc.resolve('decision', 'd-1', {
      tenantId: 't-1',
      userId: 'u-1',
    });
    expect(nodes).toHaveLength(1);
    const n = nodes[0]!;
    expect(n.blockId).toBe('b-1');
    expect(n.quote).toBe('Переходим на недельные спринты');
    expect(n.attribution).toBe('quoted');
    expect(n.accessFiltered).toBe(false);
    expect(n.startMs).toBe(90_000);
    expect(n.source).toEqual({
      type: 'meeting',
      refId: 'm-1',
      label: 'Встреча «Планёрка»',
      deepLink: '/meetings/m-1?t=90',
    });
  });

  it('report-блок → attribution=inferred', async () => {
    const prisma = meetingPrisma();
    prisma.ideaBlock.findMany = vi.fn(async () => [
      { id: 'b-1', primarySource: 'report' },
    ]);
    const svc = buildService({ prisma, isBypass: true });
    const nodes = await svc.resolve('decision', 'd-1', {
      tenantId: 't-1',
      userId: 'u-1',
    });
    expect(nodes[0]!.attribution).toBe('inferred');
  });

  it('chatbox-источник: deepLink на чат с якорем ?m=<messageExternalId>', async () => {
    const prisma = {
      decision: {
        findFirst: vi.fn(async () => ({ sourceBlockIds: ['b-1'] })),
      },
      ideaBlock: {
        findMany: vi.fn(async () => [{ id: 'b-1', primarySource: 'transcript' }]),
      },
      ideaBlockEvidence: {
        findMany: vi.fn(async () => [
          {
            blockId: 'b-1',
            rawEventId: 'raw-1',
            quote: 'Клиент просит скидку',
            startMs: 1000,
            endMs: 1900,
            sourceTimestamp: new Date('2026-03-10T09:00:00.000Z'),
            sourceMessageExternalId: 'tg-555',
          },
        ]),
      },
      rawEvent: {
        findMany: vi.fn(async () => [
          { id: 'raw-1', sourceType: 'chatbox', sourceExternalId: 'session-1' },
        ]),
      },
      meeting: { findMany: vi.fn(async () => []) },
      document: { findMany: vi.fn(async () => []) },
      chatboxChatSession: {
        findMany: vi.fn(async () => [{ id: 'session-1', chatId: 'chat-9' }]),
      },
    };
    const svc = buildService({ prisma, isBypass: true });
    const nodes = await svc.resolve('decision', 'd-1', {
      tenantId: 't-1',
      userId: 'u-1',
    });
    expect(nodes).toHaveLength(1);
    const n = nodes[0]!;
    expect(n.source.type).toBe('chat');
    expect(n.source.deepLink).toBe('/chats/chat-9?m=tg-555');
  });

  it('chatbox-источник без sourceMessageExternalId → graceful /chats/:chatId', async () => {
    const prisma = {
      decision: {
        findFirst: vi.fn(async () => ({ sourceBlockIds: ['b-1'] })),
      },
      ideaBlock: {
        findMany: vi.fn(async () => [{ id: 'b-1', primarySource: 'transcript' }]),
      },
      ideaBlockEvidence: {
        findMany: vi.fn(async () => [
          {
            blockId: 'b-1',
            rawEventId: 'raw-1',
            quote: 'Клиент просит скидку',
            startMs: 1000,
            endMs: 1900,
            sourceTimestamp: new Date('2026-03-10T09:00:00.000Z'),
            sourceMessageExternalId: null,
          },
        ]),
      },
      rawEvent: {
        findMany: vi.fn(async () => [
          { id: 'raw-1', sourceType: 'chatbox', sourceExternalId: 'session-1' },
        ]),
      },
      meeting: { findMany: vi.fn(async () => []) },
      document: { findMany: vi.fn(async () => []) },
      chatboxChatSession: {
        findMany: vi.fn(async () => [{ id: 'session-1', chatId: 'chat-9' }]),
      },
    };
    const svc = buildService({ prisma, isBypass: true });
    const nodes = await svc.resolve('decision', 'd-1', {
      tenantId: 't-1',
      userId: 'u-1',
    });
    expect(nodes[0]!.source.deepLink).toBe('/chats/chat-9');
  });

  it('document-источник: deepLink на документ с якорем цитаты ?q=', async () => {
    const prisma = {
      decision: {
        findFirst: vi.fn(async () => ({ sourceBlockIds: ['b-1'] })),
      },
      ideaBlock: {
        findMany: vi.fn(async () => [{ id: 'b-1', primarySource: 'transcript' }]),
      },
      ideaBlockEvidence: {
        findMany: vi.fn(async () => [
          {
            blockId: 'b-1',
            rawEventId: 'raw-1',
            quote: 'Регламент возврата применяется к заказам старше 30 дней',
            startMs: null,
            endMs: null,
            sourceTimestamp: new Date('2026-03-10T09:00:00.000Z'),
            sourceMessageExternalId: null,
          },
        ]),
      },
      rawEvent: {
        findMany: vi.fn(async () => [
          { id: 'raw-1', sourceType: 'document', sourceExternalId: 'doc:doc-7' },
        ]),
      },
      meeting: { findMany: vi.fn(async () => []) },
      document: {
        findMany: vi.fn(async () => [{ id: 'doc-7', name: 'Регламент возвратов' }]),
      },
    };
    const svc = buildService({ prisma, isBypass: true });
    const nodes = await svc.resolve('decision', 'd-1', {
      tenantId: 't-1',
      userId: 'u-1',
    });
    expect(nodes).toHaveLength(1);
    const n = nodes[0]!;
    expect(n.source.type).toBe('document');
    expect(n.source.refId).toBe('doc-7');
    expect(n.source.deepLink).not.toBeNull();
    expect(n.source.deepLink!.startsWith('/documents/doc-7?q=')).toBe(true);
    expect(decodeURIComponent(n.source.deepLink!.split('?q=')[1]!).length).toBeLessThanOrEqual(60);
  });

  it('блок недоступен зрителю → accessFiltered, quote/label/deepLink замаскированы', async () => {
    const svc = buildService({
      prisma: meetingPrisma(),
      isBypass: false,
      accessibleIds: new Set<string>(),
    });
    const nodes = await svc.resolve('decision', 'd-1', {
      tenantId: 't-1',
      userId: 'u-1',
    });
    expect(nodes).toHaveLength(1);
    const n = nodes[0]!;
    expect(n.accessFiltered).toBe(true);
    expect(n.quote).toBe(PROVENANCE_ACCESS_MASK);
    expect(n.source.label).toBe(PROVENANCE_ACCESS_MASK);
    expect(n.source.refId).toBeNull();
    expect(n.source.deepLink).toBeNull();
    expect(n.startMs).toBeNull();
  });

  it('сущность без sourceBlockIds → пустой результат (создано вручную)', async () => {
    const prisma = meetingPrisma();
    prisma.decision.findFirst = vi.fn(async () => ({ sourceBlockIds: [] }));
    const svc = buildService({ prisma, isBypass: true });
    const nodes = await svc.resolve('decision', 'd-1', {
      tenantId: 't-1',
      userId: 'u-1',
    });
    expect(nodes).toEqual([]);
  });
});
