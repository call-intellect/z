import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Entity, type TableProperty, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  type ExtractRowsPropertySchemaItem,
  buildTableExtractRowsPrompt,
} from '../../ai/services/prompts/table-extract-rows.prompt';

import { buildProvenanceDeepLink } from '../../knowledge-core/services/provenance.service';

import { parseEntitySync, resolveEntityTypes } from './entity-sync.util';

const DEFAULT_CONFIRMATION_THRESHOLD = 0.85;

interface ExtractedFact {
  propertyId: string;
  value: unknown;
  confidence: number;
  quote: string;
  timeSec: number;
}

interface DialogTurn {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
}

export interface EnrichResult {
  applied: number;
  pending: number;
  skippedCached: number;
}

@Injectable()
export class TableEnrichService {
  private readonly logger = new Logger(TableEnrichService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async enrichFromEvent(args: { meetingId: string; tenantId: string }): Promise<EnrichResult> {
    const empty: EnrichResult = { applied: 0, pending: 0, skippedCached: 0 };

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: args.meetingId },
      include: { transcript: { select: { turns: true } } },
    });
    if (!meeting || meeting.tenantId !== args.tenantId) return empty;
    const turns = (meeting.transcript?.turns as unknown as DialogTurn[] | null) ?? null;
    if (!turns || turns.length === 0) {
      this.logger.debug(
        { meetingId: args.meetingId },
        'table-enrich: нет transcript.turns — выход',
      );
      return empty;
    }
    const transcriptText = this.turnsToText(turns);

    const syncTables = await this.findAutoSyncTables(args.tenantId);
    if (syncTables.length === 0) return empty;
    const syncEntityTypes = new Set<string>();
    for (const t of syncTables) {
      for (const ty of t.entityTypes) syncEntityTypes.add(ty);
    }

    const entityIds = await this.resolveMeetingEntities({
      tenantId: args.tenantId,
      meetingId: args.meetingId,
      syncEntityTypes,
      transcriptText,
    });
    if (entityIds.size === 0) {
      this.logger.debug(
        { meetingId: args.meetingId },
        'table-enrich: ни одной Entity не сопоставлено встрече — выход',
      );
      return empty;
    }

    const threshold = await this.getConfirmationThreshold();
    const meetingLabel = this.meetingLabel(meeting.title);

    let applied = 0;
    let pending = 0;
    let skippedCached = 0;

    for (const table of syncTables) {
      const relevantEntityIds = [...entityIds].filter((id) => Boolean(id));
      if (relevantEntityIds.length === 0) continue;

      const rows = await this.prisma.tableRow.findMany({
        where: {
          tableId: table.id,
          tenantId: args.tenantId,
          entityId: { in: relevantEntityIds },
          deletedAt: null,
          archivedAt: null,
        },
        select: { id: true, cells: true, entityId: true },
      });
      if (rows.length === 0) continue;

      const fillable = this.fillableProperties(table.properties);
      if (fillable.length === 0) continue;
      const propSchema: ExtractRowsPropertySchemaItem[] = fillable.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
      }));
      const fillableIds = new Set(fillable.map((p) => p.id));

      for (const row of rows) {
        const entityLabel = await this.entityLabel(row.entityId);
        const facts = await this.extractFacts({
          tenantId: args.tenantId,
          meetingId: args.meetingId,
          propSchema,
          entityLabel,
          transcriptChunk: transcriptText,
        });
        if (facts.length === 0) continue;

        const cells = (row.cells as Record<string, unknown> | null) ?? {};

        for (const fact of facts) {
          if (!fillableIds.has(fact.propertyId)) continue;

          const already = await this.prisma.tableCellProvenance.findFirst({
            where: {
              tableRowId: row.id,
              propertyId: fact.propertyId,
              sourceId: args.meetingId,
              sourceType: 'meeting',
            },
            select: { id: true },
          });
          if (already) {
            skippedCached++;
            continue;
          }
          const pendingDup = await this.prisma.tableCellPendingPatch.findFirst({
            where: {
              tableRowId: row.id,
              propertyId: fact.propertyId,
              sourceId: args.meetingId,
              sourceType: 'meeting',
              status: 'pending',
            },
            select: { id: true },
          });
          if (pendingDup) {
            skippedCached++;
            continue;
          }

          const current = cells[fact.propertyId];
          const isEmpty = this.isEmptyCell(current);
          const sourceLink =
      buildProvenanceDeepLink({
        sourceType: 'meeting',
        externalId: args.meetingId,
        startMs: Math.round(fact.timeSec * 1000),
      }) ?? '';
          const sourceLabel = this.factSourceLabel(meetingLabel, fact.timeSec);

          if (isEmpty && fact.confidence >= threshold) {
            const merged = { ...cells, [fact.propertyId]: fact.value };
            await this.prisma.tableRow.update({
              where: { id: row.id },
              data: { cells: merged as Prisma.InputJsonValue },
            });
            cells[fact.propertyId] = fact.value;
            await this.prisma.tableCellProvenance.create({
              data: {
                tenantId: args.tenantId,
                tableRowId: row.id,
                propertyId: fact.propertyId,
                sourceType: 'meeting',
                sourceId: args.meetingId,
                sourceLabel,
                sourceLink,
                previousValue: Prisma.JsonNull,
                appliedValue: this.toJson(fact.value),
                confidence: new Prisma.Decimal(this.clampConfidence(fact.confidence)),
                appliedBy: 'agent',
              },
            });
            applied++;
          } else {
            const reason = !isEmpty ? 'overwrite' : 'low_confidence';
            await this.prisma.tableCellPendingPatch.create({
              data: {
                tenantId: args.tenantId,
                tableId: table.id,
                tableRowId: row.id,
                propertyId: fact.propertyId,
                proposedValue: this.toJson(fact.value),
                currentValue: isEmpty ? Prisma.JsonNull : this.toJson(current),
                confidence: new Prisma.Decimal(this.clampConfidence(fact.confidence)),
                sourceType: 'meeting',
                sourceId: args.meetingId,
                sourceLabel,
                sourceLink,
                status: 'pending',
                reason,
              },
            });
            pending++;
          }
        }
      }
    }

    if (applied > 0 || pending > 0) {
      await this.notifyOwner({
        tenantId: args.tenantId,
        ownerId: meeting.ownerId,
        meetingTitle: meeting.title,
        applied,
        pending,
      });
    }

    this.logger.log(
      { meetingId: args.meetingId, applied, pending, skippedCached },
      'table-enrich: завершено',
    );
    return { applied, pending, skippedCached };
  }

  async decidePendingPatch(args: {
    tenantId: string;
    patchId: string;
    decision: 'approve' | 'reject';
    userId: string;
  }): Promise<{ status: string }> {
    const patch = await this.prisma.tableCellPendingPatch.findUnique({
      where: { id: args.patchId },
    });
    if (!patch || patch.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'pending_patch_not_found',
          message: 'Правка на подтверждение не найдена',
        },
      });
    }
    if (patch.status !== 'pending') {
      return { status: patch.status };
    }

    if (args.decision === 'reject') {
      await this.prisma.tableCellPendingPatch.update({
        where: { id: patch.id },
        data: {
          status: 'rejected',
          decidedAt: new Date(),
          decidedBy: args.userId,
        },
      });
      return { status: 'rejected' };
    }

    const row = await this.prisma.tableRow.findUnique({
      where: { id: patch.tableRowId },
      select: { id: true, cells: true, tenantId: true, deletedAt: true },
    });
    if (!row || row.tenantId !== args.tenantId || row.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'row_not_found', message: 'Строка не найдена' },
      });
    }
    const cells = (row.cells as Record<string, unknown> | null) ?? {};
    const previous = cells[patch.propertyId];
    const merged = { ...cells, [patch.propertyId]: patch.proposedValue };
    await this.prisma.tableRow.update({
      where: { id: row.id },
      data: { cells: merged as Prisma.InputJsonValue },
    });
    await this.prisma.tableCellProvenance.create({
      data: {
        tenantId: args.tenantId,
        tableRowId: row.id,
        propertyId: patch.propertyId,
        sourceType: patch.sourceType,
        sourceId: patch.sourceId,
        sourceLabel: patch.sourceLabel,
        sourceLink: patch.sourceLink,
        previousValue: this.isEmptyCell(previous) ? Prisma.JsonNull : this.toJson(previous),
        appliedValue: patch.proposedValue as Prisma.InputJsonValue,
        confidence: patch.confidence,
        appliedBy: args.userId,
      },
    });
    await this.prisma.tableCellPendingPatch.update({
      where: { id: patch.id },
      data: {
        status: 'approved',
        decidedAt: new Date(),
        decidedBy: args.userId,
      },
    });
    return { status: 'approved' };
  }

  async undoCellEdit(args: {
    tenantId: string;
    provenanceId: string;
    userId: string;
  }): Promise<{ rolledBack: boolean }> {
    const prov = await this.prisma.tableCellProvenance.findUnique({
      where: { id: args.provenanceId },
    });
    if (!prov || prov.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'provenance_not_found',
          message: 'Запись о происхождении значения не найдена',
        },
      });
    }
    if (prov.rolledBackAt) {
      return { rolledBack: false };
    }
    const row = await this.prisma.tableRow.findUnique({
      where: { id: prov.tableRowId },
      select: { id: true, cells: true, tenantId: true, deletedAt: true },
    });
    if (!row || row.tenantId !== args.tenantId || row.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'row_not_found', message: 'Строка не найдена' },
      });
    }
    const cells = (row.cells as Record<string, unknown> | null) ?? {};
    const next = { ...cells };
    if (prov.previousValue === null || prov.previousValue === undefined) {
      delete next[prov.propertyId];
    } else {
      next[prov.propertyId] = prov.previousValue;
    }
    await this.prisma.tableRow.update({
      where: { id: row.id },
      data: { cells: next as Prisma.InputJsonValue },
    });
    await this.prisma.tableCellProvenance.update({
      where: { id: prov.id },
      data: { rolledBackAt: new Date() },
    });
    this.logger.log(
      { provenanceId: prov.id, userId: args.userId },
      'table-enrich: откат правки ячейки',
    );
    return { rolledBack: true };
  }

  async listPendingPatches(args: { tenantId: string; tableId?: string }): Promise<
    Array<{
      id: string;
      tableId: string;
      tableRowId: string;
      propertyId: string;
      proposedValue: unknown;
      currentValue: unknown;
      confidence: number;
      sourceType: string;
      sourceId: string;
      sourceLabel: string;
      sourceLink: string | null;
      reason: string | null;
      createdAt: Date;
    }>
  > {
    const rows = await this.prisma.tableCellPendingPatch.findMany({
      where: {
        tenantId: args.tenantId,
        status: 'pending',
        ...(args.tableId ? { tableId: args.tableId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((p) => ({
      id: p.id,
      tableId: p.tableId,
      tableRowId: p.tableRowId,
      propertyId: p.propertyId,
      proposedValue: p.proposedValue,
      currentValue: p.currentValue,
      confidence: Number(p.confidence.toString()),
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      sourceLabel: p.sourceLabel,
      sourceLink: p.sourceLink,
      reason: p.reason,
      createdAt: p.createdAt,
    }));
  }

  async listRowProvenance(args: { tenantId: string; rowId: string }): Promise<
    Array<{
      id: string;
      propertyId: string;
      sourceType: string;
      sourceId: string;
      sourceLabel: string;
      sourceLink: string | null;
      appliedValue: unknown;
      previousValue: unknown;
      confidence: number | null;
      appliedAt: Date;
      appliedBy: string;
      rolledBackAt: Date | null;
    }>
  > {
    const rows = await this.prisma.tableCellProvenance.findMany({
      where: { tenantId: args.tenantId, tableRowId: args.rowId },
      orderBy: { appliedAt: 'desc' },
      take: 200,
    });
    return rows.map((p) => ({
      id: p.id,
      propertyId: p.propertyId,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      sourceLabel: p.sourceLabel,
      sourceLink: p.sourceLink,
      appliedValue: p.appliedValue,
      previousValue: p.previousValue,
      confidence: p.confidence === null ? null : Number(p.confidence.toString()),
      appliedAt: p.appliedAt,
      appliedBy: p.appliedBy,
      rolledBackAt: p.rolledBackAt,
    }));
  }

  private async resolveMeetingEntities(args: {
    tenantId: string;
    meetingId: string;
    syncEntityTypes: Set<string>;
    transcriptText: string;
  }): Promise<Set<string>> {
    const found = new Set<string>();
    if (args.syncEntityTypes.size === 0) return found;

    const rawEvents = await this.prisma.rawEvent.findMany({
      where: { tenantId: args.tenantId, sourceExternalId: args.meetingId },
      select: { id: true },
    });
    if (rawEvents.length > 0) {
      const evidence = await this.prisma.ideaBlockEvidence.findMany({
        where: { rawEventId: { in: rawEvents.map((e) => e.id) } },
        select: { blockId: true },
      });
      const blockIds = [...new Set(evidence.map((e) => e.blockId))];
      if (blockIds.length > 0) {
        const links = await this.prisma.ideaBlockEntity.findMany({
          where: { blockId: { in: blockIds } },
          select: { entityId: true },
        });
        const candidateIds = [...new Set(links.map((l) => l.entityId))];
        await this.collectMatchingEntities(
          args.tenantId,
          candidateIds,
          args.syncEntityTypes,
          found,
        );
      }
    }

    const events = await this.prisma.event.findMany({
      where: {
        tenantId: args.tenantId,
        relatedMeetingId: args.meetingId,
        deletedAt: null,
      },
      select: { entityId: true },
    });
    if (events.length > 0) {
      await this.collectMatchingEntities(
        args.tenantId,
        events.map((e) => e.entityId),
        args.syncEntityTypes,
        found,
      );
    }

    if (found.size === 0) {
      const text = args.transcriptText.toLowerCase();
      const candidates = await this.prisma.entity.findMany({
        where: {
          tenantId: args.tenantId,
          type: { in: [...args.syncEntityTypes] as Entity['type'][] },
          mergedIntoId: null,
        },
        select: { id: true, canonicalName: true, aliases: true },
        take: 1000,
      });
      for (const c of candidates) {
        const names = [c.canonicalName, ...(c.aliases ?? [])]
          .map((n) => n?.trim().toLowerCase())
          .filter((n): n is string => Boolean(n) && n.length >= 3);
        if (names.some((n) => text.includes(n))) {
          found.add(c.id);
        }
      }
    }

    return found;
  }

  private async collectMatchingEntities(
    tenantId: string,
    candidateIds: string[],
    syncEntityTypes: Set<string>,
    out: Set<string>,
  ): Promise<void> {
    const ids = candidateIds.filter(Boolean);
    if (ids.length === 0) return;
    const entities = await this.prisma.entity.findMany({
      where: {
        id: { in: ids },
        tenantId,
        mergedIntoId: null,
        type: { in: [...syncEntityTypes] as Entity['type'][] },
      },
      select: { id: true },
    });
    for (const e of entities) out.add(e.id);
  }

  private async findAutoSyncTables(tenantId: string): Promise<
    Array<{
      id: string;
      properties: TableProperty[];
      entityTypes: string[];
    }>
  > {
    const tables = await this.prisma.table.findMany({
      where: {
        tenantId,
        deletedAt: null,
        archivedAt: null,
        entitySync: { not: Prisma.JsonNull },
      },
      include: { properties: true },
    });
    const out: Array<{
      id: string;
      properties: TableProperty[];
      entityTypes: string[];
    }> = [];
    for (const t of tables) {
      const sync = parseEntitySync(t.entitySync);
      if (!sync?.autoCreate) continue;
      const types = resolveEntityTypes(sync);
      if (types.length === 0) continue;
      out.push({ id: t.id, properties: t.properties, entityTypes: types });
    }
    return out;
  }

  private fillableProperties(properties: TableProperty[]): TableProperty[] {
    const skipTypes = new Set<string>([
      'relation',
      'rollup',
      'formula',
      'file',
      'createdAt',
      'updatedAt',
      'createdBy',
      'entityLink',
      'meetingLink',
      'documentLink',
    ]);
    return properties.filter((p) => {
      const cfg = (p.config as Record<string, unknown> | null) ?? {};
      if (cfg['readonly'] === true) return false;
      if (cfg['source'] === 'entity') return false;
      if (skipTypes.has(p.type)) return false;
      return true;
    });
  }

  private async extractFacts(args: {
    tenantId: string;
    meetingId: string;
    propSchema: ExtractRowsPropertySchemaItem[];
    entityLabel: string;
    transcriptChunk: string;
  }): Promise<ExtractedFact[]> {
    const prompt = buildTableExtractRowsPrompt({
      propertySchema: args.propSchema,
      entityLabel: args.entityLabel,
      transcriptChunk: args.transcriptChunk,
    });
    let text: string;
    try {
      const res = await this.llm.call({
        taskType: 'table-extract-rows',
        systemPrompt: prompt.system,
        userMessage: prompt.user,
        tenantId: args.tenantId,
        meetingId: args.meetingId,
        responseFormat: { type: 'json_object' },
        dataClass: 'internal',
        maxTokens: 1500,
        sourceRef: { type: 'meeting', id: args.meetingId },
      });
      text = res.text;
    } catch (err) {
      this.logger.warn(
        {
          meetingId: args.meetingId,
          err: err instanceof Error ? err.message : String(err),
        },
        'table-enrich: LLM extract упал — пропускаем строку',
      );
      return [];
    }
    return this.parseFacts(text);
  }

  private parseFacts(text: string): ExtractedFact[] {
    if (!text) return [];
    let candidate = text.trim();
    const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) candidate = fence[1].trim();
    if (!candidate.startsWith('{')) {
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) candidate = candidate.slice(start, end + 1);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return [];
    }
    const factsRaw = (parsed as { facts?: unknown }).facts;
    if (!Array.isArray(factsRaw)) return [];
    const out: ExtractedFact[] = [];
    for (const f of factsRaw) {
      if (!f || typeof f !== 'object') continue;
      const o = f as Record<string, unknown>;
      const propertyId = typeof o['propertyId'] === 'string' ? o['propertyId'] : '';
      if (!propertyId) continue;
      const value = o['value'];
      if (value === undefined || value === null || value === '') continue;
      const confRaw = o['confidence'];
      const confidence = typeof confRaw === 'number' && Number.isFinite(confRaw) ? confRaw : 0;
      const quote = typeof o['quote'] === 'string' ? o['quote'] : '';
      const timeRaw = o['timeSec'];
      const timeSec = typeof timeRaw === 'number' && Number.isFinite(timeRaw) ? timeRaw : 0;
      out.push({ propertyId, value, confidence, quote, timeSec });
    }
    return out;
  }

  private async notifyOwner(args: {
    tenantId: string;
    ownerId: string;
    meetingTitle: string;
    applied: number;
    pending: number;
  }): Promise<void> {
    try {
      const parts: string[] = [];
      if (args.applied > 0) {
        parts.push(
          `обновила ${args.applied} ${this.plural(args.applied, 'ячейку', 'ячейки', 'ячеек')}`,
        );
      }
      if (args.pending > 0) {
        parts.push(
          `подготовила ${args.pending} ${this.plural(args.pending, 'правку', 'правки', 'правок')} на подтверждение`,
        );
      }
      const summary = parts.join(' и ');
      const message = `После встречи «${args.meetingTitle}» я ${summary} в таблицах.`;

      await this.prisma.proactiveNotification.create({
        data: {
          tenantId: args.tenantId,
          userId: args.ownerId,
          ruleType: 'table_cells_enriched',
          severity: args.pending > 0 ? 'medium' : 'low',
          payloadJson: {
            message,
            applied: args.applied,
            pending: args.pending,
            meetingTitle: args.meetingTitle,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        {
          ownerId: args.ownerId,
          err: err instanceof Error ? err.message : String(err),
        },
        'table-enrich: уведомление Concierge не отправлено (best-effort)',
      );
    }
  }

  private async getConfirmationThreshold(): Promise<number> {
    const v = await this.cfg.getDynamic<number>(
      'table.agent.confirmation_threshold',
      undefined,
      DEFAULT_CONFIRMATION_THRESHOLD,
    );
    const n = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_CONFIRMATION_THRESHOLD;
    return Math.min(Math.max(n, 0), 1);
  }

  private async entityLabel(entityId: string | null): Promise<string> {
    if (!entityId) return 'сущность';
    const e = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: { canonicalName: true },
    });
    return e?.canonicalName?.trim() || 'сущность';
  }

  private turnsToText(turns: DialogTurn[]): string {
    return turns.map((t) => `[${this.fmtTime(t.startSec)}] ${t.speaker}: ${t.text}`).join('\n');
  }

  private meetingLabel(title: string): string {
    return (title ?? '').trim() || 'встреча';
  }

  private factSourceLabel(meetingLabel: string, timeSec: number): string {
    return `Встреча «${meetingLabel}», ${this.fmtTime(timeSec)}`;
  }

  private fmtTime(sec: number): string {
    const s = Math.max(0, Math.round(sec || 0));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  private isEmptyCell(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  private clampConfidence(c: number): number {
    const n = Number.isFinite(c) ? c : 0;
    return Math.round(Math.min(Math.max(n, 0), 1) * 100) / 100;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private plural(n: number, one: string, few: string, many: string): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }
}
