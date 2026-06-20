import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

export type ProvenanceSourceType =
  | 'meeting'
  | 'document'
  | 'chat'
  | 'voice_note'
  | 'email'
  | 'phone_call';

export type ProvenanceEntityType =
  | 'decision'
  | 'issue'
  | 'task'
  | 'regulation'
  | 'instruction'
  | 'block'
  | 'notification';

export interface ProvenanceSourceRef {
  type: ProvenanceSourceType;
  refId: string | null;
  label: string;
  deepLink: string | null;
}

export interface ProvenancePreviewRef {
  evidenceId: string | null;
  blockId: string | null;
  sourceType: ProvenanceSourceType | string | null;
  refId: string | null;
  startMs: number | null;
  deepLink: string | null;
  attribution: 'quoted' | 'inferred' | null;
  label: string | null;
}

export interface ProvenanceNode {
  blockId: string;
  rawEventId: string;
  source: ProvenanceSourceRef;
  quote: string;
  attribution: 'quoted' | 'inferred';
  startMs: number | null;
  endMs: number | null;
  occurredAt: string | null;
  confidence: number | null;
  needsReview: boolean;
  accessFiltered: boolean;
}

export interface ViewerContext {
  tenantId: string;
  userId: string;
}

export const PROVENANCE_ACCESS_MASK = 'Источник скрыт правами доступа';

const TYPE_LABEL: Record<ProvenanceSourceType, string> = {
  meeting: 'Встреча',
  document: 'Документ',
  chat: 'Сообщение в чате',
  voice_note: 'Голосовая заметка',
  email: 'Письмо',
  phone_call: 'Звонок',
};

const DOCUMENT_ANCHOR_MAX_CHARS = 60;

export function documentAnchorParam(quote: string | null | undefined): string {
  if (!quote) return '';
  const normalized = quote.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= DOCUMENT_ANCHOR_MAX_CHARS) {
    return encodeURIComponent(normalized);
  }
  const head = normalized.slice(0, DOCUMENT_ANCHOR_MAX_CHARS);
  const lastSpace = head.lastIndexOf(' ');
  const trimmed = lastSpace > 0 ? head.slice(0, lastSpace) : head;
  return encodeURIComponent(trimmed);
}

export function buildProvenanceDeepLink(args: {
  sourceType: ProvenanceSourceType;
  externalId: string;
  startMs?: number | null;
  messageExternalId?: string | null;
  quote?: string | null;
}): string | null {
  if (!args.externalId) return null;
  if (args.sourceType === 'meeting') {
    const sec = Math.max(0, Math.round((args.startMs ?? 0) / 1000));
    return `/meetings/${args.externalId}?t=${sec}`;
  }
  if (args.sourceType === 'document') {
    const anchor = documentAnchorParam(args.quote);
    return anchor
      ? `/documents/${args.externalId}?q=${anchor}`
      : `/documents/${args.externalId}`;
  }
  if (args.sourceType === 'chat') {
    return args.messageExternalId
      ? `/chats/${args.externalId}?m=${encodeURIComponent(args.messageExternalId)}`
      : `/chats/${args.externalId}`;
  }
  return null;
}

@Injectable()
export class ProvenanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver,
  ) {}

  buildDeepLink(args: {
    sourceType: ProvenanceSourceType;
    externalId: string;
    startMs?: number | null;
    messageExternalId?: string | null;
    quote?: string | null;
  }): string | null {
    return buildProvenanceDeepLink(args);
  }

  async resolveByRawEventIds(
    tenantId: string,
    rawEventIds: string[],
  ): Promise<Map<string, ProvenanceSourceRef>> {
    const out = new Map<string, ProvenanceSourceRef>();
    const ids = [...new Set(rawEventIds.filter(Boolean))];
    if (ids.length === 0) return out;

    const rawEvents = await this.prisma.rawEvent.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, sourceType: true, sourceExternalId: true },
    });

    const classified = new Map<
      string,
      { type: ProvenanceSourceType; refId: string | null }
    >();
    const meetingIds = new Set<string>();
    const documentIds = new Set<string>();
    for (const r of rawEvents) {
      const c = this.classify(r.sourceType, r.sourceExternalId);
      classified.set(r.id, c);
      if (c.type === 'meeting' && c.refId) meetingIds.add(c.refId);
      if (c.type === 'document' && c.refId) documentIds.add(c.refId);
    }

    const meetingTitle = new Map<string, string>();
    if (meetingIds.size > 0) {
      const meetings = await this.prisma.meeting.findMany({
        where: { tenantId, id: { in: [...meetingIds] } },
        select: { id: true, title: true },
      });
      for (const m of meetings) meetingTitle.set(m.id, m.title);
    }
    const docName = new Map<string, string>();
    if (documentIds.size > 0) {
      const docs = await this.prisma.document.findMany({
        where: { tenantId, id: { in: [...documentIds] }, deletedAt: null },
        select: { id: true, name: true },
      });
      for (const d of docs) docName.set(d.id, d.name);
    }

    for (const r of rawEvents) {
      const c = classified.get(r.id);
      if (!c) continue;
      out.set(r.id, this.buildRef(c, meetingTitle, docName));
    }
    return out;
  }

  async resolve(
    entityType: ProvenanceEntityType,
    entityId: string,
    viewer: ViewerContext,
  ): Promise<ProvenanceNode[]> {
    const blockIds = await this.collectSourceBlockIds(
      entityType,
      entityId,
      viewer.tenantId,
    );
    if (blockIds.length === 0) return [];

    const ctx = await this.accessResolver.resolveAccessibleGroups({
      tenantId: viewer.tenantId,
      userId: viewer.userId,
    });
    const part = await this.accessResolver.partitionProjectionsByAccess(
      ctx,
      blockIds.map((id) => ({ id, sourceBlockIds: [id] })),
    );

    const blocks = await this.prisma.ideaBlock.findMany({
      where: { id: { in: blockIds }, tenantId: viewer.tenantId },
      select: { id: true, primarySource: true },
    });
    const primaryByBlock = new Map(
      blocks.map((b) => [b.id, b.primarySource] as const),
    );

    const evidenceRows = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId: { in: blockIds } },
      select: {
        blockId: true,
        rawEventId: true,
        quote: true,
        startMs: true,
        endMs: true,
        sourceTimestamp: true,
        sourceMessageExternalId: true,
      },
      orderBy: [{ startMs: 'asc' }, { createdAt: 'asc' }],
    });
    const firstByBlock = new Map<string, (typeof evidenceRows)[number]>();
    for (const ev of evidenceRows) {
      if (!firstByBlock.has(ev.blockId)) firstByBlock.set(ev.blockId, ev);
    }

    const rawEventIds = [...new Set(evidenceRows.map((e) => e.rawEventId))];
    const sourceByRawEvent = await this.resolveByRawEventIds(
      viewer.tenantId,
      rawEventIds,
    );

    const chatSessionIds = [...sourceByRawEvent.values()]
      .filter((s) => s.type === 'chat' && s.refId)
      .map((s) => s.refId as string);
    const chatIdBySession = await this.resolveChatIdsBySession(
      viewer.tenantId,
      chatSessionIds,
    );

    const nodes: ProvenanceNode[] = [];
    for (const blockId of blockIds) {
      const ev = firstByBlock.get(blockId);
      if (!ev) continue;
      const attribution: 'quoted' | 'inferred' =
        primaryByBlock.get(blockId) === 'report' ? 'inferred' : 'quoted';
      const baseSource = sourceByRawEvent.get(ev.rawEventId) ?? {
        type: 'chat' as const,
        refId: null,
        label: TYPE_LABEL.chat,
        deepLink: null,
      };

      if (!part.accessibleIds.has(blockId)) {
        nodes.push({
          blockId,
          rawEventId: ev.rawEventId,
          source: {
            type: baseSource.type,
            refId: null,
            label: PROVENANCE_ACCESS_MASK,
            deepLink: null,
          },
          quote: PROVENANCE_ACCESS_MASK,
          attribution,
          startMs: null,
          endMs: null,
          occurredAt: null,
          confidence: null,
          needsReview: false,
          accessFiltered: true,
        });
        continue;
      }

      const chatId =
        baseSource.type === 'chat' && baseSource.refId
          ? (chatIdBySession.get(baseSource.refId) ?? null)
          : null;
      const deepLinkExternalId =
        baseSource.type === 'chat' ? chatId : baseSource.refId;
      const deepLink = deepLinkExternalId
        ? this.buildDeepLink({
            sourceType: baseSource.type,
            externalId: deepLinkExternalId,
            startMs: ev.startMs,
            messageExternalId: ev.sourceMessageExternalId,
            quote: ev.quote,
          })
        : null;
      nodes.push({
        blockId,
        rawEventId: ev.rawEventId,
        source: { ...baseSource, deepLink },
        quote: ev.quote,
        attribution,
        startMs: ev.startMs ?? null,
        endMs: ev.endMs ?? null,
        occurredAt: ev.sourceTimestamp?.toISOString() ?? null,
        confidence: null,
        needsReview: false,
        accessFiltered: false,
      });
    }
    return nodes;
  }

  async computePreviewSnapshot(
    tenantId: string,
    blockIds: string[],
  ): Promise<{
    previewQuote: string | null;
    previewSourceRef: ProvenancePreviewRef | null;
  }> {
    if (blockIds.length === 0) {
      return { previewQuote: null, previewSourceRef: null };
    }
    const ev = await this.prisma.ideaBlockEvidence.findFirst({
      where: { blockId: { in: blockIds } },
      select: {
        id: true,
        blockId: true,
        rawEventId: true,
        quote: true,
        startMs: true,
        sourceMessageExternalId: true,
      },
      orderBy: [{ startMs: 'asc' }, { createdAt: 'asc' }],
    });
    if (!ev) return { previewQuote: null, previewSourceRef: null };

    const block = await this.prisma.ideaBlock.findFirst({
      where: { id: ev.blockId, tenantId },
      select: { primarySource: true },
    });
    const sourceMap = await this.resolveByRawEventIds(tenantId, [ev.rawEventId]);
    const source = sourceMap.get(ev.rawEventId) ?? null;
    const attribution: 'quoted' | 'inferred' =
      block?.primarySource === 'report' ? 'inferred' : 'quoted';
    let chatId: string | null = null;
    if (source?.type === 'chat' && source.refId) {
      const map = await this.resolveChatIdsBySession(tenantId, [source.refId]);
      chatId = map.get(source.refId) ?? null;
    }
    const deepLinkExternalId =
      source?.type === 'chat' ? chatId : (source?.refId ?? null);
    const deepLink = deepLinkExternalId
      ? this.buildDeepLink({
          sourceType: source!.type,
          externalId: deepLinkExternalId,
          startMs: ev.startMs,
          messageExternalId: ev.sourceMessageExternalId,
          quote: ev.quote,
        })
      : null;

    return {
      previewQuote: ev.quote.slice(0, 500),
      previewSourceRef: {
        evidenceId: ev.id,
        blockId: ev.blockId,
        sourceType: source?.type ?? null,
        refId: source?.refId ?? null,
        startMs: ev.startMs ?? null,
        deepLink,
        attribution,
        label: source?.label ?? null,
      },
    };
  }

  private async resolveChatIdsBySession(
    tenantId: string,
    sessionIds: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = [...new Set(sessionIds.filter(Boolean))];
    if (ids.length === 0) return out;
    const sessions = await this.prisma.chatboxChatSession.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, chatId: true },
    });
    for (const s of sessions) out.set(s.id, s.chatId);
    return out;
  }

  private classify(
    sourceType: string,
    sourceExternalId: string | null,
  ): { type: ProvenanceSourceType; refId: string | null } {
    if (sourceExternalId && sourceExternalId.startsWith('doc:')) {
      return {
        type: 'document',
        refId: sourceExternalId.slice('doc:'.length) || null,
      };
    }
    switch (sourceType) {
      case 'meeting':
        return { type: 'meeting', refId: sourceExternalId };
      case 'email':
        return { type: 'email', refId: sourceExternalId };
      case 'phone_call':
        return { type: 'phone_call', refId: sourceExternalId };
      case 'chat':
      case 'chatbox':
        return { type: 'chat', refId: sourceExternalId };
      case 'conversational':
        return { type: 'voice_note', refId: sourceExternalId };
      default:
        return { type: 'chat', refId: sourceExternalId };
    }
  }

  private buildRef(
    c: { type: ProvenanceSourceType; refId: string | null },
    meetingTitle: Map<string, string>,
    docName: Map<string, string>,
  ): ProvenanceSourceRef {
    if (c.type === 'meeting' && c.refId) {
      const title = meetingTitle.get(c.refId);
      if (!title) return { type: 'meeting', refId: null, label: TYPE_LABEL.meeting, deepLink: null };
      return {
        type: 'meeting',
        refId: c.refId,
        label: `Встреча «${title}»`,
        deepLink: this.buildDeepLink({ sourceType: 'meeting', externalId: c.refId }),
      };
    }
    if (c.type === 'document' && c.refId) {
      const name = docName.get(c.refId);
      if (!name) return { type: 'document', refId: null, label: TYPE_LABEL.document, deepLink: null };
      return {
        type: 'document',
        refId: c.refId,
        label: `Документ «${name}»`,
        deepLink: this.buildDeepLink({ sourceType: 'document', externalId: c.refId }),
      };
    }
    return { type: c.type, refId: c.refId, label: TYPE_LABEL[c.type], deepLink: null };
  }

  private async collectSourceBlockIds(
    entityType: ProvenanceEntityType,
    entityId: string,
    tenantId: string,
  ): Promise<string[]> {
    switch (entityType) {
      case 'decision': {
        const d = await this.prisma.decision.findFirst({
          where: { id: entityId, tenantId },
          select: { sourceBlockIds: true },
        });
        return d?.sourceBlockIds ?? [];
      }
      case 'issue': {
        const i = await this.prisma.issue.findFirst({
          where: { id: entityId, tenantId },
          select: { sourceBlockIds: true },
        });
        return i?.sourceBlockIds ?? [];
      }
      case 'task': {
        const t = await this.prisma.task.findFirst({
          where: { id: entityId, tenantId },
          select: { evidenceBlockIds: true },
        });
        return t?.evidenceBlockIds ?? [];
      }
      case 'regulation':
      case 'instruction': {
        const r = await this.prisma.regulation.findFirst({
          where: { id: entityId, tenantId },
          select: { sourceBlockIds: true },
        });
        return r?.sourceBlockIds ?? [];
      }
      case 'block':
        return [entityId];
      case 'notification':
        return [];
    }
  }
}
