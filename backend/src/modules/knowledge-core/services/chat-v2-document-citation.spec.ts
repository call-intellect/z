/**
 * ТЗ-4 Ф11 — провенанс документа в citations chat-v2.
 *
 * Когда ответ AI обоснован блоком, который происходит из загруженного
 * документа (его evidence-RawEvent имеет `sourceExternalId='doc:<id>'` и НЕ
 * имеет meeting-evidence), citation должна нести `documentId` + `documentName`
 * (фронт строит ссылку `/documents/<id>`). Meeting-обоснованный блок citation
 * без `documentId` (meeting-поля как раньше).
 *
 * Изолируем приватные `loadContextBlocks` + `parseCitationsFromAnswer` через
 * any-cast (как в chat-v2-access-gate.spec.ts). prisma мокаем точечно: разные
 * ветки ideaBlockEvidence.findMany (meeting-query vs doc-query) различаются по
 * форме `where`.
 */
import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { ChatV2Citation } from './chat-v2.service';
import { ChatV2Service } from './chat-v2.service';

interface BlockRow {
  id: string;
  name: string;
  signalType: string;
  trustedAnswer: string;
  dataClass: string;
}

interface MeetingEvidenceRow {
  blockId: string;
  rawEventId: string;
  startMs: number | null;
  endMs: number | null;
  quote: string;
}

interface DocEvidenceRow {
  blockId: string;
  quote: string;
  rawEvent: { sourceExternalId: string | null };
}

function isDocEvidenceQuery(args: unknown): boolean {
  const where = (args as { where?: { rawEvent?: { sourceExternalId?: unknown } } })
    .where;
  return Boolean(where?.rawEvent?.sourceExternalId);
}

function buildService(opts: {
  blockRows: BlockRow[];
  meetingEvidence?: MeetingEvidenceRow[];
  docEvidence?: DocEvidenceRow[];
  rawEvents?: Array<{ id: string; sourceExternalId: string | null }>;
  meetings?: Array<{ id: string; title: string }>;
  documents?: Array<{ id: string; name: string }>;
}): ChatV2Service {
  const evidenceFindMany = vi.fn(async (args: unknown) => {
    // doc-query (rawEvent.sourceExternalId startsWith doc:) vs meeting-query
    // (sourceType='meeting'). Различаем по форме where.
    if (isDocEvidenceQuery(args)) return opts.docEvidence ?? [];
    return opts.meetingEvidence ?? [];
  });

  const prisma = {
    ideaBlock: { findMany: vi.fn(async () => opts.blockRows) },
    ideaBlockEvidence: { findMany: evidenceFindMany },
    rawEvent: { findMany: vi.fn(async () => opts.rawEvents ?? []) },
    meeting: { findMany: vi.fn(async () => opts.meetings ?? []) },
    document: { findMany: vi.fn(async () => opts.documents ?? []) },
  } as unknown as PrismaService;

  const metrics = {
    incAccessDenied: vi.fn(),
    incAccessShadowDiff: vi.fn(),
  } as unknown as BusinessMetricsService;

  // accessResolver не используется при accessCtx=null (off).
  const accessResolver = {} as never;

  return new ChatV2Service(
    prisma,
    {} as never, // cfg
    {} as never, // llm
    {} as never, // retrieval
    metrics,
    accessResolver,
  );
}

type ContextBlockLike = {
  id: string;
  primaryMeetingEvidence: unknown | null;
  primaryDocumentSource: { documentId: string; documentName: string } | null;
};

function loadContextBlocks(
  service: ChatV2Service,
  blockIds: string[],
): Promise<ContextBlockLike[]> {
  const fn = (
    service as unknown as {
      loadContextBlocks: (
        tenantId: string,
        blockIds: string[],
        accessCtx: null,
        enforcement: 'off',
        surface: string,
      ) => Promise<ContextBlockLike[]>;
    }
  ).loadContextBlocks.bind(service);
  return fn('t-1', blockIds, null, 'off', 'chat');
}

function parseCitations(
  service: ChatV2Service,
  answer: string,
  blocks: ContextBlockLike[],
): ChatV2Citation[] {
  const fn = (
    service as unknown as {
      parseCitationsFromAnswer: (
        answer: string,
        blocks: ContextBlockLike[],
      ) => ChatV2Citation[];
    }
  ).parseCitationsFromAnswer.bind(service);
  return fn(answer, blocks);
}

const ROWS: BlockRow[] = [
  { id: 'bMeet', name: 'Блок встречи', signalType: 'fact', trustedAnswer: 'a-meet', dataClass: 'internal' },
  { id: 'bDoc', name: 'Блок регламента', signalType: 'fact', trustedAnswer: 'a-doc', dataClass: 'internal' },
];

describe('ChatV2Service — ТЗ-4 Ф11 документный провенанс citations', () => {
  it('блок из doc:<id> RawEvent → primaryDocumentSource + citation с documentId/documentName; блок из встречи → без documentId', async () => {
    const service = buildService({
      blockRows: ROWS,
      // bMeet имеет meeting-evidence; bDoc — НЕТ (попадает в doc-ветку).
      meetingEvidence: [
        {
          blockId: 'bMeet',
          rawEventId: 're-meet',
          startMs: 12000,
          endMs: 15000,
          quote: 'фраза из встречи',
        },
      ],
      rawEvents: [{ id: 're-meet', sourceExternalId: 'meeting-1' }],
      meetings: [{ id: 'meeting-1', title: 'Планёрка' }],
      // doc-ветка: bDoc привязан к документу doc-77.
      docEvidence: [
        {
          blockId: 'bDoc',
          quote: 'пункт регламента 3.2',
          rawEvent: { sourceExternalId: 'doc:doc-77' },
        },
      ],
      documents: [{ id: 'doc-77', name: 'Регламент отпусков.pdf' }],
    });

    const blocks = await loadContextBlocks(service, ['bMeet', 'bDoc']);
    const meet = blocks.find((b) => b.id === 'bMeet');
    const doc = blocks.find((b) => b.id === 'bDoc');

    // meeting-блок: meeting-evidence есть, document-source НЕТ.
    expect(meet?.primaryMeetingEvidence).not.toBeNull();
    expect(meet?.primaryDocumentSource).toBeNull();
    // doc-блок: meeting-evidence НЕТ, document-source резолвлен.
    expect(doc?.primaryMeetingEvidence).toBeNull();
    expect(doc?.primaryDocumentSource).toEqual({
      documentId: 'doc-77',
      documentName: 'Регламент отпусков.pdf',
      snippet: 'пункт регламента 3.2',
    });

    // citations: ответ ссылается на оба блока.
    const answer = 'По встрече [BLOCK:bMeet], а по регламенту [BLOCK:bDoc].';
    const citations = parseCitations(service, answer, blocks);

    const docCit = citations.find((c) => c.documentId === 'doc-77');
    const meetCit = citations.find((c) => c.meetingId === 'meeting-1');

    // document citation: documentId + documentName, meeting-поля пустые.
    expect(docCit).toBeDefined();
    expect(docCit?.documentName).toBe('Регламент отпусков.pdf');
    expect(docCit?.snippet).toBe('пункт регламента 3.2');
    expect(docCit?.meetingId).toBe('');

    // meeting citation: meeting-поля целы, documentId отсутствует.
    expect(meetCit).toBeDefined();
    expect(meetCit?.meetingTitle).toBe('Планёрка');
    expect(meetCit?.startMs).toBe(12000);
    expect(meetCit?.documentId).toBeUndefined();
    expect(meetCit?.documentName).toBeUndefined();
  });

  it('документ удалён / другого tenant (findMany не вернул name) → нет documentSource и нет citation', async () => {
    const service = buildService({
      blockRows: [ROWS[1]!],
      docEvidence: [
        {
          blockId: 'bDoc',
          quote: 'пункт регламента',
          rawEvent: { sourceExternalId: 'doc:doc-gone' },
        },
      ],
      documents: [], // документ не найден (удалён / чужой tenant)
    });

    const blocks = await loadContextBlocks(service, ['bDoc']);
    expect(blocks[0]?.primaryDocumentSource).toBeNull();

    const citations = parseCitations(service, '[BLOCK:bDoc]', blocks);
    expect(citations).toEqual([]);
  });
});
