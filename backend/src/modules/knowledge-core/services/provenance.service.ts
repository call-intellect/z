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

export function buildProvenanceDeepLink(args: {
  sourceType: ProvenanceSourceType;
  externalId: string;
  startMs?: number | null;
}): string | null {
  if (!args.externalId) return null;
  if (args.sourceType === 'meeting') {
    const sec = Math.max(0, Math.round((args.startMs ?? 0) / 1000));
    return `/meetings/${args.externalId}?t=${sec}`;
  }
  if (args.sourceType === 'document') {
    return `/documents/${args.externalId}`;
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
          accessFiltered: true,
        });
        continue;
      }

      const deepLink = baseSource.refId
        ? this.buildDeepLink({
            sourceType: baseSource.type,
            externalId: baseSource.refId,
            startMs: ev.startMs,
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
        accessFiltered: false,
      });
    }
    return nodes;
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
