import { Inject, Injectable } from '@nestjs/common';
import type { EntityLinkType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';
import { S3Service } from '../../recordings/s3.service';

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
  | 'regulation'
  | 'instruction'
  | 'block'
  | 'notification'
  | 'entity'
  | 'idea'
  | 'goal'
  | 'insight'
  | 'friction';

const TEAM_FRICTION_RELATION_TYPES: EntityLinkType[] = ['conflicted_with'];
const FRICTION_VERBATIM_ROLES_FALLBACK: readonly string[] = ['owner', 'admin'];

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
  hasAudio: boolean;
}

export interface ViewerContext {
  tenantId: string;
  userId: string;
  viewerRole?: string;
}

export const PROVENANCE_ACCESS_MASK = 'Источник скрыт правами доступа';

export const VOICE_NOTE_AUDIO_TTL_SECONDS = 600;

export type VoiceNoteAudioResult =
  | { status: 'ok'; url: string; expiresAt: Date }
  | { status: 'not_found' }
  | { status: 'forbidden' };

const TYPE_LABEL: Record<ProvenanceSourceType, string> = {
  meeting: 'Встреча',
  document: 'Документ',
  chat: 'Сообщение в чате',
  voice_note: 'Голосовая заметка',
  email: 'Письмо',
  phone_call: 'Звонок',
};

const DOCUMENT_ANCHOR_MAX_CHARS = 60;

export function offsetToPage(
  pageOffsets: number[],
  charOffset: number,
): number | null {
  if (!pageOffsets.length) return null;
  let page = 1;
  for (let i = 0; i < pageOffsets.length; i += 1) {
    if (charOffset >= pageOffsets[i]!) page = i + 1;
    else break;
  }
  return page;
}

export function findQuoteOffset(
  parsedText: string,
  quote: string,
): number | null {
  const normalizedQuery = quote.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalizedQuery) return null;

  const normalizedChars: string[] = [];
  const sourceIndex: number[] = [];
  let prevWasSpace = false;
  for (let i = 0; i < parsedText.length; i += 1) {
    const ch = parsedText[i]!;
    if (/\s/.test(ch)) {
      if (normalizedChars.length === 0 || prevWasSpace) continue;
      normalizedChars.push(' ');
      sourceIndex.push(i);
      prevWasSpace = true;
    } else {
      normalizedChars.push(ch.toLowerCase());
      sourceIndex.push(i);
      prevWasSpace = false;
    }
  }
  while (
    normalizedChars.length > 0 &&
    normalizedChars[normalizedChars.length - 1] === ' '
  ) {
    normalizedChars.pop();
    sourceIndex.pop();
  }

  const at = normalizedChars.join('').indexOf(normalizedQuery);
  if (at < 0) return null;
  return sourceIndex[at]!;
}

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
  page?: number | null;
}): string | null {
  if (!args.externalId) return null;
  if (args.sourceType === 'meeting') {
    const sec = Math.max(0, Math.round((args.startMs ?? 0) / 1000));
    return `/meetings/${args.externalId}/result?t=${sec}`;
  }
  if (args.sourceType === 'document') {
    const anchor = documentAnchorParam(args.quote);
    const page = args.page != null && args.page >= 1 ? args.page : null;
    if (page != null) {
      return anchor
        ? `/documents/${args.externalId}?page=${page}&q=${anchor}`
        : `/documents/${args.externalId}?page=${page}`;
    }
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
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  buildDeepLink(args: {
    sourceType: ProvenanceSourceType;
    externalId: string;
    startMs?: number | null;
    messageExternalId?: string | null;
    quote?: string | null;
    page?: number | null;
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

    const audioRawEventIds = [...sourceByRawEvent.entries()]
      .filter(([, s]) => s.type === 'voice_note')
      .map(([id]) => id);
    const hasAudioByRawEvent = await this.resolveHasAudio(
      viewer.tenantId,
      audioRawEventIds,
    );

    const chatSessionIds = [...sourceByRawEvent.values()]
      .filter((s) => s.type === 'chat' && s.refId)
      .map((s) => s.refId as string);
    const chatIdBySession = await this.resolveChatIdsBySession(
      viewer.tenantId,
      chatSessionIds,
    );

    const documentIds = [...sourceByRawEvent.values()]
      .filter((s) => s.type === 'document' && s.refId)
      .map((s) => s.refId as string);
    const documentPaging = await this.resolveDocumentPaging(
      viewer.tenantId,
      documentIds,
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
          hasAudio: false,
        });
        continue;
      }

      const chatId =
        baseSource.type === 'chat' && baseSource.refId
          ? (chatIdBySession.get(baseSource.refId) ?? null)
          : null;
      const deepLinkExternalId =
        baseSource.type === 'chat' ? chatId : baseSource.refId;
      const page =
        baseSource.type === 'document' && baseSource.refId
          ? this.computeDocumentPage(
              documentPaging.get(baseSource.refId),
              ev.quote,
            )
          : null;
      const deepLink = deepLinkExternalId
        ? this.buildDeepLink({
            sourceType: baseSource.type,
            externalId: deepLinkExternalId,
            startMs: ev.startMs,
            messageExternalId: ev.sourceMessageExternalId,
            quote: ev.quote,
            page,
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
        hasAudio:
          baseSource.type === 'voice_note' &&
          hasAudioByRawEvent.has(ev.rawEventId),
      });
    }
    if (entityType === 'friction') {
      return this.maskFrictionByRole(nodes, viewer.viewerRole);
    }
    return nodes;
  }

  private async maskFrictionByRole(
    nodes: ProvenanceNode[],
    viewerRole: string | undefined,
  ): Promise<ProvenanceNode[]> {
    const verbatimRoles = await this.cfg.getDynamic<readonly string[]>(
      'provenance.frictionVerbatimRoles',
      undefined,
      FRICTION_VERBATIM_ROLES_FALLBACK,
    );
    if (viewerRole && verbatimRoles.includes(viewerRole)) return nodes;
    return nodes.map((n) => {
      if (n.accessFiltered) return n;
      const aggregateDeepLink = n.source.deepLink
        ? (n.source.deepLink.split('?')[0] ?? null)
        : null;
      return {
        ...n,
        quote: n.source.label,
        startMs: null,
        endMs: null,
        source: { ...n.source, deepLink: aggregateDeepLink },
      };
    });
  }

  private async resolveHasAudio(
    tenantId: string,
    rawEventIds: string[],
  ): Promise<Set<string>> {
    const out = new Set<string>();
    const ids = [...new Set(rawEventIds.filter(Boolean))];
    if (ids.length === 0) return out;
    const rows = await this.prisma.rawEvent.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, payload: true },
    });
    for (const r of rows) {
      if (this.extractAudioS3Key(r.payload)) out.add(r.id);
    }
    return out;
  }

  async resolveVoiceNoteAudioUrl(
    rawEventId: string,
    viewer: ViewerContext,
  ): Promise<VoiceNoteAudioResult> {
    const rawEvent = await this.prisma.rawEvent.findFirst({
      where: { id: rawEventId, tenantId: viewer.tenantId },
      select: { id: true, payload: true },
    });
    if (!rawEvent) return { status: 'not_found' };

    const audioS3Key = this.extractAudioS3Key(rawEvent.payload);
    if (!audioS3Key) return { status: 'not_found' };

    const evidences = await this.prisma.ideaBlockEvidence.findMany({
      where: { rawEventId },
      select: { blockId: true },
    });
    const blockIds = [...new Set(evidences.map((e) => e.blockId))];

    if (blockIds.length > 0) {
      const ctx = await this.accessResolver.resolveAccessibleGroups({
        tenantId: viewer.tenantId,
        userId: viewer.userId,
      });
      const part = await this.accessResolver.partitionProjectionsByAccess(
        ctx,
        blockIds.map((id) => ({ id, sourceBlockIds: [id] })),
      );
      if (part.accessibleIds.size === 0) return { status: 'forbidden' };
    }

    const ttl =
      (await this.cfg.getDynamic<number>(
        'provenance.voiceNoteAudioPresignTtlSeconds',
        undefined,
        VOICE_NOTE_AUDIO_TTL_SECONDS,
      )) ?? VOICE_NOTE_AUDIO_TTL_SECONDS;

    const { url, expiresAt } = await this.s3.presignGet(audioS3Key, ttl, {
      responseContentType: 'audio/ogg',
    });
    return { status: 'ok', url, expiresAt };
  }

  private extractAudioS3Key(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const metadata = (payload as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== 'object') return null;
    const key = (metadata as { audioS3Key?: unknown }).audioS3Key;
    return typeof key === 'string' && key.length > 0 ? key : null;
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
    let page: number | null = null;
    if (source?.type === 'document' && source.refId) {
      const paging = await this.resolveDocumentPaging(tenantId, [source.refId]);
      page = this.computeDocumentPage(paging.get(source.refId), ev.quote);
    }
    const deepLink = deepLinkExternalId
      ? this.buildDeepLink({
          sourceType: source!.type,
          externalId: deepLinkExternalId,
          startMs: ev.startMs,
          messageExternalId: ev.sourceMessageExternalId,
          quote: ev.quote,
          page,
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

  async resolveQuotesForJudge(
    tenantId: string,
    entityType: string,
    entityId: string,
    limit = 5,
  ): Promise<string[]> {
    const VALID: ReadonlyArray<ProvenanceEntityType> = [
      'decision',
      'issue',
      'regulation',
      'instruction',
      'block',
      'entity',
      'idea',
      'goal',
      'insight',
      'friction',
    ];
    if (!VALID.includes(entityType as ProvenanceEntityType)) return [];
    const blockIds = await this.collectSourceBlockIds(
      entityType as ProvenanceEntityType,
      entityId,
      tenantId,
    );
    if (blockIds.length === 0) return [];
    const evs = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId: { in: blockIds } },
      select: { quote: true },
      orderBy: [{ startMs: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });
    return evs
      .map((e) => (typeof e.quote === 'string' ? e.quote.trim() : ''))
      .filter((q) => q.length > 0);
  }

  private async resolveDocumentPaging(
    tenantId: string,
    documentIds: string[],
  ): Promise<
    Map<string, { parsedText: string | null; pageOffsets: number[] }>
  > {
    const out = new Map<
      string,
      { parsedText: string | null; pageOffsets: number[] }
    >();
    const ids = [...new Set(documentIds.filter(Boolean))];
    if (ids.length === 0) return out;
    const docs = await this.prisma.document.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, parsedText: true, pageOffsets: true },
    });
    for (const d of docs) {
      out.set(d.id, { parsedText: d.parsedText, pageOffsets: d.pageOffsets });
    }
    return out;
  }

  private computeDocumentPage(
    paging: { parsedText: string | null; pageOffsets: number[] } | undefined,
    quote: string,
  ): number | null {
    if (!paging || !paging.parsedText || paging.pageOffsets.length === 0) {
      return null;
    }
    const off = findQuoteOffset(paging.parsedText, quote);
    return off == null ? null : offsetToPage(paging.pageOffsets, off);
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
          where: { id: entityId, tenantId, deletedAt: null },
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
      case 'regulation':
      case 'instruction': {
        const r = await this.prisma.regulation.findFirst({
          where: { id: entityId, tenantId, deletedAt: null },
          select: { sourceBlockIds: true },
        });
        return r?.sourceBlockIds ?? [];
      }
      case 'block':
        return [entityId];
      case 'entity': {
        const links = await this.prisma.ideaBlockEntity.findMany({
          where: { entityId, block: { tenantId } },
          select: { blockId: true },
          orderBy: { createdAt: 'asc' },
          take: 200,
        });
        return links.map((l) => l.blockId);
      }
      case 'idea': {
        const i = await this.prisma.idea.findFirst({
          where: { id: entityId, tenantId },
          select: { sourceBlockIds: true },
        });
        return i?.sourceBlockIds ?? [];
      }
      case 'goal': {
        const g = await this.prisma.goal.findFirst({
          where: { id: entityId, tenantId },
          select: { sourceBlockIds: true },
        });
        return g?.sourceBlockIds ?? [];
      }
      case 'insight': {
        const s = await this.prisma.insight.findFirst({
          where: { id: entityId, tenantId },
          select: { sourceBlockIds: true },
        });
        return s?.sourceBlockIds ?? [];
      }
      case 'friction': {
        const l = await this.prisma.entityLink.findFirst({
          where: {
            id: entityId,
            tenantId,
            relationType: { in: TEAM_FRICTION_RELATION_TYPES },
          },
          select: { sourceBlockIds: true },
        });
        return l?.sourceBlockIds ?? [];
      }
      case 'notification':
        return [];
    }
  }
}
